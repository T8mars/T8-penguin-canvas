import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  DEFAULT_ADVANCED_PROVIDER_IDS,
  DEFAULT_MODELSCOPE_LORAS,
  maskAdvancedProviders,
  normalizeAdvancedProviders,
  normalizeModelscopeLoras,
  summarizeAdvancedProviders,
} = require('../backend/src/providers/registry.js');

test('normalizeAdvancedProviders migrates missing settings to disabled default provider cards', () => {
  const providers = normalizeAdvancedProviders(undefined);

  assert.deepEqual(
    providers.map((provider: any) => provider.id),
    DEFAULT_ADVANCED_PROVIDER_IDS,
  );
  assert.ok(providers.every((provider: any) => provider.enabled === false));
  assert.equal(providers.find((provider: any) => provider.id === 'modelscope')?.baseUrl, 'https://api-inference.modelscope.cn/v1');
  assert.equal(providers.find((provider: any) => provider.id === 'volcengine')?.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.equal(providers.find((provider: any) => provider.id === 'agnes')?.baseUrl, 'https://apihub.agnes-ai.com/v1');
  assert.deepEqual(providers.find((provider: any) => provider.id === 'agnes')?.imageModels, [
    'agnes-image-2.1-flash',
    'agnes-image-2.0-flash',
  ]);
  assert.deepEqual(providers.find((provider: any) => provider.id === 'agnes')?.videoModels, ['agnes-video-v2.0']);
  assert.deepEqual(providers.find((provider: any) => provider.id === 'agnes')?.chatModels, ['agnes-2.0-flash']);
  assert.deepEqual(providers.find((provider: any) => provider.id === 'modelscope')?.chatModels, [
    'Qwen/Qwen3-235B-A22B',
    'Qwen/Qwen3-VL-235B-A22B-Instruct',
    'MiniMax/MiniMax-M2.7:MiniMax',
  ]);
  assert.deepEqual(
    providers.find((provider: any) => provider.id === 'modelscope')?.modelscopeConfig?.loras?.map((lora: any) => lora.id),
    DEFAULT_MODELSCOPE_LORAS.map((lora: any) => lora.id),
  );
  assert.deepEqual(providers.find((provider: any) => provider.id === 'volcengine')?.videoModels, [
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-lite-t2v-250428',
    'doubao-seedance-1-0-lite-i2v-250428',
  ]);
});

test('normalizeAdvancedProviders migrates ModelScope LoRA defaults and legacy ms_loras', () => {
  const providers = normalizeAdvancedProviders([
    {
      id: 'modelscope',
      protocol: 'modelscope',
      enabled: true,
      ms_loras: [
        {
          id: 'custom/lora',
          name: 'Custom Lora',
          target_model: 'Tongyi-MAI/Z-Image-Turbo',
          strength: 9,
          enabled: true,
          note: 'demo',
        },
        { id: '', target_model: 'bad' },
      ],
    },
  ]);

  const loras = providers.find((provider: any) => provider.id === 'modelscope')?.modelscopeConfig?.loras || [];
  const custom = loras.find((lora: any) => lora.id === 'custom/lora');

  assert.ok(loras.find((lora: any) => lora.id === 'Daniel8152/film'));
  assert.equal(custom?.targetModel, 'Tongyi-MAI/Z-Image-Turbo');
  assert.equal(custom?.strength, 2);
  assert.equal(custom?.enabled, true);
  assert.equal(loras.some((lora: any) => !lora.id), false);
});

test('normalizeModelscopeLoras dedupes by target model and clamps strength', () => {
  const loras = normalizeModelscopeLoras([
    { id: 'a/lora', target_model: 'model-a', strength: -1 },
    { id: 'a/lora', targetModel: 'model-a', strength: 1 },
    { id: 'a/lora', targetModel: 'model-b', strength: 3 },
  ]);

  assert.deepEqual(loras.map((lora: any) => `${lora.targetModel}:${lora.id}:${lora.strength}`), [
    'model-a:a/lora:0',
    'model-b:a/lora:2',
  ]);
});

test('normalizeAdvancedProviders merges built-in provider model defaults into old empty settings', () => {
  const providers = normalizeAdvancedProviders([
    { id: 'modelscope', protocol: 'modelscope', imageModels: [], chatModels: [], enabled: true },
    { id: 'volcengine', protocol: 'volcengine', imageModels: [], videoModels: [], chatModels: [], enabled: true },
    { id: 'jimeng-cli', protocol: 'jimeng-cli', imageModels: [], videoModels: [], enabled: true },
  ]);

  const modelscope = providers.find((provider: any) => provider.id === 'modelscope');
  const volcengine = providers.find((provider: any) => provider.id === 'volcengine');
  const jimeng = providers.find((provider: any) => provider.id === 'jimeng-cli');

  assert.equal(modelscope?.imageModels[0], 'Tongyi-MAI/Z-Image-Turbo');
  assert.equal(modelscope?.chatModels[0], 'Qwen/Qwen3-235B-A22B');
  assert.equal(volcengine?.imageModels[0], 'doubao-seedream-4-0-250828');
  assert.equal(volcengine?.videoModels[1], 'doubao-seedance-2-0-fast-260128');
  assert.equal(volcengine?.chatModels[0], 'doubao-seed-1-6-250615');
  assert.deepEqual(jimeng?.videoModels.slice(0, 6), [
    'seedance2.0fast_vip',
    'seedance2.5',
    'seedance2.0_vip',
    'seedance2.0mini',
    'seedance2.0fast',
    'seedance2.0',
  ]);
  assert.ok(jimeng?.videoModels.includes('seedance1.5pro'));
  assert.ok(jimeng?.videoModels.includes('seedance1.0fast'));
  assert.equal(jimeng?.videoModels.includes('seedance1.0'), false);
  assert.deepEqual(jimeng?.imageModels.slice(0, 5), [
    'seedream-4.7',
    'seedream-4.6',
    'seedream-4.5',
    'seedream-5.0',
    'seedream-5.0-pro',
  ]);
  assert.ok(jimeng?.imageModels.includes('seedream-4.1'));
  assert.ok(jimeng?.imageModels.includes('seedream-4.0'));
  assert.ok(jimeng?.imageModels.includes('seedream-3.1'));
  assert.ok(jimeng?.imageModels.includes('seedream-3.0'));
});

test('normalizeAdvancedProviders filters invalid providers and clamps unsafe fields', () => {
  const providers = normalizeAdvancedProviders([
    {
      id: '../bad',
      label: 'bad',
      protocol: 'modelscope',
      baseUrl: 'https://api-inference.modelscope.cn/v1',
    },
    {
      id: 'remote-comfy',
      label: 'Remote Comfy',
      protocol: 'comfyui',
      baseUrl: 'https://example.com',
      apiKey: 'should-not-matter',
    },
    {
      id: 'valid-openai',
      label: '  My OpenAI Compatible Provider With An Extremely Long Name That Should Be Trimmed  ',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
      imageModels: ['gpt-image-1', 'bad\nmodel', 'x'.repeat(260), 'gpt-image-1'],
      videoModels: ['video-model'],
      chatModels: ['gpt-4o-mini'],
      unknownField: 'drop me',
    },
  ]);

  const provider = providers.find((item: any) => item.id === 'valid-openai');

  assert.ok(provider);
  assert.equal(provider.baseUrl, 'https://api.example.com/v1');
  assert.equal(provider.label.length <= 60, true);
  assert.deepEqual(provider.imageModels, ['gpt-image-1']);
  assert.equal('unknownField' in provider, false);
  assert.equal(providers.some((item: any) => item.id === '../bad'), false);
  assert.equal(providers.some((item: any) => item.id === 'remote-comfy'), false);
});

test('normalizeAdvancedProviders keeps remote ComfyUI settings only when backend env allows it', () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  process.env.T8_COMFYUI_ALLOW_REMOTE = '1';
  try {
    const providers = normalizeAdvancedProviders([
      {
        id: 'comfyui-remote',
        label: 'Remote ComfyUI',
        protocol: 'comfyui',
        enabled: true,
        baseUrl: 'https://comfyui.example.test:8188/',
        comfyuiConfig: {
          instances: [
            'https://comfyui.example.test:8188/',
            'http://127.0.0.1:8188',
            'ftp://not-allowed',
          ],
        },
      },
    ]);

    const provider = providers.find((item: any) => item.id === 'comfyui-remote');

    assert.ok(provider);
    assert.equal(provider.baseUrl, 'https://comfyui.example.test:8188');
    assert.deepEqual(provider.comfyuiConfig?.instances, [
      'https://comfyui.example.test:8188',
      'http://127.0.0.1:8188',
    ]);
    assert.equal('allowRemote' in provider, false);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
  }
});

