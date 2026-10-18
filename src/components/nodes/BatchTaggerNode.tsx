import { memo, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Braces,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  Loader2,
  MessageSquareText,
  Play,
  RotateCcw,
  Square,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { LLM_MODELS } from '../../providers/models';
import { PORT_COLOR } from '../../config/portTypes';
import { useApiKeysStore } from '../../stores/apiKeys';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { openLocalPath, openOutputFolder } from '../../services/imageOps';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  BATCH_TAGGER_DEFAULT_MODEL,
  buildBatchTagSidecarNames,
  classifyBatchTagFile,
  recommendedBatchTagModel,
  summarizeBatchTagSidecarDestination,
  type BatchTagMediaKind,
  type BatchTagMode,
  type BatchTagSidecarFormat,
} from '../../utils/batchTagger';
import {
  normalizeBatchConcurrency,
  normalizeBatchRetrySettings,
  runBatchWorkPool,
  summarizeBatchProgress,
} from '../../utils/batchProcessor';
import { formatMediaSize } from '../../utils/mediaCollection';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';

type BatchTagStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';
type BatchTagRunMode = 'all' | 'retry-failed';

interface BatchTagItem {
  id: string;
  kind: BatchTagMediaKind;
  url: string;
  name: string;
  relativePath?: string;
  sourcePath?: string;
  size?: number;
  mime?: string;
  status: BatchTagStatus;
  error?: string;
  text?: string;
  tags?: string[];
  caption?: string;
  shortCaption?: string;
  outputFiles?: Array<{ format: string; name: string; url?: string; path?: string; directory?: string }>;
}

type BatchTagOutputFile = NonNullable<BatchTagItem['outputFiles']>[number];

interface PickedLocalBatchTagFile {
  path: string;
  name?: string;
  kind?: BatchTagMediaKind;
  size?: number;
  mime?: string;
  relativePath?: string;
}

