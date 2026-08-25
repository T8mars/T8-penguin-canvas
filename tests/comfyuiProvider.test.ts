import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const comfyui = require('../backend/src/providers/comfyui.js');
const {
  analyzeComfyWorkflow,
  buildComfyWorkflowImportChecklist,
  canonicalizeComfyFieldsByWorkflow,
  compactComfyFields,
  createComfyFieldExcludeRulesBackup,
  createBasicComfyTextToImageWorkflow,
  filterComfyFieldsByExcludeRules,
  parseComfyFieldExcludeRules,
  parseComfyFieldExcludeRulesBackup,
} = await import('../src/utils/comfyuiWorkflow.ts');
const {
  buildComfyAppFromWorkflow,
  comfyAppInputRequirements,
  normalizeComfyAppManifest,
  paramsToProviderParams,
} = await import('../src/utils/comfyuiApps.ts');
function createCustomComfyWorkflow() {
  return {
    '10': {
      class_type: 'WanVideoTextEncode',
      inputs: { positive_prompt: 'old prompt', negative_prompt: 'old negative', clip: ['1', 0] },
    },
    '11': {
      class_type: 'LoadImageMask',
      inputs: { image: 'ref.png', mask: 'mask.png' },
    },
    '12': {
      class_type: 'VHS_LoadVideo',
      inputs: { video: 'clip.mp4', frame_rate: 24 },
    },
    '13': {
      class_type: 'LoadAudio',
      inputs: { audio: 'voice.wav' },
    },
    '14': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'old-control.safetensors' },
    },
    '15': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: 111 },
    },
    '16': {
      class_type: 'WanVideoSampler',
      inputs: { num_frames: 81, fps: 16, guidance: 6, shift: 3 },
    },
    '99': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'ComfyUI', images: ['16', 0] },
    },
  };
}

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'image/png' },
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
    async arrayBuffer() {
      return Buffer.from('PNG').buffer;
    },
  };
}

function fixedNoPromptWorkflow() {
  return {
    '1': {
      class_type: 'SeedVR2Sampler',
      inputs: {
        seed: 123,
        width: 1024,
        height: 576,
        steps: 12,
      },
      _meta: { title: 'SeedVR2 fixed sampler' },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'seedvr2', images: ['1', 0] },
    },
  };
}

function minimalOutputWorkflow() {
  return {
    '1': {
      class_type: 'T8OutputFixture',
      inputs: { text: 'fixture' },
    },
  };
}

test('ComfyUI analyzer does not treat scheduler image sequence fields as media inputs', () => {
  const analysis = analyzeComfyWorkflow({
    '913:8': {
      class_type: 'FlowMatchEulerDiscreteScheduler (Custom)',
      inputs: { base_image_seq_len: 512, max_image_seq_len: 2048, steps: 10 },
    },
    '925': { class_type: 'SaveImage', inputs: { images: ['900', 0] }, _meta: { title: 'Final image' } },
  });

  assert.equal(analysis.imageInputCount, 0);
  assert.equal(analysis.outputCount, 1);
  assert.deepEqual(analysis.outputNodes, [{ nodeId: '925', classType: 'SaveImage', nodeTitle: 'Final image' }]);
});

async function runComfyOutputFixture(outputs: Record<string, any>) {
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [{ id: 'multi-output-fixture', name: 'Multi output fixture', workflowJson: minimalOutputWorkflow() }],
    },
  };
  return comfyui.generateImage(provider, { providerModel: 'multi-output-fixture' }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string) => {
      if (String(url).endsWith('/prompt')) return jsonResponse({ prompt_id: 'multi-output-1' });
      return jsonResponse({
        'multi-output-1': {
          status: { status_str: 'success' },
          outputs,
        },
      });
    },
  });
}

test('ComfyUI accepts video-only, audio-only and text-only workflow outputs', async () => {
  const video = await runComfyOutputFixture({
    '10': { gifs: [{ filename: 'clip.mp4', type: 'output', subfolder: 'video', format: 'video/h264-mp4' }] },
  });
  const audio = await runComfyOutputFixture({
    '11': { audios: [{ filename: 'voice.wav', type: 'output', subfolder: 'audio' }] },
  });
  const textOnly = await runComfyOutputFixture({
    '12': { text: 'caption result' },
  });

  assert.equal(video.ok, true);
  assert.equal(video.kind, 'video');
  assert.deepEqual(video.outputKinds, ['video']);
  assert.match(video.videoUrls[0], /filename=clip\.mp4/);
  assert.equal(audio.ok, true);
  assert.equal(audio.primaryKind, 'audio');
  assert.deepEqual(audio.outputKinds, ['audio']);
  assert.match(audio.audioUrls[0], /filename=voice\.wav/);
  assert.equal(textOnly.ok, true);
  assert.equal(textOnly.primaryKind, 'text');
  assert.deepEqual(textOnly.outputKinds, ['text']);
  assert.equal(textOnly.text, 'caption result');
});

test('ComfyUI reports all mixed output kinds and rejects a completed empty workflow', async () => {
  const mixed = await runComfyOutputFixture({
    '10': { images: [{ filename: 'image.png', type: 'output' }] },
    '11': { videos: [{ filename: 'clip.mp4', type: 'output' }] },
    '12': { audio: [{ filename: 'voice.mp3', type: 'output' }] },
    '13': { texts: ['line one', 'line two'] },
  });
  const empty = await runComfyOutputFixture({});

  assert.equal(mixed.ok, true);
  assert.equal(mixed.primaryKind, 'image');
  assert.deepEqual(mixed.outputKinds, ['image', 'video', 'audio', 'text']);
  assert.equal(mixed.text, 'line one\nline two');
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'empty_output');
  assert.match(empty.error, /没有返回图片、视频、音频或文本/);
});