test('normalizeAdvancedProviders keeps remote ComfyUI settings when the high-risk provider switch is enabled', () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  const previousPrivate = process.env.T8_COMFYUI_ALLOW_PRIVATE;
  delete process.env.T8_COMFYUI_ALLOW_REMOTE;
  delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
  try {
    const providers = normalizeAdvancedProviders([
      {
        id: 'comfyui-remote',
        label: 'Remote ComfyUI',
        protocol: 'comfyui',
        enabled: true,
        allowRemote: true,
        baseUrl: 'https://comfyui.example.test:8188/',
        comfyuiConfig: {
          instances: ['https://comfyui.example.test:8188/'],
        },
      },
    ]);

    const provider = providers.find((item: any) => item.id === 'comfyui-remote');

    assert.ok(provider);
    assert.equal(provider.baseUrl, 'https://comfyui.example.test:8188');
    assert.equal(provider.allowRemote, true);
    assert.deepEqual(provider.comfyuiConfig?.instances, ['https://comfyui.example.test:8188']);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
    if (previousPrivate === undefined) delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
    else process.env.T8_COMFYUI_ALLOW_PRIVATE = previousPrivate;
  }
});

test('normalizeAdvancedProviders rejects remote ComfyUI settings when no remote switch is enabled', () => {
  const previousRemote = process.env.T8_COMFYUI_ALLOW_REMOTE;
  const previousPrivate = process.env.T8_COMFYUI_ALLOW_PRIVATE;
  delete process.env.T8_COMFYUI_ALLOW_REMOTE;
  delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
  try {
    const providers = normalizeAdvancedProviders([
      {
        id: 'comfyui-remote',
        label: 'Remote ComfyUI',
        protocol: 'comfyui',
        enabled: true,
        baseUrl: 'https://comfyui.example.test:8188/',
        comfyuiConfig: {
          instances: ['https://comfyui.example.test:8188/'],
        },
      },
    ]);

    assert.equal(providers.some((item: any) => item.id === 'comfyui-remote'), false);
  } finally {
    if (previousRemote === undefined) delete process.env.T8_COMFYUI_ALLOW_REMOTE;
    else process.env.T8_COMFYUI_ALLOW_REMOTE = previousRemote;
    if (previousPrivate === undefined) delete process.env.T8_COMFYUI_ALLOW_PRIVATE;
    else process.env.T8_COMFYUI_ALLOW_PRIVATE = previousPrivate;
  }
});

