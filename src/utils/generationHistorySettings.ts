import type { Node } from '@xyflow/react';
import type { GenerationHistoryGroup, GenerationHistoryInputArchive, HistorySettingsReview } from '../types/generationHistory';
import type { CanvasPatch } from '../types/project';
import { historyResolvedSeedanceInput } from './historyResolvedSeedanceInput';
import { historyImageBasicSettings, IMAGE_HISTORY_EXTRA_FIELDS } from './historyImageBasicSettings';
import { historyVideoBasicSettings, VIDEO_HISTORY_EXTRA_FIELDS } from './historyVideoBasicSettings';
import { historyVideoUsesTaskCache } from './historyVideoTaskBinding';
import { buildMidjourneyNzRequest } from './midjourneyNz';

// Audited against each node's editable basic inputs. Never copy data wholesale:
// runTrigger/task/status/output/credential fields must not travel with a draft.
const SEEDANCE_FIELDS = {
  prompt: '提示词', model: '模型', seedanceNzModel: '平价小屋模型', seedanceApiSource: '内置渠道',
  providerSource: '渠道来源', providerId: '扩展渠道', providerModel: '扩展模型',
  duration: '时长', ratio: '比例', resolution: '分辨率', generateAudio: '生成声音',
  returnLastFrame: '返回尾帧', watermark: '水印', webSearch: '联网搜索', seed: '种子',
  maxPoll: '最大轮询次数', pollInt: '轮询间隔', frameMode: '首尾帧模式',
} as const;
const PROVIDER_FIELDS = { providerSource: '渠道来源', providerId: '扩展渠道', providerModel: '扩展模型' } as const;
const IMAGE_FIELDS = {
  prompt: '提示词', model: '模型', apiModel: '子模型', imageBuiltinSource: '内置渠道',
  seedreamApiSource: 'Seedream 渠道',
  ...PROVIDER_FIELDS, aspectRatio: '比例', sizeLevel: '图像尺寸',
} as const;
const VIDEO_FIELDS = {
  prompt: '提示词', mainId: '模型分类', model: '模型', videoBuiltinSource: '内置渠道',
  ...PROVIDER_FIELDS, duration: '时长', ratio: '比例', resolution: '分辨率',
  size: '输出尺寸', seed: '种子', generateAudio: '生成声音', enhancePrompt: '提示词增强',
} as const;
const fieldsFor = (type: string): Record<string, string> | undefined => {
  if (type === 'seedance' || type === 'seedance25') return SEEDANCE_FIELDS;
  if (type === 'image') return IMAGE_FIELDS;
  if (type === 'video') return VIDEO_FIELDS;
  return undefined;
};
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const historySettingLabel = (key: string, type = 'seedance') => fieldsFor(type)?.[key]
  || (type === 'image' && Object.hasOwn(IMAGE_HISTORY_EXTRA_FIELDS, key) ? IMAGE_HISTORY_EXTRA_FIELDS[key].label
    : type === 'video' && Object.hasOwn(VIDEO_HISTORY_EXTRA_FIELDS, key) ? VIDEO_HISTORY_EXTRA_FIELDS[key].label : key);
export function selectHistoryBasicSettings(saved: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(SEEDANCE_FIELDS)) {
    const value = saved[key];
    if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('历史参数结构不完整');
    if (owns(saved, key)) data[key] = structuredClone(value);
  }
  return data;
}
export const supportsHistorySettings = (type: string) => Boolean(fieldsFor(type));
// Full input recovery has node-specific ordering/mention/default semantics.
// Enabling basic settings must never opt another node into Seedance's adapter.
// Image/video records are additionally checked against their strict standard
// adapters after loading their archive; unsupported branches never fall back.
export const supportsHistoryInputDraft = (type: string) => type === 'seedance' || type === 'seedance25' || type === 'image' || type === 'video';
const printable = (value: unknown) => value === undefined ? '未指定（使用节点默认值）' : typeof value === 'string' ? value : JSON.stringify(value);

