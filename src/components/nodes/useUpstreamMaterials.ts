import { useMemo } from 'react';
import { useEdges, useNodeConnections, useNodesData } from '@xyflow/react';
import { collectMaterialSetBucketsFromData, valueOfMaterialSetItem } from '../../utils/materialSet';
import { selectSourceHandleData } from '../../utils/sourceHandleData';
import { fileNameFromUrl } from '../../utils/mediaCollection';
import { normalizeRhNodeId } from '../../utils/rhTextBinding';
import { dedupeUpstreamMaterialBuckets } from '../../utils/upstreamMaterialBuckets';
import { shouldCollectNodeTextOutput } from '../../utils/imageNodeOutputMode';
import { normalizeLoopCustomIterationInput } from '../../utils/loopDerivedExecution';

/**
 * useUpstreamMaterials - 通用「上游素材聚合」hook
 *
 * 职责: 订阅当前节点 target 侧所有上游连接的 data 变化, 派生出
 *       { texts, images, videos, audios } 四类素材列表, 每项带:
 *         - id           : 唯一 key (供 dnd-kit / React key 使用)
 *         - kind         : 'text' | 'image' | 'video' | 'audio'
 *         - url          : 资源 URL (text 类型时是文本内容)
 *         - sourceNodeId : 来源节点 id (用于跳到来源 / 显示标签)
 *         - origin       : 'upstream' (本 hook 永远是 upstream, local 由调用方追加)
 *         - label        : 显示用的简短标签 (文件名 / 文本前缀)
 *
 * 渲染联动:
 *   - useNodeConnections({ handleType: 'target' }) 订阅连入连接, 任何连/断连触发重渲染
 *   - useNodesData(upstreamIds) 订阅上游节点 data, 任何上游 data 变化触发重渲染
 *   - useMemo deps 仅依赖 upstreamNodes (xyflow 内部已稳定化), 不会循环
 *
 * 兜底:
 *   - 若 imageUrl 字段实为视频/音频扩展名, 按扩展名纠正到对应 kind
 *   - 跨上游同 url 去重 (避免同一图被两个节点都暴露时重复显示)
 */

export type MaterialKind = 'text' | 'image' | 'video' | 'audio';

export interface Material {
  id: string;
  kind: MaterialKind;
  url: string;
  sourceNodeId: string;
  origin: 'upstream' | 'local';
  label?: string;
  rhNodeId?: string;
  sourceNodeSerialId?: number;
  /** Stable provider clip identity used by chained music operations. */
  clipId?: string;
  /** Target handles on the consuming node reached by this source material. */
  targetHandles?: string[];
}

export interface UpstreamMaterials {
  texts: Material[];
  images: Material[];
  videos: Material[];
  audios: Material[];
}

const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(\?|$)/i;

type MediaBuckets = Pick<UpstreamMaterials, 'images' | 'videos' | 'audios'>;
type MentionableKind = Exclude<MaterialKind, 'text'>;

