import contract from '../../backend/src/shared/klingV4Contract.json';
import { submitKling, queryKling } from '../services/generation';
import { minimumProviderMediaPollCount } from './providerTimeoutPolicy';
import { waitForMotionPoll } from './executeMotionVideo';
import type { RunNodeLifecycleReporter } from '../types/project';
export { contract as KLING_V4 };
export const isKlingV4Model = (model: string) => contract.models.includes(model);
export const isKlingV4Aux = (model: string) => contract.auxiliaryModels.includes(model);
export function klingV4List(value: unknown): string[] {
  if (value == null || value === '') return [];
  const parsed = typeof value === 'string' ? value.trim().startsWith('[') ? JSON.parse(value) : value.split(/\r?\n/).filter(v => v.trim()) : value;
  if (!Array.isArray(parsed) || parsed.some(v => typeof v !== 'string' || !v.trim())) throw Error('ID/URL需要逐行填写或JSON字符串数组 / Use one ID or URL per line');
  return parsed.map(v => v.trim());
}
export function klingV4Reference(value: string) {
  try { const data = JSON.parse(value); return data?.schema === contract.referenceSchema && contract.auxiliaryModels.includes(data.model)
    && [data.elementId, data.voiceId].filter(Boolean).every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(id))
    && (data.model.endsWith('element') ? data.elementId && contract.referenceTypes.includes(data.referenceType) : data.voiceId) ? data : null; } catch { return null; }
}
export function klingV4Settings(request: Record<string, any>) {
  const fields: Record<string, string> = { duration:'Duration', resolution:'Resolution', ratio:'Ratio', watermark:'Watermark', videoUrlsText:'VideoUrls', imageElementIds:'ImageElementIds', videoElementIds:'VideoElementIds', voiceIds:'VoiceIds', elementName:'ElementName', referenceType:'ReferenceType', elementVoiceId:'ElementVoiceId', tagList:'Tags', voiceName:'VoiceName', voiceSource:'VoiceSource', audioUrl:'AudioUrl', videoId:'VideoId' };
  const out: Record<string, string | number> = {};
  // Parameter-only history restoration never overwrites current references/IDs.
  const references = new Set(['videoUrlsText','imageElementIds','videoElementIds','voiceIds','elementVoiceId','audioUrl','videoId']);
  for (const [from,to] of Object.entries(fields)) if (request[from] != null && !references.has(from)) out[`klingV4${to}`] = Array.isArray(request[from]) ? request[from].join('\n') : request[from];
  return out;
}
export function captureKlingV4(data: Record<string, any>, model: string, prompt: string, media: { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] }, referenceTexts: string[] = []) {
  const references = referenceTexts.map(klingV4Reference).filter(Boolean);
  const linked = (kind: 'image' | 'video' | 'voice') => [...new Set(references.flatMap(ref => kind === 'voice' ? ref.voiceId ? [ref.voiceId] : []
    : ref.elementId && (kind === 'video' ? ref.referenceType === 'video_refer' : ref.referenceType !== 'video_refer') ? [ref.elementId] : []))];
  const request: Record<string, any> = { model, prompt };
  if (contract.videoModels.includes(model)) Object.assign(request, {
    duration: data.klingV4Duration ?? 3, resolution: data.klingV4Resolution || '720p', ratio: data.klingV4Ratio || '16:9', watermark: data.klingV4Watermark || 'api_default',
    images: media.imageUrls, videos: media.videoUrls,
    ...(model === 'kling-v4-omni' ? { videoUrlsText: data.klingV4VideoUrls || '', imageElementIds: [...klingV4List(data.klingV4ImageElementIds), ...linked('image')],
      videoElementIds: [...klingV4List(data.klingV4VideoElementIds), ...linked('video')], voiceIds: [...klingV4List(data.klingV4VoiceIds), ...linked('voice')] } : {}),
  });
  else if (model === 'kling-v4-custom-element') {
    const voices = [...new Set([String(data.klingV4ElementVoiceId || '').trim(), ...linked('voice')].filter(Boolean))];
    if (voices.length > 1) throw Error('一个主体只能关联一个音色ID / An element can use one voice ID');
    Object.assign(request, { elementName: data.klingV4ElementName || '', referenceType: data.klingV4ReferenceType || 'image_refer',
      images: media.imageUrls, videos: media.videoUrls, videoUrlsText: data.klingV4ElementVideoUrl || '', elementVoiceId: voices[0] || '', tagList: data.klingV4Tags || '' });
  }
  else if (model === 'kling-v4-custom-voice') {
    if (media.audioUrls.length > 1 || media.audioUrls.length && data.klingV4AudioUrl?.trim()) throw Error('请选择一个音频来源 / Choose one audio source');
    Object.assign(request, { voiceName: data.klingV4VoiceName || '', voiceSource: data.klingV4VoiceSource || 'audio',
      audioUrl: data.klingV4VoiceSource === 'video_id' ? '' : media.audioUrls[0] || data.klingV4AudioUrl || '',
      videoId: data.klingV4VoiceSource === 'video_id' ? data.klingV4VideoId || '' : '', images: media.imageUrls, videos: media.videoUrls });
  } else throw Error('Kling 4模型无效 / Invalid Kling 4 model');
  if (model !== 'kling-v4-custom-voice' && media.audioUrls.length) throw Error('此模型需要音色ID，不接受直接音频 / Use a voice ID instead of raw audio');
  return structuredClone(request);
}
export interface KlingV4Pending { taskId: string; model: string; request: Record<string, any>; }
export function readKlingV4Pending(value: any): KlingV4Pending | null {
  if (value == null) return null;
  if (!isKlingV4Model(value.model) || value.request?.model !== value.model || !/^[A-Za-z0-9._:-]{1,512}$/.test(value.taskId || '')) throw Error('原任务身份不完整，不会重新提交 / Incomplete task identity; submission blocked');
  return structuredClone(value);
}
export async function executeKlingV4(request: Record<string, any>, reporter: RunNodeLifecycleReporter, callbacks: {
  pending: (value: KlingV4Pending) => void; stage: (value: string) => void;
}, resume?: unknown) {
  let pending = readKlingV4Pending(resume), signal = reporter.signal;
  signal?.throwIfAborted();
  if (!pending) {
    let result;
    try { result = await submitKling(request as any, { signal, submissionKey: reporter.providerSubmissionKey || undefined }); }
    catch (error) { const e = error as Error & { status?: number; httpStatus?: number; klingV4AcceptanceUnknown?: boolean };
      const status = Number(e.status || e.httpStatus); e.klingV4AcceptanceUnknown = !status || status >= 500 || [408,429].includes(status); throw error; }
    pending = { taskId: result.taskId, model: request.model, request: structuredClone(request) }; callbacks.pending(pending);
  }
  const recovery = { kind: 'kling', taskId: pending.taskId, model: pending.model, referenceType: pending.request.referenceType, pollIntervalMs: 3000, maxPolls: minimumProviderMediaPollCount(3000, 400) };
  const trace = { provider: 'seedance-nz', model: pending.model, taskId: pending.taskId };
  await reporter.providerSubmitted({ ...trace, recovery });
  for (let count = 0; count < recovery.maxPolls; count++) {
    if (count) await waitForMotionPoll(3000, signal); signal?.throwIfAborted();
    let result;
    try { result = await queryKling(pending.taskId, pending.model, { signal, referenceType: pending.request.referenceType }); }
    catch (error) { signal?.throwIfAborted(); const status = Number((error as any).status || (error as any).httpStatus);
      if (status && status < 500 && ![408,429].includes(status)) throw error; callbacks.stage('query_retry'); continue; }
    await reporter.polling({ ...trace, recovery, pollCount: count + 1, status: result.status });
    if (result.status === 'failed') throw Object.assign(Error(result.failReason || 'Kling 4任务失败 / Task failed'), { klingV4Terminal: true });
    if (result.status !== 'succeeded' || result.recoverable) { callbacks.stage(result.recoverable ? 'saving' : 'generating'); continue; }
    const assets: Array<Record<string, unknown>> = [];
    if (isKlingV4Aux(pending.model)) {
      if (!result.auxiliaryText) throw Error('辅助任务未返回有效ID / Missing reusable ID');
      assets.push({ kind: 'text', text: result.auxiliaryText, filename: 'kling-reference.json', mimeType: 'text/plain' });
      if (result.audioUrl) assets.push({ kind: 'audio', sourceUrl: result.audioUrl, filename: 'kling-voice-preview.wav' });
    } else {
      for (const [index,url] of (result.videoUrls || []).entries()) assets.push({ kind: 'video', sourceUrl: url, filename: `kling-${index + 1}.mp4` });
      if (!assets.length) throw Error('原任务视频尚未保存，请继续查询 / Continue querying to save the original video');
    }
    await reporter.providerResponse({ ...trace, status: 'succeeded' });
    await reporter.output({ status: 'succeeded', assets });
    return { ...result, taskId: pending.taskId, model: pending.model, referenceType: pending.request.referenceType };
  }
  throw Error('等待结束，远端可能仍在运行；请继续查询原任务 / Resume the original task');
}
