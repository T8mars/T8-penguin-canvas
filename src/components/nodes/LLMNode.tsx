import { memo, useCallback, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Brain,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Scissors,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  CUSTOM_LLM_MODEL_VALUE,
  LLM_MODELS,
  isImageOutputLlm,
  resolveLlmModelSelection,
} from '../../providers/models';
import {
  fileToDataUrl,
  generateExternalLlm,
  generateLlm,
  generateLlmStream,
  type LlmContentPart,
  type LlmMessage,
} from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { logBus } from '../../stores/logs';
import { PORT_COLOR } from '../../config/portTypes';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import { useThemeStore } from '../../stores/theme';
import MentionPromptInput from './MentionPromptInput';
import SmartImage from '../SmartImage';
import LazyVideo from '../LazyVideo';
import PromptTextarea from '../PromptTextarea';
import { rebaseMediaMentions, resolveMediaMentions, type MediaMention } from './mediaMentions';
import { splitText } from '../../utils/textSplit';
import { defaultSizeOf, placeBatchNodes, type Rect as PlacementRect } from '../../utils/nodePlacement';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useApiKeysStore } from '../../stores/apiKeys';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import type { RunNodeLifecycleReporter } from '../../types/project';
import {
  DEFAULT_SEEDANCE_NZ_LLM_MODEL,
  SEEDANCE_NZ_LLM_MODELS,
  resolveSeedanceNzLlmModel,
} from '../../config/llm';
import SmartTranslateButton from '../SmartTranslateButton';
import type { SmartTranslationRecord } from '../../utils/smartTranslation';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';

/**
 * LLM / Vision 节点 —— 完全对齐 gpt-image-2-web Chat (index.html L1600 / L8128~L8400)
 *  - 贞贞工坊常用模型 + Custom 自定义模型名
 *  - temperature(0~2) + max_tokens(100~128000)
 *  - 系统提示词 + localStorage 预设保存/加载
 *  - 图像上传(多模态 vision)
 *  - 多轮会话历史(可清空 / 新建会话)
 *  - 流式 SSE 增量更新
 *  - gpt-image-2-all 非流式 + 自动检测 generate_image 指令(简化版,标记生成提示)
 *  - 上游: text(prompt) + image(URL/dataURL) 自动作为多模态用户消息
 *  - 输出: data.prompt = 最后一条回复(下游可消费)
 *  - useRunTrigger 接入批量运行总线
 */

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
  videos?: string[];
}

const PRESET_KEY = 't8-llm-sys-presets';

function loadPresets(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePresets(map: Record<string, string>) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

/** 原生 wheel 事件拦截 —— 阻止冒泡到 ReactFlow 画布缩放 */
function attachWheelBlock(el: HTMLElement | null) {
  if (!el) return;
  // 避免重复绑定
  if ((el as any).__wheelBlocked) return;
  (el as any).__wheelBlocked = true;
  el.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.stopPropagation();
    },
    { passive: false, capture: false }
  );
  // 同时在 capture 阶段也拦截，防止 ReactFlow capture 监听
  el.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.stopPropagation();
    },
    { passive: false, capture: true }
  );
}

const LLM_REPLY_BLOCK_RE = /^\s*(?:#{1,6}\s+|[-*]\s+|>\s*)?(?:\*\*)?(?:宫格|镜头|分镜|场景|画面|提示词|方案|Scene|Shot)\s*(?:第\s*)?(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]+)?\s*(?:[:：、.)）\-—]\s*)?/i;
const LLM_REPLY_NUMBER_RE = /^\s*(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]+)\s*[.、)）:：\-—]\s+\S/;
const LLM_TRUNCATION_FINISH_REASONS = new Set(['length', 'max_tokens', 'content_length']);

function isLlmReplyTruncated(result: any): boolean {
  const finishReason =
    result?.finishReason ||
    result?.finish_reason ||
    result?.raw?.choices?.[0]?.finish_reason ||
    result?.raw?.choices?.[0]?.finishReason ||
    '';
  return result?.truncated === true || LLM_TRUNCATION_FINISH_REASONS.has(String(finishReason || '').toLowerCase());
}

function llmTokenLimitWarning(maxTokens: number): string {
  return `回答可能因为 maxTok=${maxTokens} 达到输出上限而被截断，请调大 maxTok 后重试。`;
}

function splitAssistantReplyForScatter(input: string): string[] {
  const text = String(input || '').replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const probe = trimmed.replace(/^\*\*/, '').replace(/\*\*:?$/, '');
    const startsBlock =
      LLM_REPLY_BLOCK_RE.test(probe) ||
      LLM_REPLY_NUMBER_RE.test(probe) ||
      /^[-*]\s+\S/.test(trimmed);
    if (startsBlock && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());
  const structured = blocks.filter(Boolean);
  if (structured.length > 1) return structured;

  const fallbacks = [
    splitText(text, { mode: 'storyboard', removeEmpty: true, trim: true }),
    splitText(text, { mode: 'paragraph', removeEmpty: true, trim: true }),
    splitText(text, { mode: 'line', removeEmpty: true, trim: true }),
  ];
  return fallbacks.find((parts) => parts.length > 1) || [text];
}

const LLMNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const { getEdges, getNodes, getNode, addNodes } = useReactFlow();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [presetMap, setPresetMap] = useState<Record<string, string>>(() => loadPresets());
  const [pickedFiles, setPickedFiles] = useState<{ name: string; dataUrl: string }[]>([]);
  const [pickedVideos, setPickedVideos] = useState<{ name: string; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const sysRef = useCallback((el: HTMLElement | null) => attachWheelBlock(el), []);
  const userRef = useCallback((el: HTMLElement | null) => attachWheelBlock(el), []);
  const chatRef = useCallback((el: HTMLDivElement | null) => attachWheelBlock(el), []);

  const d = data as any;
  const modelSelection = resolveLlmModelSelection({
    model: d?.model,
    customModel: d?.customModel,
    useCustomModel: d?.useCustomModel,
  });
  const model = modelSelection.model;
  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
  const llmAdvancedProviders = useMemo(
    () => advancedProvidersForNode(advancedProviders, 'llm'),
    [advancedProviders],
  );
  const providerSelection = useMemo(
    () => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
      providerSource: d?.providerSource,
      providerId: d?.providerId,
      providerModel: d?.providerModel,
    }),
    [advancedProviders, d?.providerSource, d?.providerId, d?.providerModel],
  );
  const isExternalSelected = providerSelection.available && providerSelection.providerSource !== 'zhenzhen';
  const isSeedanceNzSelected = !isExternalSelected && d?.llmApiSource === 'seedance-nz';
  const savedExternalMissing = !isSeedanceNzSelected
    && !!d?.providerSource
    && d.providerSource !== 'zhenzhen'
    && !providerSelection.available;
  const externalModelOptions = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'llm')
    : [];
  const externalProviderModel = providerSelection.providerModel || externalModelOptions[0] || '';
  const seedanceNzModel = resolveSeedanceNzLlmModel(d?.providerModel);
  const status: 'idle' | 'generating' | 'success' | 'error' = d?.status || 'idle';
    // 用户输入框值: 改用 d.userPrompt 私有字段（避免与对下游开放的 d.prompt=助手回复 冲突，
    // 否则下游 useUpstreamMaterials 会同时 pushText(d.prompt) + pushText(d.reply) 出现两条文本）
    // 兼容旧画布: 若仅有 d.prompt 而无 d.userPrompt 也无 d.reply（即历史数据从未生成过），按用户输入读取一次
    const localPrompt: string = d?.userPrompt ?? (d?.reply == null && typeof d?.prompt === 'string' ? d.prompt : '');
  const userPromptMentions: MediaMention[] = Array.isArray(d?.userPromptMentions) ? d.userPromptMentions : [];
  const systemPrompt: string = d?.system ?? '你是一个提示词专家，将用户的提示词优化';
  const temperature: number = typeof d?.temperature === 'number' ? d.temperature : 0.7;
  const maxTokens: number = typeof d?.maxTokens === 'number' ? d.maxTokens : 16384;
  const useStream: boolean = d?.stream !== false; // 默认开
  const llmVideoMode: 'frames' | 'native-base64' | 'url' =
    d?.llmVideoMode === 'url'
      ? 'url'
      : d?.llmVideoMode === 'native-base64' || d?.llmVideoMode === 'video-base64' || d?.llmVideoMode === 'compressed-base64'
        ? 'native-base64'
        : 'frames';
  const videoMaxWidth: number = typeof d?.videoMaxWidth === 'number' ? d.videoMaxWidth : 720;
  const videoMaxHeight: number = typeof d?.videoMaxHeight === 'number' ? d.videoMaxHeight : 720;
  const videoMaxBase64Mb: number = typeof d?.videoMaxBase64Mb === 'number' ? d.videoMaxBase64Mb : 8;
  const videoCrf: number = typeof d?.videoCrf === 'number' ? d.videoCrf : 32;
  const videoFrameCount: number = typeof d?.videoFrameCount === 'number' ? d.videoFrameCount : 12;
  const history: ChatTurn[] = Array.isArray(d?.history) ? d.history : [];
  const generatedImages: string[] = Array.isArray(d?.generatedImages) ? d.generatedImages : [];

  const syncOutputFromHistory = useCallback((nextHistory: ChatTurn[], keepConsumedTexts = false) => {
    const lastAssistant = [...nextHistory].reverse().find((t) => t.role === 'assistant');
    const allAssistantImages = nextHistory.flatMap((t) => (t.role === 'assistant' && Array.isArray(t.images) ? t.images : []));
    update({
      history: nextHistory,
      reply: lastAssistant?.text || '',
      prompt: lastAssistant?.text || '',
      generatedImages: allAssistantImages,
      imageUrls: lastAssistant?.images && lastAssistant.images.length ? lastAssistant.images : [],
      consumedTexts: lastAssistant && keepConsumedTexts ? d?.consumedTexts || [] : [],
    });
  }, [d?.consumedTexts, update]);

  const activeModel = isExternalSelected
    ? externalProviderModel
    : isSeedanceNzSelected ? seedanceNzModel : model;
  const src = `LLM·${activeModel || model}·#${id.slice(-4)}`;
  const isImgOut = !isExternalSelected && !isSeedanceNzSelected && isImageOutputLlm(model);

  // 上游素材实时订阅(跟随上游 data 变化重渲染) —— 用于节点内预览。
  // 跟 ImageNode / SeedanceNode 同一套机制(useNodeConnections + useNodesData),
  // 仅负责画面预览;实际发送仍走已有 collectUpstream 退路, 隐式零破坏。
  const upstreamMats = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstreamMats.images, excludedMaterialIds),
    [upstreamMats.images, excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstreamMats.texts, excludedMaterialIds),
    [upstreamMats.texts, excludedMaterialIds],
  );
  const visibleUpstreamVideos = useMemo(
    () => filterExcludedMaterials(upstreamMats.videos, excludedMaterialIds),
    [upstreamMats.videos, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstreamMats.images, ...upstreamMats.texts, ...upstreamMats.videos]),
    [excludedMaterialIds, upstreamMats.images, upstreamMats.texts, upstreamMats.videos],
  );

  // === 主题适配 (dark / pixel) ===
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  // 本地拾取的图片 → 包装为 Material(origin='local') 与上游素材统一在 MaterialPreviewSection 里呈现
  const localImageMaterials: Material[] = useMemo(
    () =>
      pickedFiles.map((f, i) => ({
        id: `local::image:${i}:${f.name}`,
        kind: 'image' as const,
        url: f.dataUrl,
        sourceNodeId: id,
        origin: 'local' as const,
        label: f.name || `本地${i + 1}`,
      })),
    [pickedFiles, id],
  );
  const localVideoMaterials: Material[] = useMemo(
    () =>
      pickedVideos.map((f, i) => ({
        id: `local::video:${i}:${f.name}`,
        kind: 'video' as const,
        url: f.url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: f.name || `本地视频${i + 1}`,
      })),
    [pickedVideos, id],
  );
  const allImagesUnordered = useMemo(
    () => [...localImageMaterials, ...visibleUpstreamImages],
    [localImageMaterials, visibleUpstreamImages],
  );
  const allVideosUnordered = useMemo(
    () => [...localVideoMaterials, ...visibleUpstreamVideos],
    [localVideoMaterials, visibleUpstreamVideos],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedImages = useOrderedMaterials(allImagesUnordered, materialOrder);
  const orderedVideos = useOrderedMaterials(allVideosUnordered, materialOrder);
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const translationProtectedTerms = useMemo(
    () => Array.from(new Set(userPromptMentions.map((mention) => mention.token).filter(Boolean))),
    [userPromptMentions],
  );
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleRemoveLocalMaterial = (m: Material) => {
    if (m.origin !== 'local') return;
    if (m.kind === 'image') setPickedFiles((s) => s.filter((f) => f.dataUrl !== m.url));
    if (m.kind === 'video') setPickedVideos((s) => s.filter((f) => f.url !== m.url));
  };
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });
  const handleTranslationRecord = useCallback((record: SmartTranslationRecord) => {
    update({ smartTranslation: record });
    if (record.status !== 'success') setError(record.error || '智能翻译失败');
  }, [update]);
  const handleTranslated = useCallback((translatedText: string, record: SmartTranslationRecord) => {
    setError(null);
    update({
      userPrompt: translatedText,
      userPromptMentions: rebaseMediaMentions(translatedText, userPromptMentions),
      smartTranslation: record,
    });
  }, [update, userPromptMentions]);

  // 上游: 收集 text + image + video (使用按用户拖拽顺序排好的 ordered 列表，与预览区呈现一致)
  const collectUpstream = (): { text: string; images: string[]; videos: string[] } => {
    const texts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    // orderedImages / orderedVideos 已包含上游与本地拾取，不需额外 concat
    const images = orderedImages.map((m) => m.url).filter((s) => !!s);
    const videos = orderedVideos.map((m) => m.url).filter((s) => !!s);
    void getEdges; // 保留引用避免 unused警告
    void getNodes;
    return { text: texts.join('\n').trim(), images, videos };
  };

  // 选本地图片
  const handlePickImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: { name: string; dataUrl: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      try {
        const url = await fileToDataUrl(f);
        next.push({ name: f.name, dataUrl: url });
      } catch (e: any) {
        logBus.warn(`图片读取失败: ${e?.message || '未知错误'}`, src);
      }
    }
    if (next.length) setPickedFiles((s) => [...s, ...next]);
  };

  const removePickedAt = (i: number) => setPickedFiles((s) => s.filter((_, idx) => idx !== i));

  // 构造 messages 数组(对齐主项目 _doSendChat)
  const buildMessages = (userText: string, userImages: string[], userVideos: string[]): LlmMessage[] => {
    const msgs: LlmMessage[] = [];
    if (systemPrompt.trim()) {
      msgs.push({ role: 'system', content: systemPrompt.trim() });
    }
    // 注入历史
    history.forEach((t) => {
      if (t.role === 'user' && ((t.images && t.images.length) || (t.videos && t.videos.length))) {
        const parts: LlmContentPart[] = [];
        if (t.text) parts.push({ type: 'text', text: t.text });
        (t.images || []).forEach((u) => parts.push({ type: 'image_url', image_url: { url: u } }));
        (t.videos || []).forEach((u) => parts.push({ type: 'video_url', video_url: { url: u } }));
        msgs.push({ role: 'user', content: parts });
      } else {
        msgs.push({ role: t.role, content: t.text });
      }
    });
    // 当前用户消息
    if (userImages.length || userVideos.length) {
      const parts: LlmContentPart[] = [];
      if (userText) parts.push({ type: 'text', text: userText });
      userImages.forEach((u) => parts.push({ type: 'image_url', image_url: { url: u } }));
      userVideos.forEach((u) => parts.push({ type: 'video_url', video_url: { url: u } }));
      msgs.push({ role: 'user', content: parts });
    } else {
      msgs.push({ role: 'user', content: userText });
    }
    return msgs;
  };

  const handleSend = async (reporter?: RunNodeLifecycleReporter) => {
    setError(null);
    setWarning(null);
    setStreamingText('');
    if (!isSeedanceNzSelected && modelSelection.isCustom && !model) {
      const message = '请先填写 Custom 模型名称';
      setError(message);
      update({ status: 'error', error: message });
      logBus.error(message, src);
      return;
    }
    const upstream = collectUpstream();
    const resolvedLocalPrompt = resolveMediaMentions(localPrompt, userPromptMentions, orderedImages);
    const userText = (upstream.text || resolvedLocalPrompt || '').trim();
    // 注: orderedImages 已包含本地 pickedFiles + 上游，不再重复拼接
    const userImages = upstream.images;
    const userVideos = upstream.videos;
    if (!userText && userImages.length === 0 && userVideos.length === 0) {
      setError('未提供用户输入(无上游 prompt / 本地输入 / 图片 / 视频)');
      logBus.error('缺少用户输入', src);
      return;
    }
    const llmVideoOptions = { llmVideoMode, videoMaxWidth, videoMaxHeight, videoMaxBase64Mb, videoCrf, videoFrameCount };
    const traceProvider = isExternalSelected && providerSelection.provider
      ? providerSelection.provider.id
      : isSeedanceNzSelected ? 'seedance-nz' : 'zhenzhen';
    const traceModel = activeModel || model;
    await reporter?.providerRequest({ provider: traceProvider, model: traceModel });

    taskCompletionSound.primeAudio();
    update({ status: 'generating', error: null });
    logBus.info(
      `发送到 ${isExternalSelected && providerSelection.provider
        ? providerSelection.provider.label
        : isSeedanceNzSelected ? '贞贞的平价AI小屋' : model} · ${
        !isExternalSelected && useStream && !isImgOut && userVideos.length === 0 ? 'SSE' : '非流式'
      } · imgs=${userImages.length} · videos=${userVideos.length}${userVideos.length ? ` · ${llmVideoMode}` : ''}`,
      src,
    );

    const messages = buildMessages(userText, userImages, userVideos);
    // 立即把当前轮加入历史(回复占位)
    const userTurn: ChatTurn = {
      role: 'user',
      text: userText,
      images: userImages.length ? userImages : undefined,
      videos: userVideos.length ? userVideos : undefined,
    };
    const nextHistory: ChatTurn[] = [...history, userTurn];

    try {
      if (!isExternalSelected && useStream && !isImgOut && userVideos.length === 0) {
        // ====== 流式 ======
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const streamResult = await generateLlmStream(
          {
            source: isSeedanceNzSelected ? 'seedance-nz' : 'zhenzhen',
            model: activeModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            ...llmVideoOptions,
          },
          {
            onDelta: (chunk) => setStreamingText((s) => s + chunk),
            signal: ctrl.signal,
            submissionKey: reporter?.providerSubmissionKey,
          }
        );
        abortRef.current = null;
        const replyText = streamResult.content || '';
        if (streamResult.usage) await reporter?.providerUsage({
          provider: traceProvider,
          model: traceModel,
          requestId: streamResult.requestId,
          usage: streamResult.usage,
        });
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          requestId: streamResult.requestId,
          transportHttpStatus: streamResult.transportHttpStatus,
          httpStatusSource: 'local-backend',
          finishReason: streamResult.finishReason,
          status: 'succeeded',
        });
        const truncationWarning = isLlmReplyTruncated(streamResult) ? llmTokenLimitWarning(maxTokens) : '';
        const finalHistory: ChatTurn[] = [...nextHistory, { role: 'assistant', text: replyText }];
        update({
          status: 'success',
          history: finalHistory,
          reply: replyText,
          prompt: replyText, // 下游可作为 prompt 消费
          // 记录本轮被「消化」的上游文本: 下游 useUpstreamMaterials 聚合时
          // 会跳过这些文本, 避免「原始 TextNode + LLM 优化结果」同时出现 2 条文本。
          consumedTexts: orderedTexts.map((t) => t.url).filter((s) => !!s),
          requestId: streamResult.requestId,
          httpStatus: streamResult.transportHttpStatus,
          usage: streamResult.usage,
        });
        setStreamingText('');
        setPickedFiles([]);
        setPickedVideos([]);
        if (truncationWarning) {
          setWarning(truncationWarning);
          logBus.warn(truncationWarning, src);
        }
        logBus.success(`完成 · ${replyText.length} 字`, src);
        taskCompletionSound.notifyComplete(id, 'llm');
      } else {
        // ====== 非流式(出图模型 或 关流式) ======
        const res = isExternalSelected && providerSelection.provider
          ? await generateExternalLlm({
              providerId: providerSelection.provider.id,
              providerModel: externalProviderModel,
              model: externalProviderModel,
              messages,
              temperature,
              max_tokens: maxTokens,
              ...llmVideoOptions,
              providerParams: d?.providerParams || {},
            }, { submissionKey: reporter?.providerSubmissionKey })
          : await generateLlm({
              source: isSeedanceNzSelected ? 'seedance-nz' : 'zhenzhen',
              model: activeModel,
              messages,
              temperature,
              max_tokens: maxTokens,
              ...llmVideoOptions,
            }, { submissionKey: reporter?.providerSubmissionKey });
        const replyText = res.content || '';
        if (res.usage) await reporter?.providerUsage({
          provider: traceProvider,
          model: traceModel,
          requestId: res.requestId,
          usage: res.usage,
        });
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          requestId: res.requestId,
          transportHttpStatus: res.transportHttpStatus,
          httpStatusSource: 'local-backend',
          finishReason: res.finishReason,
          status: 'succeeded',
        });
        const imgs = res.imageUrls || [];
        const truncationWarning = isLlmReplyTruncated(res) ? llmTokenLimitWarning(maxTokens) : '';
        const finalHistory: ChatTurn[] = [
          ...nextHistory,
          { role: 'assistant', text: replyText, images: imgs.length ? imgs : undefined },
        ];
        update({
          status: 'success',
          history: finalHistory,
          reply: replyText,
          prompt: replyText,
          generatedImages: imgs.length ? [...generatedImages, ...imgs] : generatedImages,
          imageUrls: imgs.length ? imgs : undefined,
          // 同上: 记录被消化的上游文本(非流式分支)
          consumedTexts: orderedTexts.map((t) => t.url).filter((s) => !!s),
          requestId: res.requestId,
          httpStatus: res.transportHttpStatus,
          usage: res.usage,
        });
        setPickedFiles([]);
        setPickedVideos([]);
        if (truncationWarning) {
          setWarning(truncationWarning);
          logBus.warn(truncationWarning, src);
        }
        if (imgs.length) logBus.success(`完成 · ${replyText.length} 字 + ${imgs.length} 图`, src);
        else logBus.success(`完成 · ${replyText.length} 字`, src);
        taskCompletionSound.notifyComplete(id, 'llm');
        // 注意:主项目还会进一步检测 streamed text 中的 generate_image JSON 块自动调
        // /v1/images/generations。本节点版用户可通过下游 ImageNode 直接消费 prompt 输出实现等价能力。
        if (isImgOut && /"generate_image"\s*:/.test(replyText) && imgs.length === 0) {
          logBus.warn('检测到 generate_image 指令但上游未返回图,可将本节点 prompt 输出连到下游图像节点自动出图', src);
        }
      }
    } catch (e: any) {
      const msg = e?.message || '调用失败';
      await reporter?.providerResponse({ provider: traceProvider, model: traceModel, status: 'failed', error: { message: msg } });
      setError(msg);
      update({ status: 'error', error: msg });
      logBus.error(msg, src);
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      logBus.warn('用户中止流式请求', src);
    }
  };

  const handleClear = () => {
    update({ history: [], reply: '', prompt: '', generatedImages: [], imageUrls: [], consumedTexts: [] });
    setStreamingText('');
    setPickedFiles([]);
    setPickedVideos([]);
  };

  // 预设
  const handleSavePreset = () => {
    const name = window.prompt('为当前系统提示词命名:', '');
    if (!name) return;
    if (!systemPrompt.trim()) {
      window.alert('系统提示词为空,无法保存');
      return;
    }
    const map = { ...presetMap, [name]: systemPrompt };
    savePresets(map);
    setPresetMap(map);
  };
  const handleDeletePreset = (name: string) => {
    const { [name]: _del, ...rest } = presetMap;
    void _del;
    savePresets(rest);
    setPresetMap(rest);
  };

  // 双击编辑助手消息
  const handleDoubleClickMsg = (idx: number) => {
    const turn = history[idx];
    if (turn?.role !== 'assistant') return;
    setEditingIdx(idx);
    setEditText(turn.text);
  };
  const handleEditBlur = () => {
    if (editingIdx === null) return;
    const newHistory = [...history];
    newHistory[editingIdx] = { ...newHistory[editingIdx], text: editText };
    // 最后一条助手消息编辑后同步更新输出
    const lastAssistant = [...newHistory].reverse().find(t => t.role === 'assistant');
    update({
      history: newHistory,
      reply: lastAssistant?.text || '',
      prompt: lastAssistant?.text || '',
      // 双击编辑助手回复后保持已有 consumedTexts (即上一次 send 时的上游)。
      // 此处不重新计算: 用户编辑期间 orderedTexts 可能与生成时不同, 不应覆盖。
    });
    setEditingIdx(null);
  };
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditingIdx(null);
    }
  };

  const handleDeleteHistoryTurn = (idx: number) => {
    const target = history[idx];
    if (!target) return;
    const previousLastAssistantIndex = history.map((turn, index) => ({ turn, index })).reverse().find((item) => item.turn.role === 'assistant')?.index ?? -1;
    const nextHistory = history.filter((_, index) => index !== idx);
    const nextLastAssistantIndex = nextHistory.map((turn, index) => ({ turn, index })).reverse().find((item) => item.turn.role === 'assistant')?.index ?? -1;
    syncOutputFromHistory(nextHistory, previousLastAssistantIndex !== idx && nextLastAssistantIndex >= 0);
    if (editingIdx !== null) {
      if (editingIdx === idx) setEditingIdx(null);
      else if (editingIdx > idx) setEditingIdx(editingIdx - 1);
    }
    logBus.info(target.role === 'assistant' ? '已删除这条 LLM 结果' : '已删除这条 LLM 消息', src);
  };

  const scatterAssistantText = useCallback((text: string, mode: 'smart' | 'single' = 'smart') => {
    const normalized = String(text || '').trim();
    const segments = mode === 'single' ? (normalized ? [normalized] : []) : splitAssistantReplyForScatter(text);
    if (segments.length === 0) return;
    const current = getNode(id);
    const size = defaultSizeOf('text');
    const baseX = (current?.position.x || 0) + ((current as any)?.measured?.width || (current as any)?.width || 580) + 80;
    const baseY = (current?.position.y || 0) + 40;
    const desired: PlacementRect[] = segments.map((_, index) => ({
      x: baseX + (index % 2) * (size.w + 36),
      y: baseY + Math.floor(index / 2) * (size.h + 36),
      w: size.w,
      h: size.h,
    }));
    const offset = placeBatchNodes(desired, getNodes(), {
      excludeIds: new Set([id]),
      source: `placement:llm-reply-scatter:${id}`,
    });
    const stamp = Date.now();
    const textNodes: Node[] = segments.map((segment, index) => ({
      id: `text-llm-${id}-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'text',
      position: {
        x: desired[index].x + offset.dx,
        y: desired[index].y + offset.dy,
      },
      selected: false,
      data: {
        prompt: segment,
        text: segment,
      },
    }));
    addNodes(textNodes);
    logBus.success(
      mode === 'single' ? '已生成 1 个完整助手回复文本节点' : `已智能打散 ${segments.length} 段助手回复`,
      src,
    );
  }, [addNodes, getNode, getNodes, id, src]);

  // 接入运行总线
  useRunTrigger(id, handleSend, 'llm', { lifecycleAware: true });

  // === 跨节点拖拽: source (生成图可拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收 image/video → 本地素材, text → prompt) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const url = payload.url;
      setPickedFiles((s) => (s.some((f) => f.dataUrl === url) ? s : [...s, { name: url.split('/').pop() || 'dropped', dataUrl: url }]));
      logBus.info(`已接受拖入图像 · ${url.slice(-40)}`, src);
    } else if (payload.kind === 'video' && payload.url) {
      const url = payload.url;
      setPickedVideos((s) => (s.some((f) => f.url === url) ? s : [...s, { name: url.split('/').pop() || 'dropped-video', url }]));
      logBus.info(`已接受拖入视频 · ${url.slice(-40)}`, src);
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ userPrompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'video', 'text'],
    onDrop: handleDrop,
  });

  const handleColor = PORT_COLOR.text; // 输出 text;输入兼容 text+image+video(由 portTypes.llm 决定)

  const mainRef = useRef<HTMLDivElement>(null);
  const hasChat = history.length > 0 || !!streamingText;

  // 用 state + useLayoutEffect 精确测量左侧主体高度，确保右侧面板底部对齐
  const [mainH, setMainH] = useState<number>(0);
  useLayoutEffect(() => {
    if (mainRef.current) {
      setMainH(mainRef.current.offsetHeight);
    }
  });

  if (canvasRenderMode === 'cold') {
    return (
      <div
        className="t8-node-cold-shell"
        data-t8-node-cold-shell="llm"
        style={{ width: hasChat ? 580 : 320, minHeight: 168 }}
      >
        <Handle type="target" position={Position.Left} className="!border-0 !bg-sky-300" />
        <Handle type="source" position={Position.Right} className="!border-0 !bg-sky-300" />
        <div className="t8-node-cold-shell__header">
          <Brain size={16} className="shrink-0 text-emerald-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{t('llm.title')}</strong>
            <small>{t('llm.offscreen', { model: model || 'LLM', count: history.length })}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-start gap-0" {...dropProps}>
      {/* 输入 Handle — 固定在整体左侧 */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-sky-300 !border-0 !z-10"
      />
      {/* 输出 Handle — 固定在整体右侧 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-sky-300 !border-0 !z-10"
      />
    {/* 主体 */}
    <div
      ref={mainRef}
      className={`relative rounded-xl border-2 transition-all w-[320px] ${
        selected ? 'border-emerald-400 shadow-2xl shadow-emerald-500/20' : isAccepting ? 'border-emerald-400' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        boxShadow: isAccepting ? '0 0 0 2px rgba(52,211,153,.45), 0 12px 30px rgba(52,211,153,.18)' : undefined,
      }}
    >

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,.2)', color: '#6ee7b7', boxShadow: 'inset 0 0 0 1px rgba(16,185,129,.45)' }}
        >
          <Brain size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{t('llm.title')}</div>
          <div className="text-[10px] text-white/40 truncate">
            {isExternalSelected && providerSelection.provider
              ? `${providerSelection.provider.label || providerSelection.provider.id} · ${externalProviderModel || t('llm.model')}`
              : isSeedanceNzSelected
                ? `${t('llm.budgetSource')} · ${seedanceNzModel}`
                : t('llm.defaultSource')}
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            title={t('llm.clearSession')}
            className="text-[10px] text-white/50 hover:text-rose-300 flex items-center gap-1"
          >
            <Plus size={11} /> {t('llm.newSession')}
          </button>
        )}
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-2">
            <button
              type="button"
              onClick={() => update({ advancedProviderOpen: !d?.advancedProviderOpen })}
              className="w-full flex items-center justify-between text-[10px] font-semibold text-white/70 hover:text-white"
            >
              <span>{t('llm.advancedSource')}</span>
              <span>
                {isExternalSelected && providerSelection.provider
                  ? providerSelection.provider.label
                  : isSeedanceNzSelected
                    ? t('llm.budgetSource')
                    : t('llm.defaultSource')}
              </span>
            </button>
            {d?.advancedProviderOpen && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{t('llm.platform')}</label>
                  <select
                    value={isExternalSelected
                      ? providerSelection.providerId
                      : isSeedanceNzSelected ? 'seedance-nz' : 'zhenzhen'}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (nextId === 'zhenzhen') {
                        update({
                          llmApiSource: 'zhenzhen',
                          providerSource: 'zhenzhen',
                          providerId: '',
                          providerModel: '',
                        });
                        return;
                      }
                      if (nextId === 'seedance-nz') {
                        update({
                          llmApiSource: 'seedance-nz',
                          providerSource: 'zhenzhen',
                          providerId: '',
                          providerModel: DEFAULT_SEEDANCE_NZ_LLM_MODEL,
                        });
                        return;
                      }
                      const provider = llmAdvancedProviders.find((item) => item.id === nextId);
                      if (!provider) return;
                      const nextModels = advancedProviderModelOptions(provider, 'llm');
                      update({
                        llmApiSource: 'zhenzhen',
                        providerSource: provider.protocol,
                        providerId: provider.id,
                        providerModel: nextModels[0] || '',
                        stream: false,
                      });
                    }}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  >
                    <option value="zhenzhen" style={{ background: '#18181b', color: '#ffffff' }}>
                      {t('llm.defaultSource')}
                    </option>
                    <option value="seedance-nz" style={{ background: '#18181b', color: '#ffffff' }}>
                      {t('llm.budgetSource')}
                    </option>
                    {llmAdvancedProviders.map((provider) => (
                      <option key={provider.id} value={provider.id} style={{ background: '#18181b', color: '#ffffff' }}>
                        {provider.label || provider.id}
                      </option>
                    ))}
                  </select>
                </div>
                {isExternalSelected && providerSelection.provider && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">{t('llm.externalModel')}</label>
                    <select
                      value={externalProviderModel}
                      onChange={(e) => update({ providerModel: e.target.value })}
                      style={{ background: '#18181b', color: '#ffffff' }}
                      className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                    >
                      {externalModelOptions.map((m) => (
                        <option key={m} value={m} style={{ background: '#18181b', color: '#ffffff' }}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isSeedanceNzSelected && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">{t('llm.budgetModel')}</label>
                    <select
                      value={seedanceNzModel}
                      onChange={(e) => update({ providerModel: e.target.value })}
                      style={{ background: '#18181b', color: '#ffffff' }}
                      className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                    >
                      {SEEDANCE_NZ_LLM_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId} style={{ background: '#18181b', color: '#ffffff' }}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[9px] leading-snug text-white/40">
                      {t('llm.budgetHelp')}
                    </div>
                  </div>
                )}
                {savedExternalMissing && (
                  <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                    {t('llm.missingProvider')}
                  </div>
                )}
              </div>
            )}
          </div>

        {/* 模型 */}
        {!isExternalSelected && !isSeedanceNzSelected && <div>
          <label className="text-[10px] text-white/50 block mb-1">{t('llm.model')}</label>
          <select
            value={modelSelection.presetValue}
            onChange={(e) => {
              const value = e.target.value;
              if (value === CUSTOM_LLM_MODEL_VALUE) {
                const customModel = typeof d?.customModel === 'string' ? d.customModel : '';
                update({ useCustomModel: true, customModel, model: customModel });
                return;
              }
              update({ useCustomModel: false, model: value });
            }}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            {LLM_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-zinc-900">
                {m.label}
              </option>
            ))}
            <option value={CUSTOM_LLM_MODEL_VALUE} className="bg-zinc-900">
              {t('llm.customModel')}
            </option>
          </select>
          {modelSelection.isCustom && (
            <input
              type="text"
              value={modelSelection.customModelInput}
              maxLength={200}
              placeholder={t('llm.customPlaceholder')}
              onChange={(e) => update({
                useCustomModel: true,
                customModel: e.target.value,
                model: e.target.value,
              })}
              className="mt-1.5 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/30"
            />
          )}
        </div>}

        {/* 温度 / max_tokens / 流式 */}
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[9px] text-white/40 block mb-0.5">temp</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => update({ temperature: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[9px] text-white/40 block mb-0.5">maxTok</label>
            <input
              type="number"
              min={100}
              max={128000}
              step={100}
              value={maxTokens}
              onChange={(e) => update({ maxTokens: Math.max(100, Math.min(128000, Number(e.target.value) || 16384)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none focus:border-white/30"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] text-white/40 block mb-0.5">{t('llm.stream')}</label>
            <label
              className={`flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] cursor-pointer ${
                useStream && !isImgOut && !isExternalSelected
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-white/5 text-white/40 border border-white/10'
              } ${isImgOut || isExternalSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                disabled={isImgOut || isExternalSelected}
                checked={useStream && !isImgOut && !isExternalSelected}
                onChange={(e) => update({ stream: e.target.checked })}
                className="hidden"
              />
              {isExternalSelected ? '关(扩展)' : isImgOut ? '关(出图)' : useStream ? 'SSE' : '关'}
            </label>
          </div>
        </div>

        {/* 系统提示词 + 预设 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-white/50">{t('llm.systemPrompt')}</label>
            <div className="flex items-center gap-1">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) update({ system: presetMap[e.target.value] || '' });
                }}
                title={t('llm.loadPreset')}
                className="rounded bg-white/5 border border-white/10 px-1 py-0.5 text-[10px] text-white/70 outline-none"
              >
                <option value="" className="bg-zinc-900">
                  {t('llm.presetPlaceholder')}
                </option>
                {Object.keys(presetMap).map((name) => (
                  <option key={name} value={name} className="bg-zinc-900">
                    {name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleSavePreset}
                title={t('llm.savePreset')}
                className="text-emerald-300 hover:text-emerald-200"
              >
                <Save size={11} />
              </button>
              {Object.keys(presetMap).length > 0 && (
                <button
                  onClick={() => {
                    const name = window.prompt(t('llm.deletePresetPrompt'), '');
                    if (name && presetMap[name]) handleDeletePreset(name);
                  }}
                  title={t('llm.deletePreset')}
                  className="text-rose-300 hover:text-rose-200"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
          <PromptTextarea
            ref={sysRef}
            title={t('llm.systemPromptTitle')}
            value={systemPrompt}
            onValueChange={(value) => update({ system: value })}
            placeholder={t('llm.systemPlaceholder')}
            className="w-full h-36 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30 overflow-y-auto"
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="image"
          />
        </div>

        {/* 用户输入 */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{t('llm.userInput')}</label>
          <MentionPromptInput
            editorRef={userRef}
            title={t('llm.userInputTitle')}
            value={localPrompt}
            mentions={userPromptMentions}
            materials={orderedImages}
            onChange={(value, mentions) => update({ userPrompt: value, userPromptMentions: mentions })}
            placeholder={t('llm.userInputPlaceholder')}
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="image"
            toolbarAction={(
              <SmartTranslateButton
                text={localPrompt}
                nodeId={id}
                protectedTerms={translationProtectedTerms}
                lastRecord={d?.smartTranslation}
                onTranslated={handleTranslated}
                onRecord={handleTranslationRecord}
              />
            )}
            className="w-full h-60 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30 overflow-y-auto"
          />
        </div>

        {orderedVideos.length > 0 && (
          <div className="rounded border border-sky-400/20 bg-sky-500/[0.06] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] text-sky-200/80">{t('llm.videoInput')}</label>
              <select
                value={llmVideoMode}
                onChange={(e) => {
                  const value = e.target.value;
                  update({ llmVideoMode: value === 'url' ? 'url' : value === 'native-base64' ? 'native-base64' : 'frames' });
                }}
                className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[10px] text-white outline-none"
                title={t('llm.videoInputTitle')}
              >
                <option value="frames" className="bg-zinc-900">{t('llm.frames')}</option>
                <option value="native-base64" className="bg-zinc-900">{t('llm.nativeVideo')}</option>
                <option value="url" className="bg-zinc-900">URL</option>
              </select>
            </div>
            {llmVideoMode === 'frames' ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-[9px] text-white/40 block mb-0.5">{t('llm.frameCount')}</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={videoFrameCount}
                      onChange={(e) => update({ videoFrameCount: Math.max(1, Math.min(60, Number(e.target.value) || 12)) })}
                      className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-white/40 block mb-0.5">{t('llm.frameEdge')}</label>
                    <input
                      type="number"
                      min={256}
                      max={1600}
                      step={64}
                      value={videoMaxWidth}
                      onChange={(e) => {
                        const next = Math.max(256, Math.min(1600, Number(e.target.value) || 720));
                        update({ videoMaxWidth: next, videoMaxHeight: next });
                      }}
                      className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-white/45 leading-snug">
                  {t('llm.framesHelp')}
                </div>
              </div>
            ) : llmVideoMode === 'native-base64' ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="text-[9px] text-white/40 block mb-0.5">{t('llm.edge')}</label>
                    <input
                      type="number"
                      min={256}
                      max={1920}
                      step={64}
                      value={videoMaxWidth}
                      onChange={(e) => {
                        const next = Math.max(256, Math.min(1920, Number(e.target.value) || 720));
                        update({ videoMaxWidth: next, videoMaxHeight: next });
                      }}
                      className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-white/40 block mb-0.5">{t('llm.maxMb')}</label>
                    <input
                      type="number"
                      min={2}
                      max={64}
                      step={1}
                      value={videoMaxBase64Mb}
                      onChange={(e) => update({ videoMaxBase64Mb: Math.max(2, Math.min(64, Number(e.target.value) || 8)) })}
                      className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-white/40 block mb-0.5">CRF</label>
                    <input
                      type="number"
                      min={18}
                      max={40}
                      step={1}
                      value={videoCrf}
                      onChange={(e) => update({ videoCrf: Math.max(18, Math.min(40, Number(e.target.value) || 32)) })}
                      className="w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-white/45 leading-snug">
                  {t('llm.nativeHelp')}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-white/45 leading-snug">
                {t('llm.urlHelp')}
              </div>
            )}
          </div>
        )}

        {/* 上游素材聚合预览区 (与 ImageNode / VideoNode / SeedanceNode 使用同一个组件，保证双主题下尺寸/样式一致) */}
        <MaterialPreviewSection
          texts={orderedTexts}
          images={orderedImages}
          videos={orderedVideos}
          order={materialOrder}
          onReorder={setMaterialOrder}
          onRemoveLocal={handleRemoveLocalMaterial}
          onExcludeUpstream={handleExcludeUpstreamMaterial}
          excludedCount={excludedUpstreamCount}
          onRestoreExcluded={handleRestoreExcludedMaterials}
          selected={!!selected}
          isDark={isDark}
          isPixel={isPixel}
          groups={['text', 'image', 'video']}
          title={t('llm.materials')}
          imageUploadAction={{
            onClick: () => fileInputRef.current?.click(),
            title: '上传本地图片(多模态)',
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            handlePickImages(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {/* 按钮 */}
        <div className="flex gap-1.5">
          <button
            onClick={() => requestCanvasNodeRun(id)}
            disabled={status === 'generating'}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {status === 'generating' ? (
              <>
                <Loader2 size={12} className="animate-spin" /> {t('llm.thinking')}
              </>
            ) : (
              <>
                <Send size={12} /> {t('llm.send')}
              </>
            )}
          </button>
          {status === 'generating' && useStream && !isImgOut && !isExternalSelected && (
            <button
              onClick={handleStop}
              className="px-2 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs"
              title={t('llm.abort')}
            >
              <Square size={11} />
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {warning && (
          <div className="flex items-start gap-1 text-[10px] text-amber-200 bg-amber-500/10 border border-amber-400/25 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{warning}</span>
          </div>
        )}
      </div>

    </div>

    {/* 右侧会话面板 */}
    {hasChat && (
      <div
        ref={chatRef}
        className={`llm-chat-panel w-[260px] rounded-xl border-2 pl-2.5 pt-2.5 pb-2.5 pr-0 ${
          editingIdx !== null ? 'flex flex-col' : 'overflow-y-auto space-y-1.5'
        } ${
          selected ? 'border-emerald-400/60' : 'border-white/10'
        }`}
        style={{ background: 'rgba(20,20,22,.94)', height: mainH ? `${mainH}px` : undefined }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {editingIdx !== null ? (
          /* 编辑模式：textarea 擑满整个面板，高度严格等于左侧节点 */
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleEditBlur}
            onKeyDown={handleEditKeyDown}
            className="w-full flex-1 resize-none rounded bg-white/10 border border-emerald-400/50 px-2 py-1.5 text-[11px] text-white outline-none focus:border-emerald-400 overflow-y-auto"
          />
        ) : (
          /* 正常展示模式 */
          <>
        {history.map((turn, i) => (
          <div key={i} className="text-[11px]">
            <div className={`text-[9px] mb-0.5 ${turn.role === 'user' ? 'text-sky-300/60' : 'text-emerald-300/60'}`}>
              {turn.role === 'user' ? t('llm.user') : t('llm.assistant')}
              {turn.role === 'assistant' && <span className="text-white/30 ml-1">{t('llm.editHint')}</span>}
            </div>
            <div
              onDoubleClick={() => handleDoubleClickMsg(i)}
              className={`llm-chat-message relative whitespace-pre-wrap text-white/80 bg-white/[0.03] rounded p-1.5 ${
                turn.role === 'assistant' ? 'cursor-pointer hover:bg-white/[0.06] transition-colors pr-20' : ''
              }`}
            >
              {turn.role === 'assistant' && turn.text.trim() && (
                <>
                  <button
                    type="button"
                    className="llm-chat-action-button llm-chat-action-button--single t8-mini-icon-button nodrag nopan"
                    title={t('llm.scatterSingle')}
                    aria-label={t('llm.scatterSingleAria')}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      scatterAssistantText(turn.text, 'single');
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <FileText size={13} />
                  </button>
                  <button
                    type="button"
                    className="llm-chat-action-button llm-chat-action-button--smart t8-mini-icon-button nodrag nopan"
                    title={t('llm.scatterSmart')}
                    aria-label={t('llm.scatterSmartAria')}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      scatterAssistantText(turn.text, 'smart');
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Scissors size={13} />
                  </button>
                  <button
                    type="button"
                    className="llm-chat-action-button llm-chat-action-button--delete t8-mini-icon-button nodrag nopan"
                    title={t('llm.deleteResult')}
                    aria-label={t('llm.deleteResult')}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteHistoryTurn(i);
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
              {turn.text || '[空]'}
            </div>
            {turn.images && turn.images.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {turn.images.map((u, j) => (
                  <SmartImage
                    key={j}
                    src={u}
                    alt=""
                    data-drag-source
                    data-drag-kind="image"
                    data-drag-url={u}
                    data-drag-preview={u}
                    data-drag-node-id={id}
                    data-resource-title={u.split('/').pop() || '助手图像'}
                    data-prompt-template-kind="image"
                    data-prompt-template-category="image-reference-edit"
                    data-prompt-template-prompt={turn.text || localPrompt}
                    onMouseDown={(e) => beginMaterialDrag(e, { kind: 'image', url: u, sourceNodeId: id, previewUrl: u })}
                    className="w-12 h-12 object-cover rounded border border-white/10 cursor-grab"
                    title={t('llm.dragMaterial')}
                    thumbSize={160}
                  />
                ))}
              </div>
            )}
            {turn.videos && turn.videos.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {turn.videos.map((u, j) => (
                  <LazyVideo
                    key={j}
                    src={u}
                    muted
                    controls
                    data-drag-source
                    data-drag-kind="video"
                    data-drag-url={u}
                    data-drag-preview={u}
                    data-drag-node-id={id}
                    data-resource-title={u.split('/').pop() || '助手视频'}
                    data-prompt-template-kind="video"
                    data-prompt-template-category="video-image-to-video"
                    data-prompt-template-prompt={turn.text || localPrompt}
                    onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: u, sourceNodeId: id, previewUrl: u })}
                    className="w-20 h-12 object-cover rounded border border-white/10 cursor-grab"
                    title={t('llm.dragMaterial')}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {streamingText && (
          <div className="text-[11px]">
            <div className="text-[9px] mb-0.5 text-emerald-300/60">{t('llm.streamingAssistant')}</div>
            <div className="whitespace-pre-wrap text-white/80 bg-emerald-500/[0.08] rounded p-1.5 border border-emerald-500/20">
              {streamingText}
            </div>
          </div>
        )}
          </>
        )}
      </div>
    )}
    </div>
  );
};

export default memo(LLMNode);