test('ComfyUI output whitelist collects only selected workflow nodes', async () => {
  const raw = {
    selected: {
      outputs: {
        '925': { images: [{ filename: 'final.png', type: 'output' }] },
        '913:122': { images: [{ filename: 'preview.png', type: 'temp' }] },
      },
    },
  };
  const all = comfyui.collectComfyOutputs(raw, 'selected', 'http://127.0.0.1:8188');
  const selected = comfyui.collectComfyOutputs(raw, 'selected', 'http://127.0.0.1:8188', ['925']);

  assert.equal(all.imageUrls.length, 2);
  assert.equal(selected.imageUrls.length, 1);
  assert.match(selected.imageUrls[0], /filename=final\.png/);
});

test('ComfyUI generation applies the workflow output-node whitelist end to end', async () => {
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [{
        id: 'selected-output-workflow',
        name: 'Selected output workflow',
        workflowJson: minimalOutputWorkflow(),
        outputNodeIds: ['925'],
      }],
    },
  };
  const result = await comfyui.generateImage(provider, { providerModel: 'selected-output-workflow' }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string) => {
      if (String(url).endsWith('/prompt')) return jsonResponse({ prompt_id: 'selected-output-pid' });
      return jsonResponse({
        'selected-output-pid': {
          outputs: {
            '925': { images: [{ filename: 'final.png', type: 'output' }] },
            '913:122': { images: [{ filename: 'preview.png', type: 'temp' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.imageUrls.length, 1);
  assert.match(result.imageUrls[0], /filename=final\.png/);
});

test('ComfyUI heuristic patch preserves linked width height and seed inputs', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [{
        id: 'linked-values',
        name: 'Linked values',
        workflowJson: {
          '1': { class_type: 'GetImageSize+', inputs: { image: ['0', 0] } },
          '2': { class_type: 'ImageResize+', inputs: { width: ['1', 0], height: ['1', 1], image: ['0', 0] } },
          '3': { class_type: 'KSampler', inputs: { seed: ['4', 0], steps: 20 } },
          '9': { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
        },
      }],
    },
  };

  const result = await comfyui.generateImage(provider, {
    providerModel: 'linked-values',
    size: '1024x768',
    providerParams: { seed: 999 },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/prompt')) {
        calls.push(JSON.parse(init.body));
        return jsonResponse({ prompt_id: 'linked-pid' });
      }
      return jsonResponse({ 'linked-pid': { outputs: { '9': { images: [{ filename: 'linked.png', type: 'output' }] } } } });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].prompt['2'].inputs.width, ['1', 0]);
  assert.deepEqual(calls[0].prompt['2'].inputs.height, ['1', 1]);
  assert.deepEqual(calls[0].prompt['3'].inputs.seed, ['4', 0]);
});

test('ComfyUI testProvider rejects remote base url by default', async () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  const previousPrivate = process.env.T8_COMFYUI_ALLOW_PRIVATE;
  delete process.env.T8_COMFYUI_ALLOW_REMOTE;
  delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
  let fetched = false;
  try {
    const result = await comfyui.testProvider({
      id: 'comfyui',
      protocol: 'comfyui',
      baseUrl: 'https://comfyui.example.test:8188',
    }, {
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({});
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'non_local_comfyui');
    assert.equal(fetched, false);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
    if (previousPrivate === undefined) delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
    else process.env.T8_COMFYUI_ALLOW_PRIVATE = previousPrivate;
  }
});

test('ComfyUI testProvider allows remote base url when provider high-risk switch is enabled', async () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  const previousPrivate = process.env.T8_COMFYUI_ALLOW_PRIVATE;
  delete process.env.T8_COMFYUI_ALLOW_REMOTE;
  delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
  const calls: string[] = [];
  try {
    const result = await comfyui.testProvider({
      id: 'comfyui',
      protocol: 'comfyui',
      allowRemote: true,
      baseUrl: 'https://comfyui.example.test:8188',
    }, {
      fetchImpl: async (url: string) => {
        calls.push(String(url));
        return jsonResponse({ queue_running: [], queue_pending: [] });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, 'connected');
    assert.deepEqual(calls, ['https://comfyui.example.test:8188/queue']);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
    if (previousPrivate === undefined) delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
    else process.env.T8_COMFYUI_ALLOW_PRIVATE = previousPrivate;
  }
});

test('ComfyUI testProvider allows remote base url when backend remote access is enabled', async () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  process.env.T8_COMFYUI_ALLOW_REMOTE = '1';
  const calls: string[] = [];
  try {
    const result = await comfyui.testProvider({
      id: 'comfyui',
      protocol: 'comfyui',
      baseUrl: 'https://comfyui.example.test:8188',
    }, {
      fetchImpl: async (url: string) => {
        calls.push(String(url));
        return jsonResponse({ queue_running: [], queue_pending: [] });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, 'connected');
    assert.deepEqual(calls, ['https://comfyui.example.test:8188/queue']);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
  }
});

test('ComfyUI image generation submits to remote base url when backend remote access is enabled', async () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  process.env.T8_COMFYUI_ALLOW_REMOTE = '1';
  const calls: any[] = [];
  try {
    const provider = {
      id: 'comfyui',
      protocol: 'comfyui',
      baseUrl: 'https://comfyui.example.test:8188',
      enabled: true,
      comfyuiConfig: {
        workflows: [
          {
            id: 'remote-workflow',
            name: 'Remote Workflow',
            workflowJson: {
              '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
              '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
            },
            fields: [
              { nodeId: '1', fieldName: 'text', source: 'prompt' },
            ],
          },
        ],
      },
    };

    const result = await comfyui.generateImage(provider, {
      prompt: 'remote prompt',
      providerModel: 'remote-workflow',
    }, {
      pollIntervalMs: 1,
      fetchImpl: async (url: string, init: any = {}) => {
        if (String(url).endsWith('/prompt')) {
          calls.push({ url, init, body: JSON.parse(init.body) });
          return jsonResponse({ prompt_id: 'remote-pid' });
        }
        calls.push({ url, init });
        return jsonResponse({
          'remote-pid': {
            outputs: {
              '9': { images: [{ filename: 'remote-out.png', type: 'output', subfolder: '' }] },
            },
          },
        });
      },
    });

    assert.equal(result.ok, true);
    const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
    assert.equal(String(promptCall.url), 'https://comfyui.example.test:8188/prompt');
    assert.equal(promptCall.body.prompt['1'].inputs.text, 'remote prompt');
    assert.deepEqual(result.imageUrls, [
      'https://comfyui.example.test:8188/view?filename=remote-out.png&type=output&subfolder=',
    ]);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
  }
});

test('ComfyUI image generation patches workflow, submits prompt, polls history and returns view urls', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'workflow-1',
          name: 'Flux Workflow',
          workflowJson: {
            '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
            '2': { class_type: 'KSampler', inputs: { seed: 1 } },
            '3': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
            '4': { class_type: 'LoadImage', inputs: { image: '' } },
          },
          fields: [
            { nodeId: '1', fieldName: 'text', source: 'prompt' },
            { nodeId: '3', fieldName: 'width', source: 'width' },
            { nodeId: '3', fieldName: 'height', source: 'height' },
            { nodeId: '4', fieldName: 'image', source: 'image1' },
          ],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'a court',
    providerModel: 'workflow-1',
    size: '1024x768',
    images: ['/files/input/ref.png'],
  }, {
    baseUrl: 'http://127.0.0.1:18766',
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).includes('/files/input/ref.png')) {
        calls.push({ url, init });
        return jsonResponse({}, 200);
      }
      if (String(url).endsWith('/upload/image')) {
        calls.push({ url, init, upload: true });
        return jsonResponse({ name: 'ref-uploaded.png' });
      }
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-1' });
      }
      calls.push({ url, init });
      return jsonResponse({
        'pid-1': {
          outputs: {
            '9': { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['1'].inputs.text, 'a court');
  assert.equal(promptCall.body.prompt['3'].inputs.width, 1024);
  assert.equal(promptCall.body.prompt['3'].inputs.height, 768);
  assert.equal(promptCall.body.prompt['4'].inputs.image, 'ref-uploaded.png');
  const downloadCall = calls.find((call) => String(call.url).includes('/files/input/ref.png'));
  const uploadCall = calls.find((call) => String(call.url).endsWith('/upload/image'));
  assert.equal(String(downloadCall.url), 'http://127.0.0.1:18766/files/input/ref.png');
  assert.equal(String(uploadCall.url), 'http://127.0.0.1:8188/upload/image');
  assert.deepEqual(result.imageUrls, ['http://127.0.0.1:8188/view?filename=out.png&type=output&subfolder=']);
});

test('ComfyUI field mappings ignore stale value unless source is fixed', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'workflow-stale-values',
          name: 'Workflow With Stale Values',
          workflowJson: {
            '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' } },
            '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
            '3': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
            '4': { class_type: 'CustomNode', inputs: { token: '' } },
            '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
          },
          fields: [
            { nodeId: '1', fieldName: 'text', source: 'prompt', value: 'stale prompt must not win' },
            { nodeId: '2', fieldName: 'width', source: 'width', value: 640 },
            { nodeId: '2', fieldName: 'height', source: 'height', value: 640 },
            { nodeId: '3', fieldName: 'image', source: 'image1', value: 'stale-image.png' },
            { nodeId: '4', fieldName: 'token', source: 'fixed', value: 'keep-fixed-token' },
          ],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'fresh runtime prompt',
    providerModel: 'workflow-stale-values',
    size: '1280x720',
    images: ['/files/input/fresh.png'],
  }, {
    baseUrl: 'http://127.0.0.1:18766',
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).includes('/files/input/fresh.png')) return jsonResponse({}, 200);
      if (String(url).endsWith('/upload/image')) {
        calls.push({ url, init, upload: true });
        return jsonResponse({ name: 'fresh-uploaded.png' });
      }
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-stale' });
      }
      return jsonResponse({
        'pid-stale': {
          outputs: {
            '9': { images: [{ filename: 'fresh-out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['1'].inputs.text, 'fresh runtime prompt');
  assert.equal(promptCall.body.prompt['2'].inputs.width, 1280);
  assert.equal(promptCall.body.prompt['2'].inputs.height, 720);
  assert.equal(promptCall.body.prompt['3'].inputs.image, 'fresh-uploaded.png');
  assert.equal(promptCall.body.prompt['4'].inputs.token, 'keep-fixed-token');
});

test('ComfyUI image generation submits workflows that do not declare a prompt field', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'fixed-seedvr2',
          name: 'Fixed SeedVR2',
          workflowJson: fixedNoPromptWorkflow(),
          fields: [
            { nodeId: '1', fieldName: 'seed', source: 'seed' },
            { nodeId: '1', fieldName: 'width', source: 'width' },
            { nodeId: '1', fieldName: 'height', source: 'height' },
          ],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    providerModel: 'fixed-seedvr2',
    size: '1280x720',
    providerParams: { seed: 456 },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-fixed' });
      }
      return jsonResponse({
        'pid-fixed': {
          outputs: {
            '9': { images: [{ filename: 'fixed.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['1'].inputs.seed, 456);
  assert.equal(promptCall.body.prompt['1'].inputs.width, 1280);
  assert.equal(promptCall.body.prompt['1'].inputs.height, 720);
  assert.deepEqual(result.imageUrls, ['http://127.0.0.1:8188/view?filename=fixed.png&type=output&subfolder=']);
});

test('ComfyUI image generation infers and patches custom workflow fields on submit', async () => {
  const calls: any[] = [];
  let uploadCount = 0;
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'custom-autofields',
          name: 'Custom auto fields',
          workflowJson: createCustomComfyWorkflow(),
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'fresh custom prompt',
    negativePrompt: 'fresh custom negative',
    providerModel: 'custom-autofields',
    size: '832x1216',
    seed: 999,
    images: ['/files/input/ref.png', '/files/input/mask.png'],
    videos: ['/files/input/clip.mp4'],
    audios: ['/files/input/voice.wav'],
    providerParams: {
      control_net_name: 'openpose-control.safetensors',
      frame_rate: 30,
      num_frames: 49,
      fps: 12,
      guidance: 7,
      shift: 2,
    },
  }, {
    baseUrl: 'http://127.0.0.1:18766',
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).includes('/files/input/ref.png') || String(url).includes('/files/input/mask.png')) {
        calls.push({ url, init });
        return jsonResponse({}, 200);
      }
      if (String(url).endsWith('/upload/image')) {
        uploadCount += 1;
        calls.push({ url, init, upload: true });
        return jsonResponse({ name: uploadCount === 1 ? 'ref-uploaded.png' : 'mask-uploaded.png' });
      }
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-custom' });
      }
      return jsonResponse({
        'pid-custom': {
          outputs: {
            '99': { images: [{ filename: 'custom-out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['10'].inputs.positive_prompt, 'fresh custom prompt');
  assert.equal(promptCall.body.prompt['10'].inputs.negative_prompt, 'fresh custom negative');
  assert.equal(promptCall.body.prompt['11'].inputs.image, 'ref-uploaded.png');
  assert.equal(promptCall.body.prompt['11'].inputs.mask, 'mask-uploaded.png');
  assert.equal(promptCall.body.prompt['12'].inputs.video, '/files/input/clip.mp4');
  assert.equal(promptCall.body.prompt['12'].inputs.frame_rate, 30);
  assert.equal(promptCall.body.prompt['13'].inputs.audio, '/files/input/voice.wav');
  assert.equal(promptCall.body.prompt['14'].inputs.control_net_name, 'openpose-control.safetensors');
  assert.equal(promptCall.body.prompt['15'].inputs.noise_seed, 999);
  assert.equal(promptCall.body.prompt['16'].inputs.num_frames, 49);
  assert.equal(promptCall.body.prompt['16'].inputs.fps, 12);
  assert.equal(promptCall.body.prompt['16'].inputs.guidance, 7);
  assert.equal(promptCall.body.prompt['16'].inputs.shift, 2);
});

test('compactComfyFields keeps fixed values but drops stale runtime-source values', () => {
  assert.deepEqual(
    compactComfyFields([
      { nodeId: '1', fieldName: 'text', source: 'prompt', value: 'old prompt' } as any,
      { nodeId: '2', fieldName: 'image', source: 'image1', value: 'old.png' } as any,
      { nodeId: '3', fieldName: 'token', source: 'fixed', value: 'abc' } as any,
      { nodeId: '4', fieldName: 'custom', value: 'manual fixed' } as any,
    ]),
    [
      { nodeId: '1', fieldName: 'text', source: 'prompt' },
      { nodeId: '2', fieldName: 'image', source: 'image1' },
      { nodeId: '3', fieldName: 'token', source: 'fixed', value: 'abc' },
      { nodeId: '4', fieldName: 'custom', source: 'fixed', value: 'manual fixed' },
    ],
  );
});

test('ComfyUI workflow analyzer creates friendly mappings for common API workflow nodes', () => {
  const analysis = analyzeComfyWorkflow({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'Positive Prompt' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'Negative Prompt' } },
    '3': { class_type: 'LoadImage', inputs: { image: '' } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768 } },
    '5': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal' } },
    '6': { class_type: 'SaveImage', inputs: { images: ['x', 0] } },
  });

  assert.equal(analysis.imageInputCount, 1);
  assert.equal(analysis.outputCount, 1);
  assert.deepEqual(
    analysis.fields.map((field) => [field.nodeId, field.fieldName, field.source]),
    [
      ['1', 'text', 'prompt'],
      ['2', 'text', 'negative'],
      ['3', 'image', 'image1'],
      ['4', 'width', 'width'],
      ['4', 'height', 'height'],
      ['5', 'seed', 'seed'],
      ['5', 'steps', 'steps'],
      ['5', 'cfg', 'cfg'],
      ['5', 'sampler_name', 'sampler_name'],
      ['5', 'scheduler', 'scheduler'],
    ],
  );
});

test('ComfyUI workflow analyzer recognizes custom prompt, media, model and timeline fields', () => {
  const analysis = analyzeComfyWorkflow(createCustomComfyWorkflow());
  const sourceByNodeField = new Map(analysis.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));

  assert.equal(sourceByNodeField.get('10.positive_prompt'), 'prompt');
  assert.equal(sourceByNodeField.get('10.negative_prompt'), 'negative');
  assert.equal(sourceByNodeField.get('11.image'), 'image1');
  assert.equal(sourceByNodeField.get('11.mask'), 'image2');
  assert.equal(sourceByNodeField.get('12.video'), 'video1');
  assert.equal(sourceByNodeField.get('12.frame_rate'), 'frame_rate');
  assert.equal(sourceByNodeField.get('13.audio'), 'audio1');
  assert.equal(sourceByNodeField.get('14.control_net_name'), 'control_net_name');
  assert.equal(sourceByNodeField.get('15.noise_seed'), 'seed');
  assert.equal(sourceByNodeField.get('16.num_frames'), 'num_frames');
  assert.equal(sourceByNodeField.get('16.fps'), 'fps');
  assert.equal(sourceByNodeField.get('16.guidance'), 'guidance');
  assert.equal(sourceByNodeField.get('16.shift'), 'shift');
  assert.equal(analysis.imageInputCount, 2);
  assert.equal(analysis.videoInputCount, 1);
  assert.equal(analysis.audioInputCount, 1);
  assert.equal(analysis.outputCount, 1);
});

test('ComfyUI workflow analyzer does not force plain image-named config fields into upstream image inputs', () => {
  const workflow = {
    '1': {
      class_type: 'SeedVR2Sampler',
      inputs: {
        image: 'internal-preview-disabled',
        image_mode: 'none',
        seed: 123,
        steps: 12,
        width: 1024,
        height: 576,
      },
      _meta: { title: 'SeedVR2 fixed sampler' },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'seedvr2', images: ['1', 0] },
    },
  };
  const analysis = analyzeComfyWorkflow(workflow);
  const app = buildComfyAppFromWorkflow({ title: 'SeedVR2 fixed', workflowJson: workflow });
  const sourceByNodeField = new Map(analysis.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));

  assert.equal(analysis.imageInputCount, 0);
  assert.equal(sourceByNodeField.get('1.image'), 'image');
  assert.equal(sourceByNodeField.get('1.image_mode'), 'image_mode');
  assert.deepEqual(comfyAppInputRequirements(app), { images: 0, videos: 0, audios: 0 });
});

test('ComfyUI workflow analyzer ignores display-only text outputs when finding positive prompts', () => {
  const workflow = {
    '3218': {
      class_type: 'LoadImage',
      inputs: { image: 'ComfyUI_00001.png' },
      _meta: { title: '加载图像' },
    },
    '3238': {
      class_type: 'Comfly_gpt_image_2_official_ratio_stable',
      inputs: {
        prompt: '女人在跳舞',
        aspect_ratio: 'custom',
        resolution: '2k',
        api_key: ['3220', 0],
        model: 'gpt-image-2',
        n: 1,
        response_format: 'url',
        image1: ['3218', 0],
      },
      _meta: { title: 'zhenzhen-gpt-image-2-official_ratio_stable' },
    },
    '3239': {
      class_type: 'easy showAnything',
      inputs: {
        text: 'https://webstatic.aiproxy.vip/output/example.png',
        anything: ['3238', 1],
      },
      _meta: { title: '展示任何' },
    },
    '3240': {
      class_type: 'easy showAnything',
      inputs: {
        text: '**Comfly gpt-image-2**\nPrompt: 女人在跳舞\nImage URL: https://example.test/out.png',
        anything: ['3238', 2],
      },
      _meta: { title: '展示任何' },
    },
  };

  const analysis = analyzeComfyWorkflow(workflow);
  const promptFields = analysis.fields
    .filter((field) => field.source === 'prompt' || field.source === 'positive')
    .map((field) => `${field.nodeId}.${field.fieldName}`);
  const sourceByNodeField = new Map(analysis.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));

  assert.deepEqual(promptFields, ['3238.prompt']);
  assert.equal(sourceByNodeField.has('3239.text'), false);
  assert.equal(sourceByNodeField.has('3240.text'), false);
});

test('ComfyUI app builder keeps LIST fields as select params and labels them with node ids', () => {
  const app = buildComfyAppFromWorkflow({
    title: 'Comfly GPT Image',
    workflowJson: {
      '3238': {
        class_type: 'Comfly_gpt_image_2_official_ratio_stable',
        inputs: {
          prompt: '女人在跳舞',
          aspect_ratio: 'custom',
          resolution: '2k',
          quality: {
            value: 'auto',
            options: ['auto', 'low', 'medium', 'high'],
          },
          n: 1,
        },
        input_types: {
          required: {
            aspect_ratio: [['1:1', '16:9', '9:16', 'custom'], { default: 'custom' }],
            resolution: [['1k', '2k', '4k'], { default: '2k' }],
          },
        },
      },
    },
  });

  const resolution = app.userParams.find((param) => param.source === 'resolution');
  const aspectRatio = app.userParams.find((param) => param.source === 'aspect_ratio');
  const quality = app.userParams.find((param) => param.source === 'quality');

  assert.equal(resolution?.kind, 'select');
  assert.deepEqual(resolution?.options, ['1k', '2k', '4k']);
  assert.equal(resolution?.defaultValue, '2k');
  assert.match(resolution?.label || '', /#3238/);
  assert.equal(aspectRatio?.kind, 'select');
  assert.deepEqual(aspectRatio?.options, ['1:1', '16:9', '9:16', 'custom']);
  assert.equal(quality?.kind, 'select');
  assert.deepEqual(quality?.options, ['auto', 'low', 'medium', 'high']);
});

test('ComfyUI app builder scopes duplicated runtime params so one control cannot overwrite another', () => {
  const app = buildComfyAppFromWorkflow({
    title: 'Two LoRA workflow',
    workflowJson: {
      '10': {
        class_type: 'LoraLoader',
        inputs: { lora_name: 'first.safetensors', strength_model: 0.45, strength_clip: 0.55 },
        _meta: { title: 'Foreground LoRA' },
      },
      '11': {
        class_type: 'LoraLoader',
        inputs: { lora_name: 'second.safetensors', strength_model: 0.25, strength_clip: 0.35 },
        _meta: { title: 'Background LoRA' },
      },
      '99': {
        class_type: 'SaveImage',
        inputs: { images: ['11', 0] },
      },
    },
  });

  const loraNameParams = app.userParams.filter((param) => param.fieldName === 'lora_name');
  const strengthParams = app.userParams.filter((param) => param.fieldName === 'strength_model');

  assert.equal(loraNameParams.length, 2);
  assert.equal(strengthParams.length, 2);
  assert.equal(new Set(loraNameParams.map((param) => param.key)).size, 2);
  assert.equal(new Set(loraNameParams.map((param) => param.source)).size, 2);
  assert.equal(new Set(strengthParams.map((param) => param.key)).size, 2);
  assert.equal(new Set(strengthParams.map((param) => param.source)).size, 2);
  assert.ok(loraNameParams.every((param) => /LoRA #1[01]/.test(param.label)));
  assert.ok(strengthParams.every((param) => /LoRA 模型强度 #1[01]/.test(param.label)));

  const sourceByField = new Map(app.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));
  assert.equal(sourceByField.get('10.lora_name'), loraNameParams[0].source);
  assert.equal(sourceByField.get('11.lora_name'), loraNameParams[1].source);
  assert.equal(sourceByField.get('10.strength_model'), strengthParams[0].source);
  assert.equal(sourceByField.get('11.strength_model'), strengthParams[1].source);

  const providerParams = paramsToProviderParams(app, {
    [loraNameParams[0].key]: 'foreground-v2.safetensors',
    [loraNameParams[1].key]: 'background-v2.safetensors',
    [strengthParams[0].key]: 0.7,
    [strengthParams[1].key]: 0.3,
  });

  assert.equal(providerParams[loraNameParams[0].source], 'foreground-v2.safetensors');
  assert.equal(providerParams[loraNameParams[1].source], 'background-v2.safetensors');
  assert.equal(providerParams[strengthParams[0].source], 0.7);
  assert.equal(providerParams[strengthParams[1].source], 0.3);
});

test('ComfyUI app builder collapses shared prompt and size params to one visible control', () => {
  const app = buildComfyAppFromWorkflow({
    title: 'Shared runtime controls',
    workflowJson: {
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry, low resolution, pixelated' },
        _meta: { title: 'Negative Prompt' },
      },
      '34': {
        class_type: 'TiledDiffusion',
        inputs: {
          negative_prompt: 'blurry, low resolution, pixelated',
          width: 512,
          height: 512,
          seed: 123,
          mode_type: 'Linear',
        },
        _meta: { title: 'Tile Settings' },
      },
      '35': {
        class_type: 'AnotherLatentSize',
        inputs: { width: 1024, height: 768, seed: 456 },
        _meta: { title: 'Second Size' },
      },
      '99': {
        class_type: 'SaveImage',
        inputs: { images: ['35', 0] },
      },
    },
  });

  const paramsBySource = new Map<string, number>();
  for (const param of app.userParams) {
    paramsBySource.set(param.source, (paramsBySource.get(param.source) || 0) + 1);
  }

  assert.equal(app.fields.filter((field) => field.source === 'negative').length, 2);
  assert.equal(app.fields.filter((field) => field.source === 'width').length, 2);
  assert.equal(app.fields.filter((field) => field.source === 'height').length, 2);
  assert.equal(app.fields.filter((field) => field.source === 'seed').length, 2);
  assert.equal(paramsBySource.get('negative'), 1);
  assert.equal(paramsBySource.get('width'), 1);
  assert.equal(paramsBySource.get('height'), 1);
  assert.equal(paramsBySource.get('seed'), 1);
  assert.equal(new Set(app.userParams.map((param) => param.key)).size, app.userParams.length);
});

test('ComfyUI app manifest normalization repairs old duplicate param sources without field ids', () => {
  const manifest = normalizeComfyAppManifest({
    schema: 't8-comfyui-app-manifest',
    version: 1,
    categories: [{ id: 'image', name: '图像', order: 1 }],
    apps: [{
      id: 'old-lora-app',
      title: 'Old LoRA App',
      categoryId: 'image',
      workflowJson: {
        '10': { class_type: 'LoraLoader', inputs: { lora_name: 'first.safetensors' } },
        '11': { class_type: 'LoraLoader', inputs: { lora_name: 'second.safetensors' } },
        '99': { class_type: 'SaveImage', inputs: { images: ['11', 0] } },
      },
      fields: [
        { nodeId: '10', fieldName: 'lora_name', source: 'lora_name' },
        { nodeId: '11', fieldName: 'lora_name', source: 'lora_name' },
      ],
      userParams: [
        { key: 'lora-name', label: 'LoRA', kind: 'text', source: 'lora_name', defaultValue: 'first.safetensors' },
        { key: 'lora-name', label: 'LoRA', kind: 'text', source: 'lora_name', defaultValue: 'second.safetensors' },
      ],
      outputs: [{ key: 'image', kind: 'image' }],
    }],
  });

  const app = manifest.apps[0];
  assert.equal(app.userParams.length, 2);
  assert.equal(new Set(app.userParams.map((param) => param.key)).size, 2);
  assert.equal(new Set(app.userParams.map((param) => param.source)).size, 2);
  assert.equal(app.fields[0].source, app.userParams[0].source);
  assert.equal(app.fields[1].source, app.userParams[1].source);

  const providerParams = paramsToProviderParams(app, {
    [app.userParams[0].key]: 'first-fixed.safetensors',
    [app.userParams[1].key]: 'second-fixed.safetensors',
  });
  assert.equal(providerParams[app.userParams[0].source], 'first-fixed.safetensors');
  assert.equal(providerParams[app.userParams[1].source], 'second-fixed.safetensors');
});

test('ComfyUI sample workflow and import checklist guide first-time setup', () => {
  const workflow = createBasicComfyTextToImageWorkflow();
  const analysis = analyzeComfyWorkflow(workflow);
  const checklist = buildComfyWorkflowImportChecklist(workflow, analysis);
  const sourceByNodeField = new Map(analysis.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));

  assert.equal(sourceByNodeField.get('1.ckpt_name'), 'ckpt_name');
  assert.equal(sourceByNodeField.get('2.text'), 'prompt');
  assert.equal(sourceByNodeField.get('3.text'), 'negative');
  assert.equal(analysis.outputCount, 1);
  assert.ok(checklist.some((item) => item.id === 'model' && item.labelKey === 'comfy.checklist.modelCheck'));
  assert.ok(checklist.some((item) => item.id === 'api-format' && item.level === 'ok'));
});

test('ComfyUI workflow analyzer uses sampler links to avoid swapping positive and negative prompt nodes', () => {
  const analysis = analyzeComfyWorkflow({
    '71': {
      class_type: 'KSampler',
      inputs: {
        seed: 528424127902021,
        steps: 40,
        cfg: 4.5,
        sampler_name: 'er_sde',
        scheduler: 'beta',
        denoise: 1,
        positive: ['91', 0],
        negative: ['87', 0],
        latent_image: ['86', 0],
      },
      _meta: { title: 'K采样器' },
    },
    '85': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors' } },
    '86': { class_type: 'EmptyLatentImage', inputs: { width: 1920, height: 1080, batch_size: 1 } },
    '87': { class_type: 'CLIPTextEncode', inputs: { text: 'bad anatomy', clip: ['85', 0] }, _meta: { title: 'CLIP文本编码' } },
    '88': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['90', 0] } },
    '91': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece', clip: ['85', 0] }, _meta: { title: 'CLIP文本编码' } },
    '94': { class_type: 'AnimaBoosterLoader', inputs: { model_name: 'anima-base-v1.0.safetensors' } },
    '95': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
  });

  const sourceByNodeField = new Map(analysis.fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));
  assert.equal(sourceByNodeField.get('91.text'), 'prompt');
  assert.equal(sourceByNodeField.get('87.text'), 'negative');
  assert.equal(sourceByNodeField.get('86.batch_size'), 'batch_size');
  assert.equal(sourceByNodeField.get('94.model_name'), 'model_name');
  assert.equal(sourceByNodeField.get('85.clip_name'), 'clip_name');
  assert.equal(sourceByNodeField.get('95.vae_name'), 'vae_name');
});

test('ComfyUI exclude rules filter auto mapped fields by source, class and node input', () => {
  const workflow = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt' }, _meta: { title: 'Positive Prompt' } },
    '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7 } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
  };
  const fields = analyzeComfyWorkflow(workflow).fields;

  assert.deepEqual(parseComfyFieldExcludeRules('seed, steps\n#3.batch_size'), ['seed', 'steps', '#3.batch_size']);
  assert.deepEqual(
    filterComfyFieldsByExcludeRules(workflow, fields, ['class:KSampler', '#3.batch_size'])
      .map((field) => `${field.nodeId}.${field.fieldName}:${field.source}`),
    [
      '1.text:prompt',
      '3.width:width',
      '3.height:height',
    ],
  );
});

test('ComfyUI exclude rules backup accepts JSON, arrays and legacy text formats', () => {
  const backup = createComfyFieldExcludeRulesBackup('seed\nsteps\n#3.batch_size', 'test');
  assert.equal(backup.schema, 't8-comfyui-field-exclude-rules');
  assert.deepEqual(backup.rules, ['seed', 'steps', '#3.batch_size']);
  assert.deepEqual(
    parseComfyFieldExcludeRulesBackup(JSON.stringify(backup)),
    ['seed', 'steps', '#3.batch_size'],
  );
  assert.deepEqual(
    parseComfyFieldExcludeRulesBackup({ excludeRules: ['class:KSampler', 'field:width'] }),
    ['class:KSampler', 'field:width'],
  );
  assert.deepEqual(
    parseComfyFieldExcludeRulesBackup({ payload: { autoMappingExcludeRules: 'cfg; scheduler' } }),
    ['cfg', 'scheduler'],
  );
  assert.deepEqual(
    parseComfyFieldExcludeRulesBackup('seed, steps\n#3.batch_size'),
    ['seed', 'steps', '#3.batch_size'],
  );
});

test('ComfyUI image generation respects workflow exclude rules during submit', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'workflow-exclude',
          name: 'Workflow exclude',
          workflowJson: {
            '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' } },
            '2': { class_type: 'KSampler', inputs: { seed: 11, steps: 20 } },
            '3': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
            '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
          },
          excludeRules: ['seed', '#3.width'],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'fresh prompt',
    providerModel: 'workflow-exclude',
    size: '1024x768',
    providerParams: { seed: 999, steps: 40 },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-exclude' });
      }
      return jsonResponse({
        'pid-exclude': {
          outputs: {
            '9': { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['1'].inputs.text, 'fresh prompt');
  assert.equal(promptCall.body.prompt['2'].inputs.seed, 11);
  assert.equal(promptCall.body.prompt['2'].inputs.steps, 40);
  assert.equal(promptCall.body.prompt['3'].inputs.width, 512);
  assert.equal(promptCall.body.prompt['3'].inputs.height, 768);
});

test('ComfyUI canonical fields repair stale saved prompt mapping from sampler links', () => {
  const workflow = {
    '71': {
      class_type: 'KSampler',
      inputs: {
        positive: ['91', 0],
        negative: ['87', 0],
        latent_image: ['86', 0],
      },
    },
    '86': { class_type: 'EmptyLatentImage', inputs: { width: 1920, height: 1080 } },
    '87': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' }, _meta: { title: 'CLIP文本编码' } },
    '91': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' }, _meta: { title: 'CLIP文本编码' } },
  };

  const fields = canonicalizeComfyFieldsByWorkflow(workflow, [
    { nodeId: '86', fieldName: 'width', source: 'width' },
    { nodeId: '86', fieldName: 'height', source: 'height' },
    { nodeId: '87', fieldName: 'text', source: 'prompt' },
  ]);

  const sourceByNodeField = new Map(fields.map((field) => [`${field.nodeId}.${field.fieldName}`, field.source]));
  assert.equal(sourceByNodeField.get('87.text'), 'negative');
  assert.equal(sourceByNodeField.get('91.text'), 'prompt');
});

test('ComfyUI image generation repairs stale saved prompt mapping before submit', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'anima-stale-fields',
          name: 'Anima stale fields',
          workflowJson: {
            '71': {
              class_type: 'KSampler',
              inputs: {
                seed: 1,
                positive: ['91', 0],
                negative: ['87', 0],
                latent_image: ['86', 0],
              },
            },
            '86': { class_type: 'EmptyLatentImage', inputs: { width: 1920, height: 1080 } },
            '87': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' }, _meta: { title: 'CLIP文本编码' } },
            '88': { class_type: 'SaveImage', inputs: { images: ['90', 0] } },
            '91': { class_type: 'CLIPTextEncode', inputs: { text: 'old cyberpunk positive' }, _meta: { title: 'CLIP文本编码' } },
          },
          fields: [
            { nodeId: '86', fieldName: 'width', source: 'width' },
            { nodeId: '86', fieldName: 'height', source: 'height' },
            { nodeId: '87', fieldName: 'text', source: 'prompt' },
          ],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'socore_9,score_8,1girl,nsfw,nude body',
    providerModel: 'anima-stale-fields',
    size: '1024x768',
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-stale-map' });
      }
      return jsonResponse({
        'pid-stale-map': {
          outputs: {
            '88': { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['91'].inputs.text, 'socore_9,score_8,1girl,nsfw,nude body');
  assert.equal(promptCall.body.prompt['87'].inputs.text, 'old negative');
  assert.equal(promptCall.body.prompt['86'].inputs.width, 1024);
  assert.equal(promptCall.body.prompt['86'].inputs.height, 768);
});

test('ComfyUI image generation preserves sampler-linked negative prompt when heuristic fallback runs', async () => {
  const calls: any[] = [];
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'anima-like',
          name: 'Anima-like',
          workflowJson: {
            '71': {
              class_type: 'KSampler',
              inputs: {
                seed: 1,
                steps: 40,
                cfg: 4.5,
                sampler_name: 'er_sde',
                scheduler: 'beta',
                denoise: 1,
                positive: ['91', 0],
                negative: ['87', 0],
                latent_image: ['86', 0],
              },
            },
            '86': { class_type: 'EmptyLatentImage', inputs: { width: 1920, height: 1080, batch_size: 1 } },
            '87': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' }, _meta: { title: 'CLIP文本编码' } },
            '88': { class_type: 'SaveImage', inputs: { images: ['90', 0] } },
            '91': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' }, _meta: { title: 'CLIP文本编码' } },
            '94': { class_type: 'AnimaBoosterLoader', inputs: { model_name: 'anima-base-v1.0.safetensors' } },
            '95': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
          },
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'fresh positive',
    negativePrompt: 'fresh negative',
    providerModel: 'anima-like',
    size: '512x512',
    providerParams: {
      seed: 123,
      steps: 4,
      cfg: 4,
      sampler_name: 'er_sde',
      scheduler: 'beta',
      denoise: 1,
      batch_size: 1,
    },
  }, {
    pollIntervalMs: 1,
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/prompt')) {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ prompt_id: 'pid-2' });
      }
      return jsonResponse({
        'pid-2': {
          outputs: {
            '88': { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] },
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  const promptCall = calls.find((call) => String(call.url).endsWith('/prompt'));
  assert.equal(promptCall.body.prompt['91'].inputs.text, 'fresh positive');
  assert.equal(promptCall.body.prompt['87'].inputs.text, 'fresh negative');
  assert.equal(promptCall.body.prompt['71'].inputs.seed, 123);
  assert.equal(promptCall.body.prompt['86'].inputs.width, 512);
  assert.equal(promptCall.body.prompt['86'].inputs.height, 512);
});

test('ComfyUI error classifier explains missing models and custom nodes', () => {
  const missingModel = comfyui.classifyComfyUiError({
    error: { message: 'Prompt outputs failed validation' },
    node_errors: {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        errors: [{ message: 'Value not in list', details: "ckpt_name: 'missing.safetensors' not in list" }],
      },
    },
  }, 'ComfyUI 提交失败');
  const missingNode = comfyui.classifyComfyUiError({
    error: { message: 'Cannot execute because node class_type IPAdapterApply does not exist' },
  }, 'ComfyUI 提交失败');

  assert.equal(missingModel.code, 'missing_model');
  assert.match(missingModel.error, /模型名不匹配|模型或模型名/);
  assert.match(missingModel.error, /Checkpoint/);
  assert.equal(missingNode.code, 'missing_custom_node');
  assert.match(missingNode.error, /自定义节点/);
});

test('ComfyUI image generation returns friendly missing-model error from prompt validation', async () => {
  const provider = {
    id: 'comfyui',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    comfyuiConfig: {
      workflows: [
        {
          id: 'sample',
          name: 'Sample',
          workflowJson: createBasicComfyTextToImageWorkflow(),
          fields: [
            { nodeId: '1', fieldName: 'ckpt_name', source: 'ckpt_name' },
            { nodeId: '2', fieldName: 'text', source: 'prompt' },
          ],
        },
      ],
    },
  };

  const result = await comfyui.generateImage(provider, {
    prompt: 'test',
    providerModel: 'sample',
    providerParams: { ckpt_name: 'missing.safetensors' },
  }, {
    fetchImpl: async (url: string) => {
      if (String(url).endsWith('/prompt')) {
        return jsonResponse({
          error: { message: 'Prompt outputs failed validation' },
          node_errors: {
            '1': {
              class_type: 'CheckpointLoaderSimple',
              errors: [{ message: 'Value not in list', details: "ckpt_name: 'missing.safetensors' not in list" }],
            },
          },
        }, 400);
      }
      return jsonResponse({});
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_model');
  assert.match(result.error, /Checkpoint|模型/);
});