type BrowserDirectoryHandle = {
  values?: () => AsyncIterable<any>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    getFile?: () => Promise<File>;
    createWritable: () => Promise<{ write: (value: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

interface BrowserDirectoryFileEntry {
  file: File;
  relativePath: string;
}

interface BrowserSidecarTarget {
  root: BrowserDirectoryHandle;
}

const MODE_OPTIONS: Array<{ value: BatchTagMode; label: string; icon: any }> = [
  { value: 'tags', label: 'TAG', icon: Hash },
  { value: 'caption', label: '描述', icon: MessageSquareText },
  { value: 'short', label: '短句', icon: FileText },
  { value: 'json', label: 'JSON', icon: Braces },
];

const VIDEO_MODE_OPTIONS = [
  { value: 'frames', label: '关键帧' },
  { value: 'url', label: 'URL' },
  { value: 'compressed-base64', label: 'Base64' },
];

const KIND_LABEL: Record<BatchTagMediaKind, string> = {
  image: '图像',
  video: '视频',
};

const BATCH_TAGGER_CUSTOM_MODEL_VALUE = '__custom__';
const BATCH_TAGGER_EXTERNAL_TOOL_URL = 'https://zhaotutu.xyz';
const BATCH_TAGGER_ZHENZHEN_MODELS = LLM_MODELS.filter((model) => model.vision && !model.imageOutput);

async function openBatchTaggerExternalTool() {
  if (typeof window === 'undefined') return;
  if (typeof window.t8pc?.openExternal === 'function') {
    try {
      const result = await window.t8pc.openExternal(BATCH_TAGGER_EXTERNAL_TOOL_URL);
      if (result?.success === true) return;
    } catch {
      /* fallback to browser window below */
    }
  }
  window.open(BATCH_TAGGER_EXTERNAL_TOOL_URL, '_blank', 'noopener,noreferrer');
}

function statusMeta(status: BatchTagStatus) {
  if (status === 'running') return { label: '打标中', color: '#f59e0b', glow: 'rgba(245,158,11,.24)' };
  if (status === 'success') return { label: '已完成', color: '#22c55e', glow: 'rgba(34,197,94,.2)' };
  if (status === 'error') return { label: '失败', color: '#ef4444', glow: 'rgba(239,68,68,.22)' };
  if (status === 'skipped') return { label: '已跳过', color: '#94a3b8', glow: 'rgba(148,163,184,.16)' };
  return { label: '等待', color: 'var(--t8-text-dim)', glow: 'transparent' };
}

function itemKey(item: BatchTagItem): string {
  return `${item.kind}:${item.url}`;
}

function formatBatchTagOutputPath(file: BatchTagOutputFile): string {
  const pathValue = String(file.path || '').trim();
  if (pathValue) return pathValue;
  const directory = String(file.directory || '').trim();
  const name = String(file.name || '').trim();
  if (directory && name) {
    const separator = directory.includes('\\') ? '\\' : '/';
    return `${directory.replace(/[\\/]+$/, '')}${separator}${name.replace(/^[\\/]+/, '')}`;
  }
  return String(file.url || name || '').trim();
}

function dedupeItems(items: BatchTagItem[]): BatchTagItem[] {
  const seen = new Set<string>();
  const out: BatchTagItem[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (!item.url || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resetItem(item: BatchTagItem): BatchTagItem {
  return {
    ...item,
    status: 'pending',
    error: '',
    text: '',
    tags: [],
    caption: '',
    shortCaption: '',
    outputFiles: [],
  };
}

function createItem(input: {
  kind: BatchTagMediaKind;
  url: string;
  name?: string;
  relativePath?: string;
  sourcePath?: string;
  size?: number;
  mime?: string;
  index?: number;
}): BatchTagItem {
  const fallback = input.name || input.url.split('/').pop() || `素材-${(input.index || 0) + 1}`;
  return {
    id: `batch-tag-${Date.now()}-${input.index || 0}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    url: input.url,
    name: fallback,
    relativePath: input.relativePath,
    sourcePath: input.sourcePath,
    size: input.size,
    mime: input.mime,
    status: 'pending',
  };
}

function nativePathForFile(file: File): string {
  try {
    const fromBridge = typeof window !== 'undefined' ? window.t8pc?.getPathForFile?.(file) : '';
    if (fromBridge) return String(fromBridge);
  } catch {
    /* ignore */
  }
  return String((file as any).path || '').trim();
}

async function uploadBatchTagFile(file: File, index: number): Promise<BatchTagItem | null> {
  const kind = classifyBatchTagFile(file.name, file.type);
  if (!kind) return null;
  const nativeSourcePath = nativePathForFile(file);
  const fd = new FormData();
  fd.append('file', file);
  const response = await fetch('/api/files/upload', { method: 'POST', body: fd });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json.data?.url) {
    throw new Error(json?.error || `上传失败 HTTP ${response.status}`);
  }
  return createItem({
    kind,
    url: json.data.url,
    name: file.name,
    relativePath: String((file as any).webkitRelativePath || file.name || '').replace(/\\/g, '/'),
    sourcePath: nativeSourcePath,
    size: json.data.size || file.size,
    mime: json.data.mime || file.type,
    index,
  });
}

async function importLocalBatchTagPath(file: PickedLocalBatchTagFile, index: number): Promise<BatchTagItem | null> {
  const sourcePath = String(file.path || '').trim();
  const fallbackName = file.name || sourcePath.split(/[\\/]/).pop() || `素材-${index + 1}`;
  const kind = file.kind || classifyBatchTagFile(fallbackName, file.mime || '');
  if (!sourcePath || !kind) return null;
  const response = await fetch('/api/files/import-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json.data?.url) {
    throw new Error(json?.error || `导入本地素材失败 HTTP ${response.status}`);
  }
  const originalName = json.data.originalName || fallbackName;
  return createItem({
    kind,
    url: json.data.url,
    name: originalName,
    relativePath: String(file.relativePath || originalName || '').replace(/\\/g, '/'),
    sourcePath: json.data.sourcePath || sourcePath,
    size: json.data.size || file.size,
    mime: json.data.mime || file.mime,
    index,
  });
}

function browserDirectoryPickerAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

async function pickBrowserSidecarDirectory(): Promise<BrowserDirectoryHandle | null> {
  if (!browserDirectoryPickerAvailable()) return null;
  try {
    return await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

async function writeBrowserDirectoryText(root: BrowserDirectoryHandle, relativeName: string, text: string): Promise<string> {
  const parts = String(relativeName || 'batch-tag.txt').replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop() || 'batch-tag.txt';
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
  return [parts.join('/'), fileName].filter(Boolean).join('/');
}

async function collectBrowserDirectoryFiles(root: BrowserDirectoryHandle, prefix = ''): Promise<BrowserDirectoryFileEntry[]> {
  const out: BrowserDirectoryFileEntry[] = [];
  if (typeof root.values !== 'function') return out;
  for await (const entry of root.values()) {
    if (entry?.kind === 'directory') {
      out.push(...await collectBrowserDirectoryFiles(entry, `${prefix}${entry.name}/`));
      continue;
    }
    if (entry?.kind !== 'file' || typeof entry.getFile !== 'function') continue;
    const file = await entry.getFile();
    if (!classifyBatchTagFile(file.name, file.type)) continue;
    out.push({ file, relativePath: `${prefix}${file.name}` });
  }
  return out;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-[10px] font-semibold uppercase" style={{ color: 'var(--t8-text-muted)' }}>{children}</label>;
}

function BatchTaggerNode({ id, data, selected }: NodeProps) {
  const { t } = useTranslation('settings');
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const d = (data || {}) as any;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const browserSidecarTargetsRef = useRef<Map<string, BrowserSidecarTarget>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showAllOutputPaths, setShowAllOutputPaths] = useState(false);

  const upstream = useUpstreamMaterials(id);
  const upstreamItems = useMemo<BatchTagItem[]>(() => [
    ...upstream.images.map((item, index) => createItem({
      kind: 'image',
      url: item.url,
      name: item.label || `上游图像 ${index + 1}`,
      index,
    })),
    ...upstream.videos.map((item, index) => createItem({
      kind: 'video',
      url: item.url,
      name: item.label || `上游视频 ${index + 1}`,
      index: upstream.images.length + index,
    })),
  ], [upstream.images, upstream.videos]);

  const storedItems = Array.isArray(d.batchTagItems) ? d.batchTagItems as BatchTagItem[] : [];
  const allItems = useMemo(() => dedupeItems([...storedItems, ...upstreamItems]), [storedItems, upstreamItems]);
  const progress = summarizeBatchProgress(allItems as any);
  const running = d.status === 'running' || progress.status === 'running';
  const mode: BatchTagMode = ['tags', 'caption', 'short', 'json'].includes(d.batchTagMode) ? d.batchTagMode : 'tags';
  const upstreamTrigger = useMemo(
    () => upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').slice(0, 8000),
    [upstream.texts],
  );
  const triggerInputValue = String(d.batchTagTrigger ?? d.batchTagPrompt ?? '');
  const effectiveTrigger = String(triggerInputValue || upstreamTrigger || '').trim();
  const videoMode = ['url', 'compressed-base64', 'native-base64'].includes(d.batchTagVideoMode)
    ? d.batchTagVideoMode
    : 'frames';
  const frameCount = Math.max(1, Math.min(60, Number(d.batchTagFrameCount || 8)));
  const maxTags = Math.max(1, Math.min(200, Number(d.batchTagMaxTags || 30)));
  const requestedFormats = Array.isArray(d.batchTagFormats)
    ? d.batchTagFormats.filter((item: string) => item === 'txt' || item === 'json') as BatchTagSidecarFormat[]
    : [];
  const selectedFormat: BatchTagSidecarFormat = requestedFormats.includes('json') && !requestedFormats.includes('txt') ? 'json' : 'txt';
  const formats = [selectedFormat] as BatchTagSidecarFormat[];
  const concurrency = normalizeBatchConcurrency(d.batchTagConcurrency, 2, 1, 4);
  const { retryCount, continueOnError } = normalizeBatchRetrySettings({
    retryCount: d.batchTagRetryCount,
    continueOnError: d.batchTagContinueOnError,
  });

  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
  const llmProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'llm'), [advancedProviders]);
  const providerSelection = useMemo(
    () => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
      providerSource: d.batchTagProviderSource || d.providerSource,
      providerId: d.batchTagProviderId || d.providerId,
      providerModel: d.batchTagProviderModel || d.providerModel,
    }),
    [advancedProviders, d.batchTagProviderSource, d.batchTagProviderId, d.batchTagProviderModel, d.providerSource, d.providerId, d.providerModel],
  );
  const isExternal = providerSelection.available && providerSelection.providerSource !== 'zhenzhen';
  const externalModelOptions = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'llm')
    : [];
  const storedZhenzhenModel = String(d.batchTagProviderModel || '').trim();
  const storedZhenzhenModelIsPreset = BATCH_TAGGER_ZHENZHEN_MODELS.some((model) => model.id === storedZhenzhenModel);
  const isZhenzhenCustomModel = d.batchTagUseCustomModel === true || (Boolean(storedZhenzhenModel) && !storedZhenzhenModelIsPreset);
  const activeModel = isExternal
    ? recommendedBatchTagModel({
      providerSource: providerSelection.providerSource,
      requestedModel: providerSelection.providerModel,
      mediaKind: allItems.some((item) => item.kind === 'video') ? 'video' : 'image',
      chatModels: externalModelOptions,
    })
    : (storedZhenzhenModel || BATCH_TAGGER_DEFAULT_MODEL.zhenzhen);
  const zhenzhenModelPresetValue = isZhenzhenCustomModel || !BATCH_TAGGER_ZHENZHEN_MODELS.some((model) => model.id === activeModel) ? BATCH_TAGGER_CUSTOM_MODEL_VALUE : activeModel;
  const modelscopeHint = isExternal && providerSelection.providerSource === 'modelscope'
    ? 'ModelScope 推荐 Qwen/Qwen3-VL-235B-A22B-Instruct；文本 Qwen3 会自动切到 VL。'
    : '贞贞默认走 LLM 独立 Key；可选 LLM/Vision 预设或 Custom 自定义模型。';

  const patchItems = (items: BatchTagItem[]) => {
    const summary = summarizeBatchProgress(items as any);
    const successItems = items.filter((item) => item.status === 'success');
    update({
      batchTagItems: items,
      batchTagResults: items.filter((item) => item.status === 'success' || item.status === 'error'),
      batchTagProgress: summary,
      outputText: successItems.map((item) => item.text || item.caption || item.tags?.join(', ')).filter(Boolean).join('\n'),
      metadata: {
        schema: 't8-batch-tags-v1',
        items: successItems,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const appendFiles = async (
    files: File[],
    browserSidecarRoot?: BrowserDirectoryHandle | null,
    relativePathByName?: Map<string, string>,
    noticeSuffix = '',
  ) => {
    if (!files.length) return;
    setBusy(true);
    setLocalError('');
    try {
      const uploaded: BatchTagItem[] = [];
      let skipped = 0;
      for (let i = 0; i < files.length; i += 1) {
        const item = await uploadBatchTagFile(files[i], storedItems.length + uploaded.length + i);
        if (item) {
          const relativePath = relativePathByName?.get(files[i].name) || item.relativePath;
          const nextItem = relativePath ? { ...item, relativePath } : item;
          uploaded.push(nextItem);
          if (browserSidecarRoot) browserSidecarTargetsRef.current.set(nextItem.id, { root: browserSidecarRoot });
        } else skipped += 1;
      }
      const next = dedupeItems([...storedItems, ...uploaded]);
      const baseNotice = skipped ? `已加入 ${uploaded.length} 项，跳过 ${skipped} 个` : `已加入 ${uploaded.length} 项`;
      update({
        batchTagItems: next,
        batchTagNotice: `${baseNotice}${noticeSuffix}`,
      });
    } catch (error: any) {
      setLocalError(error?.message || '上传失败');
    } finally {
      setBusy(false);
    }
  };

  const appendPickedLocalFiles = async (files: PickedLocalBatchTagFile[]) => {
    if (!files.length) return;
    setBusy(true);
    setLocalError('');
    try {
      const uploaded: BatchTagItem[] = [];
      let skipped = 0;
      for (let i = 0; i < files.length; i += 1) {
        const item = await importLocalBatchTagPath(files[i], storedItems.length + uploaded.length + i);
        if (item) uploaded.push(item);
        else skipped += 1;
      }
      const next = dedupeItems([...storedItems, ...uploaded]);
      update({
        batchTagItems: next,
        batchTagNotice: skipped ? `已导入 ${uploaded.length} 项，跳过 ${skipped} 个` : `已导入 ${uploaded.length} 项`,
      });
    } catch (error: any) {
      setLocalError(error?.message || '导入本地素材失败');
    } finally {
      setBusy(false);
    }
  };

  const openFilePicker = async () => {
    const picker = typeof window !== 'undefined' ? window.t8pc?.pickMediaFiles : undefined;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }
    try {
      update({ batchTagNotice: '正在选择本地素材...' });
      const result = await picker({ multiple: true, kinds: ['image', 'video'] });
      if (!result?.success) throw new Error(result?.message || '选择本地素材失败');
      if (result.cancelled || !result.files?.length) {
        update({ batchTagNotice: '未选择素材' });
        return;
      }
      update({ batchTagNotice: `正在导入 ${result.files.length} 个本地素材...` });
      await appendPickedLocalFiles(result.files as PickedLocalBatchTagFile[]);
    } catch (error: any) {
      setLocalError(error?.message || '选择本地素材失败');
    }
  };

  const openFolderPicker = async () => {
    const picker = typeof window !== 'undefined' ? window.t8pc?.pickMediaFiles : undefined;
    if (!picker) {
      if (browserDirectoryPickerAvailable()) {
        try {
          update({ batchTagNotice: '正在选择本地文件夹...' });
          const root = await pickBrowserSidecarDirectory();
          if (!root) {
            update({ batchTagNotice: '未选择素材' });
            return;
          }
          const entries = await collectBrowserDirectoryFiles(root);
          if (!entries.length) {
            update({ batchTagNotice: '文件夹内没有可打标的图像/视频' });
            return;
          }
          const relativePathByName = new Map(entries.map((entry) => [entry.file.name, entry.relativePath]));
          update({ batchTagNotice: `正在导入 ${entries.length} 个本地素材...` });
          await appendFiles(entries.map((entry) => entry.file), root, relativePathByName);
          return;
        } catch (error: any) {
          setLocalError(error?.message || '选择本地文件夹失败');
          return;
        }
      }
      folderInputRef.current?.click();
      return;
    }
    try {
      update({ batchTagNotice: '正在选择本地文件夹...' });
      const result = await picker({ directory: true, multiple: true, kinds: ['image', 'video'] });
      if (!result?.success) throw new Error(result?.message || '选择本地文件夹失败');
      if (result.cancelled || !result.files?.length) {
        update({ batchTagNotice: '未选择素材' });
        return;
      }
      update({ batchTagNotice: `正在导入 ${result.files.length} 个本地素材${result.truncated ? '（已截断）' : ''}...` });
      await appendPickedLocalFiles(result.files as PickedLocalBatchTagFile[]);
    } catch (error: any) {
      setLocalError(error?.message || '选择本地文件夹失败');
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    void (async () => {
      const browserFileUploadWithoutNativePath = !window.t8pc?.pickMediaFiles && files.every((file) => !nativePathForFile(file));
      update({ batchTagNotice: `正在上传 ${files.length} 个文件...` });
      await appendFiles(
        files,
        null,
        undefined,
        browserFileUploadWithoutNativePath ? '；浏览器文件上传无法获取原始目录，打标文件会保存到 input，需写回原目录请用“文件夹”导入' : '',
      );
    })();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void appendFiles(Array.from(event.dataTransfer?.files || []));
  };

  type WorkEntry = { item: BatchTagItem; index: number };

  const needsBrowserSidecarTarget = (item: BatchTagItem) => {
    return !String(item.sourcePath || '').trim() && !browserSidecarTargetsRef.current.has(item.id);
  };

  const ensureBrowserSidecarTargetsForRun = async (items: BatchTagItem[]) => {
    if (typeof window === 'undefined' || window.t8pc?.pickMediaFiles || !browserDirectoryPickerAvailable()) return true;
    const missing = items.filter(needsBrowserSidecarTarget);
    if (!missing.length) return true;
    update({
      batchTagNotice: '浏览器文件上传无法自动写回原目录，本次会保存到上传副本目录；需写回原目录请用“文件夹”导入素材目录',
    });
    return true;
  };

  const mirrorBrowserSidecars = async (item: BatchTagItem, outputFiles: BatchTagItem['outputFiles'] = []) => {
    const target = browserSidecarTargetsRef.current.get(item.id);
    if (!target || !outputFiles.length) return outputFiles;
    const mirrored: NonNullable<BatchTagItem['outputFiles']> = [];
    for (const outputFile of outputFiles) {
      const url = String(outputFile.url || '').trim();
      if (!url) {
        mirrored.push(outputFile);
        continue;
      }
      const response = await fetch(url);
      if (!response.ok) {
        mirrored.push(outputFile);
        continue;
      }
      const text = await response.text();
      const format = outputFile.format === 'json' ? 'json' : 'txt';
      const desiredNames = buildBatchTagSidecarNames({
        name: item.name,
        relativePath: item.relativePath,
        formats: [format],
      });
      const writtenName = await writeBrowserDirectoryText(target.root, desiredNames[format] || outputFile.name || `${item.name}.${format}`, text);
      mirrored.push({
        ...outputFile,
        name: writtenName,
        path: `browser-fs://${writtenName}`,
        directory: '浏览器授权的原素材目录',
      });
    }
    return mirrored;
  };

  const tagOne = async (
    entry: WorkEntry,
    signal: AbortSignal,
    submissionKey = '',
  ): Promise<BatchTagItem> => {
    if ((d.batchTagProviderId || d.batchTagProviderSource) && d.batchTagProviderSource !== 'zhenzhen' && !isExternal) {
      throw new Error(t('strata.sourceUnavailable'));
    }
    const response = await fetch('/api/batch-tags/tag', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(submissionKey ? { 'X-T8-Provider-Submission': submissionKey } : {}),
      },
      body: JSON.stringify({
        providerSource: isExternal ? providerSelection.providerSource : 'zhenzhen',
        providerId: isExternal ? providerSelection.providerId : '',
        model: activeModel,
        item: entry.item,
        mode,
        videoMode,
        frameCount,
        maxTags,
        formats,
        overwrite: d.batchTagOverwrite === true,
        triggerText: effectiveTrigger,
        temperature: 0.2,
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error || `打标失败 HTTP ${response.status}`);
    }
    const result = json.data || {};
    const outputFiles = Array.isArray(result.outputFiles) ? await mirrorBrowserSidecars(entry.item, result.outputFiles) : [];
    return {
      ...entry.item,
      status: 'success',
      error: '',
      text: result.text || '',
      tags: Array.isArray(result.tags) ? result.tags : [],
      caption: result.caption || '',
      shortCaption: result.shortCaption || '',
      outputFiles,
    };
  };

  const runBatch = async (retryOnly = false, reporter?: RunNodeLifecycleReporter) => {
    const deduped = dedupeItems(allItems);
    if (!deduped.length) {
      const msg = '请先上传图片/视频、导入文件夹或连接上游素材';
      setLocalError(msg);
      update({ status: 'error', error: msg });
      return;
    }
    const targetKeys = new Set(
      deduped.filter((item) => !retryOnly || item.status === 'error').map(itemKey),
    );
    if (retryOnly && targetKeys.size === 0) {
      update({ batchTagNotice: '没有失败项需要重试' });
      return;
    }
    const baseItems = deduped.map((item) => (targetKeys.has(itemKey(item)) ? resetItem(item) : item));
    const workEntries = baseItems
      .map((item, index) => ({ item, index }))
      .filter((entry) => targetKeys.has(itemKey(entry.item)));

    if (!await ensureBrowserSidecarTargetsForRun(workEntries.map((entry) => entry.item))) {
      update({
        status: 'idle',
        batchTagItems: baseItems,
        batchTagProgress: summarizeBatchProgress(baseItems as any),
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    cancelRef.current = false;
    setLocalError('');
    update({
      status: 'running',
      error: '',
      batchTagItems: baseItems,
      batchTagProgress: summarizeBatchProgress(baseItems as any),
      batchTagNotice: `${retryOnly ? '重试失败项' : '批量打标'}：${workEntries.length} 项 · 并发 ${concurrency} · 重试 ${retryCount}`,
    });
    await reporter?.providerRequest({
      provider: 'batch-tagger',
      model: activeModel,
      itemCount: workEntries.length,
      mode,
    });

    let nextItems = [...baseItems];
    const patchAt = (index: number, patch: Partial<BatchTagItem>) => {
      nextItems = nextItems.map((item, i) => (i === index ? { ...item, ...patch } : item));
      patchItems(nextItems);
    };

    const results = await runBatchWorkPool<WorkEntry, BatchTagItem>({
      items: workEntries,
      concurrency,
      retryCount,
      retryDelayMs: 800,
      continueOnError,
      signal: controller.signal,
      onItemStatus: (event) => {
        const masterIndex = event.item.index;
        if (event.status === 'start') {
          patchAt(masterIndex, {
            status: 'running',
            error: event.attempt > 1 ? `重试 ${event.attempt}/${event.maxAttempts}` : '',
          });
        } else if (event.status === 'retry') {
          patchAt(masterIndex, { status: 'running', error: `准备重试：${event.error || '请求失败'}` });
        }
      },
      worker: (entry) => {
        const baseKey = String(reporter?.providerSubmissionKey || '').trim();
        const submissionKey = baseKey
          ? `${baseKey}:batch-tag:${entry.index}`
          : '';
        return tagOne(entry, controller.signal, submissionKey);
      },
    });

    for (const result of results) {
      if (result.status === 'success' && result.value) {
        patchAt(result.item.index, result.value);
      } else if (result.status === 'cancelled') {
        patchAt(result.item.index, { status: 'skipped', error: result.error || '已停止' });
      } else {
        patchAt(result.item.index, { status: 'error', error: result.error || '打标失败' });
      }
    }
    await reporter?.providerResponse({
      provider: 'batch-tagger',
      model: activeModel,
      status: controller.signal.aborted || cancelRef.current ? 'cancelled' : 'succeeded',
      itemCount: workEntries.length,
      succeeded: results.filter((result) => result.status === 'success').length,
      failed: results.filter((result) => result.status === 'error').length,
      cancelled: results.filter((result) => result.status === 'cancelled').length,
    });
    update({
      status: controller.signal.aborted || cancelRef.current ? 'idle' : 'success',
      batchTagNotice: controller.signal.aborted || cancelRef.current ? '批量打标已停止' : summarizeBatchTagSidecarDestination(nextItems),
    });
    abortRef.current = null;
  };

  const stopBatch = () => {
    cancelRef.current = true;
    abortRef.current?.abort();
    update({ status: 'idle', batchTagNotice: '正在停止本地队列...' });
  };

  const requestBatchTagRun = (runMode: BatchTagRunMode) => {
    if (running) return;
    const requestId = runMode === 'retry-failed'
      ? createCanvasNodeRunRequestId(id, 'batch-tag-retry')
      : '';
    update({ batchTagRunMode: runMode, batchTagRunRequestId: requestId });
    // Canvas must snapshot the persisted intent, not the click handler's stale
    // render, so publish it before dispatching the preflight request.
    window.requestAnimationFrame(() => requestCanvasNodeRun(id, requestId ? { requestId } : {}));
  };

  useRunTrigger(id, async (reporter) => {
    if (running) return;
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const retryOnly = Boolean(reporter.runContext?.requestId)
      && reporter.runContext?.requestId === liveData?.batchTagRunRequestId
      && liveData?.batchTagRunMode === 'retry-failed';
    try {
      await runBatch(retryOnly, reporter);
    } finally {
      update({ batchTagRunMode: 'all', batchTagRunRequestId: '' });
    }
  }, 'batch-tagger', { lifecycleAware: true });

  const resultItems = allItems.filter((item) => item.status === 'success' || item.status === 'error');
  const previewItem = [...allItems].reverse().find((item) => item.status === 'success') || resultItems[0] || allItems[0];
  const sampleNames = previewItem ? buildBatchTagSidecarNames({
    name: previewItem.name,
    relativePath: previewItem.relativePath,
    formats,
  }) : {};
  const allOutputFiles = useMemo(() => allItems.flatMap((item) => (item.outputFiles || []).map((file) => ({
    itemName: item.relativePath || item.name,
    file,
    displayPath: formatBatchTagOutputPath(file),
  }))).filter((entry) => entry.displayPath), [allItems]);
  const latestOutputFile = [...allOutputFiles].reverse().find((entry) => (
    String(entry.file.path || entry.file.directory || '').trim()
  ));
  const latestOutputPath = String(latestOutputFile?.file.path || '').trim();
  const latestOutputDir = String(latestOutputFile?.file.directory || '').trim();

  const openBatchTagOutput = async () => {
    setFolderBusy(true);
    try {
      if (latestOutputPath || latestOutputDir) {
        if (latestOutputPath.startsWith('browser-fs://') || latestOutputDir.includes('浏览器授权')) {
          update({ batchTagNotice: '结果已写回浏览器授权的原素材目录，请在系统文件夹中查看' });
          return;
        }
        const normalizedDir = latestOutputDir.replace(/\\/g, '/');
        if (/(^|\/)T8-penguin-canvas\/input$/i.test(normalizedDir) && allItems.some((item) => !String(item.sourcePath || '').trim())) {
          update({ batchTagNotice: '当前结果只在上传副本目录；需写回原目录请用“文件夹”导入素材目录' });
          return;
        }
        await openLocalPath(latestOutputPath || latestOutputDir, { selectFile: Boolean(latestOutputPath) });
        update({ batchTagNotice: latestOutputPath ? '已定位最近打标文件' : '已打开最近打标目录' });
        return;
      }
      await openOutputFolder('batch-tags');
      update({ batchTagNotice: '已打开 output/batch-tags' });
    } catch (error: any) {
      setLocalError(error?.message || '打开输出目录失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const clearItems = () => {
    cancelRef.current = true;
    abortRef.current?.abort();
    update({
      batchTagItems: [],
      batchTagResults: [],
      batchTagProgress: summarizeBatchProgress([]),
      outputText: '',
      metadata: null,
      status: 'idle',
      error: '',
      batchTagNotice: '队列已清空',
    });
    setLocalError('');
  };

  const removeItem = (index: number) => {
    if (running) return;
    const nextItems = allItems.filter((_, itemIndex) => itemIndex !== index);
    const successItems = nextItems.filter((item) => item.status === 'success');
    update({
      batchTagItems: nextItems,
      batchTagResults: nextItems.filter((item) => item.status === 'success' || item.status === 'error'),
      batchTagProgress: summarizeBatchProgress(nextItems as any),
      outputText: successItems.map((item) => item.text || item.caption || item.tags?.join(', ')).filter(Boolean).join('\n'),
      metadata: successItems.length ? {
        schema: 't8-batch-tags-v1',
        items: successItems,
        updatedAt: new Date().toISOString(),
      } : null,
      batchTagNotice: `已删除素材 ${index + 1}`,
    });
    setLocalError('');
  };

  const selectFormat = (format: BatchTagSidecarFormat) => {
    update({ batchTagFormats: [format] });
  };

  return (
    <div
      className="t8-node w-[720px] overflow-hidden"
      data-node-type="batch-tagger"
      style={{
        borderColor: selected ? 'var(--t8-accent)' : 'var(--t8-border-strong)',
        boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--t8-accent) 30%, transparent)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: PORT_COLOR.image, border: '1px solid var(--t8-bg-node)' }} />
      <Handle type="source" position={Position.Right} id="text" style={{ top: '42%', background: PORT_COLOR.text, border: '1px solid var(--t8-bg-node)' }} />
      <Handle type="source" position={Position.Right} id="metadata" style={{ top: '58%', background: PORT_COLOR.metadata, border: '1px solid var(--t8-bg-node)' }} />

      <div className="t8-node-header flex items-center gap-2 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: '#f472b6', color: '#260516' }}>
          <Tags size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">批量打标</div>
          <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
            {progress.total} 项 · {progress.done}/{progress.total} · 成功 {progress.ok} · 失败 {progress.fail}
          </div>
          <button
            type="button"
            className="t8-batch-tagger-tool-link nodrag nowheel mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold"
            title="在新窗口打开图图打标器"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void openBatchTaggerExternalTool();
            }}
            style={{
              color: '#0f172a',
              background: '#f8fafc',
              border: '1px solid rgba(15, 23, 42, 0.45)',
              boxShadow: '0 1px 0 rgba(255, 255, 255, 0.72), 0 1px 4px rgba(15, 23, 42, 0.18)',
            }}
          >
            <ExternalLink size={11} className="shrink-0" />
            <span className="truncate">最好的打标工具-图图打标器：点击获取</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[10px] font-bold" style={{ color: progress.fail ? '#ef4444' : running ? '#f59e0b' : '#16a34a' }}>
          {running ? <Loader2 size={13} className="animate-spin" /> : progress.fail ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
          {running ? '打标中' : progress.total ? '待运行' : '待导入'}
        </div>
      </div>

      <div
        className="nodrag nowheel grid gap-3 p-3"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}
        onMouseDown={(event) => event.stopPropagation()}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 space-y-2">
          <div
            className={`rounded-md border border-dashed p-2 transition-colors ${dragActive ? 'bg-cyan-500/10' : ''}`}
            style={{ borderColor: dragActive ? '#22d3ee' : 'var(--t8-border)' }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFileChange}
              {...({ webkitdirectory: '', directory: '' } as any)}
            />
            <div className="flex items-center gap-2">
              <button type="button" className="t8-btn px-2 py-1.5 text-xs" onClick={() => void openFilePicker()} disabled={busy || running}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                文件
              </button>
              <button type="button" className="t8-btn px-2 py-1.5 text-xs" onClick={() => void openFolderPicker()} disabled={busy || running}>
                <FolderOpen size={13} />
                文件夹
              </button>
              <button type="button" className="t8-btn px-2 py-1.5 text-xs" onClick={clearItems} disabled={running}>
                <X size={13} />
                清空
              </button>
              <span className="ml-auto truncate text-[10px]" style={{ color: 'var(--t8-text-dim)' }}>{d.batchTagNotice || '拖拽图片/视频也可导入'}</span>
            </div>
          </div>

          <div className="rounded-md border p-2" style={{ borderColor: 'var(--t8-border)' }}>
            <div className="mb-1 flex items-center justify-between text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
              <span>素材队列</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--t8-bg-soft)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress.percent}%`, background: progress.fail ? '#ef4444' : '#22c55e' }} />
            </div>
            <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
              {allItems.length === 0 ? (
                <div className="rounded border border-dashed px-2 py-5 text-center text-[11px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-dim)' }}>
                  等待图像/视频素材
                </div>
              ) : allItems.map((item, index) => {
                const meta = statusMeta(item.status);
                return (
                  <div
                    key={itemKey(item)}
                    className="grid min-h-[38px] items-center gap-2 rounded px-2 py-1"
                    data-batch-tag-status={item.status}
                    style={{ background: 'var(--t8-bg-soft)', gridTemplateColumns: '14px 38px minmax(0, 1fr) 64px 28px' }}
                  >
                    <span className="inline-flex h-3 w-3 items-center justify-center rounded-full border" title={meta.label} style={{ borderColor: meta.color, boxShadow: `0 0 0 3px ${meta.glow}` }}>
                      <span className={`h-1.5 w-1.5 rounded-full ${item.status === 'running' ? 'animate-pulse' : ''}`} style={{ background: meta.color }} />
                    </span>
                    <span className="rounded px-1 py-0.5 text-center text-[10px] font-bold" style={{ background: 'var(--t8-bg-node)', color: 'var(--t8-text-main)' }}>{KIND_LABEL[item.kind]}</span>
                    <span className="min-w-0 truncate text-[11px]" style={{ color: 'var(--t8-text-main)' }} title={`${item.relativePath || item.name}\n${item.error || item.text || ''}`}>{item.relativePath || item.name}</span>
                    <span className="truncate text-right text-[10px]" style={{ color: item.status === 'error' ? '#ef4444' : 'var(--t8-text-dim)' }}>{item.status === 'success' ? '已保存' : item.error || formatMediaSize(item.size)}</span>
                    <button
                      type="button"
                      className="nodrag nowheel inline-flex h-7 w-7 items-center justify-center rounded"
                      data-batch-tag-item-action="delete"
                      aria-label={`删除素材 ${index + 1}`}
                      title="删除素材"
                      onClick={(event) => { event.stopPropagation(); removeItem(index); }}
                      disabled={running}
                      style={{ color: running ? 'var(--t8-text-dim)' : '#ef4444', opacity: running ? 0.45 : 1 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 38px' }}>
            {running ? (
              <button type="button" className="t8-btn px-3 py-2 text-sm" onClick={stopBatch}>
                <Square size={14} />
                停止
              </button>
            ) : (
              <button type="button" className="t8-btn t8-btn-primary px-3 py-2 text-sm" onClick={() => requestBatchTagRun('all')} disabled={!allItems.length || busy}>
                <Play size={14} />
                开始打标
              </button>
            )}
            <button type="button" className="t8-btn px-3 py-2 text-sm" onClick={() => requestBatchTagRun('retry-failed')} disabled={running || progress.fail === 0}>
              <RotateCcw size={14} />
              重试失败
            </button>
            <button type="button" className="t8-btn justify-center px-2 py-2" onClick={openBatchTagOutput} disabled={folderBusy} title={latestOutputDir ? '打开最近打标目录' : '打开 output/batch-tags'}>
              {folderBusy ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            </button>
          </div>

          {(localError || d.error) && (
            <div className="flex items-start gap-1 rounded-md border px-2 py-1.5 text-[11px]" style={{ borderColor: '#ef444466', color: '#ef4444' }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{localError || d.error}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="rounded-md border p-2" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-soft)' }}>
            <div className="mb-2 grid grid-cols-4 gap-1">
              {MODE_OPTIONS.map((item) => {
                const Icon = item.icon;
                const active = mode === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className="t8-btn min-w-0 justify-center px-1.5 py-1.5 text-[11px]"
                    aria-pressed={active}
                    onClick={() => update({ batchTagMode: item.value })}
                    disabled={running}
                    style={{
                      borderColor: active ? '#ec4899' : 'var(--t8-border)',
                      background: active ? 'rgba(236,72,153,.18)' : 'var(--t8-bg-node)',
                    }}
                  >
                    <Icon size={12} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label className="block">
                <FieldLabel>API</FieldLabel>
                <select
                  className="t8-select w-full px-2 py-1.5 text-xs"
                  value={isExternal ? providerSelection.providerId : 'zhenzhen'}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    if (nextId === 'zhenzhen') {
                      update({ batchTagProviderSource: 'zhenzhen', batchTagProviderId: '', batchTagProviderModel: BATCH_TAGGER_DEFAULT_MODEL.zhenzhen, batchTagUseCustomModel: false });
                      return;
                    }
                    const provider = llmProviders.find((item) => item.id === nextId);
                    const models = advancedProviderModelOptions(provider as any, 'llm');
                    const model = recommendedBatchTagModel({
                      providerSource: provider?.protocol,
                      requestedModel: models[0],
                      mediaKind: 'image',
                      chatModels: models,
                    });
                    update({ batchTagProviderSource: provider?.protocol || '', batchTagProviderId: provider?.id || '', batchTagProviderModel: model });
                  }}
                  disabled={running}
                >
                  <option value="zhenzhen">贞贞 LLM 独立 Key</option>
                  {llmProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>
                  ))}
                </select>
              </label>

              {isExternal ? (
                <label className="block">
                  <FieldLabel>模型</FieldLabel>
                  <select
                    className="t8-select w-full px-2 py-1.5 text-xs"
                    value={activeModel}
                    onChange={(event) => update({ batchTagProviderModel: event.target.value })}
                    disabled={running}
                  >
                    {Array.from(new Set([
                      ...(providerSelection.providerSource === 'modelscope' ? [BATCH_TAGGER_DEFAULT_MODEL.modelscope] : []),
                      ...externalModelOptions,
                      activeModel,
                    ].filter(Boolean))).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="space-y-1.5">
                  <label className="block">
                    <FieldLabel>贞贞模型</FieldLabel>
                    <select
                      className="t8-select w-full px-2 py-1.5 text-xs"
                      value={zhenzhenModelPresetValue}
                      onChange={(event) => {
                        if (event.target.value === BATCH_TAGGER_CUSTOM_MODEL_VALUE) {
                          update({ batchTagUseCustomModel: true, batchTagProviderModel: activeModel });
                          return;
                        }
                        update({ batchTagUseCustomModel: false, batchTagProviderModel: event.target.value });
                      }}
                      disabled={running}
                    >
                      {BATCH_TAGGER_ZHENZHEN_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                      <option value="__custom__">Custom / 自定义</option>
                    </select>
                  </label>
                  {zhenzhenModelPresetValue === '__custom__' && (
                    <label className="block">
                      <FieldLabel>Custom 模型</FieldLabel>
                      <input className="t8-input w-full px-2 py-1.5 text-xs" value={activeModel} onChange={(event) => update({ batchTagProviderModel: event.target.value })} disabled={running} />
                    </label>
                  )}
                </div>
              )}
            </div>
            <div className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--t8-text-dim)' }}>{modelscopeHint}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="min-w-0">
              <FieldLabel>视频模式</FieldLabel>
              <select className="t8-select w-full px-1.5 py-1 text-xs" value={videoMode} onChange={(event) => update({ batchTagVideoMode: event.target.value })} disabled={running}>
                {VIDEO_MODE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <FieldLabel>关键帧</FieldLabel>
              <input type="number" min={1} max={60} className="t8-input w-full px-1.5 py-1 text-xs" value={frameCount} onChange={(event) => update({ batchTagFrameCount: Number(event.target.value) })} disabled={running} />
            </label>
            <label className="min-w-0">
              <FieldLabel>最大TAG</FieldLabel>
              <input type="number" min={1} max={200} className="t8-input w-full px-1.5 py-1 text-xs" value={maxTags} onChange={(event) => update({ batchTagMaxTags: Number(event.target.value) })} disabled={running} />
            </label>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <label className="min-w-0">
              <FieldLabel>并发</FieldLabel>
              <select className="t8-select w-full px-1.5 py-1 text-xs" value={concurrency} onChange={(event) => update({ batchTagConcurrency: Number(event.target.value) })} disabled={running}>
                {[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <FieldLabel>重试</FieldLabel>
              <select className="t8-select w-full px-1.5 py-1 text-xs" value={retryCount} onChange={(event) => update({ batchTagRetryCount: Number(event.target.value) })} disabled={running}>
                {[0, 1, 2, 3].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-end gap-1 rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-main)' }}>
              <input type="checkbox" checked={continueOnError} onChange={(event) => update({ batchTagContinueOnError: event.target.checked })} disabled={running} />
              失败继续
            </label>
            <label className="flex min-w-0 items-end gap-1 rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-main)' }}>
              <input type="checkbox" checked={d.batchTagOverwrite === true} onChange={(event) => update({ batchTagOverwrite: event.target.checked })} disabled={running} />
              覆盖
            </label>
          </div>

          <div className="rounded-md border p-2" style={{ borderColor: 'var(--t8-border)' }}>
            <div className="mb-1 flex items-center justify-between">
              <FieldLabel>保存</FieldLabel>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="t8-btn px-1.5 py-0.5 text-[10px]"
                  onClick={() => setShowAllOutputPaths((value) => !value)}
                  disabled={!allOutputFiles.length}
                  title="查看全部打标文件的实际路径"
                >
                  查看全部路径
                </button>
                <span className="text-[10px]" style={{ color: 'var(--t8-text-dim)' }}>原素材目录</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: 'var(--t8-text-main)' }}>
              <label className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: 'var(--t8-border)' }}>
                <input type="radio" name={`batch-tag-format-${id}`} checked={selectedFormat === 'txt'} onChange={() => selectFormat('txt')} disabled={running} />
                TXT
              </label>
              <label className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: 'var(--t8-border)' }}>
                <input type="radio" name={`batch-tag-format-${id}`} checked={selectedFormat === 'json'} onChange={() => selectFormat('json')} disabled={running} />
                JSON
              </label>
            </div>
            <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--t8-text-dim)' }}>
              {sampleNames.txt || sampleNames.json || 'foo.png -> foo.txt'}
            </div>
            {showAllOutputPaths && (
              <div
                data-batch-tag-output-paths
                className="mt-2 max-h-24 space-y-1 overflow-auto rounded border px-2 py-1 text-[10px]"
                style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-node)', color: 'var(--t8-text-main)' }}
              >
                {allOutputFiles.length ? allOutputFiles.map((entry, index) => (
                  <div key={`${entry.file.format}-${entry.displayPath}-${index}`} className="min-w-0 break-all" title={`${entry.itemName}\n${entry.displayPath}`}>
                    {index + 1}. {entry.displayPath}
                  </div>
                )) : (
                  <div style={{ color: 'var(--t8-text-dim)' }}>暂无已生成路径</div>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <FieldLabel>统一触发词</FieldLabel>
            <textarea
              className="t8-input h-16 w-full resize-none px-2 py-1.5 text-xs"
              value={triggerInputValue}
              onChange={(event) => update({ batchTagTrigger: event.target.value, batchTagPrompt: '' })}
              disabled={running}
              placeholder={upstreamTrigger ? '已接入上游触发词；输入可覆盖' : '例如 zhenzhen'}
            />
            {upstream.texts.length > 0 && !String(triggerInputValue).trim() && (
              <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--t8-text-dim)' }}>
                已使用上游触发词 {upstream.texts.length} 条
              </div>
            )}
          </label>

          <div className="rounded-md border p-2" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-soft)' }}>
            <div className="mb-1 flex items-center justify-between text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
              <span>最近结果</span>
              <span>{previewItem?.outputFiles?.length ? `${previewItem.outputFiles.length} 文件` : ''}</span>
            </div>
            <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 text-[11px]" style={{ background: 'var(--t8-bg-node)', color: 'var(--t8-text-main)' }}>
              {previewItem?.text || previewItem?.caption || previewItem?.tags?.join(', ') || previewItem?.error || '暂无结果'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(BatchTaggerNode);
