import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const volcengine = require('../backend/src/providers/volcengine.js');

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

test('Volcengine image generation posts Seedream-style payload to Ark images endpoint', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'Bearer ark-secret',
    imageModels: ['doubao-seedream-4-0-250828'],
  };

  const result = await volcengine.generateImage(provider, {
    prompt: 'court',
    size: '1344x768',
    images: ['data:image/png;base64,AAA'],
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ data: [{ url: 'https://volc.example.com/out.png' }] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ark-secret');
  assert.equal(calls[0].body.model, 'doubao-seedream-4-0-250828');
  assert.equal(calls[0].body.size, '1344x768');
  assert.deepEqual(calls[0].body.image, ['data:image/png;base64,AAA']);
  assert.deepEqual(result.imageUrls, ['https://volc.example.com/out.png']);
});

test('Volcengine video generation submits content array and polls returned task id', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-fast-260128'],
  };

  const result = await volcengine.generateVideo(provider, {
    prompt: 'pass the ball',
    model: 'doubao-seedance-2-0-fast-260128',
    aspect_ratio: '16:9',
    duration: 5,
    resolution: '720p',
    images: ['data:image/png;base64,AAA'],
    providerParams: {
      frameMode: 'first',
      generate_audio: true,
      return_last_frame: true,
      watermark: true,
    },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (init.method === 'POST') {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ id: 'task-123' });
      }
      calls.push({ url, init });
      return jsonResponse({ status: 'SUCCESS', data: { video_url: 'https://volc.example.com/out.mp4' } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  assert.equal(calls[0].body.model, 'doubao-seedance-2-0-fast-260128');
  assert.equal(calls[0].body.duration, 5);
  assert.equal(calls[0].body.resolution, '720p');
  assert.equal(calls[0].body.generate_audio, true);
  assert.equal(calls[0].body.return_last_frame, true);
  assert.equal(calls[0].body.watermark, true);
  assert.equal(calls[0].body.content[0].type, 'text');
  assert.equal(calls[0].body.content[1].type, 'image_url');
  assert.equal(calls[0].body.content[1].role, 'first_frame');
  assert.match(calls[1].url, /\/contents\/generations\/tasks\/task-123$/);
  assert.deepEqual(result.videoUrls, ['https://volc.example.com/out.mp4']);
});

test('Volcengine video generation explains ModelNotOpen 404 as model activation issue', async () => {
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-260128'],
  };

  const result = await volcengine.generateVideo(provider, {
    prompt: 'cat waves',
    model: 'doubao-seedance-2-0-260128',
    duration: 4,
    resolution: '480p',
  }, {
    fetchImpl: async () => jsonResponse({
      error: {
        code: 'ModelNotOpen',
        message: 'Your account has not activated the model doubao-seedance-2-0-260128. Please activate the model service in the Ark Console.',
        type: 'Not Found',
      },
    }, 404),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'model_not_open');
  assert.match(result.error, /火山方舟模型未开通/);
  assert.match(result.error, /doubao-seedance-2-0-260128/);
  assert.match(result.error, /控制台开通/);
});

test('Volcengine image generation explains ModelNotOpen 404 as model activation issue', async () => {
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    imageModels: ['doubao-seedream-4-0-250828'],
  };

  const result = await volcengine.generateImage(provider, {
    prompt: 'cat',
    model: 'doubao-seedream-4-0-250828',
  }, {
    fetchImpl: async () => jsonResponse({
      error: {
        code: 'ModelNotOpen',
        message: 'Your account has not activated the model doubao-seedream-4-0-250828.',
      },
    }, 404),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'model_not_open');
  assert.match(result.error, /火山方舟模型未开通/);
});