test('normalizeAdvancedProviders preserves stored secrets when incoming values are blank or masked', () => {
  const current = normalizeAdvancedProviders([
    {
      id: 'modelscope',
      protocol: 'modelscope',
      apiKey: 'ms-secret-123456',
      enabled: true,
    },
    {
      id: 'volcengine',
      protocol: 'volcengine',
      apiKey: 'ark-secret-abcdef',
      volcengineConfig: {
        accessKeyId: 'ak-secret-1111',
        secretAccessKey: 'sk-secret-2222',
      },
    },
  ]);

  const next = normalizeAdvancedProviders(
    [
      { id: 'modelscope', protocol: 'modelscope', apiKey: '****3456', enabled: true },
      {
        id: 'volcengine',
        protocol: 'volcengine',
        apiKey: '',
        volcengineConfig: {
          accessKeyId: '****1111',
          secretAccessKey: '',
        },
      },
    ],
    current,
  );

  assert.equal(next.find((item: any) => item.id === 'modelscope')?.apiKey, 'ms-secret-123456');
  const volc = next.find((item: any) => item.id === 'volcengine');
  assert.equal(volc?.apiKey, 'ark-secret-abcdef');
  assert.equal(volc?.volcengineConfig?.accessKeyId, 'ak-secret-1111');
  assert.equal(volc?.volcengineConfig?.secretAccessKey, 'sk-secret-2222');
});