function classifyMediaKind(kind: MentionableKind, url: string): MentionableKind {
  if (/^data:video\//i.test(url) || VIDEO_RE.test(url)) return 'video';
  if (/^data:audio\//i.test(url) || AUDIO_RE.test(url)) return 'audio';
  if (/^data:image\//i.test(url) || IMAGE_RE.test(url)) return 'image';
  return kind;
}

function pushMediaMaterial(
  buckets: MediaBuckets,
  seen: Set<string>,
  sourceId: string,
  kind: MentionableKind,
  value: any,
  key: string,
  label?: string,
) {
  if (typeof value !== 'string') return;
  const url = value.trim();
  if (!url) return;
  const actualKind = classifyMediaKind(kind, url);
  const dedupeKey = `${actualKind}:${url}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  const arr = actualKind === 'image' ? buckets.images : actualKind === 'video' ? buckets.videos : buckets.audios;
  arr.push({
    id: `${sourceId}::${key}:${dedupeKey}`,
    kind: actualKind,
    url,
    sourceNodeId: sourceId,
    origin: 'upstream',
    label: label || fileNameFromUrl(url).slice(0, 28),
  });
}

function pushMediaArray(
  buckets: MediaBuckets,
  seen: Set<string>,
  sourceId: string,
  kind: MentionableKind,
  data: any,
  field: string,
  label: string,
) {
  const arr = data?.[field];
  if (!Array.isArray(arr)) return;
  arr.forEach((url: any, index: number) => {
    pushMediaMaterial(buckets, seen, sourceId, kind, url, `${field}:${index}`, `${label}${index + 1}`);
  });
}

function collectMentionableMediaFromNodeData(sourceId: string, data: any, type?: string): Material[] {
  const buckets: MediaBuckets = { images: [], videos: [], audios: [] };
  const seen = new Set<string>();
  if (!data) return [];

  // 生成产物 / 输出节点 / 循环累积产物。
  pushMediaMaterial(buckets, seen, sourceId, 'image', data.imageUrl, 'imageUrl', '下游图像');
  pushMediaMaterial(buckets, seen, sourceId, 'image', data.directImageUrl, 'directImageUrl', '下游图像');
  pushMediaMaterial(buckets, seen, sourceId, 'image', data.resultUrl, 'resultUrl', '目标框图像');
  for (const field of ['imageUrls', 'urls', 'generatedImages', 'directImageUrls', 'resultUrls'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'image', data, field, '下游图像');
  }
  pushMediaMaterial(buckets, seen, sourceId, 'image', data.firstFrameUrl, 'firstFrameUrl', '首帧');
  pushMediaMaterial(buckets, seen, sourceId, 'image', data.lastFrameUrl, 'lastFrameUrl', '尾帧');

  pushMediaMaterial(buckets, seen, sourceId, 'video', data.videoUrl, 'videoUrl', '下游视频');
  pushMediaMaterial(buckets, seen, sourceId, 'video', data.directVideoUrl, 'directVideoUrl', '下游视频');
  for (const field of ['videoUrls', 'directVideoUrls'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'video', data, field, '下游视频');
  }

  pushMediaMaterial(buckets, seen, sourceId, 'audio', data.audioUrl, 'audioUrl', '下游音频');
  pushMediaMaterial(buckets, seen, sourceId, 'audio', data.audioUrl_1, 'audioUrl_1', '下游音频');
  pushMediaMaterial(buckets, seen, sourceId, 'audio', data.directAudioUrl, 'directAudioUrl', '下游音频');
  for (const field of ['audioUrls', 'directAudioUrls'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'audio', data, field, '下游音频');
  }

  // 节点内本地参考素材。文本节点作为上游时, @ 需要能引用下游生成节点里手动放入的素材。
  for (const field of ['referenceImages', 'localRefImages', 'mjSrefImages', 'mjOrefImages'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'image', data, field, '下游参考图');
  }
  for (const field of ['referenceVideos', 'localRefVideos'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'video', data, field, '下游参考视频');
  }
  pushMediaMaterial(buckets, seen, sourceId, 'audio', data.localRefAudio, 'localRefAudio', '下游参考音频');
  for (const field of ['referenceAudios', 'localRefAudios'] as const) {
    pushMediaArray(buckets, seen, sourceId, 'audio', data, field, '下游参考音频');
  }

  if (Array.isArray(data.pickedFiles)) {
    data.pickedFiles.forEach((file: any, index: number) => {
      const url = file?.dataUrl || file?.url;
      const label = typeof file?.name === 'string' && file.name ? file.name : `下游视觉输入${index + 1}`;
      pushMediaMaterial(buckets, seen, sourceId, 'image', url, `pickedFiles:${index}`, label);
    });
  }

  if (Array.isArray(data.tracks)) {
    data.tracks.forEach((track: any, index: number) => {
      const label = typeof track?.title === 'string' && track.title ? track.title : `下游音轨${index + 1}`;
      pushMediaMaterial(buckets, seen, sourceId, 'audio', track?.audioUrl || track?.remoteUrl, `tracks:${index}:audio`, label);
      pushMediaMaterial(buckets, seen, sourceId, 'image', track?.imageUrl, `tracks:${index}:image`, `${label}封面`);
    });
  }

  // 显式素材集按内部顺序读取；非素材集节点也可借此兼容标准 image/video/audio 字段。
  if (type === 'material-set' || Array.isArray(data.materialSetItems)) {
    const materialBuckets = collectMaterialSetBucketsFromData(data);
    materialBuckets.image.forEach((item, index) => {
      pushMediaMaterial(buckets, seen, sourceId, 'image', item.url, `material-set:image:${index}`, item.name);
    });
    materialBuckets.video.forEach((item, index) => {
      pushMediaMaterial(buckets, seen, sourceId, 'video', item.url, `material-set:video:${index}`, item.name);
    });
    materialBuckets.audio.forEach((item, index) => {
      pushMediaMaterial(buckets, seen, sourceId, 'audio', item.url, `material-set:audio:${index}`, item.name);
    });
  }

  return [...buckets.images, ...buckets.videos, ...buckets.audios];
}

export function useUpstreamMaterials(nodeId: string): UpstreamMaterials {
  const conns = useNodeConnections({ id: nodeId, handleType: 'target' });
  const upstreamIds = useMemo(
    () => Array.from(new Set(conns.map((c) => c.source))),
    [conns]
  );
  const upstreamNodes = useNodesData(upstreamIds);
  const currentNodeData = useNodesData([nodeId]);

  // v1.2.8.3: 收集每个上游 source 上被连接的 sourceHandle 集合, 供 FramePair 等多端口节点按 handle 区分输出
  // - sourceHandle === 'first' / 'last' (FramePair) → 只取对应帧
  // - sourceHandle === null/undefined / 默认 → 兼容全部 (保持原行为)
  const handleMap = useMemo(() => {
    const m = new Map<string, Set<string | null>>();
    for (const c of conns) {
      let set = m.get(c.source);
      if (!set) { set = new Set<string | null>(); m.set(c.source, set); }
      set.add((c as any).sourceHandle ?? null);
    }
    return m;
  }, [conns]);

  const targetHandleMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const connection of conns) {
      const targetHandle = String((connection as any).targetHandle || '').trim();
      if (!targetHandle) continue;
      const handles = map.get(connection.source) || new Set<string>();
      handles.add(targetHandle);
      map.set(connection.source, handles);
    }
    return map;
  }, [conns]);

  return useMemo<UpstreamMaterials>(() => {
    const texts: Material[] = [];
    const images: Material[] = [];
    const videos: Material[] = [];
    const audios: Material[] = [];
    const seen = new Set<string>();

    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];

    const textMetaFromData = (ud: any) => {
      const rhNodeId = normalizeRhNodeId(ud?.rhNodeId ?? ud?.rhTextNodeId ?? ud?.runningHubNodeId);
      const serial = Number(ud?.nodeSerialId);
      return {
        rhNodeId: rhNodeId || undefined,
        sourceNodeSerialId: Number.isFinite(serial) && serial > 0 ? serial : undefined,
      };
    };

    const pushText = (sourceId: string, v: any, keyOverride?: string, labelOverride?: string, meta?: Pick<Material, 'rhNodeId' | 'sourceNodeSerialId'>) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      const dedupeKey = keyOverride || `text:${s}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      texts.push({
        id: `${sourceId}::${dedupeKey}`,
        kind: 'text',
        url: s,
        sourceNodeId: sourceId,
        origin: 'upstream',
        label: labelOverride || (s.length > 24 ? s.slice(0, 22) + '…' : s),
        rhNodeId: meta?.rhNodeId,
        sourceNodeSerialId: meta?.sourceNodeSerialId,
      });
    };

    const pushUrl = (
      sourceId: string,
      kind: MaterialKind,
      v: any,
      arr: Material[],
      keyOverride?: string,
      labelOverride?: string,
      clipIdOverride?: string,
    ) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      const dedupeKey = keyOverride || `${kind}:${s}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      arr.push({
        id: `${sourceId}::${dedupeKey}`,
        kind,
        url: s,
        sourceNodeId: sourceId,
        origin: 'upstream',
        label: labelOverride || (s.split('/').pop() || s).slice(0, 28),
        clipId: clipIdOverride || undefined,
      });
    };

    for (const n of list) {
      if (!n) continue;
      const sid = n.id;
      const collectNodeTextOutput = shouldCollectNodeTextOutput(n.type, n.data);
      const handles = handleMap.get(sid) || new Set<string | null>([null]);
      const routedData = selectSourceHandleData((n.data || {}) as Record<string, unknown>, handles);
      for (const ud of routedData as any[]) {
        const textMeta = textMetaFromData(ud);

      // 显式素材集: 保留素材集内部顺序，并用序号 key 避免相同 URL 被全局去重误删。
      // 同时跳过下面的旧字段读取，避免 imageUrls/textSegments 双写后重复出现。
      if (n.type === 'material-set' && Array.isArray(ud.materialSetItems)) {
        const buckets = collectMaterialSetBucketsFromData(ud);
        buckets.text.forEach((item, index) => {
          pushText(sid, valueOfMaterialSetItem(item), `material-set:${sid}:text:${index}`, item.name, textMeta);
        });
        buckets.image.forEach((item, index) => {
          pushUrl(sid, 'image', item.url, images, `material-set:${sid}:image:${index}`, item.name);
        });
        buckets.video.forEach((item, index) => {
          pushUrl(sid, 'video', item.url, videos, `material-set:${sid}:video:${index}`, item.name);
        });
        buckets.audio.forEach((item, index) => {
          pushUrl(sid, 'audio', item.url, audios, `material-set:${sid}:audio:${index}`, item.name);
        });
        continue;
      }

      if (collectNodeTextOutput) {
        // 文本: textSegments/texts 数组优先, 避免文本分割节点再把 joined prompt 当成第 N+1 项
        const textArrayFields = ['textSegments', 'segments', 'texts'];
        const textArrayField = textArrayFields.find((f) => Array.isArray(ud[f]) && ud[f].length > 0);
        if (textArrayField) {
          ud[textArrayField].forEach((item: any, index: number) => {
            pushText(sid, item, `text-array:${sid}:${textArrayField}:${index}`, undefined, textMeta);
          });
        } else {
          // 文本: outputText (用户编辑覆盖) > reply > promptResolved(@素材已解析) > prompt > text
          pushText(sid, ud.outputText, `text-field:${sid}:outputText`, undefined, textMeta);
          pushText(sid, ud.reply, `text-field:${sid}:reply`, undefined, textMeta);
          let primaryPromptText = '';
          if (typeof ud.promptResolved === 'string' && ud.promptResolved.trim()) {
            primaryPromptText = ud.promptResolved.trim();
            pushText(sid, ud.promptResolved, `text-field:${sid}:promptResolved`, undefined, textMeta);
          } else {
            primaryPromptText = typeof ud.prompt === 'string' ? ud.prompt.trim() : '';
            pushText(sid, ud.prompt, `text-field:${sid}:prompt`, undefined, textMeta);
          }
          if (typeof ud.text === 'string' && ud.text.trim() !== primaryPromptText) {
            pushText(sid, ud.text, `text-field:${sid}:text`, undefined, textMeta);
          }
        }
      }

      // === v1.2.8.3: FramePair 双端口语义 ===
      // 节点同时具备 firstFrameUrl + lastFrameUrl 字段时按 sourceHandle 过滤,
      //   - 'first' 端口 → 只输出首帧
      //   - 'last'  端口 → 只输出尾帧
      //   - null/默认  → 同时输出两帧 (autoOutput / 手动接默认 handle 的兼容)
      // 跳过通用 imageUrl/imageUrls 分支, 避免双图被通用聚合再次合并。
      const isFramePair = (typeof ud.firstFrameUrl === 'string' || typeof ud.lastFrameUrl === 'string')
        && (ud.firstFrameUrl !== undefined || ud.lastFrameUrl !== undefined)
        && Object.prototype.hasOwnProperty.call(ud, 'firstFrameUrl')
        && Object.prototype.hasOwnProperty.call(ud, 'lastFrameUrl');
      if (isFramePair) {
        const wantFirst = handles.has('first') || (handles.has(null) && !handles.has('last'));
        const wantLast = handles.has('last') || (handles.has(null) && !handles.has('first'));
        if (wantFirst) pushUrl(sid, 'image', ud.firstFrameUrl, images);
        if (wantLast) pushUrl(sid, 'image', ud.lastFrameUrl, images);
        continue;
      }

      // 图像: 单 + 多
      pushUrl(sid, 'image', ud.imageUrl, images);
      pushUrl(sid, 'image', ud.resultUrl, images, undefined, '目标框图像');
      const arrFields = ['imageUrls', 'urls', 'generatedImages', 'resultUrls'];
      for (const f of arrFields) {
        const v = ud[f];
        if (Array.isArray(v)) {
          for (const u of v) pushUrl(sid, 'image', u, images);
        }
      }

      // 视频: 单 + 多 (v1.2.8.2: videoUrls 数组 — LoopNode 聚合多视频产物)
      pushUrl(sid, 'video', ud.videoUrl, videos);
      if (Array.isArray(ud.videoUrls)) {
        for (const u of ud.videoUrls) pushUrl(sid, 'video', u, videos);
      }

      const audioClipIds = new Map<string, string>();
      if (Array.isArray(ud.tracks)) {
        for (const track of ud.tracks) {
          const audioUrl = String(track?.audioUrl || track?.remoteUrl || '').trim();
          const clipId = String(track?.clipId || '').trim();
          if (audioUrl && clipId) audioClipIds.set(audioUrl, clipId);
        }
      }
      const fallbackClipId = String(ud.flowMusicClipId || '').trim();
      const pushAudioUrl = (value: unknown) => {
        const audioUrl = typeof value === 'string' ? value.trim() : '';
        pushUrl(sid, 'audio', value, audios, undefined, undefined, audioClipIds.get(audioUrl) || fallbackClipId);
      };

      // === v1.2.9.14: Suno 双端口语义 (与 FramePair 同模式) ===
      // AudioNode (Suno) 同时具备 audioUrl(主轨, sourceHandle='audio-0') + audioUrl_1(副轨, sourceHandle='audio-1') 字段时按 handle 过滤,
      //   - 'audio-0' 端口 → 只输出主轨
      //   - 'audio-1' 端口 → 只输出副轨
      //   - null/默认  → 同时输出两轨 (autoOutput 旧版 / 手动接默认 handle 的兼容)
      const isSuno =
        Object.prototype.hasOwnProperty.call(ud, 'audioUrl') &&
        Object.prototype.hasOwnProperty.call(ud, 'audioUrl_1');
      if (isSuno) {
        const wantA0 = handles.has('audio-0') || (handles.has(null) && !handles.has('audio-1'));
        const wantA1 = handles.has('audio-1') || (handles.has(null) && !handles.has('audio-0'));
        if (wantA0) pushAudioUrl(ud.audioUrl);
        if (wantA1) pushAudioUrl(ud.audioUrl_1);
        if (Array.isArray(ud.audioUrls)) {
          for (const u of ud.audioUrls) pushAudioUrl(u);
        }
        continue;
      }

      // 音频 (audioUrl 主轨, audioUrl_1 副轨——AudioNode 双输出口, audioUrls 数组 — LoopNode 聚合)
      pushAudioUrl(ud.audioUrl);
      pushAudioUrl(ud.audioUrl_1);
      if (Array.isArray(ud.audioUrls)) {
        for (const u of ud.audioUrls) pushAudioUrl(u);
      }
      }
    }

    // 兜底: 一些节点把视频/音频塞在 imageUrl, 通过扩展名识别再纠正
    const fixedImages: Material[] = [];
    for (const m of images) {
      if (VIDEO_RE.test(m.url)) {
        videos.push({ ...m, kind: 'video' });
        continue;
      }
      if (AUDIO_RE.test(m.url)) {
        audios.push({ ...m, kind: 'audio' });
        continue;
      }
      fixedImages.push(m);
    }

    const withTargetHandles = (materials: Material[]) => materials.map((material) => ({
      ...material,
      targetHandles: [...(targetHandleMap.get(material.sourceNodeId) || [])],
    }));
    const collected = dedupeUpstreamMaterialBuckets({
      texts: withTargetHandles(texts),
      images: withTargetHandles(fixedImages),
      videos: withTargetHandles(videos),
      audios: withTargetHandles(audios),
    });
    const self = Array.isArray(currentNodeData) ? currentNodeData[0] : null;
    const customInput = normalizeLoopCustomIterationInput((self?.data as any)?.__loopCustomInput);
    if (!customInput) return collected;

    const asMaterials = (kind: MaterialKind, entries: typeof customInput.texts): Material[] => entries.map((entry) => ({
      ...entry,
      kind,
      origin: 'upstream' as const,
      label: kind === 'text'
        ? (entry.url.length > 24 ? `${entry.url.slice(0, 22)}…` : entry.url)
        : fileNameFromUrl(entry.url).slice(0, 28),
    }));
    return {
      texts: asMaterials('text', customInput.texts),
      images: asMaterials('image', customInput.images),
      videos: asMaterials('video', customInput.videos),
      audios: asMaterials('audio', customInput.audios),
    };
  }, [upstreamNodes, handleMap, targetHandleMap, currentNodeData]);
}

/**
 * 供文本节点 @ 引用使用: 文本节点通常是提示词上游, 但用户也会把图片/视频/音频
 * 直接放在下游生成节点里。这里只读取下游媒体, 不读取下游文本, 避免形成提示词回环。
 */
export function useDownstreamMediaMaterials(nodeId: string): Material[] {
  const conns = useNodeConnections({ id: nodeId, handleType: 'source' });
  const edges = useEdges();
  const downstreamIds = useMemo(
    () => Array.from(new Set(conns.map((c) => c.target).filter(Boolean))),
    [conns],
  );
  const siblingMediaSourceIds = useMemo(() => {
    const targets = new Set(downstreamIds);
    if (targets.size === 0) return [];
    return Array.from(new Set(
      edges
        .filter((edge) => targets.has(edge.target) && edge.source !== nodeId)
        .map((edge) => edge.source)
        .filter(Boolean),
    ));
  }, [downstreamIds, edges, nodeId]);
  const downstreamNodes = useNodesData(downstreamIds);
  const siblingMediaSourceNodes = useNodesData(siblingMediaSourceIds);

  return useMemo<Material[]>(() => {
    const siblingList = Array.isArray(siblingMediaSourceNodes) ? siblingMediaSourceNodes : [];
    const downstreamList = Array.isArray(downstreamNodes) ? downstreamNodes : [];
    const out: Material[] = [];
    const seen = new Set<string>();
    for (const n of [...siblingList, ...downstreamList]) {
      if (!n) continue;
      for (const material of collectMentionableMediaFromNodeData(n.id, n.data || {}, n.type)) {
        const key = `${material.kind}:${material.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(material);
      }
    }
    return out;
  }, [downstreamNodes, siblingMediaSourceNodes]);
}
