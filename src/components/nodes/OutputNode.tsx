import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Handle,
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import { Box, Camera, MonitorPlay, Type as TypeIcon, Image as ImageIcon, Video as VideoIcon, Music, Download, Pencil, Check, Edit3, GitCompare, Trash2, Ratio, MoveDiagonal2 } from 'lucide-react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { PORT_COLOR } from '../../config/portTypes';
import { resolveThemeTemplate } from '../../theme/defaultTemplates';
import ImageEditModal, { type ImageEditProduceMeta } from './ImageEditModal';
import ImageCompareModal from '../ImageCompareModal';
import CollectionSplitButton from '../CollectionSplitButton';
import ImageHoverPreview from '../ImageHoverPreview';
import ImageDetailViewer from '../ImageDetailViewer';
import LoopingVideo from '../LoopingVideo';
import MediaMetadataBadge from '../MediaMetadataBadge';
import RhImageCapabilityRail from '../RhImageCapabilityRail';
import RhVideoCapabilityRail from '../RhVideoCapabilityRail';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import ImageLongEdgeButtons from '../ImageLongEdgeButtons';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { useImageLongEdgeOutputs } from '../../hooks/useImageLongEdgeOutputs';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import ResizableCorners from './ResizableCorners';
import { saveAssetToDisk } from '../../services/api';
import { generateImage } from '../../services/generation';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import {
  createOutputMediaRemovalData,
  createOutputDataFromItem,
  fileNameFromUrl,
  isMaterialUrlHidden,
  type MediaItem,
  type MediaKind,
} from '../../utils/mediaCollection';
import {
  extractImagesFromData,
  extractInputCandidatesFromData,
  isImageLikeUrl,
  type ImageCompareCandidate,
} from '../../utils/imageCompare';
import { collectMaterialSetBucketsFromData, valueOfMaterialSetItem } from '../../utils/materialSet';
import { selectSourceHandleData } from '../../utils/sourceHandleData';
import { shouldCollectNodeTextOutput } from '../../utils/imageNodeOutputMode';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildAnnotationEditRequest,
  buildAnnotationEditResultPlacement,
} from '../../utils/canvasCreativeWorkflow';
// v1.2.10.5: 节点落点防重叠 —— 双击编辑产出 N 节点 3 列宫格整组避让
import { placeBatchNodes, defaultSizeOf, type Rect as PlacementRect } from '../../utils/nodePlacement';
import { extractRunProviderTrace } from '../../utils/runProviderTrace';
import { snapshotVideoFrameAsync } from '../../services/videoOps';
import {
  createSecondaryProviderActionForNode,
  executeRegisteredSecondaryProviderAction,
  requestCanvasSecondaryProviderAction,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  type QueueSecondaryProviderAction,
  type SecondaryProviderActionEnvelope,
} from '../../utils/secondaryProviderAction';
import type { RunNodeLifecycleReporter } from '../../types/project';
import SmartTranslateButton from '../SmartTranslateButton';
import type { SmartTranslationRecord } from '../../utils/smartTranslation';
import {
  computeOutputAspectSize,
  normalizeOutputViewState,
  resolveOutputGridColumns,
  type OutputViewState,
} from '../../utils/outputView';

type OutputProduceMeta =
  | ImageEditProduceMeta
  | {
      type: 'rh-capability' | 'video-frame-extract' | 'rh-video-capability';
      label?: string;
      capability?: string;
      toolId?: string;
      taskIds?: string[];
    };

/**
 * OutputNode - 通用输出素材节点 (中继展示型)
 *
 * 设计:
 *   1. 输入: 接收上游任意 文本/图像/视频/音频/3D模型 连入 (target handle, 左侧)
 *   2. 自动遍历上游节点的 data, 抽取所有可识别的:
 *      - 文本: prompt / reply / text / outputText
 *      - 图像: imageUrl / imageUrls[] / urls[] / generatedImages[]
 *      - 视频: videoUrl
 *      - 音频: audioUrl
 *   3. 分区显示, 图像/视频按原始宽高比 (object-contain + maxHeight) 不强制裁剪
 *   4. 文本双击进入可编辑状态, 编辑保存到 data.outputText (覆盖上游 live 文本)
 *      置空 outputText 时再次显示上游原文
 *   5. 输出: 收集到的 文本/图像/视频/音频/3D模型 同时透传到本节点自身 data 的
 *      prompt / imageUrl / imageUrls / urls / videoUrl / audioUrl / modelUrl 字段上,
 *      下游节点能像读上游一样读到 (source handle, 右侧, any)
 *
 * 渲染联动机制(重要):
 *   - 上游订阅: useNodeConnections + useNodesData (xyflow 官方 hook)
 *   - 下游透传: useEffect 监听 collected + displayText 变化,
 *     写不同字段避免踩 outputText (后者是「用户编辑覆盖」标记),
 *     同时手式比较 cur/next, 一致时不调 update 以免产生循环。
 */

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u);
const isAudioUrl = (u: string) => /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(u);
const isModel3DUrl = (u: string) => /\.(glb|gltf|obj|fbx|stl|usdz|zip)(\?|$)/i.test(u) || /^data:model\//i.test(u);

const NODE_INPUT_LABEL_KEYS: Record<string, string> = {
  upload: 'nodes:output.inputLabels.upload',
  output: 'nodes:output.inputLabels.output',
  image: 'nodes:output.inputLabels.image',
  'frame-pair': 'nodes:output.inputLabels.framePair',
  resize: 'nodes:output.inputLabels.resize',
  combine: 'nodes:output.inputLabels.combine',
  'grid-crop': 'nodes:output.inputLabels.gridCrop',
  'grid-editor': 'nodes:output.inputLabels.gridEditor',
  'remove-bg': 'nodes:output.inputLabels.removeBg',
  upscale: 'nodes:output.inputLabels.upscale',
  relay: 'nodes:output.inputLabels.relay',
};

interface Collected {
  texts: string[];
  images: string[];
  videos: string[];
  audios: string[];
  models: string[];
}

