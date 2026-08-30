import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const openaiCompatible = require('../backend/src/providers/openaiCompatible.js');
const { providerSubmissionContextMiddleware } = require('../backend/src/services/providerSubmissionContext.js');

function runWithSubmission<T>(key: string, callback: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    providerSubmissionContextMiddleware({
      get(name: string) {
        return String(name).toLowerCase() === 'x-t8-provider-submission' ? key : '';
      },
    }, {}, () => {
      Promise.resolve().then(callback).then(resolve, reject);
    });
  });
}

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test('OpenAI compatible adapter forwards a parent AbortSignal to a hanging LLM request', async () => {
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    chatModels: ['gpt-4o-mini'],
  };
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const pending = openaiCompatible.generateChat(provider, { prompt: 'stop me' }, {
    signal: controller.signal,
    timeoutMs: 5_000,
    fetchImpl: (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      observedSignal = init.signal as AbortSignal;
      if (observedSignal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      observedSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  controller.abort(new Error('test-client-stop'));
  const result = await pending;
  assert.equal(observedSignal?.aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request_aborted');
});

test('OpenAI compatible chat posts to chat/completions and normalizes assistant text', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-secret',
    chatModels: ['gpt-4o-mini'],
  };

  const result = await openaiCompatible.generateChat(provider, {
    prompt: 'hello',
    temperature: 0.25,
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        choices: [
          { message: { content: 'world' } },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'llm');
  assert.equal(result.text, 'world');
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].body.model, 'gpt-4o-mini');
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(calls[0].body.temperature, 0.25);
});

test('OpenAI compatible chat forwards bounded JSON response and reasoning controls', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-secret',
    chatModels: ['structured-model'],
  };

  const result = await openaiCompatible.generateChat(provider, {
    model: 'structured-model',
    prompt: 'return JSON',
    responseFormat: { type: 'json_object', ignored: 'must-not-forward' },
    reasoningEffort: 'low',
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.equal(calls[0].body.reasoning_effort, 'low');
});

test('OpenAI compatible writes inherit the lifecycle submission key without changing auth headers', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-secret',
    chatModels: ['gpt-4o-mini'],
  };

  const result = await runWithSubmission('attempt-openai-0001', () => (
    openaiCompatible.generateChat(provider, {
      prompt: 'stable request',
    }, {
      fetchImpl: async (url: string, init: any) => {
        calls.push({ url, init });
        return jsonResponse({
          choices: [
            { message: { content: 'stable response' } },
          ],
        });
      },
    })
  ));

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'attempt-openai-0001');
});

test('OpenAI compatible chat preserves remote video_url multimodal parts', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    chatModels: ['gpt-4o-mini'],
  };

  const result = await openaiCompatible.generateChat(provider, {
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe motion' },
        { type: 'video_url', video_url: { url: 'https://cdn.example.com/clip.mp4' } },
      ],
    }],
    llmVideoMode: 'compressed-base64',
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ choices: [{ message: { content: 'moving' } }] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'moving');
  assert.equal(calls[0].body.messages[0].content[1].type, 'video_url');
  assert.equal(calls[0].body.messages[0].content[1].video_url.url, 'https://cdn.example.com/clip.mp4');
});

