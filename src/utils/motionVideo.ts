import contract from '../../backend/src/shared/motionVideoContract.json';
export { contract as MOTION_VIDEO_CONTRACT };
export const MOTION_INPUT_SCHEMA = 't8-motion-video-input-v1';
export interface MotionRequest {
  model: string; operation: 'generate' | 'revise'; prompt: string; duration: number; ratio: string; resolution: string;
  motion?: { template_id?: string; title?: string; subtitle?: string; keywords?: string[]; signature?: string; language?: string; music?: string;
    revise_from?: string; revision_instruction?: string };
  connectionRef?: string;
}
export interface MotionResult {
  schema: string; model: string; taskId: string; connectionRef: string;
  storyboard: Record<string, unknown> | null; fallbackScenes: unknown[]; warnings: string[];
  coverUrl?: string;
}
export interface MotionVersion {
  id: string; createdAt: number; request: MotionRequest; result: MotionResult; videoUrls: string[]; assetIds: string[];
  baseVersionId: string | null; ancestorQuality: string[]; review: 'unreviewed' | 'accepted';
}
export interface MotionInput {
  schema: typeof MOTION_INPUT_SCHEMA; prompt: string; request: MotionRequest; baseVersionId: string | null; ancestorQuality: string[];
}
export interface MotionPending extends MotionInput { taskId: string; connectionRef: string; runId?: string; nodeRunId?: string; }
export const motionDefaults = { model: contract.defaults.model, prompt: '', duration: 15, ratio: '16:9', resolution: '720p',
  motionOperation: 'generate', motionTemplate: 'api_default', motionMusic: 'api_default', motionKeywords: '', motionRevisionInstruction: '', motionBaseVersionId: '', status: 'idle' };
const string = (value: unknown) => typeof value === 'string' ? value : '';
export function readMotionPending(value: unknown): MotionPending | undefined {
  if (value == null) return undefined;
  const pending = value as MotionPending;
  if (pending.schema !== MOTION_INPUT_SCHEMA || !/^[A-Za-z0-9._:-]{1,512}$/.test(pending.taskId || '')
    || !/^seedance-nz:[a-f0-9]{64}$/.test(pending.connectionRef || '') || !contract.models.includes(pending.request?.model)
    || typeof pending.request?.prompt !== 'string' || !contract.durations.includes(pending.request.duration)
    || !contract.ratios.includes(pending.request.ratio) || !contract.resolutions.includes(pending.request.resolution)) {
    throw Error('待恢复动画任务信息不完整，请从生成历史找回；不会重新提交 / Incomplete task identity; recover from history without resubmitting');
  }
  return structuredClone(pending);
}
export function motionVersions(value: unknown): MotionVersion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is MotionVersion => Boolean(v && typeof v === 'object' && typeof v.id === 'string'
    && v.result?.schema === contract.resultSchema && contract.models.includes(v.result.model)
    && /^[A-Za-z0-9._:-]{1,512}$/.test(v.result.taskId || '') && /^seedance-nz:[a-f0-9]{64}$/.test(v.result.connectionRef || '')
    && Array.isArray(v.result.fallbackScenes) && Array.isArray(v.result.warnings)
    && Array.isArray(v.videoUrls) && v.videoUrls.length
    && v.videoUrls.every((url: unknown) => typeof url === 'string' && /^\/(api\/project-assets\/|files\/output\/)/.test(url))
    && Array.isArray(v.assetIds) && v.assetIds.every((item: unknown) => typeof item === 'string')
    && Array.isArray(v.ancestorQuality) && v.request && typeof v.request.prompt === 'string'
    && v.request.model === v.result.model && contract.durations.includes(v.request.duration)
    && contract.ratios.includes(v.request.ratio) && contract.resolutions.includes(v.request.resolution)));
}
export function captureMotionInput(data: Record<string, unknown>, upstreamPrompt = ''): MotionInput {
  if (data.motionOperation === 'revise') {
    const base = motionVersions(data.motionVersions).find(v => v.id === data.motionBaseVersionId);
    if (!base) throw new Error('请选择一个已完成的代码动画版本 / Select a completed animation version');
    const instruction = string(data.motionRevisionInstruction).trim();
    if (!instruction) throw new Error('请填写修改要求 / Enter revision instructions');
    const request: MotionRequest = { ...structuredClone(base.request), operation: 'revise', connectionRef: base.result.connectionRef,
      motion: { ...base.request.motion, revise_from: base.result.taskId, revision_instruction: instruction } };
    return { schema: MOTION_INPUT_SCHEMA, prompt: request.prompt, request, baseVersionId: base.id,
      ancestorQuality: [...new Set([...base.ancestorQuality, ...(base.result.fallbackScenes.length ? [base.id] : [])])] };
  }
  const prompt = (upstreamPrompt.trim() || string(data.prompt)).trim();
  if (!prompt) throw new Error('请填写动画描述 / Enter an animation description');
  const model = string(data.model) || contract.defaults.model;
  const duration = data.duration ?? 15, ratio = data.ratio ?? '16:9', resolution = data.resolution ?? '720p';
  if (!contract.models.includes(model) || !contract.durations.includes(duration as number)
    || !contract.ratios.includes(ratio as string) || !contract.resolutions.includes(resolution as string)) throw Error('代码动画参数无效 / Invalid animation settings');
  const motion: NonNullable<MotionRequest['motion']> = {};
  for (const [field, key] of [['title', 'motionTitle'], ['subtitle', 'motionSubtitle'], ['signature', 'motionSignature'], ['language', 'motionLanguage']] as const) {
    const value = string(data[key]).trim(); if (value) motion[field] = value;
  }
  const template = string(data.motionTemplate), music = string(data.motionMusic);
  if (template && template !== 'api_default') {
    if (!contract.templates.some(item => item.id === template)) throw Error('动画风格无效 / Invalid animation style');
    motion.template_id = template;
  }
  if (music && music !== 'api_default') {
    if (!contract.music.includes(music)) throw Error('配乐选项无效 / Invalid music option');
    motion.music = music;
  }
  const keywords = string(data.motionKeywords).split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  if (keywords.length) motion.keywords = keywords;
  const request: MotionRequest = { model, operation: 'generate', prompt, duration: duration as number, ratio: ratio as string, resolution: resolution as string,
    ...(Object.keys(motion).length ? { motion } : {}) };
  return { schema: MOTION_INPUT_SCHEMA, prompt, request, baseVersionId: null, ancestorQuality: [] };
}
export function createMotionVersion(input: MotionInput, result: MotionResult, videoUrls: string[], assetIds: string[] = [], createdAt = Date.now()): MotionVersion {
  return { id: `motion:${result.taskId}`, createdAt, request: structuredClone(input.request), result, videoUrls, assetIds,
    baseVersionId: input.baseVersionId, ancestorQuality: input.ancestorQuality, review: 'unreviewed' };
}
export function mergeMotionVersions(current: MotionVersion[], incoming: MotionVersion[]): MotionVersion[] {
  const map = new Map(current.map(v => [v.id, v]));
  for (const next of incoming) { const old = map.get(next.id); map.set(next.id, old ? { ...next, review: old.review,
    assetIds: next.assetIds.length ? next.assetIds : old.assetIds } : next); }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}