const OutputNode = ({ id, data, selected }: NodeProps) => {
  const canvasRenderMode = useCanvasNodeRenderMode();
  const { t } = useTranslation(['nodes', 'common']);
  const update = useUpdateNodeData(id);
  const { theme, templateId, customTemplates } = useThemeStore();
  const isDark = theme === 'dark';
  const d = (data as any) || {};
  const rf = useReactFlow();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaAspectByUrlRef = useRef(new Map<string, number>());
  const queueSecondaryAction = useCallback<QueueSecondaryProviderAction>((draft) => {
    const action = createSecondaryProviderActionForNode(id, 'output', draft);
    update(secondaryProviderActionNodePatch(action));
    queueMicrotask(() => {
      if (!requestCanvasSecondaryProviderAction(action)) {
        const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
        if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
        logBus.error(t('nodes:output.errors.secondaryHealth'), `secondary-output:${id}`);
      }
    });
    return action;
  }, [id, rf, t, update]);
  const [rhCapabilityBusy, setRhCapabilityBusy] = useState(false);
  const [rhVideoCapabilityBusy, setRhVideoCapabilityBusy] = useState(false);
  const [capturingFrameKey, setCapturingFrameKey] = useState<string | null>(null);
  const [videoFrameError, setVideoFrameError] = useState('');
  const [imageLongEdgeError, setImageLongEdgeError] = useState('');
  const videoFrameTimesRef = useRef(new Map<string, number>());
  const activeTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const isRhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'rh';
  const isRhVisual = activeTemplate.visuals?.style === 'rh' || isRhDomVisual;
  const isRhDuckOutput = Boolean(isRhVisual && d.rhDuckDecoded);
  const isYyhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'yyh';
  const isYyhVisual = activeTemplate.visuals?.style === 'yyh' || isYyhDomVisual;
  const isYyhPortraitOutput = Boolean(isYyhVisual && d.yyhPortraitHidden);

  // 节点本地尺寸 state: 默认 (320, 高度由内容撑开)
  // 拖角后由 ResizableCorners onResize 同步具体 px — 保证节点始终有具体尺寸 → wrapper measured 准确
  // → keepAspectRatio 生效 (同比例缩放) + handleBounds 准确 (连线稳定)
  const [outputView, setOutputView] = useState<OutputViewState>(() => normalizeOutputViewState(d.outputView));
  const [size, setSize] = useState<{ w: number; h?: number }>(() => ({
    w: normalizeOutputViewState(d.outputView).width || 320,
    h: normalizeOutputViewState(d.outputView).height,
  }));

  // 订阅连入本节点 target handle 的连接变化
  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(
    () => Array.from(new Set(connections.map((c) => c.source))),
    [connections]
  );
  // 订阅上游节点的 data, 任何上游 data 变化都会触发重渲染
  const upstreamNodes = useNodesData(upstreamIds);

  // v1.2.9.5: 检测上游是否含 LoopNode —— 用于「直接接 LoopNode 的 OutputNode」空状态下显示友好提示,
  //         代替误导性的「连入上游...」占位 (循环器不产出素材 → OutputNode 本身也不应表现得像「坏掉」)。
  const upstreamHasLoop = useMemo(() => {
    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    return list.some((n: any) => n?.type === 'loop');
  }, [upstreamNodes]);

  // v1.2.8.4: 收集每个上游 source 上被连接的 sourceHandle 集合,
  //           供 FramePair 等多端口节点按 handle 区分输出 (与 useUpstreamMaterials 对齐)
  const handleMap = useMemo(() => {
    const m = new Map<string, Set<string | null>>();
    for (const c of connections) {
      let set = m.get(c.source);
      if (!set) { set = new Set<string | null>(); m.set(c.source, set); }
      set.add((c as any).sourceHandle ?? null);
    }
    return m;
  }, [connections]);

  // 细粒度字段签名: 防止 xyflow useNodesData 返回引用稳定导致 useMemo 漏重算;
  // 纯字符串变化 React 可靠跟踪，上游任何一个被迫关心的字段变动均会重算 collected。
  const upstreamSig = useMemo(() => {
    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    return list
      .map((n: any) => {
        const ud = n?.data || {};
        const arr1 = Array.isArray(ud.imageUrls) ? ud.imageUrls.join(',') : '';
        const arr2 = Array.isArray(ud.urls) ? ud.urls.join(',') : '';
        const arr3 = Array.isArray(ud.generatedImages) ? ud.generatedImages.join(',') : '';
        const arr4 = Array.isArray(ud.consumedTexts) ? ud.consumedTexts.join('\u241F') : '';
        const arr5 = Array.isArray(ud.textSegments) ? ud.textSegments.join('\u241F') : '';
        const arr6 = Array.isArray(ud.segments) ? ud.segments.join('\u241F') : '';
        const arr7 = Array.isArray(ud.texts) ? ud.texts.join('\u241F') : '';
        const arrModel1 = Array.isArray(ud.modelUrls) ? ud.modelUrls.join(',') : '';
        const arrModel2 = Array.isArray(ud.directModelUrls) ? ud.directModelUrls.join(',') : '';
        const arr8 = Array.isArray(ud.materialSetItems)
          ? JSON.stringify(ud.materialSetItems.map((item: any) => [item?.kind, item?.url, item?.text, item?.name]))
          : '';
        const routedOutputs = ud.subflowOutputs && typeof ud.subflowOutputs === 'object' ? JSON.stringify(ud.subflowOutputs) : '';
        return [
          n?.id || '',
          n?.type || '',
          ud.materialSetKind || '',
          ud.outputText || '',
          ud.reply || '',
          ud.prompt || '',
          ud.text || '',
          ud.imageOnlyOutput === false ? 'image-text-output' : 'image-only-output',
          ud.imageUrl || '',
          ud.videoUrl || '',
          ud.audioUrl || '',
          ud.audioUrl_1 || '', // Suno 双轨副轨; 漏写会导致只显示第 1 首
          ud.modelUrl || '',
          ud.directModelUrl || '',
          ud.firstFrameUrl || '', // v1.2.8.4: FramePair 双端口字段
          ud.lastFrameUrl || '',
          ud.__loopAccumulate ? `LA:${ud.__loopAccumulate}` : '', // v1.2.9.1: 循环累积标记 — 进入/退出循环时需重算 collected
          arr1,
          arr2,
          arr3,
          arr4,
          arr5,
          arr6,
          arr7,
          arrModel1,
          arrModel2,
          arr8,
          routedOutputs,
        ].join('§');
      })
      .join('|');
  }, [upstreamNodes]);

  const collected = useMemo<Collected>(() => {
    const out: Collected = { texts: [], images: [], videos: [], audios: [], models: [] };

    // 「被 LLM 消化」文本跳过集: 与 useUpstreamMaterials 保持一致。
    // 场景: TextNode 同时连 LLM 和 OutputNode 时, 避免 原始 prompt + LLM reply 同现 2 条。
    const skipTextSet = new Set<string>();
    {
      const list0 = Array.isArray(upstreamNodes) ? upstreamNodes : [];
      for (const n of list0) {
        const ud: any = n?.data || {};
        const hasReply = typeof ud.reply === 'string' && ud.reply.trim().length > 0;
        if (!hasReply) continue;
        if (Array.isArray(ud.consumedTexts)) {
          for (const t of ud.consumedTexts) {
            if (typeof t === 'string') {
              const s = t.trim();
              if (s) skipTextSet.add(s);
            }
          }
        }
      }
    }

    const pushUnique = (arr: string[], v: any) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      if (arr.indexOf(s) === -1) arr.push(s);
    };
    const pushUniqueText = (arr: string[], v: any) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      if (skipTextSet.has(s)) return; // 已被 LLM 消化
      if (arr.indexOf(s) === -1) arr.push(s);
    };
    const pushTextSegment = (arr: string[], v: any) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      if (skipTextSet.has(s)) return;
      arr.push(s);
    };
    const pushClassifiedUrl = (value: any) => {
      if (typeof value !== 'string') return;
      const url = value.trim();
      if (!url) return;
      if (isModel3DUrl(url)) pushUnique(out.models, url);
      else if (isVideoUrl(url)) pushUnique(out.videos, url);
      else if (isAudioUrl(url)) pushUnique(out.audios, url);
      else pushUnique(out.images, url);
    };

    const directSnapshotOnly = d.directOutputSingleSnapshot === true;
    const directOnlyOutput = Boolean(d.rhDuckDecoded) || directSnapshotOnly;
    if (!directOnlyOutput) {
      const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
      for (const n of list) {
        const sid = (n as any)?.id || '';
        const collectNodeTextOutput = shouldCollectNodeTextOutput((n as any)?.type, n?.data);
        const handles = handleMap.get(sid) || new Set<string | null>([null]);
        const routedData = selectSourceHandleData((n?.data || {}) as Record<string, unknown>, handles);
        for (const ud of routedData as any[]) {

        // 显式素材集: 按内部顺序透传；跳过旧字段读取，避免素材集同步字段造成重复。
        if ((n as any)?.type === 'material-set' && Array.isArray(ud.materialSetItems)) {
          const buckets = collectMaterialSetBucketsFromData(ud);
          buckets.text.forEach((item) => pushTextSegment(out.texts, valueOfMaterialSetItem(item)));
          buckets.image.forEach((item) => pushUnique(out.images, item.url));
          buckets.video.forEach((item) => pushUnique(out.videos, item.url));
          buckets.audio.forEach((item) => pushUnique(out.audios, item.url));
          continue;
        }

      // === v1.2.9.0: 循环累积模式 —— 上游节点被 LoopNode 标记 __loopAccumulate 时,
      //             跳过该上游的 fresh 字段收集 (让本节点 direct*Urls / directOutputText 的累积值独占显示)。
      //             这样跨轮产物不会被生成节点「本轮覆盖」的 fresh 担换, 循环结束后标记被 LoopNode 清除, 恢复正常透传。
        if (ud.__loopAccumulate) continue;

      // 文本: textSegments/texts 数组优先, 避免文本分割节点再把 joined prompt 当成第 N+1 项
        if (collectNodeTextOutput) {
          const textArrayFields = ['textSegments', 'segments', 'texts'];
          const textArrayField = textArrayFields.find((f) => Array.isArray(ud[f]) && ud[f].length > 0);
          if (textArrayField) {
            ud[textArrayField].forEach((item: any) => pushTextSegment(out.texts, item));
          } else {
            pushUniqueText(out.texts, ud.outputText);
            pushUniqueText(out.texts, ud.reply);
            pushUniqueText(out.texts, ud.prompt);
            pushUniqueText(out.texts, ud.text);
          }
        }

      // === v1.2.8.4: FramePair 双端口语义 ===
      // 节点同时具备 firstFrameUrl + lastFrameUrl 字段时按 sourceHandle 过滤,
      //   - 'first' 端口 → 只输出首帧
      //   - 'last'  端口 → 只输出尾帧
      //   - null/默认  → 同时输出两帧 (autoOutput / 手动接默认 handle 的兼容)
      // 跳过通用 imageUrl/imageUrls 分支, 避免历史残留字段把双图都捞过来。
        const isFramePair =
          Object.prototype.hasOwnProperty.call(ud, 'firstFrameUrl') &&
          Object.prototype.hasOwnProperty.call(ud, 'lastFrameUrl');
        if (isFramePair) {
          const wantFirst = handles.has('first') || (handles.has(null) && !handles.has('last'));
          const wantLast = handles.has('last') || (handles.has(null) && !handles.has('first'));
          if (wantFirst) pushUnique(out.images, ud.firstFrameUrl);
          if (wantLast) pushUnique(out.images, ud.lastFrameUrl);
          // 视频/音频 此节点不会有, 跳过
          continue;
        }

      // 图像 - 单
        pushUnique(out.images, ud.imageUrl);
        // 图像 - 多
        const arrFields = ['imageUrls', 'urls', 'generatedImages'];
        for (const f of arrFields) {
          const v = ud[f];
          if (Array.isArray(v)) v.forEach((u) => (f === 'urls' ? pushClassifiedUrl(u) : pushUnique(out.images, u)));
        }

      // 3D 模型
        pushUnique(out.models, ud.modelUrl);
        pushUnique(out.models, ud.directModelUrl);
        if (Array.isArray(ud.modelUrls)) ud.modelUrls.forEach((u: any) => pushUnique(out.models, u));
        if (Array.isArray(ud.directModelUrls)) ud.directModelUrls.forEach((u: any) => pushUnique(out.models, u));

      // 视频
        pushUnique(out.videos, ud.videoUrl);

      // === v1.2.9.14: Suno 双端口语义 (与 FramePair 同模式) ===
      // AudioNode (Suno) 同时具备 audioUrl + audioUrl_1 字段时按 sourceHandle 过滤,
      //   - 'audio-0' → 主轨、 'audio-1' → 副轨、 null/默认 → 两轨
      // 跳过下面的通用 audioUrl/audioUrl_1 分支，避免重复加入。
        const isSuno =
          Object.prototype.hasOwnProperty.call(ud, 'audioUrl') &&
          Object.prototype.hasOwnProperty.call(ud, 'audioUrl_1');
        if (isSuno) {
          const wantA0 = handles.has('audio-0') || (handles.has(null) && !handles.has('audio-1'));
          const wantA1 = handles.has('audio-1') || (handles.has(null) && !handles.has('audio-0'));
          if (wantA0) pushUnique(out.audios, ud.audioUrl);
          if (wantA1) pushUnique(out.audios, ud.audioUrl_1);
          continue;
        }

        // 音频 (audioUrl 主轨, audioUrl_1 副轨——AudioNode/SunoNode 双输出口)
        pushUnique(out.audios, ud.audioUrl);
        pushUnique(out.audios, ud.audioUrl_1);
        }
      }
    }

    // 独立模式 (双击编辑生成的产物 OutputNode):
    //   节点本身携带 directImageUrl/directImageUrls, 未连任何上游也能独立展示。
    //   这些产物不会被 pickKind/pickIndex 过滤干预, 在下面独立补补。
    //   v1.5: 新增 directVideoUrl / directAudioUrl / outputText 以支持跨节点拖拽投放。
    if (typeof d.directImageUrl === 'string' && d.directImageUrl) {
      pushUnique(out.images, d.directImageUrl);
    }
    if (Array.isArray(d.directImageUrls)) {
      d.directImageUrls.forEach((u: any) => pushUnique(out.images, u));
    }
    if (typeof d.directVideoUrl === 'string' && d.directVideoUrl) {
      pushUnique(out.videos, d.directVideoUrl);
    }
    // v1.2.8.3: 多产物数组 (LoopNode 串联 / 并联跨轮累积)
    if (Array.isArray(d.directVideoUrls)) {
      d.directVideoUrls.forEach((u: any) => pushUnique(out.videos, u));
    }
    if (typeof d.directAudioUrl === 'string' && d.directAudioUrl) {
      pushUnique(out.audios, d.directAudioUrl);
    }
    if (Array.isArray(d.directAudioUrls)) {
      d.directAudioUrls.forEach((u: any) => pushUnique(out.audios, u));
    }
    if (typeof d.directModelUrl === 'string' && d.directModelUrl) {
      pushUnique(out.models, d.directModelUrl);
    }
    if (Array.isArray(d.directModelUrls)) {
      d.directModelUrls.forEach((u: any) => pushUnique(out.models, u));
    }
    // v1.2.8.5: 循环器跨轮累积的文本联接作为独立一项加入 (已含 —— 分隔符)
    if (typeof d.directOutputText === 'string' && d.directOutputText) {
      pushUniqueText(out.texts, d.directOutputText);
    }
    if (Array.isArray(d.directTextSegments)) {
      d.directTextSegments.forEach((t: any) => pushUniqueText(out.texts, t));
    }

    // 兜底: 一些节点把视频/音频塞在 imageUrl, 通过扩展名识别再纠正
    out.images = out.images.filter((u) => {
      if (isModel3DUrl(u)) {
        if (out.models.indexOf(u) === -1) out.models.push(u);
        return false;
      }
      if (isVideoUrl(u)) {
        if (out.videos.indexOf(u) === -1) out.videos.push(u);
        return false;
      }
      if (isAudioUrl(u)) {
        if (out.audios.indexOf(u) === -1) out.audios.push(u);
        return false;
      }
      return true;
    });

    // === pickKind / pickIndex 过滤 ===
    // Canvas 自动创建多个 OutputNode 映射上游多项输出时,
    // 会在 data 里标记 pickKind ('text'/'image'/'video'/'audio') + pickIndex,
    // 则本节点只保留对应 kind 的第 pickIndex 项, 避免多图场景下
    // 所有 OutputNode 都重复显示全部输出。
    // 手动连连的 OutputNode 不带 pickKind => 保留原语义 (显示上游全部).
    //
    // v1.2.9.10: 累积模式短路 ——
    //   场景: LoopNode 跑完后下游 OutputNode 的 directImageUrls/directVideoUrls/directAudioUrls
    //         里累积了 N 张, 但 Canvas autoOutput 早在第一轮就把它升级为 pickKind='image', pickIndex=0,
    //         finally 清除 __loopAccumulate 后 collected.images 顺序变成 [fresh_lastRound, direct_r1, direct_r2 dedup],
    //         pickIndex=0 把全集砍成 [fresh_lastRound] → 用户只看到最后一轮 (典型 ImageNode/VideoNode/AudioNode 覆盖症状)。
    //   修复: 若 OutputNode 自身已有 direct*Urls / directOutputText 累积多项,
    //         说明它是 LoopNode 累积模式的 OutputNode, 跳过 pickKind 切割, 全量展示 fresh+direct 去重结果。
    //         注意: 输出素材持久化会给每个自动 OutputNode 写入单项 direct* 快照。
    //         单项快照仍必须保留 pickKind/pickIndex, 否则宫格剪裁等多产物会退回“每个输出节点显示整组”。
    //         与 FramePair 行为对齐 (FramePair 走 autoOutput 专属路径不带 pickKind, 不受此 BUG 影响)。
    const directTextSegments = Array.isArray(d.directTextSegments) ? d.directTextSegments : [];
    const directOutputTextSegments =
      typeof d.directOutputText === 'string' && d.directOutputText.trim()
        ? d.directOutputText.split('\n\n').map((item: string) => item.trim()).filter(Boolean)
        : [];
    const hasAnyDirectAccumulated =
      (Array.isArray(d.directImageUrls) && d.directImageUrls.length > 1) ||
      (Array.isArray(d.directVideoUrls) && d.directVideoUrls.length > 1) ||
      (Array.isArray(d.directAudioUrls) && d.directAudioUrls.length > 1) ||
      (Array.isArray(d.directModelUrls) && d.directModelUrls.length > 1) ||
      directTextSegments.length > 1 ||
      directOutputTextSegments.length > 1;
    const pickKind: string | undefined = (hasAnyDirectAccumulated || directSnapshotOnly) ? undefined : d.pickKind;
    const pickIndex: number | undefined =
      typeof d.pickIndex === 'number' ? d.pickIndex : undefined;
    if (pickKind && typeof pickIndex === 'number') {
      if (pickKind === 'text') {
        out.texts = out.texts[pickIndex] ? [out.texts[pickIndex]] : [];
        out.images = [];
        out.videos = [];
        out.audios = [];
        out.models = [];
      } else if (pickKind === 'image') {
        out.images = out.images[pickIndex] ? [out.images[pickIndex]] : [];
        out.videos = [];
        out.audios = [];
        out.models = [];
        // 图像项模式只保留上游明确允许的文本；imageOnlyOutput 已在收集阶段过滤。
      } else if (pickKind === 'video') {
        const pairedText = out.texts[pickIndex] || (out.texts.length === 1 ? out.texts[0] : '');
        out.videos = out.videos[pickIndex] ? [out.videos[pickIndex]] : [];
        out.texts = pairedText ? [pairedText] : [];
        out.images = [];
        out.audios = [];
        out.models = [];
      } else if (pickKind === 'audio') {
        out.audios = out.audios[pickIndex] ? [out.audios[pickIndex]] : [];
        out.images = [];
        out.videos = [];
        out.models = [];
      } else if (pickKind === 'model3d') {
        out.models = out.models[pickIndex] ? [out.models[pickIndex]] : [];
        out.images = [];
        out.videos = [];
        out.audios = [];
      }
    }

    out.images = out.images.filter((u) => !isMaterialUrlHidden(d, 'image', u));
    out.videos = out.videos.filter((u) => !isMaterialUrlHidden(d, 'video', u));
    out.audios = out.audios.filter((u) => !isMaterialUrlHidden(d, 'audio', u));
    out.models = out.models.filter((u) => !isMaterialUrlHidden(d, 'model3d', u));

    return out;
  }, [upstreamNodes, upstreamSig, handleMap, d.pickKind, d.pickIndex, d.directOutputSingleSnapshot, d.directImageUrl, d.directImageUrls, d.directVideoUrl, d.directVideoUrls, d.directAudioUrl, d.directAudioUrls, d.directModelUrl, d.directModelUrls, d.modelUrl, d.modelUrls, d.directOutputText, d.directTextSegments, d.hiddenMaterialUrls, d.rhDuckDecoded]);

  const reportImageLongEdgeError = useCallback((message: string) => {
    setImageLongEdgeError(message);
  }, []);
  const imageLongEdge = useImageLongEdgeOutputs({
    sourceUrls: collected.images,
    data: d,
    update,
    onError: reportImageLongEdgeError,
  });
  const displayImageUrls = imageLongEdge.previewUrls;
  const publishedImageUrls = imageLongEdge.outputUrls;
  const [detailImageIndex, setDetailImageIndex] = useState<number | null>(null);

  useEffect(() => {
    if (detailImageIndex === null) return;
    if (displayImageUrls.length === 0) {
      setDetailImageIndex(null);
      return;
    }
    if (detailImageIndex >= displayImageUrls.length) {
      setDetailImageIndex(displayImageUrls.length - 1);
    }
  }, [detailImageIndex, displayImageUrls.length]);

  // 文本编辑
  const overrideText: string = typeof d.outputText === 'string' ? d.outputText : '';
  const liveText = collected.texts.join('\n\n──────\n\n');
  const displayText = overrideText !== '' ? overrideText : liveText;
  const mediaPromptByUrl = useMemo(() => {
    const map = new Map<string, { prompt: string; negative: string }>();
    const clean = (value: any) => (typeof value === 'string' ? value.trim() : '');
    const readPrompt = (ud: any) => clean(ud?.lastPrompt) || clean(ud?.prompt) || clean(ud?.outputText) || clean(ud?.text) || clean(ud?.reply);
    const readNegative = (ud: any) => clean(ud?.negativePrompt) || clean(ud?.negative) || clean(ud?.providerParams?.negativePrompt) || clean(ud?.providerParams?.negative);
    const add = (value: any, prompt: string, negative: string) => {
      const url = clean(value);
      if (!url || map.has(url)) return;
      map.set(url, { prompt, negative });
    };
    const addArray = (values: any, prompt: string, negative: string) => {
      if (Array.isArray(values)) values.forEach((url) => add(url, prompt, negative));
    };

    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    for (const node of list) {
      const ud: any = (node as any)?.data || {};
      const prompt = readPrompt(ud);
      const negative = readNegative(ud);
      if (!prompt) continue;
      add(ud.imageUrl, prompt, negative);
      addArray(ud.imageUrls, prompt, negative);
      addArray(ud.urls, prompt, negative);
      addArray(ud.generatedImages, prompt, negative);
      add(ud.firstFrameUrl, prompt, negative);
      add(ud.lastFrameUrl, prompt, negative);
      add(ud.videoUrl, prompt, negative);
      addArray(ud.videoUrls, prompt, negative);
      add(ud.audioUrl, prompt, negative);
      add(ud.audioUrl_1, prompt, negative);
      addArray(ud.audioUrls, prompt, negative);
      add(ud.modelUrl, prompt, negative);
      add(ud.directModelUrl, prompt, negative);
      addArray(ud.modelUrls, prompt, negative);
      addArray(ud.directModelUrls, prompt, negative);
    }

    const ownPrompt = clean(d.lastPrompt) || clean(d.prompt) || clean(d.directOutputText) || displayText.trim();
    const ownNegative = readNegative(d);
    if (ownPrompt) {
      add(d.directImageUrl, ownPrompt, ownNegative);
      addArray(d.directImageUrls, ownPrompt, ownNegative);
      add(d.directVideoUrl, ownPrompt, ownNegative);
      addArray(d.directVideoUrls, ownPrompt, ownNegative);
      add(d.directAudioUrl, ownPrompt, ownNegative);
      addArray(d.directAudioUrls, ownPrompt, ownNegative);
      add(d.directModelUrl, ownPrompt, ownNegative);
      addArray(d.directModelUrls, ownPrompt, ownNegative);
      add(d.modelUrl, ownPrompt, ownNegative);
      addArray(d.modelUrls, ownPrompt, ownNegative);
    }
    return map;
  }, [d.directAudioUrl, d.directAudioUrls, d.directImageUrl, d.directImageUrls, d.directModelUrl, d.directModelUrls, d.directOutputText, d.directVideoUrl, d.directVideoUrls, d.lastPrompt, d.modelUrl, d.modelUrls, d.negative, d.negativePrompt, d.prompt, d.providerParams, displayText, upstreamNodes, upstreamSig]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const enterEdit = () => {
    setDraft(displayText);
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 30);
  };
  const saveEdit = () => {
    update({ outputText: draft });
    setEditing(false);
  };
  const cancelEdit = () => {
    setEditing(false);
  };
  const restoreLive = () => {
    update({ outputText: '' });
    setEditing(false);
  };
  const handleTranslationRecord = useCallback(
    (record: SmartTranslationRecord) => update({ smartTranslation: record }),
    [update],
  );
  const handleTranslated = useCallback(
    (translatedText: string, record: SmartTranslationRecord) => {
      update({ outputText: translatedText, smartTranslation: record });
      setEditing(false);
    },
    [update],
  );

  const isEdited = overrideText !== '' && overrideText !== liveText;
  const HANDLE = PORT_COLOR.any;
  const accent = '#5eead4'; // teal-300, 与 nodeRegistry color: 'teal' 对齐
  const effectiveAccent = isRhDuckOutput ? '#ff345f' : isYyhPortraitOutput ? '#ff4fd8' : accent;
  const effectiveHandle = isRhDuckOutput ? '#ff345f' : isYyhPortraitOutput ? '#ff4fd8' : HANDLE;

  const total = collected.texts.length + collected.images.length + collected.videos.length + collected.audios.length + collected.models.length;
  const mediaCount = displayImageUrls.length + collected.videos.length + collected.audios.length + collected.models.length;
  const singleAspectMediaUrl = mediaCount === 1 && displayImageUrls.length === 1
    ? displayImageUrls[0]
    : mediaCount === 1 && collected.videos.length === 1
      ? collected.videos[0]
      : '';
  const hasExplicitSize = outputView.mode !== 'legacy-auto' && Number.isFinite(size.h);
  const imageGridColumns = resolveOutputGridColumns(displayImageUrls.length, size.w);

  const persistOutputView = useCallback((next: OutputViewState) => {
    const normalized = normalizeOutputViewState(next);
    setOutputView(normalized);
    update({ outputView: normalized });
  }, [update]);

  const applyAspectView = useCallback(() => {
    if (!singleAspectMediaUrl) return;
    const ratio = mediaAspectByUrlRef.current.get(singleAspectMediaUrl);
    const root = rootRef.current;
    const media = root?.querySelector<HTMLElement>('[data-output-primary-media="true"]');
    if (!ratio || !Number.isFinite(ratio) || ratio <= 0 || !root || !media) return;
    const rootRect = root.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const { width, height } = computeOutputAspectSize({
      rootWidth: rootRect.width || size.w,
      rootHeight: rootRect.height,
      mediaWidth: mediaRect.width,
      mediaHeight: mediaRect.height,
      aspect: ratio,
    });
    const next: OutputViewState = { version: 1, mode: 'aspect', width, height };
    setSize({ w: width, h: height });
    persistOutputView(next);
    rf.setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          width,
          height,
          style: { ...(node.style || {}), width, height },
          data: { ...(node.data as object), outputView: next },
        }
      : node));
  }, [id, persistOutputView, rf, singleAspectMediaUrl, size.w]);

  const switchToFreeView = useCallback(() => {
    const rootRect = rootRef.current?.getBoundingClientRect();
    const width = Math.max(260, Math.round(rootRect?.width || size.w));
    const height = Math.max(160, Math.round(rootRect?.height || size.h || 320));
    setSize({ w: width, h: height });
    persistOutputView({ version: 1, mode: 'free', width, height });
  }, [persistOutputView, size.h, size.w]);

  // === 双击图片 → 裁剪/宫格弹窗 ===
  // 仅针对 collected.images 中的单张图生效; 产物“不”修改本节点, 而是
  // 以 directImageUrl 独立模式创建 N 个新 OutputNode (沉淀在本节点的右下区),
  // 取 id 前缀 'output-auto-edit-' 以与源 output-auto-* 区分 (不受重排接管).
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [compareState, setCompareState] = useState<{
    resultUrl: string;
    candidates: ImageCompareCandidate[];
  } | null>(null);

  const buildCompareCandidates = (resultUrl: string): ImageCompareCandidate[] => {
    const nodes = rf.getNodes();
    const edges = rf.getEdges();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>([resultUrl]);
    const out: ImageCompareCandidate[] = [];

    const push = (url: any, label: string, sourceNodeId?: string, sourceType?: string) => {
      if (typeof url !== 'string') return;
      const s = url.trim();
      if (!s || !isImageLikeUrl(s) || seen.has(s)) return;
      seen.add(s);
      out.push({ url: s, label, sourceNodeId, sourceType });
    };

    const directSourceIds = Array.from(new Set(connections.map((c) => c.source)));
    for (const sourceId of directSourceIds) {
      const sourceNode = nodeMap.get(sourceId);
      if (!sourceNode) continue;
      const sourceType = String(sourceNode.type || '');
      out.push(...extractInputCandidatesFromData(sourceNode.data, sourceId, sourceType, seen));

      const incoming = edges.filter((e) => e.target === sourceId);
      for (const edge of incoming as any[]) {
        const inputNode = nodeMap.get(edge.source);
        if (!inputNode) continue;
        const inputType = String(inputNode.type || '');
        const labelBase = t(NODE_INPUT_LABEL_KEYS[inputType] || 'nodes:output.inputLabels.default');
        const imgs = extractImagesFromData(inputNode.data, edge.sourceHandle ?? null);
        imgs.forEach((u, i) => {
          const label = inputType === 'frame-pair'
            ? (edge.sourceHandle === 'last'
                ? t('nodes:output.inputLabels.lastFrame')
                : edge.sourceHandle === 'first'
                  ? t('nodes:output.inputLabels.firstFrame')
                  : t('nodes:output.inputLabels.extractedFrame', { index: i + 1 }))
            : t('nodes:output.inputLabels.indexed', { label: labelBase, index: i + 1 });
          push(u, label, inputNode.id, inputType);
        });
        out.push(...extractInputCandidatesFromData(inputNode.data, inputNode.id, inputType, seen));
      }
    }

    collected.images.forEach((u, i) => {
      push(u, t('nodes:output.inputLabels.currentOutput', { index: i + 1 }), id, 'output');
    });

    return out;
  };

  const openImageCompare = (resultUrl: string) => {
    setCompareState({
      resultUrl,
      candidates: buildCompareCandidates(resultUrl),
    });
  };

  const handleRemoveOutputMaterial = (kind: MediaKind, url: string) => {
    update(createOutputMediaRemovalData(d, kind, url));
    if (editingUrl === url) setEditingUrl(null);
    if (compareState?.resultUrl === url) setCompareState(null);
  };

  const splitOutputCollection = (kind: MediaKind, urls: string[]) => {
    if (!urls || urls.length <= 1) return;
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const ts = Date.now();
    const COLS = 3;
    const targetType = kind === 'model3d' ? 'model-3d-preview' : 'output';
    const targetSize = defaultSizeOf(targetType);
    const COL_W = targetType === 'model-3d-preview' ? targetSize.w + 40 : 350;
    const ROW_H = Math.max(300, myH);
    const _sz = targetSize;
    const items: MediaItem[] = urls.map((url) => ({ kind, url }));
    const _desired: PlacementRect[] = items.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w,
      h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:split-output:${id}` });
    const newNodes: Node[] = items.map((item, i) => ({
      id: `${targetType}-split-${id}-${ts}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      type: targetType,
      position: {
        x: baseX + (i % COLS) * COL_W + _off.dx,
        y: baseY + Math.floor(i / COLS) * ROW_H + _off.dy,
      },
      data: createOutputDataFromItem(item),
      selected: false,
    } as Node));
    rf.addNodes(newNodes);
  };

  const queueAnnotationEditProduce = (
    cleanUrls: string[],
    meta: Extract<ImageEditProduceMeta, { type: 'annotation-edit' }>,
  ) => {
    const logSource = `annotation-edit-output:${id}`;
    if (cleanUrls.length < 2) {
      const error = new Error(t('nodes:output.errors.annotationSources'));
      logBus.warn(error.message, logSource);
      throw error;
    }
    const targetNode = rf.getNodes().find((node) => node.id !== id && node.selected && node.type === CREATIVE_TARGET_NODE_TYPE) || null;
    queueSecondaryAction({
      actionId: 'image-edit.annotation',
      target: 'annotation-edit',
      params: {
        sourceImageUrl: cleanUrls[0],
        annotatedImageUrl: cleanUrls[1],
        instruction: meta.instruction,
        annotationTextCount: meta.annotationTextCount,
        annotationShapeCount: meta.annotationShapeCount,
        providerId: 'default-image',
        providerModel: 'gpt-image-2',
        ...(targetNode ? { targetNodeId: targetNode.id } : {}),
      },
    });
    logBus.info(t('nodes:output.logs.annotationBound'), logSource);
  };

  const executeAnnotationEditAction = async (
    action: Extract<SecondaryProviderActionEnvelope, { actionId: 'image-edit.annotation' }>,
    reporter: RunNodeLifecycleReporter,
  ) => {
    const params = action.params;
    const logSource = `annotation-edit-output:${id}`;
    let providerRequested = false;
    let providerResponded = false;
    try {
      logBus.info(t('nodes:output.logs.annotationRunning'), logSource);
      const request = buildAnnotationEditRequest({
        sourceNodeId: id,
        sourceImageUrl: params.sourceImageUrl,
        annotatedImageUrl: params.annotatedImageUrl,
        instruction: params.instruction,
        annotationTextCount: params.annotationTextCount,
        annotationShapeCount: params.annotationShapeCount,
        providerId: params.providerId,
        providerModel: params.providerModel,
      });
      const targetNode = params.targetNodeId
        ? rf.getNode(params.targetNodeId) || null
        : null;
      if (params.targetNodeId && (!targetNode || targetNode.type !== CREATIVE_TARGET_NODE_TYPE)) {
        throw new Error(t('nodes:output.errors.annotationTargetChanged'));
      }
      await reporter.providerRequest({
        provider: params.providerId,
        model: params.providerModel,
        actionId: action.actionId,
        actionTarget: action.target,
      });
      providerRequested = true;
      const result = await generateImage({
        model: params.providerModel,
        apiModel: params.providerModel,
        prompt: request.prompt,
        images: request.images,
        n: 1,
      });
      const resultUrls = (Array.isArray(result.urls) ? result.urls : []).map((url) => String(url || '').trim()).filter(Boolean);
      if (resultUrls.length === 0) throw new Error(t('nodes:output.errors.annotationNoResult'));
      await reporter.providerResponse({
        provider: params.providerId,
        model: params.providerModel,
        ...extractRunProviderTrace(result),
        status: 'succeeded',
      });
      providerResponded = true;
      const sourceNode = rf.getNode(id) || ({
        id,
        type: 'output',
        position: { x: 0, y: 0 },
        data: d,
      } as Node);
      const placement = buildAnnotationEditResultPlacement({
        sourceNode,
        targetNode,
        targetMode: 'replace',
        resultUrls,
        request,
      });
      rf.setNodes((prev) => {
        const patched = prev.map((node) => {
          if (placement.targetPatch && targetNode && node.id === targetNode.id) {
            return { ...node, data: { ...(node.data as any), ...placement.targetPatch }, selected: true };
          }
          return placement.outputNode ? { ...node, selected: false } : node;
        });
        return placement.outputNode ? [...patched, placement.outputNode] : patched;
      });
      await reporter.output({
        status: 'succeeded',
        assets: resultUrls.map((url) => ({ kind: 'image', sourceUrl: url })),
      });
      logBus.success(targetNode ? t('nodes:output.logs.annotationFilledTarget') : t('nodes:output.logs.annotationCreatedRight'), logSource);
    } catch (error: any) {
      logBus.error(error?.message || t('nodes:output.errors.annotationFailed'), logSource);
      if (providerRequested && !providerResponded) {
        await reporter.providerResponse({
          provider: params.providerId,
          model: params.providerModel,
          status: 'failed',
        });
      }
      throw error;
    }
  };

  const handleProduce = (urls: string[], _meta?: OutputProduceMeta): void | Promise<void> => {
    const cleanUrls = (Array.isArray(urls) ? urls : []).map((url) => String(url || '').trim()).filter(Boolean);
    const isRhCapabilityOutput = _meta?.type === 'rh-capability' || _meta?.type === 'video-frame-extract';
    const logSource = `rh-image-output:${id}`;
    if (_meta?.type === 'annotation-edit') {
      return queueAnnotationEditProduce(cleanUrls, _meta);
    }
    if (cleanUrls.length === 0) {
      if (isRhCapabilityOutput) logBus.warn(t('nodes:output.logs.rhImageNoUrl', { label: _meta.label || t('nodes:output.rhImageCapability') }), logSource);
      return;
    }
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const COLS = 3;
    const COL_W = 350;
    const ROW_H = Math.max(360, myH); // 以本节点高度为下限避免重叠
    const ts = Date.now();
    // v1.2.10.5: 整组防重叠 —— 先算期望 3 列宫格, 再求公共偏移
    const _sz = defaultSizeOf('output');
    if (isRhCapabilityOutput) {
      logBus.info(t('nodes:output.logs.rhImagePreparing', { label: _meta.label || t('nodes:output.rhImageCapability'), count: cleanUrls.length }), logSource);
    }
    const _desired: PlacementRect[] = cleanUrls.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w, h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:produce:${id}` });
    const newNodes: Node[] = cleanUrls.map((u, i) => {
      const newId = `output-auto-edit-${id}-${ts}-${i}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      return {
        id: newId,
        type: 'output',
        position: {
          x: baseX + (i % COLS) * COL_W + _off.dx,
          y: baseY + Math.floor(i / COLS) * ROW_H + _off.dy,
        },
        data: {
          directImageUrl: u,
          // 便于下游节点从 data 读取 (与现有 effect 透传不冲突)
          imageUrl: u,
        },
        selected: isRhCapabilityOutput,
      } as Node;
    });
    if (isRhCapabilityOutput) {
      rf.setNodes((prev) => [...prev.map((node) => ({ ...node, selected: false })), ...newNodes]);
      const first = newNodes[0];
      if (first) {
        window.setTimeout(() => {
          try {
            rf.setCenter(first.position.x + _sz.w / 2, first.position.y + _sz.h / 2, {
              zoom: Math.max(0.7, Math.min(1.2, rf.getZoom())),
              duration: 320,
            });
          } catch {
            /* 视野定位失败不影响节点创建 */
          }
        }, 0);
      }
      logBus.success(t('nodes:output.logs.rhImageCreated', { label: _meta.label || t('nodes:output.rhImageCapability'), count: newNodes.length }), logSource);
    } else {
      rf.addNodes(newNodes);
    }
  };

  const handleVideoProduce = (urls: string[], _meta?: OutputProduceMeta): void => {
    const cleanUrls = (Array.isArray(urls) ? urls : []).map((url) => String(url || '').trim()).filter(Boolean);
    const isRhCapabilityOutput = _meta?.type === 'rh-video-capability';
    const logSource = `rh-video-output:${id}`;
    if (cleanUrls.length === 0) {
      if (isRhCapabilityOutput) logBus.warn(t('nodes:output.logs.rhVideoNoUrl', { label: _meta.label || t('nodes:output.rhVideoCapability') }), logSource);
      return;
    }
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const COLS = 3;
    const COL_W = 350;
    const ROW_H = Math.max(360, myH);
    const ts = Date.now();
    const _sz = defaultSizeOf('output');
    if (isRhCapabilityOutput) {
      logBus.info(t('nodes:output.logs.rhVideoPreparing', { label: _meta.label || t('nodes:output.rhVideoCapability'), count: cleanUrls.length }), logSource);
    }
    const _desired: PlacementRect[] = cleanUrls.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w,
      h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:output-video-produce:${id}` });
    const newNodes: Node[] = cleanUrls.map((u, i) => {
      const newId = `output-auto-video-${id}-${ts}-${i}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      return {
        id: newId,
        type: 'output',
        position: {
          x: baseX + (i % COLS) * COL_W + _off.dx,
          y: baseY + Math.floor(i / COLS) * ROW_H + _off.dy,
        },
        data: {
          ...createOutputDataFromItem({
            kind: 'video',
            url: u,
            name: fileNameFromUrl(u),
          }),
          ...(isRhCapabilityOutput
            ? {
                rhCapabilityOutput: true,
                rhCapability: _meta?.capability || '',
                rhToolboxToolId: _meta?.toolId || '',
                rhTaskIds: Array.isArray(_meta?.taskIds) ? _meta.taskIds : [],
                rhSourceNodeId: id,
              }
            : {}),
        },
        selected: isRhCapabilityOutput,
      } as Node;
    });
    if (isRhCapabilityOutput) {
      rf.setNodes((prev) => [...prev.map((node) => ({ ...node, selected: false })), ...newNodes]);
      const first = newNodes[0];
      if (first) {
        window.setTimeout(() => {
          try {
            rf.setCenter(first.position.x + _sz.w / 2, first.position.y + _sz.h / 2, {
              zoom: Math.max(0.7, Math.min(1.2, rf.getZoom())),
              duration: 320,
            });
          } catch {
            /* 视野定位失败不影响节点创建 */
          }
        }, 0);
      }
      logBus.success(t('nodes:output.logs.rhVideoCreated', { label: _meta.label || t('nodes:output.rhVideoCapability'), count: newNodes.length }), logSource);
    } else {
      rf.addNodes(newNodes);
    }
  };

  const rememberVideoFrameTime = (key: string, time: number) => {
    if (Number.isFinite(time) && time >= 0) videoFrameTimesRef.current.set(key, time);
  };

  const captureCurrentVideoFrame = async (videoUrl: string, index: number) => {
    const frameKey = `${index}:${videoUrl}`;
    if (capturingFrameKey) return;
    const frameTime = Math.max(0, Number(videoFrameTimesRef.current.get(frameKey)) || 0);
    const sourceName = fileNameFromUrl(videoUrl) || t('nodes:output.videoIndexed', { index: index + 1 });
    setCapturingFrameKey(frameKey);
    setVideoFrameError('');
    try {
      const snapshot = await snapshotVideoFrameAsync({
        id: `output-video-frame-${id}-${index}`,
        sourceNodeId: id,
        sourceLabel: t('nodes:output.outputVideo'),
        name: sourceName,
        url: videoUrl,
        directUrl: videoUrl,
        trimStart: 0,
        status: 'ready',
      }, frameTime, {
        format: 'png',
        sourceLabel: t('nodes:output.currentFrameSource', { name: sourceName }),
      });
      await Promise.resolve(handleProduce([snapshot.imageUrl], {
        type: 'video-frame-extract',
        label: t('nodes:output.currentFrameSnapshot'),
      }));
      logBus.success(
        t('nodes:output.logs.frameCaptured', { time: snapshot.time.toFixed(2) }),
        `video-frame:output:${id}`,
      );
    } catch (captureError: any) {
      const message = captureError?.message || t('nodes:output.errors.frameCaptureFailed');
      setVideoFrameError(message);
      logBus.error(message, `video-frame:output:${id}`);
    } finally {
      setCapturingFrameKey(null);
    }
  };

  // === 跨节点拖拽: source (从 collected.* 拖出) ===
  // 独立函数避开 hooks-in-loop 限制
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收后以 direct* 独立模式补充, 不依赖上游) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur: string[] = Array.isArray(d.directImageUrls) ? d.directImageUrls : [];
      if (!d.directImageUrl) {
        update({ directImageUrl: payload.url });
      } else if (cur.indexOf(payload.url) === -1) {
        update({ directImageUrls: [...cur, payload.url] });
      }
    } else if (payload.kind === 'video' && payload.url) {
      update({ directVideoUrl: payload.url });
    } else if (payload.kind === 'audio' && payload.url) {
      update({ directAudioUrl: payload.url });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ outputText: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'video', 'audio', 'text'],
    onDrop: handleDrop,
  });

  // === v1.2.9.8: 彻底删除「OutputNode useEffect 自动累积 fresh」机制 (v1.2.9.2/4/7 抩废)
  //   原因: FramePair 等节点每轮多次 update + StrictMode 双调 + 二级链路 OutputNode → OutputNode
  //         + finally 清除 __loopAccumulate 后残留一次 fresh 被重复 push, 跨 useEffect / setNodes 的 race 无法仅由前端隔离。
  //   新机制: 累积完全由 LoopNode 在每轮 awaitNode 后调 functional setNodes 一次性写入 direct*Urls。
  //   OutputNode 仅保留: 上游 __loopAccumulate truthy 时 collected useMemo 跳过 fresh (避免中间闪烁干扰 OUT 展示)。

  // === 下游透传: 将 collected + displayText 写到自身 data 供下游节点读取 ===
  // 仅在生成的输出实际变化时调用 update, 避免 setNode 风暴.
  // 不踩 outputText (保留 「用户编辑覆盖」 语义), 文本透传到 prompt/text/reply.
  //
  // ⚡ 过滤规则 (需求 #3):
  //   - 若 collected 同时含有非文本素材 (图/视/音任一), 下游只需要非文本部分,
  //     清空 prompt/text/reply (避免下游生成节点误将上下文提示词一起当参考文本)
  //   - 若只有文本 (纯文本输出), 仍将文本透传到 prompt/text/reply
  useEffect(() => {
    const hasNonText =
      collected.images.length > 0 ||
      collected.videos.length > 0 ||
      collected.audios.length > 0 ||
      collected.models.length > 0;
    const passText = hasNonText ? '' : (displayText || '');
    const next: any = {
      prompt: passText,
      text: passText,
      reply: passText,
      imageUrl: publishedImageUrls[0] || '',
      imageUrls: publishedImageUrls.slice(),
      urls: publishedImageUrls.slice(),
      videoUrl: collected.videos[0] || '',
      audioUrl: collected.audios[0] || '',
      audioUrl_1: collected.audios[1] || '', // 透传 Suno 双轨副轨避免串联丢失
      modelUrl: collected.models[0] || '',
      modelUrls: collected.models.slice(),
      textSegments: hasNonText ? [] : collected.texts.slice(),
      segments: hasNonText ? [] : collected.texts.slice(),
    };
    const cur: any = {
      prompt: d.prompt || '',
      text: d.text || '',
      reply: d.reply || '',
      imageUrl: d.imageUrl || '',
      imageUrls: Array.isArray(d.imageUrls) ? d.imageUrls : [],
      urls: Array.isArray(d.urls) ? d.urls : [],
      videoUrl: d.videoUrl || '',
      audioUrl: d.audioUrl || '',
      audioUrl_1: d.audioUrl_1 || '',
      modelUrl: d.modelUrl || '',
      modelUrls: Array.isArray(d.modelUrls) ? d.modelUrls : [],
      textSegments: Array.isArray(d.textSegments) ? d.textSegments : [],
      segments: Array.isArray(d.segments) ? d.segments : [],
    };
    const changed =
      cur.prompt !== next.prompt ||
      cur.text !== next.text ||
      cur.reply !== next.reply ||
      cur.imageUrl !== next.imageUrl ||
      cur.videoUrl !== next.videoUrl ||
      cur.audioUrl !== next.audioUrl ||
      cur.audioUrl_1 !== next.audioUrl_1 ||
      cur.modelUrl !== next.modelUrl ||
      JSON.stringify(cur.imageUrls) !== JSON.stringify(next.imageUrls) ||
      JSON.stringify(cur.urls) !== JSON.stringify(next.urls) ||
      JSON.stringify(cur.modelUrls) !== JSON.stringify(next.modelUrls) ||
      JSON.stringify(cur.textSegments) !== JSON.stringify(next.textSegments) ||
      JSON.stringify(cur.segments) !== JSON.stringify(next.segments);
    if (changed) update(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayText, collected, publishedImageUrls]);

  // === v1.2.10.2: 自动保存到本地路径 ===
  // 设计要点:
  //   1. OutputNode 是所有可执行节点输出的统一收口 → 在这里调一次保存实现全局能力
  //   2. 防重复保存: ref Set 记录本节点生命周期内已请求过的 url(纯前端去重, 后端还会再一道同名跳过防护)
  //   3. 静默失败: saveAssetToDisk 不抛错, 避免干扰主生成链路
  //   4. 远端 http(s) URL 也照位部 —— 后端会 fetch 拉取后保存, 不依赖前端报三方
  const savedUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const all: string[] = [
      ...collected.images,
      ...collected.videos,
      ...collected.audios,
      ...collected.models,
    ].filter(Boolean);
    if (all.length === 0) return;
    const fresh = all.filter((u) => !savedUrlsRef.current.has(u));
    if (fresh.length === 0) return;
    fresh.forEach((u) => savedUrlsRef.current.add(u));
    // 不 await: 并发发送, 静默失败
    fresh.forEach((u) => {
      saveAssetToDisk(u).catch(() => {/* 静默 */});
    });
  }, [collected]);

  // === 选中节点上方浮动「Edit」按钮 ===
  // 仅当节点被选中且至少存在一张图像时出现，等价于双击图像触发
  // ImageEditModal（裁剪 / 宫格切分），多图时编辑第一张。
  const hasEditableImages = displayImageUrls.length > 0 && (imageLongEdge.limit === 0 || imageLongEdge.ready);
  const canEditImage = selected && hasEditableImages;
  const showRhCapabilityRail = (selected || rhCapabilityBusy) && hasEditableImages;
  const videoSourceItems = useMemo(
    () => collected.videos.map((url) => ({
      kind: 'video' as const,
      url,
      name: fileNameFromUrl(url),
    })),
    [collected.videos],
  );
  const showRhVideoCapabilityRail = (selected || rhVideoCapabilityBusy) && collected.videos.length > 0;
  const onClickEditTopBtn = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (displayImageUrls.length > 0) setEditingUrl(displayImageUrls[0]);
  };

  const runSecondaryAction = async (reporter: RunNodeLifecycleReporter) => {
    const action = resolveSecondaryProviderActionForRun({
      nodeId: id,
      nodeType: 'output',
      nodeData: rf.getNode(id)?.data,
      runContext: reporter.runContext,
    });
    if (!action) throw new Error(t('nodes:output.errors.missingSecondaryAction'));
    try {
      if (action.actionId === 'image-edit.annotation') {
        await executeAnnotationEditAction(action, reporter);
      } else {
        await executeRegisteredSecondaryProviderAction(action, reporter);
      }
    } finally {
      const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
      if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
    }
  };

  useRunTrigger(id, runSecondaryAction, undefined, { lifecycleAware: true });

  if (canvasRenderMode === 'cold' && !editingUrl && !compareState && detailImageIndex === null) {
    const materialCount = collected.texts.length + collected.images.length + collected.videos.length + collected.audios.length + collected.models.length;
    return (
      <div
        ref={rootRef}
        className="t8-node-cold-shell"
        data-t8-node-cold-shell="output"
        data-output-view-mode={outputView.mode}
        style={{ width: size.w, height: size.h, minWidth: 260, minHeight: size.h ? 160 : 112 }}
      >
        <Handle type="target" position={Position.Left} className="!border-0" style={{ background: effectiveHandle, width: 12, height: 12, left: -6 }} />
        <Handle type="source" position={Position.Right} className="!border-0" style={{ background: effectiveHandle, width: 12, height: 12, right: -6 }} />
        <div className="t8-node-cold-shell__header">
          <Box size={16} className="shrink-0" style={{ color: effectiveAccent }} />
          <div className="t8-node-cold-shell__copy">
            <strong>{t('nodes:output.title')}</strong>
            <small>{t('nodes:output.materialCount', { count: materialCount, defaultValue: `${materialCount} items` })} · {t('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-rh-duck-output={isRhDuckOutput ? 'true' : undefined}
      data-yyh-portrait-hidden-output={isYyhPortraitOutput ? 'true' : undefined}
      data-output-view-mode={outputView.mode}
      className="relative flex flex-col"
      style={{ width: size.w, height: size.h, minWidth: 260 }}
      {...dropProps}
    >
      {/* 四角同比例缩放 (仅选中时出现) — 主题色 teal-300 */}
      <ResizableCorners
        selected={selected}
        minWidth={260}
        minHeight={160}
        accent={effectiveAccent}
        keepAspectRatio={outputView.mode === 'aspect'}
        onResize={(_e, p) => {
          if (outputView.mode === 'legacy-auto') {
            setOutputView({ version: 1, mode: 'free', width: p.width, height: p.height });
          }
          setSize({ w: p.width, h: p.height });
        }}
        onResizeEnd={(_e, p) => {
          const mode = outputView.mode === 'aspect' ? 'aspect' : 'free';
          persistOutputView({ version: 1, mode, width: p.width, height: p.height });
        }}
      />
      {/* 选中时浮动图像操作按钮 — Edit 保持本地编辑，RH 图像能力走左侧轨道 */}
      {canEditImage && (
        <div
          className="nodrag nopan"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: -34,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            zIndex: 30,
          }}
        >
          <button
            type="button"
            className="nodrag nopan"
            onClick={onClickEditTopBtn}
            onMouseDown={(e) => e.stopPropagation()}
            title={t('nodes:output.editImageTitle')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              height: 26,
              background: isDark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.95)',
              color: effectiveAccent,
              border: `1px solid ${effectiveAccent}66`,
              borderRadius: 6,
              boxShadow: isDark ? '0 6px 24px rgba(0,0,0,0.4)' : '0 6px 24px rgba(0,0,0,0.12)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Edit3 size={12} />
            <span>Edit</span>
          </button>
        </div>
      )}
      <RhImageCapabilityRail
        secondaryActionNodeId={id}
        queueSecondaryAction={queueSecondaryAction}
        sourceUrls={publishedImageUrls}
        accent={effectiveAccent}
        isDark={isDark}
        style={{ display: showRhCapabilityRail ? 'flex' : 'none' }}
        onComplete={(result) => handleProduce(result.imageUrls, { type: 'rh-capability', label: result.tool.title })}
        onRunningChange={setRhCapabilityBusy}
      />
      <RhVideoCapabilityRail
        secondaryActionNodeId={id}
        queueSecondaryAction={queueSecondaryAction}
        sourceItems={videoSourceItems}
        accent={effectiveAccent}
        isDark={isDark}
        style={{
          display: showRhVideoCapabilityRail ? 'flex' : 'none',
          ...(showRhCapabilityRail ? { left: -96 } : {}),
        }}
        onFramesComplete={(imageUrls) => handleProduce(imageUrls, { type: 'video-frame-extract', label: t('nodes:output.framePairExtract') })}
        onVideosComplete={(result) => handleVideoProduce(result.videoUrls, {
          type: 'rh-video-capability',
          label: result.tool.title,
          capability: result.tool.capabilities.find((item) => item.startsWith('video.')),
          toolId: result.tool.id,
          taskIds: result.taskIds,
        })}
        onRunningChange={setRhVideoCapabilityBusy}
      />
      {/* target handle (左侧) - 上游任意类型可连入 */}
      <Handle
        type="target"
        position={Position.Left}
        className="!border-0"
        style={{
          background: effectiveHandle,
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          top: '50%',
          left: -6,
          transform: 'translateY(-50%)',
          zIndex: 12,
          pointerEvents: 'all',
        }}
        title={t('nodes:output.inputHandleTitle')}
      />
      {/* source handle (右侧) - 作为中继节点可继续向下游透传 (any) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-0"
        style={{
          background: effectiveHandle,
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          top: '50%',
          right: -6,
          transform: 'translateY(-50%)',
          zIndex: 12,
          pointerEvents: 'all',
        }}
        title={t('nodes:output.outputHandleTitle')}
      />

      {/* 内层裁切容器: 圆角 + 越界裁切, 不影响外层 handle */}
      {/* 高度逻辑: root 默认 height=auto 时 内层也 auto 跟随内容自然高;
          root 拖角后有具体 px 时, 内层 flex-1 撑满剩余 + min-h-0 允许内容 overflow */}
      <div
        data-rh-duck-output-frame={isRhDuckOutput ? 'true' : undefined}
        data-yyh-portrait-hidden-output-frame={isYyhPortraitOutput ? 'true' : undefined}
        className={`rounded-xl border-2 transition-colors ${hasExplicitSize ? 'flex flex-1 min-h-0 flex-col' : ''}`}
        style={{
          background: isDark ? 'rgb(20,20,22)' : 'rgb(255,255,255)',
          overflow: hasExplicitSize ? 'hidden' : 'auto',
          width: '100%',
          borderColor: isAccepting
            ? effectiveAccent
            : selected
              ? effectiveAccent
              : isDark
                ? 'rgba(255,255,255,.15)'
                : 'rgba(0,0,0,.1)',
          boxShadow: isAccepting ? `0 0 0 3px ${effectiveAccent}40` : undefined,
        }}
      >

      {/* 头部 */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{
            background: effectiveAccent + '33',
            color: effectiveAccent,
            boxShadow: `inset 0 0 0 1px ${effectiveAccent}66`,
          }}
        >
          <MonitorPlay size={13} />
        </div>
        <div className={`flex-1 text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          {t('nodes:output.title')}
        </div>
        <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-400'}`}>
          {t('common:units.items', { count: total })}
        </span>
        {singleAspectMediaUrl ? (
          <button
            type="button"
            className={`nodrag nopan t8-btn t8-mini-icon-button ${outputView.mode === 'aspect' ? 'is-active' : ''}`}
            title={outputView.mode === 'aspect' ? t('nodes:output.freeSize') : t('nodes:output.fitAspect')}
            aria-label={outputView.mode === 'aspect' ? t('nodes:output.freeSize') : t('nodes:output.fitAspect')}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (outputView.mode === 'aspect') switchToFreeView();
              else applyAspectView();
            }}
          >
            {outputView.mode === 'aspect' ? <MoveDiagonal2 size={12} /> : <Ratio size={12} />}
          </button>
        ) : null}
      </div>

      {/* body */}
      <div className={`t8-output-node__body p-2.5 ${hasExplicitSize ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto' : 'space-y-3'}`} onMouseDown={(e) => e.stopPropagation()}>
        {total === 0 && (
          <div
            className={`rounded flex items-center justify-center text-[11px] py-3 px-2 text-center ${
              isDark ? 'text-white/40' : 'text-zinc-400'
            }`}
          >
            {upstreamHasLoop
              ? t('nodes:output.loopHint')
              : t('nodes:output.inputHint')}
          </div>
        )}

        {/* 文本区 */}
        {(collected.texts.length > 0 || isEdited) && (
          <div className="space-y-1">
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <TypeIcon size={11} />
              <span className="flex-1">{t('nodes:output.text')}{isEdited ? ` · ${t('nodes:output.edited')}` : ''}</span>
              <SmartTranslateButton
                text={displayText}
                nodeId={id}
                lastRecord={d?.smartTranslation}
                onTranslated={handleTranslated}
                onRecord={handleTranslationRecord}
              />
              {!editing && (
                <button
                  onClick={enterEdit}
                  className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                  title={t('nodes:output.editHint')}
                >
                  <Pencil size={10} />
                </button>
              )}
              {isEdited && !editing && (
                <button
                  onClick={restoreLive}
                  className={`text-[10px] px-1 rounded ${isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'}`}
                  title={t('nodes:output.restoreLive')}
                >
                  {t('common:actions.restore')}
                </button>
              )}
            </div>
            {!editing ? (
              <div
                data-user-content={isEdited ? 'true' : undefined}
                data-provider-content={!isEdited ? 'true' : undefined}
                onDoubleClick={enterEdit}
                onWheelCapture={(e) => e.stopPropagation()}
                className={`nowheel whitespace-pre-wrap break-words text-[12px] leading-relaxed rounded px-2 py-1.5 cursor-text ${
                  isDark ? 'bg-white/5 text-white/85' : 'bg-black/5 text-zinc-800'
                }`}
                style={{ maxHeight: 200, overflow: 'auto' }}
                title={t('nodes:output.editHint')}
              >
                {displayText || <span className="opacity-50">{t('common:empty')}</span>}
              </div>
            ) : (
              <div className="space-y-1">
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  rows={6}
                  className={`w-full rounded px-2 py-1.5 text-[12px] outline-none nodrag nowheel ${
                    isDark
                      ? 'bg-black/40 text-white border border-teal-400/40'
                      : 'bg-white text-zinc-900 border border-teal-500/50'
                  }`}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelEdit();
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                  }}
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    onClick={cancelEdit}
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      isDark ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-black/5 hover:bg-black/10 text-zinc-700'
                    }`}
                  >
                    {t('common:actions.cancel')}
                  </button>
                  <button
                    onClick={saveEdit}
                    className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 text-zinc-900"
                    style={{ background: effectiveAccent }}
                  >
                    <Check size={10} /> {t('common:actions.save')}
                  </button>
                </div>
                <div className={`text-[10px] ${isDark ? 'text-white/30' : 'text-zinc-400'}`}>
                  {t('nodes:output.editShortcut')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 图像区 */}
        {displayImageUrls.length > 0 && (
          <div className={`group/output-images t8-output-node__media-section ${hasExplicitSize ? 'is-sized' : ''} space-y-1`}>
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <ImageIcon size={11} />
              <span className="flex-1">
                {t('nodes:output.images', { count: displayImageUrls.length })}
                {imageLongEdge.busy ? ` · ${t('nodes:output.resizing')}` : ''}
              </span>
              <ImageLongEdgeButtons
                value={imageLongEdge.limit}
                busy={imageLongEdge.busy}
                onChange={imageLongEdge.selectLimit}
              />
              {(imageLongEdge.limit === 0 || imageLongEdge.ready) && (
                <CollectionSplitButton
                  count={displayImageUrls.length}
                  kindLabel={t('nodes:output.kind.image')}
                  onSplit={() => splitOutputCollection('image', publishedImageUrls)}
                  className="opacity-100 transition sm:opacity-0 sm:group-hover/output-images:opacity-100 sm:focus-within:opacity-100"
                />
              )}
            </div>
            {imageLongEdgeError && (
              <div className="rounded border border-red-400/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                {imageLongEdgeError}
              </div>
            )}
            {/* 单张：全宽大图预览；多张：2 列原比例预览，操作按钮放在图片上方，避免遮挡下载。 */}
            <div
              className={`t8-output-node__image-grid ${hasExplicitSize ? 'is-sized' : ''} ${
                displayImageUrls.length >= 2 ? 'grid gap-1.5' : 'space-y-1'
              }`}
              style={displayImageUrls.length >= 2 ? { gridTemplateColumns: `repeat(${imageGridColumns}, minmax(0, 1fr))` } : undefined}
            >
              {displayImageUrls.map((u, i) => (
                <div key={i} className={`group group/output-image-card t8-output-node__image-card ${hasExplicitSize ? 'is-sized' : ''} space-y-0.5`}>
                  <div className={`relative ${hasExplicitSize ? 't8-output-node__media-stage' : ''}`}>
                    <div
                      className={
                        displayImageUrls.length >= 2
                          ? 't8-output-image-action-stack t8-output-image-action-stack--compact t8-output-image-action-stack--above z-10 mb-1 flex flex-row justify-end gap-1 opacity-100'
                          : 't8-output-image-action-stack absolute right-1.5 top-1.5 z-10 flex flex-col gap-1 opacity-100 transition sm:opacity-0 sm:group-hover/output-image-card:opacity-100 sm:focus-within:opacity-100'
                      }
                    >
                      <button
                        type="button"
                        className="nodrag nopan t8-btn t8-mini-icon-button t8-image-compare-button t8-material-action-button p-0 shadow-md transition"
                        title={t('nodes:output.compareImage')}
                        aria-label={t('nodes:output.compareImage')}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openImageCompare(u);
                        }}
                      >
                        <GitCompare size={displayImageUrls.length >= 2 ? 10 : 13} />
                      </button>
                      <ImageHoverPreview
                        src={u}
                        alt={t('nodes:output.imageIndexed', { index: i + 1 })}
                        iconSize={displayImageUrls.length >= 2 ? 10 : 14}
                        buttonClassName="t8-material-action-button p-0 shadow-md transition"
                        title={t('nodes:output.hoverDetail')}
                        onOpen={() => setDetailImageIndex(i)}
                      />
                      <button
                        type="button"
                        className="nodrag nopan t8-btn t8-mini-icon-button t8-material-delete-button t8-material-action-button p-0 shadow-md transition"
                        title={t('nodes:output.removeMaterial', { index: i + 1 })}
                        aria-label={t('nodes:output.removeMaterial', { index: i + 1 })}
                        style={{ color: 'var(--t8-danger, #ef4444)' }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (editingUrl === u) setEditingUrl(null);
                          if (compareState?.resultUrl === u) setCompareState(null);
                          handleRemoveOutputMaterial('image', collected.images[i] || u);
                        }}
                      >
                        <Trash2 size={displayImageUrls.length >= 2 ? 10 : 13} />
                      </button>
                    </div>
                    <SmartImage
                      src={u}
                      alt={t('nodes:output.imageIndexed', { index: i + 1 })}
                      className={`t8-output-image-media${displayImageUrls.length >= 2 ? ' t8-output-image-media--grid' : ''} w-full rounded block cursor-zoom-in`}
                      thumbSize={displayImageUrls.length >= 2 ? 420 : 720}
                      style={{
                        background: '#0008',
                        objectFit: 'contain',
                        maxHeight: hasExplicitSize ? 'none' : displayImageUrls.length >= 2 ? 180 : 480,
                        height: hasExplicitSize ? '100%' : undefined,
                      }}
                      data-output-primary-media={singleAspectMediaUrl === u ? 'true' : undefined}
                      data-drag-source={imageLongEdge.limit === 0 || imageLongEdge.ready ? true : undefined}
                      data-drag-kind="image"
                      data-drag-url={u}
                      data-drag-preview={u}
                      data-drag-node-id={id}
                      data-resource-title={u.split('/').pop()}
                      data-prompt-template-kind="image"
                      data-prompt-template-category="image-reference-edit"
                      data-prompt-template-prompt={mediaPromptByUrl.get(u)?.prompt || displayText}
                      data-prompt-template-negative={mediaPromptByUrl.get(u)?.negative || ''}
                      onMouseDown={(e) => {
                        if (imageLongEdge.limit === 0 || imageLongEdge.ready) {
                          beginMaterialDrag(e, { kind: 'image', url: u, sourceNodeId: id, previewUrl: u });
                        }
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingUrl(u);
                      }}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                          mediaAspectByUrlRef.current.set(u, image.naturalWidth / image.naturalHeight);
                        }
                      }}
                      title={t('nodes:output.editDragTitle')}
                    />
                  </div>
                  <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-400'}`}>
                    <span className="truncate flex-1" title={u}>{u.split('/').pop()}</span>
                    <MediaMetadataBadge kind="image" url={u} />
                    <a
                      href={imageLongEdge.limit === 0 || imageLongEdge.ready ? u : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                        isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                      } ${imageLongEdge.limit !== 0 && !imageLongEdge.ready ? 'pointer-events-none opacity-40' : ''}`}
                    >
                      <Download size={10} /> {t('common:actions.download')}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 视频区 */}
        {collected.videos.length > 0 && (
          <div className={`group/output-videos t8-output-node__media-section ${hasExplicitSize ? 'is-sized' : ''} space-y-1`}>
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <VideoIcon size={11} />
              <span className="flex-1">{t('nodes:output.videos', { count: collected.videos.length })}</span>
              <CollectionSplitButton
                count={collected.videos.length}
                kindLabel={t('nodes:output.kind.video')}
                onSplit={() => splitOutputCollection('video', collected.videos)}
                className="opacity-100 transition sm:opacity-0 sm:group-hover/output-videos:opacity-100 sm:focus-within:opacity-100"
              />
            </div>
            {collected.videos.map((u, i) => (
              <div key={i} className={`t8-output-node__video-card ${hasExplicitSize ? 'is-sized' : ''} space-y-0.5`}>
                <LoopingVideo
                  src={u}
                  controls
                  className="t8-output-node__video-media w-full h-auto rounded block"
                  style={{ background: '#000', objectFit: 'contain', maxHeight: hasExplicitSize ? 'none' : 480, height: hasExplicitSize ? '100%' : undefined }}
                  data-output-primary-media={singleAspectMediaUrl === u ? 'true' : undefined}
                  data-drag-source
                  data-drag-kind="video"
                  data-drag-url={u}
                  data-drag-preview={u}
                  data-drag-node-id={id}
                  data-resource-title={u.split('/').pop()}
                  data-prompt-template-kind="video"
                  data-prompt-template-category="video-image-to-video"
                  data-prompt-template-prompt={mediaPromptByUrl.get(u)?.prompt || displayText}
                  data-prompt-template-negative={mediaPromptByUrl.get(u)?.negative || ''}
                  onLoadedMetadata={(event) => {
                    rememberVideoFrameTime(`${i}:${u}`, event.currentTarget.currentTime);
                    const video = event.currentTarget;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                      mediaAspectByUrlRef.current.set(u, video.videoWidth / video.videoHeight);
                    }
                  }}
                  onTimeUpdate={(event) => rememberVideoFrameTime(`${i}:${u}`, event.currentTarget.currentTime)}
                  onSeeked={(event) => rememberVideoFrameTime(`${i}:${u}`, event.currentTarget.currentTime)}
                  onMouseDown={(e) =>
                    beginMaterialDrag(e, { kind: 'video', url: u, sourceNodeId: id, previewUrl: u })
                  }
                />
                <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-400'}`}>
                  <span className="truncate flex-1" title={u}>{u.split('/').pop()}</span>
                  <MediaMetadataBadge kind="video" url={u} />
                  <button
                    type="button"
                    data-video-current-frame
                    className={`nodrag nopan flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 ${
                      isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                    } disabled:cursor-wait disabled:opacity-55`}
                    title={t('nodes:output.captureFrameTitle')}
                    aria-label={t('nodes:output.captureFrameAria', { index: i + 1 })}
                    disabled={capturingFrameKey !== null}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void captureCurrentVideoFrame(u, i);
                    }}
                  >
                    <Camera size={10} />
                    {capturingFrameKey === `${i}:${u}` ? t('nodes:output.capturing') : t('nodes:output.currentFrame')}
                  </button>
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                      isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                    }`}
                  >
                    <Download size={10} /> {t('common:actions.download')}
                  </a>
                  <button
                    type="button"
                    className={`nodrag nopan p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                    title={t('nodes:output.removeMaterial', { index: i + 1 })}
                    aria-label={t('nodes:output.removeMaterial', { index: i + 1 })}
                    style={{ color: 'var(--t8-danger, #ef4444)' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveOutputMaterial('video', u);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {videoFrameError ? (
              <div className="rounded border border-red-500/35 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
                {videoFrameError}
              </div>
            ) : null}
          </div>
        )}

        {/* 音频区 */}
        {collected.audios.length > 0 && (
          <div className="group/output-audios space-y-1">
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <Music size={11} />
              <span className="flex-1">{t('nodes:output.audios', { count: collected.audios.length })}</span>
              <CollectionSplitButton
                count={collected.audios.length}
                kindLabel={t('nodes:output.kind.audio')}
                onSplit={() => splitOutputCollection('audio', collected.audios)}
                className="opacity-100 transition sm:opacity-0 sm:group-hover/output-audios:opacity-100 sm:focus-within:opacity-100"
              />
            </div>
            {collected.audios.map((u, i) => (
              <div key={i} className="space-y-0.5">
                <LazyAudio
                  src={u}
                  controls
                  className="w-full"
                  data-drag-source
                  data-drag-kind="audio"
                  data-drag-url={u}
                  data-drag-node-id={id}
                  data-resource-title={u.split('/').pop()}
                  data-prompt-template-kind="video"
                  data-prompt-template-category="video-music-audio"
                  data-prompt-template-prompt={mediaPromptByUrl.get(u)?.prompt || displayText}
                  data-prompt-template-negative={mediaPromptByUrl.get(u)?.negative || ''}
                  onMouseDown={(e) =>
                    beginMaterialDrag(e, { kind: 'audio', url: u, sourceNodeId: id })
                  }
                />
                <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-400'}`}>
                  <span className="truncate flex-1" title={u}>{u.split('/').pop()}</span>
                  <MediaMetadataBadge kind="audio" url={u} />
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                      isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                    }`}
                  >
                    <Download size={10} /> {t('common:actions.download')}
                  </a>
                  <button
                    type="button"
                    className={`nodrag nopan p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                    title={t('nodes:output.removeMaterial', { index: i + 1 })}
                    aria-label={t('nodes:output.removeMaterial', { index: i + 1 })}
                    style={{ color: 'var(--t8-danger, #ef4444)' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveOutputMaterial('audio', u);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 3D 模型区 */}
        {collected.models.length > 0 && (
          <div className="group/output-models space-y-1">
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <Box size={11} />
              <span className="flex-1">{t('nodes:output.models', { count: collected.models.length })}</span>
              <CollectionSplitButton
                count={collected.models.length}
                kindLabel={t('nodes:output.kind.model3d')}
                onSplit={() => splitOutputCollection('model3d', collected.models)}
                className="opacity-100 transition sm:opacity-0 sm:group-hover/output-models:opacity-100 sm:focus-within:opacity-100"
              />
            </div>
            <div className="space-y-1.5">
              {collected.models.map((u, i) => (
                <div
                  key={i}
                  className={`rounded border px-2 py-2 ${
                    isDark ? 'border-white/10 bg-white/[0.04]' : 'border-black/10 bg-black/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded"
                      style={{ color: PORT_COLOR.model3d, background: `${PORT_COLOR.model3d}22`, boxShadow: `inset 0 0 0 1px ${PORT_COLOR.model3d}66` }}
                    >
                      <Box size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[11px] font-semibold ${isDark ? 'text-white/80' : 'text-zinc-800'}`} title={u}>
                        {fileNameFromUrl(u) || t('nodes:output.modelIndexed', { index: i + 1 })}
                      </div>
                      <div className={`truncate text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-500'}`} title={u}>
                        {t('nodes:output.modelPreviewHint')} · {u}
                      </div>
                    </div>
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className={`nodrag nopan inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${
                        isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                      }`}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <Download size={10} /> {t('common:actions.download')}
                    </a>
                    <button
                      type="button"
                      className={`nodrag nopan inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] ${
                        isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                      }`}
                      title={t('nodes:output.removeMaterial', { index: i + 1 })}
                      aria-label={t('nodes:output.removeMaterial', { index: i + 1 })}
                      style={{ color: 'var(--t8-danger, #ef4444)' }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveOutputMaterial('model3d', u);
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
      {editingUrl && (
        <ImageEditModal
          srcUrl={editingUrl}
          secondaryActionNodeId={id}
          secondaryActionNodeType="output"
          queueSecondaryAction={queueSecondaryAction}
          onClose={() => setEditingUrl(null)}
          onProduce={handleProduce}
        />
      )}
      {compareState && (
        <ImageCompareModal
          resultUrl={compareState.resultUrl}
          inputCandidates={compareState.candidates}
          onClose={() => setCompareState(null)}
        />
      )}
      <ImageDetailViewer
        images={displayImageUrls}
        index={detailImageIndex ?? 0}
        open={detailImageIndex !== null}
        title={t('nodes:output.originalDetail')}
        onClose={() => setDetailImageIndex(null)}
        onIndexChange={setDetailImageIndex}
      />
    </div>
  );
};

export default memo(OutputNode);