test('OpenAI compatible chat consumes upstream SSE deltas without replaying or trimming content', async () => {
  const calls: any[] = [];
  const deltas: string[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    chatModels: ['gpt-stream'],
  };
  const payload = [
    'data: {"id":"chatcmpl-stream-body-1","model":"gpt-stream","choices":[{"delta":{"content":"第一段"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"，继续"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"\\n第二行"}}]}\n\n',
    'data: {"model":"gpt-stream","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const encoded = new TextEncoder().encode(payload);
  const boundaries = [1, 7, 19, 34, 51, 93, 137, encoded.length];

  const result = await openaiCompatible.generateChat(provider, {
    prompt: 'stream it',
    model: 'gpt-stream',
    stream: true,
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      let offset = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const end = boundaries.shift();
          if (end == null) {
            controller.close();
            return;
          }
          controller.enqueue(encoded.slice(offset, end));
          offset = end;
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'x-request-id': 'req-stream-1',
        },
      });
    },
    onDelta: async (delta: string) => {
      deltas.push(delta);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'llm');
  assert.equal(result.text, '第一段，继续\n第二行');
  assert.deepEqual(deltas, ['第一段', '，继续', '\n第二行']);
  assert.equal(result.model, 'gpt-stream');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.eventCount, 4);
  assert.equal(result.requestId, 'chatcmpl-stream-body-1');
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].init.headers.Accept, 'text/event-stream');
});
test('OpenAI compatible image generation normalizes url and b64_json results', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    imageModels: ['gpt-image-1'],
  };

  const result = await openaiCompatible.generateImage(provider, {
    prompt: 'a tiny penguin',
    size: '1024x1024',
    n: 2,
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        data: [
          { url: 'https://cdn.example.com/penguin.png' },
          { b64_json: 'QUJD', mime_type: 'image/png' },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'image');
  assert.deepEqual(result.imageUrls, [
    'https://cdn.example.com/penguin.png',
    'data:image/png;base64,QUJD',
  ]);
  assert.equal(calls[0].url, 'https://api.example.com/v1/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].body.model, 'gpt-image-1');
  assert.equal(calls[0].body.prompt, 'a tiny penguin');
  assert.equal(calls[0].body.size, '1024x1024');
  assert.equal(calls[0].body.n, 2);
});

test('OpenAI compatible image edit posts reference images to images/edits as multipart form data', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    imageModels: ['gpt-image-1'],
  };

  const result = await openaiCompatible.generateImage(provider, {
    prompt: 'make it neon',
    size: '1024x1024',
    n: 1,
    images: [],
    referenceImages: ['data:image/png;base64,QUJD'],
  }, {
    fetchImpl: async (url: string, init: any) => {
      const body = init.body;
      calls.push({
        url,
        init,
        model: body.get('model'),
        prompt: body.get('prompt'),
        size: body.get('size'),
        imageCount: body.getAll('image').length,
        image: body.get('image'),
      });
      return jsonResponse({
        data: [
          { url: 'https://cdn.example.com/edited.png' },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'image');
  assert.deepEqual(result.imageUrls, ['https://cdn.example.com/edited.png']);
  assert.equal(calls[0].url, 'https://api.example.com/v1/images/edits');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
  assert.equal(calls[0].model, 'gpt-image-1');
  assert.equal(calls[0].prompt, 'make it neon');
  assert.equal(calls[0].size, '1024x1024');
  assert.equal(calls[0].imageCount, 1);
  assert.equal(calls[0].image.name, 'reference-1.png');
  assert.equal(calls[0].image.type, 'image/png');
});

test('OpenAI compatible Agnes image edit uses Agnes generations JSON shape', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'openai-compatible',
    label: 'Agnes via OpenAI compatible',
    protocol: 'openai-compatible',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    imageModels: ['agnes-image-2.1-flash'],
  };

  const result = await openaiCompatible.generateImage(provider, {
    prompt: 'make the cup matte red',
    model: 'agnes-image-2.1-flash',
    size: '1024x768',
    response_format: 'url',
    referenceImages: ['data:image/png;base64,QUJD'],
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        data: [
          { url: 'https://cdn.example.com/agnes-edited.png' },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://cdn.example.com/agnes-edited.png']);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, {
    model: 'agnes-image-2.1-flash',
    prompt: 'make the cup matte red',
    size: '1024x768',
    extra_body: {
      image: ['data:image/png;base64,QUJD'],
      response_format: 'url',
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'response_format'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'tags'), false);
});

test('OpenAI compatible video generation posts to video endpoint and normalizes returned media urls', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    videoModels: ['video-model'],
  };

  const result = await openaiCompatible.generateVideo(provider, {
    prompt: 'a quick pass',
    model: 'video-model',
    aspect_ratio: '16:9',
    duration: 6,
    resolution: '720p',
    images: ['data:image/png;base64,AAA'],
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        data: {
          video_url: 'https://cdn.example.com/video.mp4',
          task_id: 'vid-1',
        },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.deepEqual(result.videoUrls, ['https://cdn.example.com/video.mp4']);
  assert.equal(result.taskId, 'vid-1');
  assert.equal(calls[0].url, 'https://api.example.com/v1/videos/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.equal(calls[0].body.model, 'video-model');
  assert.equal(calls[0].body.prompt, 'a quick pass');
  assert.equal(calls[0].body.aspect_ratio, '16:9');
  assert.equal(calls[0].body.duration, 6);
  assert.deepEqual(calls[0].body.images, ['data:image/png;base64,AAA']);
});