test('maskAdvancedProviders hides secrets while preserving configuration status', () => {
  const providers = normalizeAdvancedProviders([
    {
      id: 'modelscope',
      protocol: 'modelscope',
      apiKey: 'ms-secret-123456',
      enabled: true,
    },
    {
      id: 'volcengine',
      protocol: 'volcengine',
      apiKey: 'ark-secret-abcdef',
      volcengineConfig: {
        accessKeyId: 'ak-secret-1111',
        secretAccessKey: 'sk-secret-2222',
      },
    },
  ]);

  const masked = maskAdvancedProviders(providers);
  const modelscope = masked.find((item: any) => item.id === 'modelscope');
  const volc = masked.find((item: any) => item.id === 'volcengine');

  assert.equal(modelscope?.apiKey, '****3456');
  assert.equal(modelscope?.hasApiKey, true);
  assert.equal(volc?.apiKey, '****cdef');
  assert.equal(volc?.volcengineConfig?.accessKeyId, '****1111');
  assert.equal(volc?.volcengineConfig?.secretAccessKey, '****2222');
  const serialized = JSON.stringify(masked);
  assert.equal(serialized.includes('ms-secret-123456'), false);
  assert.equal(serialized.includes('ark-secret-abcdef'), false);
  assert.equal(serialized.includes('ak-secret-1111'), false);
  assert.equal(serialized.includes('sk-secret-2222'), false);
});

test('summarizeAdvancedProviders reports enabled platforms, configured keys, and local tool readiness', () => {
  const providers = normalizeAdvancedProviders([
    { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: 'ms-secret' },
    { id: 'comfyui-local', protocol: 'comfyui', enabled: true, baseUrl: 'http://127.0.0.1:8188' },
    { id: 'jimeng-local', protocol: 'jimeng-cli', enabled: false, jimengConfig: { executablePath: 'dreamina' } },
  ]);

  const summary = summarizeAdvancedProviders(providers);

  assert.equal(summary.enabledCount, 2);
  assert.equal(summary.configuredKeyCount, 1);
  assert.equal(summary.comfyuiConfigured, true);
  assert.equal(summary.jimengConfigured, true);
});

test('normalizeAdvancedProviders preserves ComfyUI workflow json and exposed field mappings', () => {
  const workflowJson = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
  };
  const providers = normalizeAdvancedProviders([
    {
      id: 'comfyui',
      protocol: 'comfyui',
      enabled: true,
      baseUrl: 'http://127.0.0.1:8188',
      comfyuiConfig: {
        instances: ['http://127.0.0.1:8188'],
        workflows: [
          {
            id: 'workflow-1',
            name: 'Flux',
            workflowJson,
            fields: [
              { nodeId: '1', fieldName: 'text', source: 'prompt', value: 'old prompt' },
              { nodeId: '2', fieldName: 'secret', source: 'fixed', value: 'keep me' },
              { nodeId: '3', fieldName: 'legacy', value: 'legacy fixed' },
            ],
            excludeRules: ['seed', 'class:KSampler', '#86.batch_size'],
            outputNodeIds: ['925', '913:122', '925', ''],
          },
        ],
      },
    },
  ]);

  const workflow = providers.find((item: any) => item.id === 'comfyui')?.comfyuiConfig?.workflows?.[0];

  assert.deepEqual(workflow?.workflowJson, workflowJson);
  assert.deepEqual(workflow?.fields, [
    { nodeId: '1', fieldName: 'text', source: 'prompt' },
    { nodeId: '2', fieldName: 'secret', source: 'fixed', value: 'keep me' },
    { nodeId: '3', fieldName: 'legacy', source: 'fixed', value: 'legacy fixed' },
  ]);
  assert.deepEqual(workflow?.excludeRules, ['seed', 'class:KSampler', '#86.batch_size']);
  assert.deepEqual(workflow?.outputNodeIds, ['925', '913:122']);
});
