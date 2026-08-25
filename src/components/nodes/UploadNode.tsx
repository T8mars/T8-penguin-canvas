import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, useReactFlow, type Node, type Edge, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Box,
  Camera,
  Download,
  Edit3,
  FileImage,
  FileVideo,
  Music,
  RotateCcw,
  Trash2,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';
import { trackAchievementEvent } from '../../stores/achievements';
import { useHiddenFeatureStore, isRhDuckUploadEnabled } from '../../stores/hiddenFeatures';
import { PORT_COLOR } from '../../config/portTypes';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useCanvasStore } from '../../stores/canvas';
import { logBus } from '../../stores/logs';
import ImageEditModal, { type ImageEditProduceMeta } from './ImageEditModal';
import ResizableCorners from './ResizableCorners';
import CollectionSplitButton from '../CollectionSplitButton';
import ImageHoverPreview from '../ImageHoverPreview';
import LoopingVideo from '../LoopingVideo';
import MediaMetadataBadge from '../MediaMetadataBadge';
import RhImageCapabilityRail from '../RhImageCapabilityRail';
import RhVideoCapabilityRail from '../RhVideoCapabilityRail';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import ImageLongEdgeButtons from '../ImageLongEdgeButtons';
import { useImageLongEdgeOutputs } from '../../hooks/useImageLongEdgeOutputs';
import { generateImage } from '../../services/generation';
import { decodeDuckFiles, type DuckDecodeFileItem } from '../../services/api';
import { resolveThemeTemplate } from '../../theme/defaultTemplates';
import {
  createEmptyUploadMediaData,
  createOutputDataFromItems,
  createUploadDataFromItem,
  createUploadDataFromItems,
  createUploadMediaRemovalData,
  createUploadReplacementData,
  fileNameFromUrl,
  formatMediaSize,
  getMediaItemsFromData,
  sameMediaUrls,
  type MediaItem,
  type MediaKind,
} from '../../utils/mediaCollection';
import {
  AUDIO_UPLOAD_ACCEPT,
  UNSUPPORTED_M4A_UPLOAD_MESSAGE,
  isUnsupportedUploadAudioFile,
  validateUploadMediaFile,
} from '../../utils/uploadMediaValidation';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildAnnotationEditRequest,
  buildAnnotationEditResultPlacement,
} from '../../utils/canvasCreativeWorkflow';
// v1.2.10.5: 节点落点防重叠
import { placeSingleNode, placeBatchNodes, defaultSizeOf, type Rect as PlacementRect } from '../../utils/nodePlacement';
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
import NodeVisible from '../../i18n/NodeVisible';

type UploadProduceMeta =
  | ImageEditProduceMeta
  | {
      type: 'rh-capability' | 'video-frame-extract' | 'rh-video-capability';
      label?: string;
      capability?: string;
      toolId?: string;
      taskIds?: string[];
    };

/**
 * UploadNode - 通用上传素材节点
 *
 * 设计(v2 重构: 占除了"先选类型"步骤):
 *   1. 节点创建后默认就是"点击/拖拽上传"状态, accept = image/video/audio 三合一
 *   2. 选中/拖入文件 → 按 MIME 自动识别 kind (图像/视频/音频)
 *   3. 上传完成:保存 url 到对应字段(imageUrl / videoUrl / audioUrl)
 *      同时按类型选择正确的端口颜色
 *   4. Handle 颜色随 uploadType 变化(image=黄/video=粉/audio=紫);
 *      未上传时 Handle 为中性 any 色
 *   5. 已上传后右上角可重置/换文件
 *
 * 与下游联动:
 *   - 上游 nothing(无 target Handle)
 *   - 输出 → 通过 data.imageUrl/videoUrl/audioUrl 暴露给下游
 */
type UploadKind = MediaKind;

const KIND_META: Record<
  UploadKind,
  {
    label: string;
    accept: string;
    icon: typeof FileImage;
    color: string;
    dataField: 'imageUrl' | 'videoUrl' | 'audioUrl' | 'modelUrl';
    port: 'image' | 'video' | 'audio' | 'model3d';
  }
> = {
  image: {
    label: '图像',
    accept: 'image/*',
    icon: FileImage,
    color: PORT_COLOR.image,
    dataField: 'imageUrl',
    port: 'image',
  },
  video: {
    label: '视频',
    accept: 'video/*,.mov,video/quicktime',
    icon: FileVideo,
    color: PORT_COLOR.video,
    dataField: 'videoUrl',
    port: 'video',
  },
  audio: {
    label: '音频',
    accept: AUDIO_UPLOAD_ACCEPT,
    icon: Music,
    color: PORT_COLOR.audio,
    dataField: 'audioUrl',
    port: 'audio',
  },
  model3d: {
    label: '3D模型',
    accept: '.glb,.gltf,.obj,.fbx,.stl,.usdz,.zip,model/gltf-binary,model/gltf+json,model/vnd.usdz+zip,application/octet-stream,application/zip',
    icon: Box,
    color: PORT_COLOR.model3d,
    dataField: 'modelUrl',
    port: 'model3d',
  },
};

const MODEL_3D_EXT_RE = /\.(glb|gltf|obj|fbx|stl|usdz|zip)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;

/** 通过文件 MIME 推断上传类型(支持拖拽时自动选定类型) */
function inferKindFromFile(file: File): UploadKind | null {
  const name = file.name || '';
  if (MODEL_3D_EXT_RE.test(name)) return 'model3d';
  if (VIDEO_EXT_RE.test(name)) return 'video';
  const m = file.type;
  if (!m) return null;
  if (m.startsWith('model/')) return 'model3d';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return null;
}

function autoOutputNodeTypeForMedia(kind: MediaKind): 'output' | 'model-3d-preview' {
  return kind === 'model3d' ? 'model-3d-preview' : 'output';
}

function uploadDownloadName(item: MediaItem, index: number): string {
  const fallback = `upload-${index + 1}`;
  const raw = (item.name || fileNameFromUrl(item.url) || fallback).trim();
  const basename = raw.split(/[\\/]/).filter(Boolean).pop() || fallback;
  return basename.slice(0, 180);
}