export function motionOutputPatch(version: MotionVersion) {
  const storyboardText = version.result.storyboard ? JSON.stringify(version.result.storyboard, null, 2) : '';
  const motionAssetRefs = version.videoUrls.map((url, index) => ({ url, assetId: version.assetIds[index] || '' }));
  return { motionSelectedVersionId: version.id, videoUrl: version.videoUrls[0], videoUrls: version.videoUrls,
    sourceAssetId: version.assetIds[0] || '', sourceAssetIds: version.assetIds, motionAssetRefs, metadata: { motionResult: version.result },
    outputs: { video: { videoUrl: version.videoUrls[0], videoUrls: version.videoUrls, sourceAssetIds: version.assetIds, motionAssetRefs, metadata: { motionResult: version.result } },
      storyboard: { outputText: storyboardText, text: storyboardText, texts: storyboardText ? [storyboardText] : [] } } };
}
/** Ordered slots carry stable AssetRefs through routing nodes; full metadata
 * stays on the asset instead of copying every storyboard into every relay. */
export function motionAssetRefs(data: Record<string, any>): Array<{ url: string; assetId: string }> {
  return Array.isArray(data.motionAssetRefs) ? data.motionAssetRefs.filter((item: any) => item && typeof item.assetId === 'string'
    && typeof item.url === 'string' && /^\/(api\/project-assets\/|files\/output\/)/.test(item.url)) : [];
}
export function motionSlotVideos(videos: string[], refs: Array<{ url: string }>) {
  if (!refs.length) return videos;
  const urls = new Set(refs.map(ref => ref.url)), first = videos.findIndex(url => urls.has(url));
  if (first < 0) return videos;
  return [...videos.slice(0, first), ...refs.map(ref => ref.url), ...videos.slice(first).filter(url => !urls.has(url))];
}
export function motionScenes(result: MotionResult | undefined) {
  const scenes = result?.storyboard?.scenes;
  if (!Array.isArray(scenes)) return [];
  let time = 0;
  return scenes.slice(0, 256).map((raw: unknown, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const duration = Number(item.duration ?? item.duration_seconds);
    const start = time; if (Number.isFinite(duration) && duration > 0) time += duration;
    const title = string(item.title) || string(item.text) || string(item.name);
    return { index, id: string(item.id), title, start, end: time, details: JSON.stringify(item, null, 2) };
  });
}
