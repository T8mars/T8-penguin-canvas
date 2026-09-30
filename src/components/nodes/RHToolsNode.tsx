/**
 * RH 工具节点（启动器 + 运行器双视图）— v1.2.10.1 重构版
 *
 * 设计：
 *   1. 节点初始为「启动器视图」：分类 Tab + 应用按钮网格（2 列）+ 搜索 + 「+ 增加 / ✎ 编辑 / 导出 / 导入」
 *   2. 用户点击应用 → 切换到「运行器视图」：完全复用 RunningHubNode 的运行链路：
 *      - 上游素材 (text/image/video/audio) 聚合预览（MaterialPreviewSection 拖拽排序）
 *      - 拉取 nodeInfoList → 表单展开（select / number / textarea / 媒体字段「从上游」勾选）
 *      - 实例类型 select（默认 / plus）
 *      - 提交 submitRh → startPolling 轮询（5s × 480）→ 按扩展名分流到 imageUrl/videoUrl/audioUrl
 *   3. 接入 useRunTrigger（循环器/批量执行可调起）
 *   4. 接入 useHasAutoOutput（下游已挂 OutputNode 时省略节点内预览）
 *   5. Handle 双侧（左 target / 右 source），z-index 提升避免被 UI 覆盖
 *
 * 与 RunningHubNode 的差异：
 *   - 节点头部为「应用启动器」品牌（紫罗兰系），非「RunningHub」
 *   - 运行器视图增加「← 返回应用列表」按钮
 *   - webappId 由所选应用注入，节点内不再单独输入
 *   - 支持 ResizableCorners 四角同比例缩放
 *
 * 数据：useRHToolsSafe()（多个节点共享 categories/tools）
 * 主题：useThemeStore（theme=dark/light + style=pixel/tech）
 */
import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useNodeConnections, useNodesData, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  Sparkles, Search, Plus, Pencil, AlertCircle, Loader2,
  Square, RefreshCw, ArrowLeft, Download, Upload,
} from 'lucide-react';
import { submitRh, queryRh, cancelRh, fetchRhAppInfo, uploadRhAsset, type RhSite } from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import { resolveRunningHubDisplaySite } from '../../utils/runningHubResolvedSite';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import LoopingVideo from '../LoopingVideo';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import PromptTextarea from '../PromptTextarea';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import { useRHToolsSafe } from '../../providers/RHToolsProvider';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { useCanvasStore } from '../../stores/canvas';
import { fuzzyMatch } from '../../utils/pinyinMatch';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import {
  areRhParamValuesEqual,
  applyRhTextBindings,
  findMaterialById,
  findRhTextMaterialForField,
  normalizeRhNodeId,
  rhParamKey,
  type RhParamValue,
} from '../../utils/rhTextBinding';
import { isProviderUploadMediaReference } from '../../utils/providerMediaReference';
import { extractRhFieldOptions, resolveRhFieldValue } from '../../utils/rhFieldOptions';
import ResizableCorners from './ResizableCorners';
import RHToolEditorModal from './RHToolEditorModal';
import type { RHTool, RHToolsBackup } from '../../services/api';

const ALL = 'all';
const UNCATEGORIZED = 'uncategorized';

// ========== fieldType → valueType 映射（直接搬运 RunningHubNode）==========
function inferValueType(fieldType: string | undefined): 'text' | 'number' | 'image' | 'video' | 'audio' {
  const t = String(fieldType || '').toUpperCase();
  if (t === 'IMAGE') return 'image';
  if (t === 'VIDEO') return 'video';
  if (t === 'AUDIO') return 'audio';
  if (t === 'NUMBER' || t === 'FLOAT' || t === 'INTEGER' || t === 'INT') return 'number';
  return 'text';
}

// Shared exact-value parser; never synthesize enums from a field name.
function extractFieldOptions(it: any): Array<string | number> | null {
  return extractRhFieldOptions(it);
}

function extractDefaultValue(it: any): string {
  let v = it?.fieldValue;
  if (Array.isArray(v)) v = v[0];
  if (v == null) return '';
  return typeof v === 'object' ? '' : String(v);
}

const paramKey = rhParamKey;

type RHToolsPollEntry = {
  timer: number;
  promise: Promise<void>;
  reject: (error?: Error) => void;
};

const activeRHToolsPolls = new Map<string, RHToolsPollEntry>();
const rhToolsPollKey = (nodeId: string, taskId: string) => `${nodeId}::${taskId}`;

const RHToolsNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const update = useUpdateNodeData(id);
  const updateNodeInternals = useUpdateNodeInternals();
  const { theme, style: themeStyle } = useThemeStore();
  const isLight = theme === 'light';
  const isPixel = themeStyle === 'pixel';
  const isDark = theme === 'dark';

  const ctx = useRHToolsSafe();
  const categories = ctx?.categories ?? [];
  const tools = ctx?.tools ?? [];
  const importBackup = ctx?.importBackup;

  const d = data as any;
  const appInfo: any = d?.appInfo;
  // 启动器
  const activeCategoryId: string = d?.rhToolsActiveCategoryId || ALL;
  const searchQuery: string = d?.rhToolsSearchQuery || '';
  const activeAppId: string = d?.rhToolsActiveAppId || '';
  const activeApp: RHTool | undefined = activeAppId ? tools.find((t) => t.id === activeAppId) : undefined;
  const webappId: string = activeApp?.webappId || '';
  const configuredRhSite: RhSite = activeApp?.rhSite === 'intl' ? 'intl' : 'cn';
  const displayedRhSite = resolveRunningHubDisplaySite(configuredRhSite, webappId, appInfo);
  const activeRhSiteRef = useRef<RhSite>(displayedRhSite);
  // 运行态（与 RunningHubNode 字段对齐）
  const instanceType: string = d?.instanceType || '';
  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const urls: string[] = d?.urls || [];
  const paramValues: Record<string, RhParamValue> = d?.paramValues || {};
  const paramMentions: Record<string, MediaMention[]> =
    d?.paramMentions && typeof d.paramMentions === 'object' ? d.paramMentions : {};

  useEffect(() => {
    activeRhSiteRef.current = displayedRhSite;
  }, [activeAppId, displayedRhSite]);

  // 主题色（青调 cyan，与 RunningHubNode 一致）—— v1.2.10.2 修复某些主题下紫色面板过于伤眼问题
  // v1.2.10.3: 像素风不再用 cyan 混入, 改走 RunningHubNode 同款糖果调色板（px-surface/px-muted/px-ink/px-yellow）
  const accent = isPixel
    ? 'var(--px-ink)'
    : (isLight ? 'rgb(8, 145, 178)' : 'rgb(34, 211, 238)'); // cyan-600 / cyan-400
  const accentSoft = isPixel
    ? 'var(--px-yellow)'
    : (isLight ? 'rgba(8, 145, 178, 0.10)' : 'rgba(34, 211, 238, 0.12)');
  const ringColor = isPixel
    ? 'var(--px-ink)'
    : (isLight ? 'rgba(8,145,178,0.30)' : 'rgba(34,211,238,0.45)');
  const bg = isPixel ? 'var(--px-surface)' : (isLight ? '#ffffff' : '#1c1c1e');
  const surface = isPixel ? 'var(--px-muted)' : (isLight ? '#f3f4f6' : '#2c2c2e');
  const surfaceHover = isPixel ? 'var(--px-yellow)' : (isLight ? '#e5e7eb' : '#3a3a3c');
  const text = isPixel ? 'var(--px-ink)' : (isLight ? '#1c1c1e' : '#e5e5e7');
  const subText = isPixel ? 'var(--px-ink-soft)' : (isLight ? '#6b7280' : '#9ca3af');
  const border = isPixel ? 'var(--px-ink)' : (isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)');

  // 节点尺寸（持久化到 data.size，避免每次渲染重置）
  const initialSize = (d?.size && typeof d.size.w === 'number') ? d.size : { w: 320, h: 440 };
  const [size, setSize] = useState<{ w: number; h: number }>(initialSize);
  const [showEditor, setShowEditor] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState(!!searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferMsg, setTransferMsg] = useState('');

  // ===================== 运行器侧 hooks (始终调用以保证 hooks 顺序稳定) =====================
  const hasAutoOutput = useHasAutoOutput(id);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const activeTaskIdRef = useRef<string>(taskId ? String(taskId) : '');
  const stopRequestedRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const originCanvasIdRef = useRef(useCanvasStore.getState().activeId);
  const executionNodeId = createCanvasNodeExecutionKey(originCanvasIdRef.current, id);
  const runCancelSeq = useRunBusStore((s) => s.cancelSeq);
  const runCancelTargets = useRunBusStore((s) => s.cancelTargets);
  const lastRunCancelSeqRef = useRef(runCancelSeq);
  const currentPollKeyRef = useRef<string | null>(taskId ? rhToolsPollKey(id, taskId) : null);
  const [fetchingInfo, setFetchingInfo] = useState(false);

  const setVisibleError = (message: string | null) => {
    if (mountedRef.current) setError(message);
  };

  const stopPoll = (tid?: string, reason?: Error) => {
    const key = tid
      ? rhToolsPollKey(id, tid)
      : currentPollKeyRef.current || (taskId ? rhToolsPollKey(id, taskId) : null);
    if (!key) return;
    const entry = activeRHToolsPolls.get(key);
    if (entry) {
      if (reason) entry.reject(reason);
      else {
        window.clearInterval(entry.timer);
        activeRHToolsPolls.delete(key);
      }
    }
    if (currentPollKeyRef.current === key) {
      currentPollKeyRef.current = null;
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPoll(undefined, new Error('已取消'));
    };
  }, []);
  useEffect(() => {
    if (taskId) activeTaskIdRef.current = String(taskId);
  }, [taskId]);

  // 上游连接（响应式）
  const conns = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(
    () => Array.from(new Set(conns.map((c: any) => c.source).filter(Boolean))) as string[],
    [conns],
  );
  const upstreamNodesData = useNodesData(upstreamIds);
  const upstreamNodes = useMemo(
    () => (Array.isArray(upstreamNodesData) ? upstreamNodesData : [upstreamNodesData]).filter(Boolean) as any[],
    [upstreamNodesData],
  );

  // 上游素材聚合（与 RunningHubNode 一致）
  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstream.images, excludedMaterialIds),
    [upstream.images, excludedMaterialIds],
  );
  const visibleUpstreamVideos = useMemo(
    () => filterExcludedMaterials(upstream.videos, excludedMaterialIds),
    [upstream.videos, excludedMaterialIds],
  );
  const visibleUpstreamAudios = useMemo(
    () => filterExcludedMaterials(upstream.audios, excludedMaterialIds),
    [upstream.audios, excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstream.texts, excludedMaterialIds),
    [upstream.texts, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios]),
    [excludedMaterialIds, upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const orderedImages = useOrderedMaterials(visibleUpstreamImages, materialOrder);
  const orderedVideos = useOrderedMaterials(visibleUpstreamVideos, materialOrder);
  const orderedAudios = useOrderedMaterials(visibleUpstreamAudios, materialOrder);
  const mentionMaterials = useMemo<Material[]>(
    () => [...orderedTexts, ...orderedImages, ...orderedVideos, ...orderedAudios],
    [orderedTexts, orderedImages, orderedVideos, orderedAudios],
  );
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });
  const src = `rh-tools:${id}`;

  const findUpstreamUrl = (kind: 'image' | 'video' | 'audio', idx = 0): string => {
    const arr = kind === 'image' ? orderedImages : kind === 'video' ? orderedVideos : orderedAudios;
    return arr[idx]?.url || '';
  };

  // 字段在同 kind 下的索引
  const fieldKindIndex = useMemo(() => {
    const m: Record<string, number> = {};
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    const list: any[] = appInfo?.nodeInfoList || [];
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt === 'image' || vt === 'video' || vt === 'audio') {
        m[paramKey(it.nodeId, it.fieldName)] = counters[vt]++;
      }
    }
    return m;
  }, [appInfo]);

  const setParam = (k: string, patch: Partial<RhParamValue>) => {
    const cur = paramValues[k] || { value: '' };
    const next = { ...paramValues, [k]: { ...cur, ...patch } };
    update({ paramValues: next });
  };

  const getParamMentions = (k: string): MediaMention[] =>
    Array.isArray(paramMentions[k]) ? paramMentions[k] : [];

  const setTextParam = (k: string, value: string, mentions: MediaMention[]) => {
    const cur = paramValues[k] || { value: '' };
    update({
      paramValues: { ...paramValues, [k]: { ...cur, value, sourceFromUpstream: false, sourceMaterialId: '', sourceRhNodeId: '' } },
      paramMentions: { ...paramMentions, [k]: mentions },
    });
  };

  // 媒体字段随上游 url 自动同步
  useEffect(() => {
    const list: any[] = appInfo?.nodeInfoList;
    if (!Array.isArray(list) || list.length === 0) return;
    let changed = false;
    const next = { ...paramValues };
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt !== 'image' && vt !== 'video' && vt !== 'audio') continue;
      const k = paramKey(it.nodeId, it.fieldName);
      const cur = next[k];
      const idx = counters[vt]++;
      const upUrl = findUpstreamUrl(vt, idx);
      if (!upUrl) continue;
      if (cur?.sourceFromUpstream === false) continue;
      if (cur?.sourceFromUpstream === true) {
        if (upUrl !== cur.value) {
          next[k] = { ...cur, value: upUrl };
          changed = true;
        }
      } else {
        next[k] = { value: upUrl, sourceFromUpstream: true };
        changed = true;
      }
    }
    const withTextBindings = applyRhTextBindings(list, orderedTexts, next);
    if (changed || !areRhParamValuesEqual(paramValues, withTextBindings)) {
      update({ paramValues: withTextBindings });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedTexts, orderedImages, orderedVideos, orderedAudios, appInfo]);

  // 同步重算最新 paramValues（避免 React state 异步陷阱）
  const computeFreshValuesNow = (
    list: any[] | undefined,
  ): Record<string, RhParamValue> => {
    const next: Record<string, RhParamValue> = { ...paramValues };
    if (!Array.isArray(list)) return next;
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt !== 'image' && vt !== 'video' && vt !== 'audio') continue;
      const k = paramKey(it.nodeId, it.fieldName);
      const cur = next[k];
      const idx = counters[vt]++;
      if (cur?.sourceFromUpstream === false) continue;
      const upUrl = findUpstreamUrl(vt, idx);
      if (!upUrl) continue;
      next[k] = { value: upUrl, sourceFromUpstream: true };
    }
    return applyRhTextBindings(list, orderedTexts, next);
  };

  // 收集上游 RhConfig nodeInfoList（保留兼容）
  const collectUpstreamConfigList = () => {
    const list: any[] = [];
    for (const n of upstreamNodes) {
      const arr = (n?.data as any)?.nodeInfoList;
      if (Array.isArray(arr)) list.push(...arr);
    }
    return list;
  };

  const buildRawNodeInfoList = (
    overrideList?: any[],
    overrideValues?: Record<string, RhParamValue>,
  ): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    const list: any[] = overrideList ?? appInfo?.nodeInfoList ?? [];
    const values = overrideValues ?? paramValues;
    for (const it of list) {
      const k = paramKey(it.nodeId, it.fieldName);
      const vt = inferValueType(it?.fieldType);
      const v = values[k]?.value;
      const fieldOptions = extractFieldOptions(it);
      const finalVal = v != null && v !== '' ? v : extractDefaultValue(it);
      const submitVal =
        vt === 'text' && !fieldOptions
          ? resolveMediaMentions(String(finalVal), getParamMentions(k), mentionMaterials)
          : finalVal;
      seen.add(k);
      out.push({ nodeId: it.nodeId, fieldName: it.fieldName, fieldValue: resolveRhFieldValue(it, submitVal, t('runningHub.invalidOption', { field: `#${it.nodeId} ${it.fieldName}`, value: String(submitVal) })), valueType: fieldOptions ? 'select' : vt });
    }
    const upstreamList = collectUpstreamConfigList();
    for (const it of upstreamList) {
      const k = paramKey(it?.nodeId, it?.fieldName);
      if (seen.has(k)) continue;
      out.push(it);
    }
    return out;
  };

  const handleExportBackup = () => {
    const payload: RHToolsBackup = {
      schema: 't8-rh-tools',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories,
      tools,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t8-rh-tools-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTransferMsg(`已导出 ${categories.length} 个分类 / ${tools.length} 个应用`);
  };

  const handleImportBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!importBackup) {
      setTransferMsg('导入失败：RH 超市服务未就绪');
      return;
    }
    try {
      const json = JSON.parse(await file.text());
      const payload: RHToolsBackup = {
        schema: json?.schema || 't8-rh-tools',
        version: Number(json?.version || 1),
        exportedAt: json?.exportedAt,
        categories: Array.isArray(json?.categories) ? json.categories : [],
        tools: Array.isArray(json?.tools) ? json.tools : [],
      };
      if (payload.categories.length === 0 && payload.tools.length === 0) {
        setTransferMsg('导入失败：文件里没有 RH 超市数据');
        return;
      }
      const ok = window.confirm(
        `导入将覆盖当前 RH 超市数据。\n\n文件中包含 ${payload.categories.length} 个分类 / ${payload.tools.length} 个应用，是否继续?`,
      );
      if (!ok) return;
      const success = await importBackup(payload, 'replace');
      setTransferMsg(success ? `导入完成：${payload.categories.length} 个分类 / ${payload.tools.length} 个应用` : '导入失败：后端写入失败');
    } catch (err) {
      console.error(err);
      setTransferMsg('导入失败：JSON 解析错误');
    }
  };

  const resolveNodeInfoList = async (raw: any[]): Promise<any[]> => {
    const out: any[] = [];
    for (const it of raw) {
      const nodeId = it?.nodeId;
      const fieldName = it?.fieldName;
      let fieldValue = it?.fieldValue;
      const vt = it?.valueType;
      if (!nodeId || !fieldName) continue;
      if (vt === 'image' || vt === 'video' || vt === 'audio') {
        let v = String(fieldValue || '').trim();
        if (v.includes('\n')) {
          const first = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
          logBus.warn(`多行 fieldValue 检测到-${fieldName}，仅保留首行`, src);
          v = first;
        }
        const isUrlLike0 = isProviderUploadMediaReference(v);
        if (!isUrlLike0) {
          const k = paramKey(nodeId, fieldName);
          const cur = paramValues[k];
          if (cur?.sourceFromUpstream !== false) {
            const upUrl = findUpstreamUrl(vt as any);
            if (upUrl) {
              logBus.debug(`字段 ${fieldName} 从上游覆写 → ${upUrl}`, src);
              v = upUrl;
            }
          }
        }
        if (!v) continue;
        const isUrlLike = isProviderUploadMediaReference(v);
        if (isUrlLike) {
          const r = await uploadRhAsset(v, activeRhSiteRef.current);
          if (r.site) activeRhSiteRef.current = r.site;
          fieldValue = r.fileName;
        } else {
          fieldValue = v;
        }
      } else if (vt === 'number') {
        const num = Number(fieldValue);
        fieldValue = Number.isFinite(num) ? num : fieldValue;
      }
      out.push({ nodeId, fieldName, fieldValue });
    }
    return out;
  };

  // Promise 化轮询（让 useRunTrigger 等到任务真正完成才 markDone）
  const startPolling = (tid: string, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    const key = rhToolsPollKey(id, tid);
    const existing = activeRHToolsPolls.get(key);
    if (existing) {
      currentPollKeyRef.current = key;
      return existing.promise;
    }
    stopPoll(undefined, new Error('已取消'));
    currentPollKeyRef.current = key;
    let timer: number | null = null;
    let rejectPoll: (error?: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let settled = false;
      const POLL_INT = 5000;
      const MAX = 480;
      let pollInFlight = false;
      const finish = (ok: boolean, error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer != null) {
          window.clearInterval(timer);
        }
        if (activeRHToolsPolls.get(key)?.timer === timer) {
          activeRHToolsPolls.delete(key);
        }
        if (currentPollKeyRef.current === key) {
          currentPollKeyRef.current = null;
        }
        if (activeTaskIdRef.current === tid) {
          activeTaskIdRef.current = '';
        }
        if (ok) resolve();
        else reject(error || new Error('RH 轮询失败'));
      };
      rejectPoll = (error?: Error) => finish(false, error || new Error('已取消'));
      timer = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > MAX) {
          update({ status: 'error', error: '轮询超时' });
          setVisibleError('轮询超时');
          finish(false, new Error('轮询超时'));
          return;
        }
        pollInFlight = true;
        try {
          const r = await queryRh(tid, activeRhSiteRef.current);
          if (r.site) activeRhSiteRef.current = r.site;
          await reporter?.polling({
            provider: 'runninghub',
            model: webappId,
            site: r.site || activeRhSiteRef.current,
            taskId: tid,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: r.status,
            code: r.code,
            outputCount: (Array.isArray(r.urls) ? r.urls.length : 0) + (Array.isArray(r.texts) ? r.texts.length : 0),
          });
          if (elapsed % 6 === 0) {
            logBus.debug(`[${elapsed * 5}s] status=${r.status} code=${r.code} urls=${r.urls?.length || 0}`, src);
          }
          const normalizedStatus = String(r.status || '').trim().toUpperCase();
          if (normalizedStatus === 'MATERIALIZING') {
            update({ status: 'polling', rhCode: r.code, error: '' });
            if (elapsed === 1 || elapsed % 6 === 0) {
              logBus.warn(
                r.error || 'RH 结果已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
                src,
              );
            }
          } else if (normalizedStatus === 'SUCCESS') {
            const list: string[] = Array.isArray(r.urls) ? r.urls : [];
            const textOutputs = (Array.isArray(r.texts) ? r.texts : [])
              .map((value) => String(value || '').trim())
              .filter(Boolean);
            const textValue = textOutputs.join('\n\n');
            const isImg = (u: string) => /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(u);
            const isVid = (u: string) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(u);
            const isAud = (u: string) => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(u);
            const firstImg = list.find(isImg);
            const firstVid = list.find(isVid);
            const firstAud = list.find(isAud);
            const patch: any = {
              status: 'success',
              urls: list,
              provider: 'runninghub',
              model: webappId,
              taskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              textUrls: Array.isArray(r.textUrls) ? r.textUrls : [],
            };
            if (textValue) {
              patch.outputText = textValue;
              patch.text = textValue;
              patch.texts = textOutputs;
              patch.textSegments = textOutputs;
            }
            if (firstImg) patch.imageUrl = firstImg;
            if (firstVid) patch.videoUrl = firstVid;
            if (firstAud) patch.audioUrl = firstAud;
            if (!firstImg && !firstVid && !firstAud && list[0]) patch.imageUrl = list[0];
            logBus.success(`任务完成 · ${list.length + textOutputs.length} 个输出`, src);
            update(patch);
            await reporter?.providerResponse({
              provider: 'runninghub',
              model: webappId,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            finish(true);
          } else if (normalizedStatus === 'FAILED') {
            let reason: string;
            if (r.failReason == null) {
              reason = `RH 失败 code=${r.code}`;
            } else if (typeof r.failReason === 'string') {
              reason = r.failReason;
            } else {
              try {
                const o: any = r.failReason;
                reason = o?.exception_message || o?.message || JSON.stringify(o);
              } catch {
                reason = `RH 失败 code=${r.code}`;
              }
            }
            await reporter?.providerResponse({
              provider: 'runninghub',
              model: webappId,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'failed',
              error: { message: reason },
              httpStatusSource: 'local-backend',
            });
            update({ status: 'error', error: reason });
            setVisibleError(reason);
            logBus.error(`生成失败: ${reason}`, src);
            finish(false, new Error(reason));
          } else {
            update({ status: 'polling', rhCode: r.code });
          }
        } catch (e: any) {
          logBus.warn(`轮询出错: ${e?.message || e}`, src);
        } finally {
          pollInFlight = false;
        }
      }, POLL_INT);
    });
    if (timer != null) {
      activeRHToolsPolls.set(key, { timer, promise, reject: rejectPoll });
    }
    return promise;
  };

  const handleFetchInfo = async (): Promise<{
    list: any[];
    paramValues: Record<string, RhParamValue>;
  } | null> => {
    setVisibleError(null);
    if (!webappId) {
      setVisibleError('请先选择应用');
      return null;
    }
    setFetchingInfo(true);
    try {
      const info = await fetchRhAppInfo(webappId, activeRhSiteRef.current);
      if (info?.rhSite === 'intl' || info?.rhSite === 'cn') {
        activeRhSiteRef.current = info.rhSite;
      }
      const list: any[] = info?.nodeInfoList || [];
      logBus.info(`拉取应用信息 · webappId=${webappId} · ${list.length} 个字段`, src);
      const next: Record<string, RhParamValue> = { ...paramValues };
      for (const it of list) {
        const k = paramKey(it.nodeId, it.fieldName);
        const vt = inferValueType(it?.fieldType);
        if (k in next) continue;
        if (vt === 'image' || vt === 'video' || vt === 'audio') {
          const upUrl = findUpstreamUrl(vt);
          next[k] = { value: upUrl || '', sourceFromUpstream: true };
          continue;
        }
        next[k] = { value: extractDefaultValue(it) };
      }
      const withTextBindings = applyRhTextBindings(list, orderedTexts, next);
      update({ appInfo: info, paramValues: withTextBindings });
      return { list, paramValues: withTextBindings };
    } catch (e: any) {
      setVisibleError(e?.message || '查询失败');
      logBus.error(`拉取应用信息失败: ${e?.message || e}`, src);
      return null;
    } finally {
      setFetchingInfo(false);
    }
  };

  // 自动拉取：activeApp 有效 + 上游有媒体 + 还未拉过 appInfo 时静默拉一次
  // 也支持「webappId 与 appInfo 不匹配」时主动重拉（用户切换应用）
  const autoFetchedRef = useRef<string>('');
  useEffect(() => {
    if (!activeAppId || !webappId) return;
    if (fetchingInfo) return;
    if (autoFetchedRef.current === activeAppId) return;
    // appInfo 还在但 webappId 已经变 → 视为旧数据
    const lastWebappId = appInfo?.webappId;
    if (appInfo && lastWebappId && lastWebappId === webappId) {
      autoFetchedRef.current = activeAppId;
      return;
    }
    autoFetchedRef.current = activeAppId;
    void handleFetchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppId, webappId]);

  useEffect(() => {
    if (status !== 'polling' || !taskId || !activeAppId || !webappId) return;
    void startPolling(taskId).catch(() => undefined);
    // startPolling 本身由节点当前 data 派生，内部有全局去重；这里故意只跟随持久化运行态恢复轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, taskId, activeAppId, webappId]);

  const handleRun = async (reporter?: RunNodeLifecycleReporter) => {
    stopRequestedRef.current = false;
    setVisibleError(null);
    if (!webappId) {
      setVisibleError('请先选择应用');
      return;
    }
    await reporter?.providerRequest({ provider: 'runninghub', model: webappId });
    let freshList: any[] | null = null;
    let freshValues: Record<string, RhParamValue> | null = null;
    if (!appInfo?.nodeInfoList?.length) {
      const r = await handleFetchInfo();
      if (r) {
        freshList = r.list;
        freshValues = r.paramValues;
      } else {
        return; // 拉取失败直接退出
      }
    }
    const effectiveList = freshList ?? appInfo?.nodeInfoList ?? [];
    const effectiveValues = freshValues ?? computeFreshValuesNow(effectiveList);
    if (Object.keys(effectiveValues).length > 0) {
      update({ paramValues: effectiveValues });
    }
    update({ status: 'submitting', error: null, urls: [], taskId: null });
    try {
      const rawList = buildRawNodeInfoList(effectiveList, effectiveValues);
      const nodeInfoList = await resolveNodeInfoList(rawList);
      logBus.info(`提交任务 · webappId=${webappId} · ${nodeInfoList.length} 个字段`, src);
      const r = await submitRh({
        webappId,
        nodeInfoList,
        instanceType: instanceType || undefined,
        site: activeRhSiteRef.current,
      }, { submissionKey: reporter?.providerSubmissionKey });
      activeRhSiteRef.current = r.site || activeRhSiteRef.current;
      await reporter?.providerSubmitted({
        provider: 'runninghub',
        model: webappId,
        upstreamTaskId: r.taskId,
        requestId: r.requestId,
        transportHttpStatus: r.transportHttpStatus,
        upstreamHttpStatus: r.upstreamHttpStatus,
        usage: r.usage,
        httpStatusSource: 'local-backend',
      });
      activeTaskIdRef.current = r.taskId;
      if (stopRequestedRef.current) {
        logBus.warn(`停止请求已收到，提交返回后立即取消 RH 后台任务 taskId=${r.taskId}`, src);
        try {
          setCancelling(true);
          await cancelRh(r.taskId, activeRhSiteRef.current);
          logBus.success(`已请求取消 RH 后台任务 taskId=${r.taskId}`, src);
          stopPoll(r.taskId, new Error('已取消'));
          stopRequestedRef.current = false;
          activeTaskIdRef.current = '';
          update({ status: 'idle', taskId: '', error: null });
          return;
        } catch (cancelError: any) {
          logBus.error(`取消 RH 后台任务失败: ${cancelError?.message || cancelError}`, src);
          stopRequestedRef.current = false;
          update({ status: 'polling', taskId: r.taskId, error: `取消 RH 后台任务失败：${cancelError?.message || cancelError}` });
        } finally {
          setCancelling(false);
        }
      }
      logBus.success(`异步任务已提交 taskId=${r.taskId} 进入轮询…`, src);
      update({ status: 'polling', taskId: r.taskId });
      await startPolling(r.taskId, reporter);
    } catch (e: any) {
      if (stopRequestedRef.current || e?.message === '已取消') {
        await reporter?.providerResponse({
          provider: 'runninghub',
          model: webappId,
          upstreamTaskId: activeTaskIdRef.current || undefined,
          status: 'stopped',
          error: { message: e?.message || '已取消' },
        });
        logBus.warn('任务已停止', src);
        update({ status: 'idle', taskId: '' });
        return;
      }
      await reporter?.providerResponse({
        provider: 'runninghub',
        model: webappId,
        upstreamTaskId: activeTaskIdRef.current || undefined,
        requestId: e?.requestId,
        transportHttpStatus: e?.transportHttpStatus,
        upstreamHttpStatus: e?.upstreamHttpStatus,
        status: 'failed',
        error: { message: e?.message || '提交失败', code: e?.code },
        httpStatusSource: 'local-backend',
      });
      logBus.error(`提交失败: ${e?.message || e}`, src);
      setVisibleError(e?.message || '提交失败');
      update({ status: 'error', error: e?.message });
    }
  };

  // 接入运行总线（循环器/批量执行）
  useRunTrigger(id, async (reporter) => {
    if (!activeAppId || !webappId) return; // 启动器视图不可被调起
    if (status === 'submitting' || status === 'polling') return;
    await handleRun(reporter);
  }, undefined, {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('rh-tools', nodeData),
  });

  const handleStop = async () => {
    stopRequestedRef.current = true;
    const tid = String(activeTaskIdRef.current || taskId || '').trim();
    if (!tid) {
      logBus.warn('用户主动停止：等待 RH 返回 taskId 后再取消后台任务', src);
      update({ error: '正在等待 RH taskId，拿到后会立即取消后台任务' });
      return;
    }
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setCancelling(true);
    logBus.warn(`用户主动停止，正在请求取消 RH 后台任务 taskId=${tid}`, src);
    update({ taskId: tid, error: '正在请求取消 RH 后台任务...' });
    try {
      await cancelRh(tid, activeRhSiteRef.current);
      logBus.success(`已请求取消 RH 后台任务 taskId=${tid}`, src);
      stopPoll(tid, new Error('已取消'));
      stopRequestedRef.current = false;
      activeTaskIdRef.current = '';
      update({ status: 'idle', taskId: '', error: null });
    } catch (error: any) {
      logBus.error(`取消 RH 后台任务失败: ${error?.message || error}`, src);
      update({
        status: status === 'submitting' ? 'submitting' : 'polling',
        taskId: tid,
        error: `取消 RH 后台任务失败：${error?.message || error}`,
      });
    } finally {
      cancelInFlightRef.current = false;
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (runCancelSeq === lastRunCancelSeqRef.current) return;
    lastRunCancelSeqRef.current = runCancelSeq;
    if (!runCancelTargets.includes(executionNodeId)) return;
    if (status !== 'submitting' && status !== 'polling' && !taskId && !activeTaskIdRef.current) return;
    handleStop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCancelSeq, runCancelTargets, executionNodeId, status, taskId]);

  const isBusy = status === 'submitting' || status === 'polling' || cancelling;
  const nodeInfoList: any[] = appInfo?.nodeInfoList || [];

  // 启动器：过滤后的工具列表
  const filteredTools = useMemo(() => {
    let list = tools;
    if (activeCategoryId === UNCATEGORIZED) {
      list = list.filter((t) => !t.categoryId || !categories.find((c) => c.id === t.categoryId));
    } else if (activeCategoryId !== ALL) {
      list = list.filter((t) => t.categoryId === activeCategoryId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      list = list.filter((t) => fuzzyMatch(`${t.title} ${t.description || ''}`, q));
    }
    return list;
  }, [tools, categories, activeCategoryId, searchQuery]);

  const previewApp = useMemo(() => {
    if (hoveredId) return tools.find((t) => t.id === hoveredId);
    return undefined;
  }, [hoveredId, tools]);

  // ===== 持久化尺寸 =====
  const handleResize = (_e: any, p: { width: number; height: number }) => {
    setSize({ w: p.width, h: p.height });
    update({ size: { w: p.width, h: p.height } });
  };

  const appInfoFieldCount = Array.isArray(appInfo?.nodeInfoList) ? appInfo.nodeInfoList.length : 0;
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(raf);
  }, [id, updateNodeInternals, activeAppId, size.w, size.h, selected, status, searchVisible, appInfoFieldCount]);

  // ===================== 渲染 =====================
  // Handle 双侧（始终渲染，z-index 提升），通过绝对定位放在容器边缘，避免被内部 UI 遮挡。
  const handleStyle = { zIndex: 10 } as const;

  // ===== 运行器视图 =====
  if (activeApp) {
    return (
      <div
        className="t8-rh-tools-node relative rounded-xl shadow-lg flex flex-col"
        style={{
          background: bg,
          color: text,
          width: size.w,
          height: size.h,
          minWidth: 280,
          minHeight: 360,
          boxSizing: 'border-box',
          border: `2px solid ${selected ? accent : ringColor}`,
          // 允许 Handle 浮出容器边缘
          overflow: 'visible',
        }}
      >
        {/* Handle 必须在最外层、最先渲染，加 zIndex 保证悬浮在最上层 */}
        <Handle type="target" position={Position.Left} className="!bg-cyan-400 !border-0" style={handleStyle} />
        <Handle type="source" position={Position.Right} className="!bg-cyan-400 !border-0" style={handleStyle} />

        <ResizableCorners
          selected={selected}
          minWidth={280}
          minHeight={360}
          accent={accent}
          onResize={handleResize}
        />

        {/* 头部：返回 + 应用名 */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${border}` }}>
          <button
            onClick={() => {
              stopPoll();
              update({
                rhToolsActiveAppId: '',
                appInfo: null,
                paramValues: {},
                materialOrder: [],
                instanceType: '',
                status: 'idle',
                taskId: '',
                urls: [],
                error: '',
                rhCode: 0,
                imageUrl: '',
                videoUrl: '',
                audioUrl: '',
              });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:opacity-80 nodrag"
            title="返回应用列表"
            style={{ color: subText }}
          >
            <ArrowLeft size={14} />
          </button>
          <div
            className="flex items-center justify-center"
            style={{ width: 24, height: 24, borderRadius: 6, background: accentSoft, color: accent }}
          >
            <Sparkles size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight truncate" style={{ color: text }}>
              {activeApp.title}
            </div>
            <div className="text-[10px] truncate" style={{ color: subText }}>
              {activeApp.description || `webappId: ${webappId}`} · {displayedRhSite === 'intl' ? '海外站' : '国内站'}
            </div>
          </div>
        </div>

        {/* 滚动内容区（包含上游素材 + 参数表 + 实例类型 + 运行按钮）*/}
        <div
          className="flex-1 overflow-y-auto px-2.5 py-2 space-y-2 nowheel nodrag"
          style={{ minHeight: 0 }}
          onMouseDown={(e) => e.stopPropagation()}
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {/* 上游素材聚合预览 */}
          {(orderedTexts.length + orderedImages.length + orderedVideos.length + orderedAudios.length + excludedUpstreamCount) > 0 && (
            <MaterialPreviewSection
              texts={orderedTexts}
              images={orderedImages}
              videos={orderedVideos}
              audios={orderedAudios}
              order={materialOrder}
              onReorder={setMaterialOrder}
              onExcludeUpstream={handleExcludeUpstreamMaterial}
              excludedCount={excludedUpstreamCount}
              onRestoreExcluded={handleRestoreExcludedMaterials}
              isDark={isDark}
              isPixel={isPixel}
              groups={['text', 'image', 'video', 'audio']}
              title="上游素材 · 拖拽可调整顺序"
            />
          )}

          {/* webappId 显示 + 重新拉取 */}
          <div>
            <label className="text-[10px] block mb-1" style={{ color: subText }}>Webapp ID</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={webappId}
                readOnly
                className="flex-1 rounded px-2 py-1 text-xs outline-none cursor-not-allowed"
                style={{ background: surface, color: text, border: `1px solid ${border}` }}
              />
              <button
                onClick={handleFetchInfo}
                disabled={fetchingInfo}
                title="重新拉取应用信息"
                onMouseDown={(e) => e.stopPropagation()}
                className="px-2 rounded disabled:opacity-50 nodrag"
                style={{ background: surface, color: subText, border: `1px solid ${border}` }}
              >
                {fetchingInfo ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              </button>
            </div>
          </div>

          {/* 参数表 */}
          {nodeInfoList.length > 0 && (
            <div
              className="rounded p-2 space-y-2"
              style={{
                // 像素风下不填黄底, 让糖果调 surface 透出来, 与 RunningHubNode 体验一致
                background: isPixel ? 'var(--px-muted)' : accentSoft,
                border: `1px solid ${ringColor}`,
              }}
            >
              <div className="text-[10px] flex items-center justify-between" style={{ color: accent }}>
                <span>参数 ({nodeInfoList.length})</span>
                <span style={{ color: subText }}>点击字段可编辑</span>
              </div>
              {nodeInfoList.map((it: any, i: number) => {
                const vt = inferValueType(it?.fieldType);
                const k = paramKey(it.nodeId, it.fieldName);
                const cur = paramValues[k] || { value: extractDefaultValue(it) };
                const isMedia = vt === 'image' || vt === 'video' || vt === 'audio';
                const fieldDataOptions = extractFieldOptions(it);
                return (
                  <div key={i} className="space-y-1 pb-2 border-b last:border-0 last:pb-0" style={{ borderColor: border }}>
                    <div className="flex items-center gap-1 text-[10px] leading-tight">
                      <span className="font-medium truncate" style={{ color: text }}>{it.fieldName}</span>
                      <span style={{ color: subText, opacity: 0.4 }}>|</span>
                      <span className="px-1 rounded" style={{ background: accentSoft, color: accent }}>
                        {fieldDataOptions ? `select(${fieldDataOptions.length})` : vt}
                      </span>
                      <span style={{ color: subText, opacity: 0.4 }}>|</span>
                      <span style={{ color: subText }}>#{it.nodeId}</span>
                    </div>
                    {it?.description && (
                      <div className="text-[9px] leading-tight" style={{ color: subText }}>{it.description}</div>
                    )}
                    {isMedia ? (
                      <>
                        <div className="flex items-center justify-between text-[10px]">
                          <label className="flex items-center gap-1 cursor-pointer" style={{ color: accent }}>
                            <input
                              type="checkbox"
                              checked={!!cur.sourceFromUpstream}
                              onChange={(e) => setParam(k, { sourceFromUpstream: e.target.checked })}
                              style={{ accentColor: accent }}
                            />
                            从上游自动获取
                          </label>
                          {cur.sourceFromUpstream && (
                            <button
                              onClick={() => {
                                const u = findUpstreamUrl(vt, fieldKindIndex[k] ?? 0);
                                if (u) setParam(k, { value: u });
                              }}
                              className="flex items-center gap-1"
                              style={{ color: accent }}
                              title="重新同步上游 url"
                            >
                              <RefreshCw size={9} /> 同步
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={cur.value}
                          onChange={(e) => setParam(k, { value: e.target.value })}
                          placeholder={cur.sourceFromUpstream ? '(从上游自动填入)' : `${vt} url 或 fileName`}
                          readOnly={!!cur.sourceFromUpstream}
                          className="w-full rounded px-2 py-1 text-[11px] outline-none"
                          style={{
                            background: cur.sourceFromUpstream ? accentSoft : surface,
                            color: text,
                            border: `1px solid ${cur.sourceFromUpstream ? ringColor : border}`,
                            cursor: cur.sourceFromUpstream ? 'not-allowed' : 'text',
                          }}
                        />
                      </>
                    ) : fieldDataOptions ? (
                      <select
                        value={cur.value}
                        onChange={(e) => setParam(k, { value: e.target.value })}
                        className="w-full rounded px-2 py-1 text-[11px] outline-none"
                        style={{ background: surface, color: text, border: `1px solid ${border}` }}
                      >
                        {cur.value && !fieldDataOptions.some((o) => String(o) === String(cur.value)) && (
                          <option value={String(cur.value)}>(当前) {String(cur.value)}</option>
                        )}
                        {!cur.value && <option value="">(选择)</option>}
                        {fieldDataOptions.map((opt, oi) => (
                          <option key={oi} value={String(opt)}>{String(opt)}</option>
                        ))}
                      </select>
                    ) : vt === 'number' ? (
                      <input
                        type="number"
                        value={cur.value}
                        onChange={(e) => setParam(k, { value: e.target.value })}
                        placeholder={extractDefaultValue(it)}
                        className="w-full rounded px-2 py-1 text-[11px] outline-none"
                        style={{ background: surface, color: text, border: `1px solid ${border}` }}
                      />
                    ) : (
                      (() => {
                        const selectedTextMaterial = findMaterialById(orderedTexts, cur.sourceMaterialId);
                        const autoTextMatch = findRhTextMaterialForField(it, orderedTexts);
                        const linkedTextMaterial = selectedTextMaterial || (autoTextMatch.status === 'matched' ? autoTextMatch.material || null : null);
                        const isLinked = !!cur.sourceFromUpstream && !!linkedTextMaterial;
                        const bindHint =
                          autoTextMatch.status === 'conflict'
                            ? `多个上游文本都填写了 RH#${normalizeRhNodeId(it.nodeId)}，请改成唯一 RH# 或手动选择。`
                            : autoTextMatch.status === 'no-match'
                              ? `给文本节点填写 RH#${normalizeRhNodeId(it.nodeId)} 后可自动绑定。`
                              : isLinked
                                ? `已绑定 ${linkedTextMaterial?.rhNodeId ? `RH#${linkedTextMaterial.rhNodeId}` : '手动选择的文本'}`
                                : '可按文本节点 RH# 自动绑定，也可手动选择上游文本。';
                        return (
                          <>
                            {orderedTexts.length > 0 && (
                              <div className="rounded px-2 py-1.5 space-y-1" style={{ background: surface, border: `1px solid ${border}` }}>
                                <div className="flex items-center justify-between gap-2 text-[10px]">
                                  <label className="flex items-center gap-1 cursor-pointer" style={{ color: accent }}>
                                    <input
                                      type="checkbox"
                                      checked={!!cur.sourceFromUpstream}
                                      onChange={(e) => {
                                        if (!e.target.checked) {
                                          setParam(k, { sourceFromUpstream: false, sourceMaterialId: '', sourceRhNodeId: '' });
                                          return;
                                        }
                                        const fallback = linkedTextMaterial || (orderedTexts.length === 1 ? orderedTexts[0] : null);
                                        if (fallback) {
                                          setParam(k, {
                                            value: fallback.url,
                                            sourceFromUpstream: true,
                                            sourceMaterialId: fallback.id,
                                            sourceRhNodeId: normalizeRhNodeId(fallback.rhNodeId),
                                          });
                                        } else {
                                          setParam(k, { sourceFromUpstream: true });
                                        }
                                      }}
                                      style={{ accentColor: accent }}
                                    />
                                    从上游文本获取
                                  </label>
                                  {linkedTextMaterial && (
                                    <button
                                      onClick={() => setParam(k, {
                                        value: linkedTextMaterial.url,
                                        sourceFromUpstream: true,
                                        sourceMaterialId: linkedTextMaterial.id,
                                        sourceRhNodeId: normalizeRhNodeId(linkedTextMaterial.rhNodeId),
                                      })}
                                      className="flex items-center gap-1"
                                      style={{ color: accent }}
                                      title="重新同步上游文本"
                                    >
                                      <RefreshCw size={9} /> 同步
                                    </button>
                                  )}
                                </div>
                                <select
                                  value={cur.sourceMaterialId || ''}
                                  onChange={(e) => {
                                    const material = findMaterialById(orderedTexts, e.target.value);
                                    if (!material) {
                                      setParam(k, { sourceMaterialId: '', sourceRhNodeId: '', sourceFromUpstream: true });
                                      return;
                                    }
                                    setParam(k, {
                                      value: material.url,
                                      sourceFromUpstream: true,
                                      sourceMaterialId: material.id,
                                      sourceRhNodeId: normalizeRhNodeId(material.rhNodeId),
                                    });
                                  }}
                                  className="w-full rounded px-2 py-1 text-[10px] outline-none"
                                  style={{ background: bg, color: text, border: `1px solid ${border}` }}
                                >
                                  <option value="">按 RH# 自动匹配</option>
                                  {orderedTexts.map((material) => (
                                    <option key={material.id} value={material.id}>
                                      {material.rhNodeId ? `RH#${material.rhNodeId}` : '未填 RH#'} · {material.label || material.url.slice(0, 24)}
                                    </option>
                                  ))}
                                </select>
                                <div className="text-[9px] leading-tight" style={{ color: subText }}>{bindHint}</div>
                              </div>
                            )}
                            {isLinked ? (
                              <PromptTextarea
                                title={`RH 工具箱参数 · ${it.fieldName || '文本'} #${it.nodeId || ''}`}
                                value={cur.value}
                                onValueChange={() => undefined}
                                readOnly
                                className="w-full min-h-14 resize-none rounded px-2 py-1 text-[11px] outline-none"
                                style={{ background: accentSoft, color: text, border: `1px solid ${ringColor}`, cursor: 'not-allowed' }}
                              />
                            ) : (
                              <MentionPromptInput
                                title={`RH 工具箱参数 · ${it.fieldName || '文本'} #${it.nodeId || ''}`}
                                value={cur.value}
                                mentions={getParamMentions(k)}
                                materials={mentionMaterials}
                                onChange={(value, mentions) => setTextParam(k, value, mentions)}
                                placeholder={extractDefaultValue(it)}
                                isDark={isDark}
                                isPixel={isPixel}
                                promptTemplateKind="image"
                                className="w-full min-h-14 resize-none rounded px-2 py-1 text-[11px] outline-none"
                                style={{ background: surface, color: text, border: `1px solid ${border}` }}
                              />
                            )}
                          </>
                        );
                      })()
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 实例类型 select（与 RunningHubNode 一致） */}
          <div>
            <label className="text-[10px] block mb-1" style={{ color: subText }}>实例类型(可选)</label>
            <select
              value={instanceType || ''}
              onChange={(e) => update({ instanceType: e.target.value })}
              className="w-full rounded px-2 py-1 text-xs outline-none"
              style={{ background: surface, color: text, border: `1px solid ${border}` }}
            >
              <option value="">默认</option>
              <option value="plus">plus</option>
              <option value="pro">pro</option>
            </select>
          </div>

          <ReuseResultToggle
            checked={d?.reuseResult === true}
            hasResult={hasReusableGenerationResult('rh-tools', d)}
            onChange={(checked) => update({ reuseResult: checked })}
            accentColor={accent}
          />

          {!isBusy ? (
            <button
              onClick={() => requestCanvasNodeRun(id)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium nodrag"
              style={{ background: accentSoft, color: accent, border: `1px solid ${ringColor}` }}
              onMouseEnter={(e) => (e.currentTarget.style.background = isPixel ? 'var(--px-yellow)' : (isLight ? 'rgba(8,145,178,0.20)' : 'rgba(34,211,238,0.25)'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = accentSoft)}
            >
              <Sparkles size={12} /> 运行应用
            </button>
          ) : (
            <button
              onClick={handleStop}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium nodrag"
              style={{ background: surface, color: text, border: `1px solid ${border}` }}
            >
              <Square size={11} /> {cancelling ? '取消中...' : '停止'}
            </button>
          )}

          {isBusy && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: accent }}>
              <Loader2 size={11} className="animate-spin" />
              {cancelling ? '正在取消 RH 后台任务...' : status === 'submitting' ? '提交任务...' : '轮询中'}
              {taskId && <span className="ml-auto" style={{ color: subText }}>{String(taskId).slice(0, 10)}…</span>}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
              <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {/* 节点内输出预览（仅在没有下游 OutputNode 时展示）*/}
          {urls.length > 0 && !hasAutoOutput && (
            <div className="space-y-1 pt-1" style={{ borderTop: `1px solid ${border}` }}>
              {urls.map((u, i) => {
                if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(u)) {
                  return <LoopingVideo key={i} src={u} controls className="w-full rounded" />;
                }
                if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(u)) {
                  return <LazyAudio key={i} src={u} controls className="w-full h-8" />;
                }
                return <SmartImage key={i} src={u} alt={`输出 ${i}`} className="w-full rounded object-cover" thumbSize={720} />;
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== 启动器视图 =====
  return (
    <div
      className="t8-rh-tools-node relative rounded-xl flex flex-col shadow-lg"
      style={{
        background: bg,
        color: text,
        width: size.w,
        height: size.h,
        minWidth: 280,
        minHeight: 320,
        boxSizing: 'border-box',
        border: `2px solid ${selected ? accent : ringColor}`,
        // overflow visible 让 Handle 悬浮于边缘之外
        overflow: 'visible',
      }}
    >
      {/* Handle 在最外层最前面，提供高 z-index */}
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !border-0" style={handleStyle} />
      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !border-0" style={handleStyle} />

      <ResizableCorners
        selected={selected}
        minWidth={280}
        minHeight={320}
        accent={accent}
        onResize={handleResize}
      />

      {/* 内层裁切：把启动器内部圆角裁切而不影响 Handle */}
      <div className="flex-1 flex flex-col rounded-xl overflow-hidden" style={{ minHeight: 0 }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${border}` }}>
          <div
            className="flex items-center justify-center"
            style={{ width: 24, height: 24, borderRadius: 6, background: accentSoft, color: accent }}
          >
            <Sparkles size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">RH 超市</div>
            <div className="text-[10px] truncate" style={{ color: subText }}>RunningHub 应用启动器</div>
          </div>
          <button
            onClick={() => {
              setSearchVisible((v) => {
                const nv = !v;
                if (nv) setTimeout(() => searchInputRef.current?.focus(), 0);
                else update({ rhToolsSearchQuery: '' });
                return nv;
              });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:opacity-80 nodrag"
            title="搜索"
            style={{ color: searchVisible ? accent : subText }}
          >
            <Search size={14} />
          </button>
        </div>

        {searchVisible && (
          <div className="px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${border}` }}>
            <input
              ref={searchInputRef}
              className="nodrag nowheel"
              placeholder="搜索（支持中文/拼音首字母，如 hy）"
              value={searchQuery}
              onChange={(e) => update({ rhToolsSearchQuery: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                background: surface,
                color: text,
                border: `1px solid ${border}`,
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                outline: 'none',
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 px-3 pt-2 shrink-0">
          <button
            onClick={() => setShowEditor(true)}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 py-1.5 rounded text-xs nodrag flex items-center justify-center gap-1"
            style={{ background: surface, color: text, border: `1px solid ${border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.background = surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = surface)}
          >
            <Plus size={11} /> 增加
          </button>
          <button
            onClick={() => setShowEditor(true)}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 py-1.5 rounded text-xs nodrag flex items-center justify-center gap-1"
            style={{ background: surface, color: text, border: `1px solid ${border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.background = surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = surface)}
          >
            <Pencil size={11} /> 编辑
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 px-3 py-2 shrink-0">
          <button
            onClick={handleExportBackup}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 py-1.5 rounded text-xs nodrag flex items-center justify-center gap-1"
            style={{ background: surface, color: text, border: `1px solid ${border}` }}
            title="导出 RH 超市 JSON"
            onMouseEnter={(e) => (e.currentTarget.style.background = surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = surface)}
          >
            <Download size={11} /> 导出
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 py-1.5 rounded text-xs nodrag flex items-center justify-center gap-1"
            style={{ background: accent, color: '#fff', border: `1px solid ${accent}` }}
            title="导入 RH 超市 JSON，会先提示确认"
          >
            <Upload size={11} /> 导入
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportBackup}
          />
        </div>

        {transferMsg && (
          <div className="px-3 pb-2 shrink-0">
            <div
              className="text-[10px] px-2 py-1 rounded truncate"
              title={transferMsg}
              style={{
                background: surface,
                color: transferMsg.includes('失败') ? '#ef4444' : accent,
                border: `1px solid ${border}`,
              }}
            >
              {transferMsg}
            </div>
          </div>
        )}

        <div
          className="flex gap-1 px-3 pb-2 overflow-x-auto shrink-0 nodrag nowheel"
          style={{ scrollbarWidth: 'thin' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {[{ id: ALL, name: '全部' }, { id: UNCATEGORIZED, name: '未分类' }, ...categories.map((c) => ({ id: c.id, name: c.name }))].map(
            (c) => {
              const active = activeCategoryId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => update({ rhToolsActiveCategoryId: c.id })}
                  className="px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap nodrag"
                  style={{
                    background: active ? accent : surface,
                    color: active ? '#fff' : subText,
                    border: `1px solid ${active ? accent : border}`,
                  }}
                >
                  {c.name}
                </button>
              );
            },
          )}
        </div>

        <div
          className="flex-1 overflow-y-auto px-3 pb-2 nodrag nowheel"
          style={{ minHeight: 0 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {tools.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px] text-center" style={{ color: subText }}>
              暂无应用
              <br />
              点击「+ 增加」开始添加
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px]" style={{ color: subText }}>
              无匹配结果
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {filteredTools.map((t) => {
                const isHover = hoveredId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      // 选中应用：重置运行状态，等待自动拉取 nodeInfoList
                      update({
                        rhToolsActiveAppId: t.id,
                        appInfo: null,
                        paramValues: {},
                        materialOrder: [],
                        instanceType: '',
                        status: 'idle',
                        taskId: '',
                        urls: [],
                        error: '',
                        rhCode: 0,
                        imageUrl: '',
                        videoUrl: '',
                        audioUrl: '',
                      });
                    }}
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => setHoveredId((prev) => (prev === t.id ? null : prev))}
                    title={t.description || t.title}
                    className="rounded text-xs px-2 py-1.5 text-center truncate nodrag"
                    style={{
                      background: isHover ? accent : surface,
                      color: isHover ? '#fff' : text,
                      border: `1px solid ${isHover ? accent : border}`,
                      transition: 'background 0.15s',
                    }}
                  >
                    {t.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="px-3 py-2 shrink-0"
          style={{ borderTop: `1px solid ${border}`, minHeight: 44, background: surface }}
        >
          {previewApp ? (
            <div>
              <div className="text-[11px] font-medium truncate" style={{ color: accent }}>
                ⚡ {previewApp.title}
              </div>
              <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: subText, lineHeight: 1.3 }}>
                {previewApp.description || `webappId: ${previewApp.webappId}`}
              </div>
            </div>
          ) : (
            <div className="text-[10px]" style={{ color: subText }}>
              悬停应用查看简介，点击启动 · 共 {tools.length} 个应用 / {categories.length} 个分类
            </div>
          )}
        </div>
      </div>

      {/* Editor Modal */}
      <RHToolEditorModal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        isLight={isLight}
        defaultCategoryId={activeCategoryId}
      />
    </div>
  );
};

export default memo(RHToolsNode);