export function prepareHistorySettingsDraft(archive: GenerationHistoryInputArchive | undefined, group: GenerationHistoryGroup,
  target: Node | undefined, scope: { projectId: string; canvasId: string; currentEdges?: ReadonlyArray<{ source: string; target: string }> }) {
  if (!archive || archive.status !== 'available' || !group.snapshotAvailable) throw new Error('当时的完整输入未归档，不能填回设置');
  const { binding, snapshot } = archive;
  if (!target || !binding.nodeEntityUid || target.id !== binding.nodeId
    || (target as Node & { entityUid?: string }).entityUid !== binding.nodeEntityUid
    || binding.nodeId !== group.nodeId || binding.nodeEntityUid !== group.nodeEntityUid
    || binding.projectId !== scope.projectId || binding.canvasId !== scope.canvasId
    || snapshot.node.id !== target.id || snapshot.node.type !== target.type) throw new Error('来源节点已删除、替换或画布已切换');
  if (!supportsHistorySettings(snapshot.node.type)) throw new Error('此类节点尚未支持安全填回参数');
  if (['generating', 'submitting', 'polling', 'running', 'queued'].includes(String(target.data.status))) throw new Error('节点正在运行，请结束后再填回设置');
  const before = target.data;
  const imageSettings = snapshot.node.type === 'image' ? historyImageBasicSettings(snapshot.node.data) : undefined;
  const videoSettings = snapshot.node.type === 'video' ? historyVideoBasicSettings(snapshot.node.data) : undefined;
  const saved = snapshot.node.type === 'image'
    ? { ...snapshot.node.data, ...imageSettings }
    : snapshot.node.type === 'video' ? { ...snapshot.node.data, ...videoSettings }
    : (supportsHistoryInputDraft(snapshot.node.type) ? historyResolvedSeedanceInput(snapshot.node.data) : null) || snapshot.node.data;
  const dataPatch: Record<string, unknown> = {};
  const dataUnsetKeys: string[] = [];
  const fields: HistorySettingsReview['fields'] = [];
  // Extra options are opt-in only when the frontend capture explicitly stored
  // them. Do not unset or infer model-specific defaults in legacy histories.
  const extraCatalog = snapshot.node.type === 'video' ? VIDEO_HISTORY_EXTRA_FIELDS : IMAGE_HISTORY_EXTRA_FIELDS;
  const extraFields = Object.fromEntries(Object.keys(imageSettings || videoSettings || {}).filter(key => owns(extraCatalog, key))
    .map(key => [key, extraCatalog[key].label]));
  for (const [key, label] of Object.entries({ ...fieldsFor(snapshot.node.type)!, ...extraFields })) {
    // New video contexts restore only explicit captured parameters. Missing
    // branch fields must not be unset (which would substitute current defaults).
    if (videoSettings && key !== 'prompt' && !owns(videoSettings, key)) continue;
    const value = saved[key];
    if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('历史参数结构不完整');
    if (JSON.stringify(before[key]) === JSON.stringify(value) && owns(before, key) === owns(saved, key)) continue;
    if (owns(saved, key)) dataPatch[key] = structuredClone(value);
    else if (owns(before, key)) dataUnsetKeys.push(key);
    // Presentation metadata only: distinguish an absent value from user text
    // that literally equals the default placeholder. Never localize dataPatch.
    fields.push({ key, label, before: printable(before[key]), after: printable(value),
      ...(owns(extraFields, key) ? { advanced: true } : {}),
      ...(before[key] === undefined ? { beforeDefault: true } : {}),
      ...(value === undefined ? { afterDefault: true } : {}) });
  }
  // Use the real request builder to identify task-bound operations. Never
  // combine an archived prompt/model with a different current task identity.
  if (snapshot.node.type === 'image') {
    const candidate: Record<string, unknown> = { ...before, ...dataPatch };
    for (const key of dataUnsetKeys) delete candidate[key];
    const requiresTask = (data: Record<string, unknown>) => data.model === 'midjourney'
      && data.imageBuiltinSource === 'seedance-nz' && (!data.providerSource || data.providerSource === 'zhenzhen')
      && owns(buildMidjourneyNzRequest(data, '', []), 'task_id');
    if (requiresTask(saved) || requiresTask(candidate)) {
      throw new Error('这条 Midjourney 设置涉及历史任务操作，暂不支持安全填回；本次未修改节点。');
    }
  }
  if (snapshot.node.type === 'video') {
    const candidate: Record<string, unknown> = { ...before, ...dataPatch };
    for (const key of dataUnsetKeys) delete candidate[key];
    if (historyVideoUsesTaskCache(saved) || historyVideoUsesTaskCache(candidate)) {
      throw new Error('这条 FLUX 草稿增强设置依赖原任务缓存，暂不支持安全填回；本次未修改节点。');
    }
  }
  // References and mention bindings are not transferable solely from a URL.
  // Keep them untouched and require explicit acknowledgement in the review.
  const referenceKeys = ['referenceImages', 'localRefImages', 'localRefVideos', 'localRefAudios', 'promptMentions', 'materialOrder', 'excludedMaterialIds', 'mjSrefImages', 'mjOrefImages', 'minimaxH3VideoStartSeconds'];
  const referenceWarning = snapshot.upstreamNodes.length > 0 || snapshot.incomingEdges.length > 0
    || Boolean(scope.currentEdges?.some(edge => edge.target === target.id))
    || referenceKeys.some(key => [saved[key], before[key]].some(value => Array.isArray(value) && value.length > 0))
    || ['topazVideoUrl', 'wanAudioUrl', 'wan30FileUrl', 'wan30LinkUrl', 'gkfReferenceUrls', 'soraCharacterIds', 'mjNzCref', 'mjNzSref', 'mjNzDref'].some(key => [saved[key], before[key]].some(value => typeof value === 'string' && value.trim().length > 0));
  return { prompt: typeof saved.prompt === 'string' ? saved.prompt : '', fields, referenceWarning,
    nodeId: target.id, nodeEntityUid: binding.nodeEntityUid, dataPatch, dataUnsetKeys };
}

export function createHistorySettingsPatch(draft: ReturnType<typeof prepareHistorySettingsDraft>, input: {
  id: string; projectId: string; canvasId: string; baseRevision: number;
}): CanvasPatch {
  if (!draft.fields.length) throw new Error('提示词和基础参数已一致，无需覆盖');
  if (Object.values(draft.dataPatch).some(value => typeof value === 'string' && value.length > 64 * 1024)) {
    throw new Error('该历史文本超过当前画布单字段写入上限，已保留原文，未截断或修改草稿');
  }
  return { schema: 't8-canvas-patch-v1', id: input.id, baseRevision: input.baseRevision,
    summary: '从生成历史填回提示词和基础参数（保留当前参考）', diagnosticsResolved: [], requiresConfirmation: true,
    operations: [{ opId: `${input.id}-settings`, projectId: input.projectId, canvasId: input.canvasId,
      actorId: '', sessionId: '', clientSeq: 0, timestamp: 1, type: 'node.patch',
      payload: { nodeId: draft.nodeEntityUid, dataPatch: draft.dataPatch, dataUnsetKeys: draft.dataUnsetKeys },
    }],
  };
}