const UploadNode = ({ id, data, selected, type }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const { theme, style, templateId, customTemplates } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const activeTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const isRhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'rh';
  const isRhVisual = activeTemplate.visuals?.style === 'rh' || isRhDomVisual;
  const isYyhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'yyh';
  const isYyhVisual = activeTemplate.visuals?.style === 'yyh' || isYyhDomVisual;
  const rhDuckUploadIds = useHiddenFeatureStore((s) => s.rhDuckUploadIds);
  const clearRhDuckUpload = useHiddenFeatureStore((s) => s.clearRhDuckUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rf = useReactFlow();
  const queueSecondaryAction = useCallback<QueueSecondaryProviderAction>((draft) => {
    const action = createSecondaryProviderActionForNode(id, 'upload', draft);
    update(secondaryProviderActionNodePatch(action));
    queueMicrotask(() => {
      if (!requestCanvasSecondaryProviderAction(action)) {
        const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
        if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
        setError('无法请求次级 Provider action 运行体检');
      }
    });
    return action;
  }, [id, rf, update]);

  const [error, setError] = useState<string | null>(null);
  const [rhCapabilityBusy, setRhCapabilityBusy] = useState(false);
  const [rhVideoCapabilityBusy, setRhVideoCapabilityBusy] = useState(false);
  const [capturingFrameKey, setCapturingFrameKey] = useState<string | null>(null);
  const videoFrameTimesRef = useRef(new Map<string, number>());
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // 图像编辑弹窗 src URL（与 OutputNode 双击逻辑保持一致）
  const [editingUrl, setEditingUrl] = useState<string | null>(null);

  const d = data as any;
  const rhDuckStoredMode =
    d?.rhDuckHiddenUpload === false
      ? false
      : Boolean(d?.rhDuckHiddenUpload || d?.rhDuckMode || d?.rhDuckUploadMode);
  const rhDuckStoreMode = isRhDuckUploadEnabled(rhDuckUploadIds, id);
  const rhDuckPersistentMode = Boolean(isRhVisual && type === 'upload' && (rhDuckStoredMode || rhDuckStoreMode));
  const lockedUploadType: UploadKind | null =
    type === 'model-3d-upload' || d?.lockedUploadType === 'model3d'
      ? 'model3d'
      : rhDuckPersistentMode
        ? 'image'
        : null;
  const uploadType: UploadKind | null =
    lockedUploadType === 'image' ? 'image' : d?.uploadType ?? lockedUploadType;
  const meta = uploadType ? KIND_META[uploadType] : null;
  const storedImageLongEdgeSourceItems: MediaItem[] = Array.isArray(d?.imageLongEdgeSourceItems)
    ? d.imageLongEdgeSourceItems.filter(
        (item: any) => item?.kind === 'image' && typeof item?.url === 'string' && item.url.trim(),
      )
    : [];
  const currentMediaItems = uploadType ? getMediaItemsFromData(d, uploadType) : [];
  const imageLongEdgeSourceItems =
    uploadType === 'image' && storedImageLongEdgeSourceItems.length > 0
      ? storedImageLongEdgeSourceItems
      : uploadType === 'image'
        ? currentMediaItems
        : [];
  const reportImageLongEdgeError = useCallback((message: string) => {
    if (message) setError(message);
  }, []);
  const imageLongEdge = useImageLongEdgeOutputs({
    sourceUrls: imageLongEdgeSourceItems.map((item) => item.url),
    data: d,
    update,
    onError: reportImageLongEdgeError,
  });
  const scaledImageItems = imageLongEdge.outputUrls.map((url, index) => ({
    ...(imageLongEdgeSourceItems[index] || { kind: 'image' as const }),
    kind: 'image' as const,
    url,
    size: undefined,
  }));
  const mediaItems =
    uploadType === 'image'
      ? imageLongEdge.previewUrls.map((url, index) => ({
          ...(imageLongEdgeSourceItems[index] || currentMediaItems[index] || { kind: 'image' as const }),
          kind: 'image' as const,
          url,
          size: imageLongEdge.ready ? undefined : imageLongEdgeSourceItems[index]?.size,
        }))
      : currentMediaItems;
  const runMediaItems =
    uploadType === 'image' && imageLongEdge.limit !== 0
      ? imageLongEdge.ready
        ? scaledImageItems
        : []
      : currentMediaItems;
  const url: string | undefined = mediaItems[0]?.url;
  const rhDuckMode = Boolean(
    isRhVisual &&
      uploadType === 'image' &&
      (rhDuckStoredMode || rhDuckStoreMode),
  );
  const yyhPortraitUploadMode = Boolean(isYyhVisual && d?.yyhPortraitHidden);

  useEffect(() => {
    if (uploadType !== 'image' || imageLongEdge.limit === 0 || !imageLongEdge.ready) return;
    if (sameMediaUrls(currentMediaItems, scaledImageItems)) return;
    update({
      ...createUploadReplacementData('image', scaledImageItems),
      imageLongEdgeLimit: imageLongEdge.limit,
      imageLongEdgeAppliedLimit: imageLongEdge.limit,
      imageLongEdgeSourceItems,
      imageLongEdgeSourceUrls: imageLongEdgeSourceItems.map((item) => item.url),
      imageLongEdgeOutputUrls: scaledImageItems.map((item) => item.url),
    });
  }, [
    currentMediaItems,
    imageLongEdge.limit,
    imageLongEdge.ready,
    imageLongEdgeSourceItems,
    scaledImageItems,
    update,
    uploadType,
  ]);

  // 节点本地尺寸 state: 默认 (260, 高度由内容撑开 — 上传后图/视频会撑高 root)
  // 拖角后由 ResizableCorners onResize 同步具体 px (保证 measured 准确 + keepAspectRatio 生效 + handleBounds 准确)
  const [size, setSize] = useState<{ w: number; h?: number }>({ w: 260 });

  // === 运行总线: 点击 RUN 后根据已上传素材生成下游 OutputNode ===
  // 设计要点:
  //   1. 只有 url 已就绪才会创建, 未上传会报错
  //   2. 防重复: 检查是否已存在 source=id, target.type='output' 且 data.directXxxUrl=当前 url 的下游
  //      若已存在则仅提示不重复创建
  //   3. 创建后节点 id 以 'output-auto-up-' 开头, 避开 'output-auto-' 网格重排接管
  const handleRun = async () => {
    setError(null);
    if (!uploadType || !meta || runMediaItems.length === 0) {
      const msg =
        uploadType === 'image' && imageLongEdge.limit !== 0
          ? '图片正在按长边缩放，请完成后再运行'
          : '请先上传素材';
      setError(msg);
      throw new Error(msg);
    }
    const edges = rf.getEdges();
    const nodes = rf.getNodes();

    const toDecodedMediaItem = (source: MediaItem, decoded?: DuckDecodeFileItem): MediaItem | null => {
      if (!decoded?.decoded || !decoded.url) return null;
      if (decoded.kind !== 'image' && decoded.kind !== 'video' && decoded.kind !== 'audio') return null;
      return {
        kind: decoded.kind,
        url: decoded.url,
        name: decoded.filename || source.name,
        size: decoded.size,
        mime: decoded.mime || source.mime,
      };
    };

    let outputGroups: Array<{ kind: MediaKind; items: MediaItem[] }> = [{ kind: uploadType, items: runMediaItems }];
    let outputFromRhDuckDecode = false;
    if (rhDuckMode && uploadType === 'image') {
      try {
        const decoded = await decodeDuckFiles(runMediaItems.map((item) => item.url));
        if (decoded.decodedCount > 0) {
          const decodedBySource = new Map(decoded.items.map((item) => [item.sourceUrl, item]));
          const grouped = new Map<MediaKind, MediaItem[]>();
          const push = (item: MediaItem) => {
            const list = grouped.get(item.kind) || [];
            list.push(item);
            grouped.set(item.kind, list);
          };
          runMediaItems.forEach((item) => {
            const decodedItem = toDecodedMediaItem(item, decodedBySource.get(item.url));
            if (decodedItem) push(decodedItem);
          });
          const decodedGroups = Array.from(grouped.entries()).map(([kind, items]) => ({ kind, items }));
          if (decodedGroups.length > 0) {
            outputGroups = decodedGroups;
            outputFromRhDuckDecode = true;
          }
        }
      } catch (e) {
        console.warn('[UploadNode] RH duck decode failed, fallback to normal upload output', e);
      }
    }

    const groupsToCreate = outputGroups.filter(({ kind, items }) => {
      if (items.length === 0) return false;
      const targetType = autoOutputNodeTypeForMedia(kind);
      return !edges.some((e) => {
        if (e.source !== id) return false;
        const t = nodes.find((n) => n.id === e.target);
        if (!t || t.type !== targetType) return false;
        if (kind === 'model3d') return true;
        const td = (t.data as any) || {};
        return sameMediaUrls(getMediaItemsFromData(td, kind), items);
      });
    });
    if (groupsToCreate.length === 0) return;

    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const ts = Date.now();
    const firstNodeType = autoOutputNodeTypeForMedia(groupsToCreate[0]?.kind || 'image');
    const _sz = defaultSizeOf(firstNodeType);
    const _singlePos = groupsToCreate.length === 1
      ? placeSingleNode(baseX, baseY, firstNodeType, nodes, { source: `placement:upload-auto:${id}` })
      : null;
    const _desired: PlacementRect[] = groupsToCreate.map(({ kind }, i) => {
      const sz = defaultSizeOf(autoOutputNodeTypeForMedia(kind));
      return ({
      x: _singlePos?.x ?? baseX,
      y: _singlePos?.y ?? baseY + i * Math.max(280, _sz.h + 40),
      w: sz.w,
      h: sz.h,
    });
    });
    const _off = groupsToCreate.length === 1
      ? { dx: 0, dy: 0 }
      : placeBatchNodes(_desired, nodes, { source: `placement:upload-auto:${id}` });
    const newNodes: Node[] = groupsToCreate.map(({ kind, items }, i) => {
      const targetType = autoOutputNodeTypeForMedia(kind);
      const newId = `${targetType}-auto-up-${id}-${ts}-${kind}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        id: newId,
        type: targetType,
        position: {
          x: _desired[i].x + _off.dx,
          y: _desired[i].y + _off.dy,
        },
        data: {
          ...createOutputDataFromItems(kind, items),
          ...(outputFromRhDuckDecode ? { rhDuckDecoded: true, rhDuckSourceNodeId: id } : {}),
        },
        selected: false,
      } as Node;
    });
    const newEdges: Edge[] = newNodes.map((node) => ({
      id: `e-auto-up-${node.id}`,
      source: id,
      target: node.id,
      type: 'deletable',
      ...(outputFromRhDuckDecode
        ? { className: 'rh-duck-edge', data: { rhDuckEdge: true } }
        : {}),
    } as Edge));
    rf.addNodes(newNodes);
    rf.setEdges((eds) => [...eds, ...newEdges]);
    if (outputFromRhDuckDecode) {
      trackAchievementEvent({ type: 'hidden_mode.used', theme: 'rh', kind: 'rh-duck', mode: 'used', nodeType: 'upload' });
    }
  };

  // === 跨节点拖拽: source (从已上传缩略图 Ctrl+拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  /** 重置:清空所有字段,回到默认拖拽上传状态 */
  const handleReset = () => {
    if (!rhDuckMode) clearRhDuckUpload(id);
    update({
      ...createEmptyUploadMediaData(),
      uploadType: rhDuckMode ? 'image' : lockedUploadType,
      lockedUploadType: lockedUploadType === 'model3d' ? 'model3d' : undefined,
      ...(rhDuckMode ? { rhDuckHiddenUpload: true } : {}),
      imageLongEdgeLimit: 0,
      imageLongEdgeAppliedLimit: 0,
      imageLongEdgeSourceItems: [],
      imageLongEdgeSourceUrls: [],
      imageLongEdgeOutputUrls: [],
    });
    setError(null);
  };

  const handleRemoveUploadItem = (index: number) => {
    if (!uploadType) return;
    const emptyUploadType = lockedUploadType ?? (rhDuckMode ? 'image' : null);
    if (uploadType === 'image' && imageLongEdge.limit !== 0) {
      const nextSources = imageLongEdgeSourceItems.filter((_, itemIndex) => itemIndex !== index);
      const nextOutputs = imageLongEdge.outputUrls.filter((_, itemIndex) => itemIndex !== index);
      const nextOutputItems = nextOutputs.map((nextUrl, itemIndex) => ({
        ...(nextSources[itemIndex] || { kind: 'image' as const }),
        kind: 'image' as const,
        url: nextUrl,
        size: undefined,
      }));
      update({
        ...createUploadReplacementData('image', nextOutputItems),
        uploadType: nextSources.length > 0 ? 'image' : emptyUploadType,
        imageLongEdgeLimit: imageLongEdge.limit,
        imageLongEdgeAppliedLimit: nextSources.length === nextOutputs.length ? imageLongEdge.limit : 0,
        imageLongEdgeSourceItems: nextSources,
        imageLongEdgeSourceUrls: nextSources.map((item) => item.url),
        imageLongEdgeOutputUrls: nextOutputs,
        ...(rhDuckMode ? { rhDuckHiddenUpload: true } : {}),
      });
      setError(null);
      if (editingUrl === mediaItems[index]?.url) setEditingUrl(null);
      return;
    }
    update({
      ...createUploadMediaRemovalData(d, uploadType, index, emptyUploadType),
      lockedUploadType: lockedUploadType === 'model3d' ? 'model3d' : undefined,
      ...(rhDuckMode ? { rhDuckHiddenUpload: true } : {}),
    });
    setError(null);
    if (editingUrl === mediaItems[index]?.url) setEditingUrl(null);
  };

  const uploadSingleFile = async (file: File, kind: UploadKind): Promise<MediaItem> => {
    const validationError = validateUploadMediaFile(file, kind);
    if (validationError) throw new Error(validationError);

    const fd = new FormData();
    fd.append('file', file);
    const canvasId = useCanvasStore.getState().activeId;
    if (canvasId) fd.append('canvasId', canvasId);
    fd.append('sourceNodeId', id);
    fd.append('sourceNodeType', String(type || 'upload'));
    fd.append('creatorId', 'local-owner');
    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `上传失败 HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data?.url) {
      throw new Error(json.error || '上传失败:未返回 URL');
    }
    return {
      kind,
      url: json.data.url,
      name: file.name,
      size: file.size,
      mime: file.type,
    };
  };

  /** 真正执行上传(在已确定 kind 后); 同类型多文件会追加到当前合集 */
  const uploadFiles = async (files: File[], kind: UploadKind, skipped = 0) => {
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: MediaItem[] = [];
      for (const file of files) {
        uploaded.push(await uploadSingleFile(file, kind));
      }
      const base = uploadType === kind ? mediaItems : [];
      if (kind === 'image' && imageLongEdge.limit !== 0) {
        const sources = [...imageLongEdgeSourceItems, ...uploaded];
        update({
          ...createUploadReplacementData('image', []),
          uploadType: 'image',
          imageLongEdgeLimit: imageLongEdge.limit,
          imageLongEdgeAppliedLimit: 0,
          imageLongEdgeSourceItems: sources,
          imageLongEdgeSourceUrls: [],
          imageLongEdgeOutputUrls: [],
          ...(rhDuckMode ? { rhDuckHiddenUpload: true } : {}),
        });
      } else {
        update({
          ...createUploadDataFromItems(kind, [...base, ...uploaded]),
          ...(rhDuckMode ? { rhDuckHiddenUpload: true } : {}),
        });
      }
      if (skipped > 0) {
        setError(`已上传 ${uploaded.length} 个${KIND_META[kind].label}，跳过 ${skipped} 个非同类型文件`);
      }
    } catch (e: any) {
      setError(e?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const prepareFiles = (rawFiles: File[]) => {
    const files = rawFiles.filter(Boolean);
    if (files.length === 0) return;
    const uploadableFiles = files.filter((file) => !isUnsupportedUploadAudioFile(file));
    if (uploadableFiles.length === 0) {
      setError(UNSUPPORTED_M4A_UPLOAD_MESSAGE);
      return;
    }
    const inferred = lockedUploadType ?? uploadType ?? uploadableFiles.map(inferKindFromFile).find(Boolean) ?? null;
    if (!inferred) {
      setError('无法识别文件类型,请选择图像/视频/音频/3D模型');
      return;
    }
    const accepted = uploadableFiles.filter((file) => inferKindFromFile(file) === inferred);
    const skipped = files.length - accepted.length;
    if (accepted.length === 0) {
      const km = KIND_META[inferred];
      setError(`文件类型不匹配:期望 ${km.label}`);
      return;
    }
    void uploadFiles(accepted, inferred, skipped);
  };

  /** 文件选择:自动按 MIME 推断 kind 后上传 */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 允许重复选同一文件
    prepareFiles(files);
  };

  /** 拖拽上传:若 kind 未选则按文件 MIME 自动推断 */
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    prepareFiles(Array.from(e.dataTransfer?.files || []));
  };

  const triggerPick = () => fileInputRef.current?.click();

  // === 双击 / 上方「Edit」 → 启动图像编辑弹窗（仅 image 类型生效） ===
  // 逻辑对齐 OutputNode：编辑产物以独立 OutputNode 外挂到右侧，
  // 不修改当前上传节点本身的 imageUrl。
  const imageSourceUrls = useMemo(
    () => mediaItems.filter((item) => item.kind === 'image' && item.url).map((item) => item.url),
    [mediaItems],
  );
  const canEditImage = imageSourceUrls.length > 0 && uploadType === 'image';
  const videoSourceItems = useMemo(
    () => mediaItems.filter((item) => item.kind === 'video' && item.url),
    [mediaItems],
  );
  const canRunVideoTools = videoSourceItems.length > 0 && uploadType === 'video';
  const showRhCapabilityRail = (selected || rhCapabilityBusy) && canEditImage;
  const showRhVideoCapabilityRail = (selected || rhVideoCapabilityBusy) && canRunVideoTools;
  const openEdit = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (canEditImage) setEditingUrl(imageSourceUrls[0]);
  };
  const queueAnnotationEditProduce = (
    cleanUrls: string[],
    meta: Extract<ImageEditProduceMeta, { type: 'annotation-edit' }>,
  ) => {
    const logSource = `annotation-edit-upload:${id}`;
    if (cleanUrls.length < 2) {
      const error = new Error('标注改图需要同时包含干净原图和标注图');
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
    logBus.info('标注改图已绑定参数，等待运行体检确认', logSource);
  };

  const executeAnnotationEditAction = async (
    action: Extract<SecondaryProviderActionEnvelope, { actionId: 'image-edit.annotation' }>,
    reporter: RunNodeLifecycleReporter,
  ) => {
    const params = action.params;
    const logSource = `annotation-edit-upload:${id}`;
    let providerRequested = false;
    let providerResponded = false;
    try {
      logBus.info('正在按标注说明生成改图结果', logSource);
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
        throw new Error('已绑定的生成目标框已删除或变化，已停止调用 Provider');
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
      if (resultUrls.length === 0) throw new Error('标注改图完成但没有返回图片');
      await reporter.providerResponse({
        provider: params.providerId,
        model: params.providerModel,
        ...extractRunProviderTrace(result),
        status: 'succeeded',
      });
      providerResponded = true;
      const sourceNode = rf.getNode(id) || ({
        id,
        type: 'upload',
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
      logBus.success(targetNode ? '标注改图结果已填入生成目标框' : '标注改图结果已创建到右侧', logSource);
    } catch (error: any) {
      logBus.error(error?.message || '标注改图失败', logSource);
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

  const handleProduce = (urls: string[], _meta?: UploadProduceMeta): void | Promise<void> => {
    const cleanUrls = (Array.isArray(urls) ? urls : []).map((url) => String(url || '').trim()).filter(Boolean);
    const isRhCapabilityOutput = _meta?.type === 'rh-capability' || _meta?.type === 'video-frame-extract';
    const logSource = `rh-image-output:${id}`;
    if (_meta?.type === 'annotation-edit') {
      return queueAnnotationEditProduce(cleanUrls, _meta);
    }
    if (cleanUrls.length === 0) {
      if (isRhCapabilityOutput) logBus.warn(`${_meta.label || 'RH 图像能力'}完成但没有可创建的图像 URL`, logSource);
      return;
    }
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 260;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const COLS = 3;
    const COL_W = 350;
    const ROW_H = Math.max(360, myH);
    const ts = Date.now();
    // v1.2.10.5: 整组防重叠 —— 先算 3 列宫格, 再求公共偏移
    const _sz = defaultSizeOf('output');
    if (isRhCapabilityOutput) {
      logBus.info(`${_meta.label || 'RH 图像能力'}准备创建 ${cleanUrls.length} 个输出素材节点`, logSource);
    }
    const _desired: PlacementRect[] = cleanUrls.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w, h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:upload-produce:${id}` });
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
      logBus.success(`${_meta.label || 'RH 图像能力'}已创建 ${newNodes.length} 个输出素材节点`, logSource);
    } else {
      rf.addNodes(newNodes);
    }
  };

  const handleVideoProduce = (urls: string[], _meta?: UploadProduceMeta): void => {
    const cleanUrls = (Array.isArray(urls) ? urls : []).map((item) => String(item || '').trim()).filter(Boolean);
    const isRhCapabilityOutput = _meta?.type === 'rh-video-capability';
    const logSource = `rh-video-output:${id}`;
    if (cleanUrls.length === 0) {
      if (isRhCapabilityOutput) logBus.warn(`${_meta.label || 'RH 视频能力'}完成但没有可创建的视频 URL`, logSource);
      return;
    }
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 260;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const COLS = 3;
    const COL_W = 350;
    const ROW_H = Math.max(360, myH);
    const ts = Date.now();
    const _sz = defaultSizeOf('output');
    if (isRhCapabilityOutput) {
      logBus.info(`${_meta.label || 'RH 视频能力'}准备创建 ${cleanUrls.length} 个视频输出素材节点`, logSource);
    }
    const _desired: PlacementRect[] = cleanUrls.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w,
      h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:upload-video-produce:${id}` });
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
          ...createOutputDataFromItems('video', [{
            kind: 'video',
            url: u,
            name: fileNameFromUrl(u),
          }]),
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
      logBus.success(`${_meta.label || 'RH 视频能力'}已创建 ${newNodes.length} 个视频输出素材节点`, logSource);
    } else {
      rf.addNodes(newNodes);
    }
  };

  const rememberVideoFrameTime = (key: string, time: number) => {
    if (Number.isFinite(time) && time >= 0) videoFrameTimesRef.current.set(key, time);
  };

  const captureCurrentVideoFrame = async (item: MediaItem, index: number) => {
    const frameKey = `${index}:${item.url}`;
    if (capturingFrameKey) return;
    const frameTime = Math.max(0, Number(videoFrameTimesRef.current.get(frameKey)) || 0);
    const sourceName = item.name || fileNameFromUrl(item.url) || `视频 ${index + 1}`;
    setCapturingFrameKey(frameKey);
    setError(null);
    try {
      const snapshot = await snapshotVideoFrameAsync({
        id: `upload-video-frame-${id}-${index}`,
        sourceNodeId: id,
        sourceLabel: '上传节点视频',
        name: sourceName,
        url: item.url,
        directUrl: item.url,
        mime: item.mime,
        trimStart: 0,
        status: 'ready',
      }, frameTime, {
        format: 'png',
        sourceLabel: `${sourceName} · 当前帧`,
      });
      await Promise.resolve(handleProduce([snapshot.imageUrl], {
        type: 'video-frame-extract',
        label: '当前帧截图',
      }));
      logBus.success(
        `已截取 ${snapshot.time.toFixed(2)} 秒画面，图片已保存并输出`,
        `video-frame:upload:${id}`,
      );
    } catch (captureError: any) {
      const message = captureError?.message || '当前帧截取失败，请确认视频仍可播放后重试';
      setError(message);
      logBus.error(message, `video-frame:upload:${id}`);
    } finally {
      setCapturingFrameKey(null);
    }
  };

  const splitUploadCollection = () => {
    if (!uploadType || mediaItems.length <= 1) return;
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 260;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 240;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const ts = Date.now();
    const COLS = 3;
    const COL_W = 300;
    const ROW_H = Math.max(240, myH);
    const _sz = defaultSizeOf('upload');
    const _desired: PlacementRect[] = mediaItems.map((_, i) => ({
      x: baseX + (i % COLS) * COL_W,
      y: baseY + Math.floor(i / COLS) * ROW_H,
      w: _sz.w,
      h: _sz.h,
    }));
    const _off = placeBatchNodes(_desired, rf.getNodes(), { source: `placement:split-upload:${id}` });
    const newNodes: Node[] = mediaItems.map((item, i) => ({
      id: `upload-split-${id}-${ts}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      type: item.kind === 'model3d' ? 'model-3d-upload' : 'upload',
      position: {
        x: baseX + (i % COLS) * COL_W + _off.dx,
        y: baseY + Math.floor(i / COLS) * ROW_H + _off.dy,
      },
      data: {
        ...createUploadDataFromItem(item),
        ...(item.kind === 'model3d' ? { lockedUploadType: 'model3d' } : {}),
      },
      selected: false,
    } as Node));
    rf.addNodes(newNodes);
  };

  // ==================== 渲染 ====================
  const handleColor = meta?.color || PORT_COLOR.any;
  const effectiveHandleColor = rhDuckMode ? '#ff345f' : yyhPortraitUploadMode ? '#ff4fd8' : handleColor;
  const headerLabel = lockedUploadType === 'model3d' ? '3D素材上传' : meta ? `上传${meta.label}` : '上传素材';
  const totalSize = mediaItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const handleDownloadUploads = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof document === 'undefined') return;
    if (uploadType === 'image' && imageLongEdge.limit !== 0 && !imageLongEdge.ready) {
      setError('图片正在按长边缩放，请完成后再下载');
      return;
    }
    mediaItems.forEach((item, i) => {
      const anchor = document.createElement('a');
      anchor.href = item.url;
      anchor.download = uploadDownloadName(item, i);
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  };

  const runNode = async (reporter: RunNodeLifecycleReporter) => {
    const action = resolveSecondaryProviderActionForRun({
      nodeId: id,
      nodeType: 'upload',
      nodeData: rf.getNode(id)?.data,
      runContext: reporter.runContext,
    });
    if (!action) {
      if (reporter.runContext?.secondaryProviderActionId) {
        throw new Error('上传节点的次级 Provider action 已过期或被修改，已停止调用 Provider');
      }
      await handleRun();
      return;
    }
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

  // Upload 的普通“输出素材”和所有次级 Provider action 共用唯一监听器。
  useRunTrigger(id, runNode, undefined, { lifecycleAware: true });

  return (
    <NodeVisible>
      <div
      data-upload-node-id={id}
      data-rh-duck-mode={rhDuckMode ? 'true' : undefined}
      data-yyh-portrait-hidden-upload={yyhPortraitUploadMode ? 'true' : undefined}
      className="relative rounded-xl border-2 transition-colors flex flex-col"
      style={{
        background: isDark ? 'rgba(20,20,22,.92)' : 'rgba(255,255,255,.96)',
        backdropFilter: 'blur(8px)',
        borderColor: selected || rhDuckMode ? effectiveHandleColor : isDark ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.1)',
        width: size.w,
        height: size.h, // undefined → auto, 上传后被图/视频自然撑高; 拖角后具体 px
        minWidth: 220,
        // 不设 overflow 避免裁掉 ResizableCorners 的 4 角 handle (中心点在节点边缘上)
      }}
    >
      {/* 四角同比例缩放 (仅选中时出现) — 主题色跟随上传类型的端口色 */}
      <ResizableCorners
        selected={selected}
        minWidth={220}
        minHeight={180}
        accent={effectiveHandleColor}
        onResize={(_e, p) => setSize({ w: p.width, h: p.height })}
      />
      {/* 选中时浮动图像操作按钮 — Edit 保持本地编辑，RH 图像能力走左侧轨道 */}
      {selected && canEditImage && (
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
            onClick={openEdit}
            onMouseDown={(e) => e.stopPropagation()}
            title="编辑图像（裁剪 / 宫格切分），等同双击预览图"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              height: 26,
              background: isDark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.95)',
              color: effectiveHandleColor,
              border: `1px solid ${effectiveHandleColor}66`,
              borderRadius: isPixel ? 0 : 6,
              boxShadow: isPixel
                ? `2px 2px 0 ${effectiveHandleColor}`
                : isDark
                  ? '0 6px 24px rgba(0,0,0,0.4)'
                  : '0 6px 24px rgba(0,0,0,0.12)',
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
        sourceUrls={imageSourceUrls}
        accent={effectiveHandleColor}
        isDark={isDark}
        isPixel={isPixel}
        style={{ display: showRhCapabilityRail ? 'flex' : 'none' }}
        onComplete={(result) => handleProduce(result.imageUrls, { type: 'rh-capability', label: result.tool.title })}
        onError={setError}
        onRunningChange={setRhCapabilityBusy}
      />
      <RhVideoCapabilityRail
        secondaryActionNodeId={id}
        queueSecondaryAction={queueSecondaryAction}
        sourceItems={videoSourceItems}
        accent={effectiveHandleColor}
        isDark={isDark}
        isPixel={isPixel}
        style={{ display: showRhVideoCapabilityRail ? 'flex' : 'none' }}
        onFramesComplete={(imageUrls) => handleProduce(imageUrls, { type: 'video-frame-extract', label: '首尾帧获取' })}
        onVideosComplete={(result) => handleVideoProduce(result.videoUrls, {
          type: 'rh-video-capability',
          label: result.tool.title,
          capability: result.tool.capabilities.find((item) => item.startsWith('video.')),
          toolId: result.tool.id,
          taskIds: result.taskIds,
        })}
        onError={setError}
        onRunningChange={setRhVideoCapabilityBusy}
      />
      {/* 仅有 source handle(上传节点不接收输入) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-0"
        style={{ background: effectiveHandleColor, width: 10, height: 10 }}
        title={meta ? `输出 ${meta.label}` : '请先选择类型'}
      />

      {/* 头部 */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{
            background: effectiveHandleColor + '33',
            color: effectiveHandleColor,
            boxShadow: `inset 0 0 0 1px ${effectiveHandleColor}66`,
          }}
        >
          {meta ? <meta.icon size={13} /> : <UploadIcon size={13} />}
        </div>
        <div className={`min-w-0 flex-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          <div className="truncate text-sm font-semibold">{headerLabel}</div>
          {d.webAssetImporter && (
            <div className={`truncate text-[10px] font-medium ${isDark ? 'text-cyan-200/75' : 'text-cyan-700'}`}>
              网页采集 · {mediaItems.length} 张
            </div>
          )}
        </div>
        {meta && (
          <button
            onClick={handleReset}
            title="重置类型"
            className={`p-1 rounded ${
              isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* body 高度逻辑: root 默认 height=auto 时 body 也 auto 跟随内容 (图/视频) 自然高;
          root 拖角后有具体 px 时, body flex-1 撑满剩余 + min-h-0 允许内容 overflow */}
      <div className={`p-2.5 space-y-2 ${size.h ? 'flex-1 min-h-0 overflow-auto' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        {/* 隐藏的文件输入: accept 三合一, 上传后自动按 MIME 识别 kind */}
        <input
          ref={fileInputRef}
          type="file"
          accept={meta ? meta.accept : `image/*,${KIND_META.video.accept},${AUDIO_UPLOAD_ACCEPT},.glb,.gltf,.obj,.fbx,.stl,.usdz,.zip`}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 未上传状态: 一个大点击/拖拽区域, 自动识别类型 */}
        {mediaItems.length === 0 && (
          <div
            onClick={triggerPick}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`cursor-pointer rounded border-2 border-dashed flex flex-col items-center justify-center text-[11px] transition-colors py-6 px-3 ${
              dragActive
                ? 'bg-white/10'
                : isDark
                  ? 'border-white/15 hover:border-white/30 text-white/60'
                  : 'border-black/15 hover:border-black/30 text-zinc-500'
            }`}
            style={dragActive ? { borderColor: effectiveHandleColor } : undefined}
          >
            <UploadIcon size={22} className="mb-1.5" style={{ color: effectiveHandleColor }} />
            <span className="font-medium">
              {uploading ? '上传中...' : dragActive ? '松开以上传' : '点击或拖拽文件'}
            </span>
            <span
              className={`text-[10px] mt-0.5 ${
                isDark ? 'text-white/30' : 'text-zinc-400'
              }`}
            >
              {lockedUploadType === 'model3d'
                ? '支持 glb / gltf / obj / fbx / stl / usdz / zip'
                : rhDuckMode
                  ? 'RED 模式已锁定图像 · 清空素材后仍保持'
                : '自动识别 图像 / 视频 / 音频 / 3D模型 · 支持同类型批量'}
            </span>
          </div>
        )}

        {/* 已上传:展示预览 + 文件信息 */}
        {mediaItems.length > 0 && uploadType && meta && (
          <div className="group/upload-section space-y-1.5">
            <div className={`flex items-center gap-1.5 text-[10px] ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>
              <meta.icon size={11} />
              <span className="flex-1">
                {meta.label} ({mediaItems.length})
                {uploadType === 'image' && imageLongEdge.busy ? ' · 缩放中' : ''}
              </span>
              {uploadType === 'image' && (
                <ImageLongEdgeButtons
                  value={imageLongEdge.limit}
                  busy={imageLongEdge.busy}
                  onChange={(next) => {
                    setError(null);
                    if (next === 0) {
                      update({
                        ...createUploadReplacementData('image', imageLongEdgeSourceItems),
                        imageLongEdgeLimit: 0,
                        imageLongEdgeAppliedLimit: 0,
                        imageLongEdgeSourceItems: [],
                        imageLongEdgeSourceUrls: [],
                        imageLongEdgeOutputUrls: [],
                      });
                      return;
                    }
                    update({
                      ...createUploadReplacementData('image', []),
                      uploadType: 'image',
                      imageLongEdgeLimit: next,
                      imageLongEdgeAppliedLimit: 0,
                      imageLongEdgeSourceItems,
                      imageLongEdgeSourceUrls: [],
                      imageLongEdgeOutputUrls: [],
                    });
                  }}
                />
              )}
              {(uploadType !== 'image' || imageLongEdge.limit === 0 || imageLongEdge.ready) && (
                <CollectionSplitButton
                  count={mediaItems.length}
                  kindLabel={meta.label}
                  onSplit={splitUploadCollection}
                  className="opacity-100 transition"
                />
              )}
            </div>

            {uploadType === 'image' && (
              <div className={mediaItems.length >= 2 ? 'grid grid-cols-2 gap-1.5' : 'space-y-1'}>
                {mediaItems.map((item, i) => (
                  <div key={`${item.url}-${i}`} className="group/upload-image space-y-0.5">
                    <div className="relative">
                      <SmartImage
                        src={item.url}
                        alt={item.name || `图像 ${i + 1}`}
                        className="w-full h-auto rounded block cursor-zoom-in"
                        thumbSize={mediaItems.length >= 2 ? 320 : 720}
                        style={{ background: '#0008', objectFit: 'contain', maxHeight: mediaItems.length >= 2 ? 120 : 480 }}
                        data-drag-source={imageLongEdge.limit === 0 || imageLongEdge.ready ? true : undefined}
                        data-drag-kind="image"
                        data-drag-url={item.url}
                        data-drag-preview={item.url}
                        data-drag-node-id={id}
                        data-resource-title={item.name}
                        onMouseDown={(e) => {
                          if (imageLongEdge.limit === 0 || imageLongEdge.ready) {
                            beginMaterialDrag(e, { kind: 'image', url: item.url, sourceNodeId: id, previewUrl: item.url });
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingUrl(item.url);
                        }}
                        title="双击编辑（裁剪 / 宫格切分） · Ctrl+拖拽可送到其他节点"
                      />
                      <ImageHoverPreview
                        src={item.url}
                        alt={item.name || `图像 ${i + 1}`}
                        buttonClassName="absolute right-1.5 top-1.5 z-10 h-7 w-7 p-0 opacity-0 shadow-md transition group-hover/upload-image:opacity-100 focus:opacity-100"
                      />
                      <button
                        type="button"
                        className="nodrag nopan t8-btn t8-mini-icon-button t8-material-delete-button absolute right-1.5 top-10 z-10 h-7 w-7 p-0 opacity-0 shadow-md transition group-hover/upload-image:opacity-100 focus:opacity-100"
                        title={`删除素材 ${i + 1}`}
                        aria-label={`删除素材 ${i + 1}`}
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
                          handleRemoveUploadItem(i);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/45' : 'text-zinc-500'}`}>
                      <span className="truncate flex-1" title={item.name}>{item.name || `图像 ${i + 1}`}</span>
                      <MediaMetadataBadge kind="image" url={item.url} />
                      {item.size ? <span className="opacity-70">{formatMediaSize(item.size)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {uploadType === 'video' && (
              <div className="space-y-1.5">
                {mediaItems.map((item, i) => (
                  <div key={`${item.url}-${i}`} className="space-y-0.5">
                    <LoopingVideo
                      src={item.url}
                      controls
                      className="w-full h-auto rounded block"
                      style={{ background: '#000', objectFit: 'contain', maxHeight: mediaItems.length >= 2 ? 180 : 480 }}
                      data-drag-source
                      data-drag-kind="video"
                      data-drag-url={item.url}
                      data-drag-preview={item.url}
                      data-drag-node-id={id}
                      data-resource-title={item.name}
                      onLoadedMetadata={(event) => rememberVideoFrameTime(`${i}:${item.url}`, event.currentTarget.currentTime)}
                      onTimeUpdate={(event) => rememberVideoFrameTime(`${i}:${item.url}`, event.currentTarget.currentTime)}
                      onSeeked={(event) => rememberVideoFrameTime(`${i}:${item.url}`, event.currentTarget.currentTime)}
                      onMouseDown={(e) =>
                        beginMaterialDrag(e, { kind: 'video', url: item.url, sourceNodeId: id, previewUrl: item.url })
                      }
                    />
                    <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/45' : 'text-zinc-500'}`}>
                      <span className="truncate flex-1" title={item.name}>{item.name || `视频 ${i + 1}`}</span>
                      <MediaMetadataBadge kind="video" url={item.url} />
                      {item.size ? <span className="opacity-70">{formatMediaSize(item.size)}</span> : null}
                      <button
                        type="button"
                        data-video-current-frame
                        className={`nodrag nopan flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 ${
                          isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/10 text-zinc-600'
                        } disabled:cursor-wait disabled:opacity-55`}
                        title="截取当前播放画面，保存到 T8 输出目录并创建图片输出节点"
                        aria-label={`截取视频 ${i + 1} 当前帧`}
                        disabled={capturingFrameKey !== null}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void captureCurrentVideoFrame(item, i);
                        }}
                      >
                        <Camera size={10} />
                        {capturingFrameKey === `${i}:${item.url}` ? '截取中' : '当前帧'}
                      </button>
                      <button
                        type="button"
                        className={`nodrag nopan p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                        title={`删除素材 ${i + 1}`}
                        aria-label={`删除素材 ${i + 1}`}
                        style={{ color: 'var(--t8-danger, #ef4444)' }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemoveUploadItem(i);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {uploadType === 'audio' && (
              <div className="space-y-1.5">
                {mediaItems.map((item, i) => (
                  <div key={`${item.url}-${i}`} className="space-y-0.5">
                    <LazyAudio
                      src={item.url}
                      controls
                      className="w-full"
                      data-drag-source
                      data-drag-kind="audio"
                      data-drag-url={item.url}
                      data-drag-node-id={id}
                      data-resource-title={item.name}
                      onMouseDown={(e) =>
                        beginMaterialDrag(e, { kind: 'audio', url: item.url, sourceNodeId: id })
                      }
                    />
                    <div className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-white/45' : 'text-zinc-500'}`}>
                      <span className="truncate flex-1" title={item.name}>{item.name || `音频 ${i + 1}`}</span>
                      <MediaMetadataBadge kind="audio" url={item.url} />
                      {item.size ? <span className="opacity-70">{formatMediaSize(item.size)}</span> : null}
                      <button
                        type="button"
                        className={`nodrag nopan p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                        title={`删除素材 ${i + 1}`}
                        aria-label={`删除素材 ${i + 1}`}
                        style={{ color: 'var(--t8-danger, #ef4444)' }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemoveUploadItem(i);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {uploadType === 'model3d' && (
              <div className="space-y-1.5">
                {mediaItems.map((item, i) => (
                  <div
                    key={`${item.url}-${i}`}
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
                        <div className={`truncate text-[11px] font-semibold ${isDark ? 'text-white/80' : 'text-zinc-800'}`} title={item.name || item.url}>
                          {item.name || `3D模型 ${i + 1}`}
                        </div>
                        <div className={`truncate text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-500'}`} title={item.url}>
                          {item.url}
                        </div>
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className={`nodrag nopan inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] ${
                          isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/10 text-zinc-600'
                        }`}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Download size={10} /> 下载
                      </a>
                      <button
                        type="button"
                        className={`nodrag nopan inline-flex items-center justify-center rounded px-1.5 py-1 text-[10px] ${
                          isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                        }`}
                        title={`删除素材 ${i + 1}`}
                        aria-label={`删除素材 ${i + 1}`}
                        style={{ color: 'var(--t8-danger, #ef4444)' }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemoveUploadItem(i);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`flex items-center gap-1 text-[10px] ${
                isDark ? 'text-white/50' : 'text-zinc-500'
              }`}
            >
              <span className="truncate flex-1">
                {mediaItems.length} 项{totalSize > 0 ? ` · ${formatMediaSize(totalSize)}` : ''}
              </span>
              <button
                type="button"
                data-upload-action="download"
                onClick={handleDownloadUploads}
                title={mediaItems.length > 1 ? '下载全部素材' : '下载素材'}
                aria-label={mediaItems.length > 1 ? '下载全部素材' : '下载素材'}
                className={`nodrag nopan p-0.5 rounded ${
                  isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Download size={11} />
              </button>
              <button
                onClick={triggerPick}
                title="继续添加同类型文件"
                className={`nodrag nopan p-0.5 rounded ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <UploadIcon size={11} />
              </button>
              <button
                onClick={handleReset}
                title="清空文件"
                className={`nodrag nopan p-0.5 rounded ${
                  isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-100 text-red-600'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X size={11} />
              </button>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* 输出说明 */}
        {meta && (
          <div
            className={`text-[10px] text-right ${
              isDark ? 'text-white/30' : 'text-zinc-400'
            }`}
          >
            → 输出 {meta.label} (端口色 <span style={{ color: effectiveHandleColor }}>●</span>)
          </div>
        )}
      </div>
      {/* 图像编辑弹窗：产物以独立 OutputNode 外挂到右侧 */}
      {editingUrl && (
        <ImageEditModal
          srcUrl={editingUrl}
          secondaryActionNodeId={id}
          secondaryActionNodeType="upload"
          queueSecondaryAction={queueSecondaryAction}
          onClose={() => setEditingUrl(null)}
          onProduce={handleProduce}
        />
      )}
      </div>
    </NodeVisible>
  );
};

export default memo(UploadNode);