test('Volcengine video generation normalizes Ark root base URL and multimodal references', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-260128'],
  };

  const result = await volcengine.generateVideo(provider, {
    prompt: 'woman eating melon',
    model: 'doubao-seedance-2-0-260128',
    ratio: '16:9',
    duration: '5s',
    resolution: 'native1080p',
    images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
    videos: ['data:video/mp4;base64,VVV'],
    audios: ['data:audio/mpeg;base64,AAA'],
    providerParams: { frameMode: 'firstlast' },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (init.method === 'POST') {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ task_id: 'task-root' });
      }
      calls.push({ url, init });
      return jsonResponse({ data: { status: 'succeeded', output: { videos: ['https://volc.example.com/root.mp4'] } } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  assert.match(calls[1].url, /^https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3\/contents\/generations\/tasks\/task-root$/);
  assert.equal(calls[0].body.duration, 5);
  assert.equal(calls[0].body.resolution, '1080p');
  assert.equal(calls[0].body.content[1].role, 'first_frame');
  assert.equal(calls[0].body.content[2].role, 'last_frame');
  assert.equal(calls[0].body.content[3].type, 'video_url');
  assert.equal(calls[0].body.content[3].role, 'reference_video');
  assert.equal(calls[0].body.content[4].type, 'audio_url');
  assert.equal(calls[0].body.content[4].role, 'reference_audio');
  assert.deepEqual(result.videoUrls, ['https://volc.example.com/root.mp4']);
});

test('Volcengine generation preserves strict asset:// references for Ark private assets', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-fast-260128'],
  };
  const result = await volcengine.generateVideo(provider, {
    prompt: 'private asset reference',
    model: 'doubao-seedance-2-0-fast-260128',
    images: ['Asset://asset-AbC_123'],
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (init.method === 'POST') {
        calls.push(JSON.parse(init.body));
        return jsonResponse({ id: 'asset-task' });
      }
      return jsonResponse({ status: 'SUCCESS', data: { video_url: 'https://volc.example.com/asset.mp4' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].content[1].image_url.url, 'asset://asset-AbC_123');
});

test('Volcengine video generation extracts nested Ark task content video URL', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-fast-260128'],
  };

  const result = await volcengine.generateVideo(provider, {
    prompt: 'woman dances',
    model: 'doubao-seedance-2-0-fast-260128',
    ratio: '16:9',
    duration: 4,
    resolution: '480p',
    images: ['https://input.example.com/ref.png'],
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (init.method === 'POST') {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({
          id: 'task-nested',
          content: [{ type: 'image_url', image_url: { url: 'https://input.example.com/ref.png' } }],
        });
      }
      calls.push({ url, init });
      return jsonResponse({
        data: {
          task_status: 'SUCCESS',
          result: {
            content: {
              video_url: { url: 'https://volc.example.com/nested.mp4' },
            },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.videoUrls, ['https://volc.example.com/nested.mp4']);
});

test('Volcengine video generation extracts URLs embedded in task content strings', async () => {
  const provider = {
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret',
    videoModels: ['doubao-seedance-2-0-fast-260128'],
  };

  const result = await volcengine.generateVideo(provider, {
    prompt: 'robot waves',
    model: 'doubao-seedance-2-0-fast-260128',
    duration: 4,
    resolution: '480p',
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (_url: string, init: any = {}) => {
      if (init.method === 'POST') return jsonResponse({ id: 'task-json-string' });
      return jsonResponse({
        data: {
          status: 'SUCCEEDED',
          content: '{"image_url":{"url":"https://input.example.com/ref.png"},"mp4_url":"https://volc.example.com/from-string.mp4"}',
        },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.videoUrls, ['https://volc.example.com/from-string.mp4']);
});

test('Volcengine testProvider rejects Access Key ID in Ark API Key field without probing network', async () => {
  let called = false;
  const result = await volcengine.testProvider({
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'AKLTFAKEACCESSKEYID1234567890',
  }, {
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'credential_type_mismatch');
  assert.match(result.error, /方舟 Ark API Key/);
  assert.match(result.error, /Access Key ID/);
});

test('Volcengine testProvider explains AK/SK-only configuration separately from generation key', async () => {
  const result = await volcengine.testProvider({
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    volcengineConfig: {
      accessKeyId: 'AKLTFAKEACCESSKEYID1234567890',
      secretAccessKey: 'fake-secret-access-key',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'aksk_configured');
  assert.match(result.message, /AK\/SK/);
  assert.match(result.message, /方舟 Ark API Key/);
});

test('Volcengine testProvider adds credential guidance to Ark 401 responses', async () => {
  const result = await volcengine.testProvider({
    id: 'volcengine',
    protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'wrong-ark-key',
  }, {
    fetchImpl: async () => jsonResponse({ error: { message: 'Unauthorized' } }, 401),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'auth_failed');
  assert.match(result.error, /Access Key ID/);
  assert.match(result.error, /生成接口必须使用 Ark API Key/);
});
