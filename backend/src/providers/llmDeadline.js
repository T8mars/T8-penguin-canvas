'use strict';

// One clock survives preparation, headers and the entire response body.
function llmDeadline(timeoutMs, parent) {
  const controller = new AbortController();
  const end = Date.now() + timeoutMs;
  const abort = () => controller.abort(parent.reason || Object.assign(new Error('LLM request cancelled'), { code: 'request_aborted' }));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('LLM 调用超时（最长3分钟），未自动重试。'), { code: 'timeout' })), timeoutMs);
  return {
    signal: controller.signal, end,
    close() { clearTimeout(timer); parent?.removeEventListener('abort', abort); },
    async run(work) {
      if (controller.signal.aborted) throw controller.signal.reason;
      return new Promise((resolve, reject) => {
        const cancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve().then(work).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', cancel));
      });
    },
  };
}

module.exports = { llmDeadline };
