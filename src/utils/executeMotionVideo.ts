import { getMotionConnection, queryMotionVideo, submitMotionVideo } from '../services/generation';
import { minimumProviderMediaPollCount } from './providerTimeoutPolicy';
import type { RunNodeLifecycleReporter } from '../types/project';
import type { MotionInput, MotionPending, MotionResult } from './motionVideo';
import { readMotionPending } from './motionVideo';
export function waitForMotionPoll(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); resolve(); };
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason || new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
export async function executeMotionVideo(input: MotionInput, reporter: RunNodeLifecycleReporter, callbacks: {
  pending: (value: MotionPending) => void; status: (stage: string, progress: number | null) => void;
}, resume?: MotionPending) {
  const signal = reporter.signal;
  signal?.throwIfAborted();
  const transport = { signal, submissionKey: reporter.providerSubmissionKey || undefined };
  let pending = readMotionPending(resume);
  if (pending) input = pending;
  const trace = { provider: 'seedance-nz', model: input.request.model };
  if (!pending) {
    const connection = await getMotionConnection(transport);
    if (!connection.configured) throw Object.assign(Error('请先设置平价小屋 API Key / Configure the budget provider API key'), { code: 'MOTION_CONNECTION_MISSING' });
    await reporter.providerRequest(trace);
    let submitted;
    try { submitted = await submitMotionVideo({ ...input.request, connectionRef: input.request.connectionRef || connection.connectionRef }, transport); }
    catch (error) {
      const value = error as Error & { status?: number; httpStatus?: number; motionAcceptanceUnknown?: boolean };
      const status = Number(value.status || value.httpStatus);
      value.motionAcceptanceUnknown = !status || status >= 500 || [408, 429].includes(status);
      throw error;
    }
    pending = { ...structuredClone(input), taskId: submitted.taskId, connectionRef: submitted.connectionRef,
      runId: reporter.runContext?.runId, nodeRunId: reporter.nodeRunId || undefined };
    // Preserve the accepted identity even if the following durable write fails.
    callbacks.pending(pending);
  }
  const recovery = { version: 1, kind: 'motion', taskId: pending.taskId, model: input.request.model,
    connectionRef: pending.connectionRef, pollIntervalMs: 3000, maxPolls: minimumProviderMediaPollCount(3000, 400) };
  await reporter.providerSubmitted({ ...trace, taskId: pending.taskId, connectionRef: pending.connectionRef, recovery, resumed: Boolean(resume) });
  for (let count = 0; count < recovery.maxPolls; count++) {
    signal?.throwIfAborted();
    if (count) await waitForMotionPoll(recovery.pollIntervalMs, signal);
    let result;
    try { result = await queryMotionVideo(pending.taskId, input.request.model, pending.connectionRef, transport); }
    catch (error) {
      signal?.throwIfAborted();
      const status = Number((error as { status?: number; httpStatus?: number }).status || (error as { httpStatus?: number }).httpStatus);
      if (status && status < 500 && ![408, 429].includes(status)) throw error;
      callbacks.status('query_retry', null);
      await reporter.polling({ ...trace, taskId: pending.taskId, recovery, pollCount: count + 1, status: 'query_retry' });
      continue;
    }
    callbacks.status(result.stage || result.status, result.progress);
    await reporter.polling({ ...trace, taskId: pending.taskId, recovery, pollCount: count + 1, status: result.status });
    if (result.status === 'failed') throw Object.assign(Error(result.failReason || '代码动画生成失败 / Animation failed'), { motionTerminal: true });
    if (result.status !== 'succeeded') continue;
    if (!result.videoUrls?.length) throw Error('视频已完成但尚未保存，请继续查询原任务 / Continue checking the original task to save the video');
    await reporter.providerResponse({ ...trace, taskId: pending.taskId, status: 'succeeded', outputCount: result.videoUrls.length });
    await reporter.output({ status: 'succeeded', assets: result.videoUrls.map((sourceUrl, i) => ({
      kind: 'video', sourceUrl, filename: `motion-${i + 1}.mp4`, mimeType: 'video/mp4',
    })) });
    return { result: result.motionResult as MotionResult, videoUrls: result.videoUrls, input: pending };
  }
  throw Error('等待已结束，服务端可能仍在生成；请继续查询原任务 / Waiting ended; the server may still be working. Resume the original task.');
}
