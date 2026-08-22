import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';
import fs from 'node:fs';

import {
  advancedProviderSummary,
  advancedProvidersForNode,
  advancedProviderModelOptions,
  resolveAdvancedProviderSelection,
  externalImageSizeFor,
  distributeModelscopeLoraWeights,
  MAX_MODELSCOPE_NODE_LORAS,
  MODELSCOPE_LORA_TOTAL_WEIGHT,
  modelscopeLoraWeightTotal,
  modelscopeLorasForModel,
  normalizeModelscopeLoraStrength,
  normalizeModelscopeSelectedLoras,
  parseAdvancedProviderModelText,
  stringifyAdvancedProviderModels,
} from '../src/utils/advancedProviders.ts';

test('parseAdvancedProviderModelText accepts commas and new lines while removing duplicates', () => {
  assert.deepEqual(
    parseAdvancedProviderModelText('gpt-image-1, seedream-4\nseedream-4\n  veo-3.1  '),
    ['gpt-image-1', 'seedream-4', 'veo-3.1'],
  );
});

test('stringifyAdvancedProviderModels keeps compact one-model-per-line output', () => {
  assert.equal(
    stringifyAdvancedProviderModels(['gpt-image-1', '', 'seedream-4']),
    'gpt-image-1\nseedream-4',
  );
});

test('advancedProviderSummary mirrors settings folded header counts', () => {
  const summary = advancedProviderSummary([
    { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: '****1234' },
    { id: 'comfyui', protocol: 'comfyui', enabled: false, baseUrl: 'http://127.0.0.1:8188' },
    { id: 'jimeng', protocol: 'jimeng-cli', enabled: true, jimengConfig: { executablePath: 'dreamina' } },
  ] as any);

  assert.equal(summary.enabledCount, 2);
  assert.equal(summary.configuredKeyCount, 1);
  assert.equal(summary.comfyuiConfigured, true);
  assert.equal(summary.jimengConfigured, true);
});

test('advancedProvidersForNode only exposes enabled providers supported by each node kind', () => {
  const providers = [
    { id: 'openai-compatible', label: 'OpenAI', protocol: 'openai-compatible', enabled: true, imageModels: ['gpt-image-1'], chatModels: ['gpt-4o-mini'] },
    { id: 'modelscope', label: 'ModelScope', protocol: 'modelscope', enabled: true, imageModels: ['MusePublic/489_ckpt_FLUX_1'], chatModels: ['Qwen/Qwen3-Coder'] },
    { id: 'volcengine', label: 'Volc', protocol: 'volcengine', enabled: false, imageModels: ['seedream'], videoModels: ['seedance'], chatModels: ['doubao'] },
    { id: 'agnes', label: 'Agnes AI', protocol: 'agnes', enabled: true, imageModels: ['agnes-image-2.1-flash'], videoModels: ['agnes-video-v2.0'], chatModels: ['agnes-2.0-flash'] },
    { id: 'comfyui', label: 'ComfyUI', protocol: 'comfyui', enabled: true, comfyuiConfig: { workflows: [] } },
    { id: 'jimeng-cli', label: 'Jimeng', protocol: 'jimeng-cli', enabled: true, imageModels: ['jimeng-image'], videoModels: ['jimeng-video'] },
  ] as any;

  assert.deepEqual(advancedProvidersForNode(providers, 'image').map((p) => p.id), [
    'openai-compatible',
    'modelscope',
    'agnes',
    'jimeng-cli',
  ]);
  assert.deepEqual(advancedProvidersForNode(providers, 'llm').map((p) => p.id), [
    'openai-compatible',
    'modelscope',
    'agnes',
  ]);
  assert.deepEqual(advancedProvidersForNode(providers, 'video').map((p) => p.id), [
    'agnes',
    'jimeng-cli',
  ]);
});

test('advanced provider selection preserves valid saved provider and falls back to zhenzhen safely', () => {
  const providers = [
    { id: 'modelscope', label: 'ModelScope', protocol: 'modelscope', enabled: true, imageModels: ['flux-dev'] },
  ] as any;

  assert.deepEqual(resolveAdvancedProviderSelection(providers, 'image', {
    providerSource: 'modelscope',
    providerId: 'modelscope',
    providerModel: 'flux-dev',
  }), {
    providerSource: 'modelscope',
    providerId: 'modelscope',
    providerModel: 'flux-dev',
    provider: providers[0],
    available: true,
  });

  assert.deepEqual(resolveAdvancedProviderSelection(providers, 'image', {
    providerSource: 'openai-compatible',
    providerId: 'missing',
    providerModel: 'old-model',
  }), {
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: '',
    provider: null,
    available: false,
  });
});

test('advancedProviderModelOptions uses explicit lists before safe provider defaults', () => {
  assert.deepEqual(
    advancedProviderModelOptions({ id: 'openai-compatible', protocol: 'openai-compatible', imageModels: ['custom-image'] } as any, 'image'),
    ['custom-image'],
  );
  assert.deepEqual(
    advancedProviderModelOptions({ id: 'modelscope', protocol: 'modelscope' } as any, 'llm'),
    [
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen3-VL-235B-A22B-Instruct',
      'MiniMax/MiniMax-M2.7:MiniMax',
    ],
  );
  assert.deepEqual(
    advancedProviderModelOptions({ id: 'volcengine', protocol: 'volcengine' } as any, 'video'),
    [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-1-5-pro-251215',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-lite-t2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
    ],
  );
  assert.deepEqual(
    advancedProviderModelOptions({
      id: 'agnes',
      protocol: 'agnes',
      defaults: { videoModel: 'agnes-video-v2.0' },
    } as any, 'video'),
    ['agnes-video-v2.0'],
  );
  assert.deepEqual(
    advancedProviderModelOptions({
      id: 'agnes',
      protocol: 'agnes',
      defaults: { chatModel: 'agnes-2.0-flash' },
    } as any, 'llm'),
    ['agnes-2.0-flash'],
  );
  assert.deepEqual(
    advancedProviderModelOptions({
      id: 'volcengine',
      protocol: 'volcengine',
      videoModels: [
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
      ],
      defaults: {
        videoModel: 'doubao-seedance-2-0-fast-260128',
      },
    } as any, 'video'),
    [
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-260128',
    ],
  );
  assert.deepEqual(
    advancedProviderModelOptions({ id: 'jimeng-cli', protocol: 'jimeng-cli' } as any, 'video'),
    [
      'seedance2.0fast_vip',
      'seedance2.5',
      'seedance2.0_vip',
      'seedance2.0mini',
      'seedance2.0fast',
      'seedance2.0',
      'seedance1.5pro',
      'seedance1.0fast',
      'jimeng-video-720p',
      'jimeng-video-1080p',
    ],
  );
  assert.deepEqual(
    advancedProviderModelOptions({ id: 'jimeng-cli', protocol: 'jimeng-cli' } as any, 'image'),
    [
      'seedream-4.7',
      'seedream-4.6',
      'seedream-4.5',
      'seedream-5.0',
      'seedream-5.0-pro',
      'seedream-4.1',
      'seedream-4.0',
      'seedream-3.1',
      'seedream-3.0',
      'jimeng-image-2k',
      'jimeng-image-4k',
    ],
  );
});

test('externalImageSizeFor maps T8 ratio and size labels to stable WxH values', () => {
  assert.equal(externalImageSizeFor('1:1', '1K'), '1024x1024');
  assert.equal(externalImageSizeFor('16:9', '1K'), '1344x768');
  assert.equal(externalImageSizeFor('9:16', '2K'), '1536x2688');
  assert.equal(externalImageSizeFor('bad', 'unknown'), '1024x1024');
});

test('modelscopeLorasForModel filters enabled LoRA entries for selected image model', () => {
  const provider = {
    id: 'modelscope',
    protocol: 'modelscope',
    modelscopeConfig: {
      loras: [
        { id: 'a/lora', name: 'A', targetModel: 'model-a', strength: 0.75, enabled: true },
        { id: 'b/lora', name: 'B', targetModel: 'model-b', strength: 0.8, enabled: true },
        { id: 'off/lora', name: 'Off', targetModel: 'model-a', strength: 0.8, enabled: false },
      ],
    },
  } as any;

  const loras = modelscopeLorasForModel(provider, 'model-a');

  assert.deepEqual(loras.map((lora) => lora.id), ['a/lora']);
  assert.equal(loras[0].strength, 0.75);
  assert.equal(normalizeModelscopeLoraStrength(8), 1);
  assert.equal(normalizeModelscopeLoraStrength(-1), 0);
});

test('normalizeModelscopeSelectedLoras caps image node LoRA selection at five and keeps total weight within one', () => {
  const available = Array.from({ length: 7 }, (_, index) => ({
    id: `lora/${index + 1}`,
    name: `LoRA ${index + 1}`,
    targetModel: 'model-a',
    strength: 0.8,
    enabled: true,
  }));

  const selected = normalizeModelscopeSelectedLoras([
    { id: 'lora/1', strength: 0.2 },
    { id: 'lora/2', weight: 0.4 },
    { id: 'lora/off', strength: 1, enabled: false },
    { id: 'lora/3', scale: 1.4 },
    { id: 'lora/4', loraStrength: 3 },
    { id: 'lora/5', strength: -1 },
    { id: 'lora/6', strength: 0.9 },
  ], available as any);

  assert.equal(MAX_MODELSCOPE_NODE_LORAS, 5);
  assert.deepEqual(selected.map((item) => `${item.id}:${item.strength}`), [
    'lora/1:0.0769',
    'lora/2:0.1538',
    'lora/3:0.3846',
    'lora/4:0.3847',
    'lora/5:0',
  ]);
  assert.equal(modelscopeLoraWeightTotal(selected), MODELSCOPE_LORA_TOTAL_WEIGHT);

  const migrated = normalizeModelscopeSelectedLoras([], available as any, {
    enabled: true,
    id: 'lora/2',
    strength: 1.25,
  });
  assert.deepEqual(migrated, [{ id: 'lora/2', strength: 1 }]);

  assert.deepEqual(distributeModelscopeLoraWeights([
    { id: 'a', strength: 0.1 },
    { id: 'b', strength: 0.1 },
    { id: 'c', strength: 0.1 },
  ]), [
    { id: 'a', strength: 0.3333 },
    { id: 'b', strength: 0.3333 },
    { id: 'c', strength: 0.3334 },
  ]);
});

test('ImageNode makes ModelScope multi-LoRA total weight visible and bounded', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');

  assert.match(source, /官方总权重/);
  assert.match(source, /多个 LoRA 权重总和必须为 1\.00/);
  assert.match(source, /还可分配/);
  assert.match(source, /均分到 1\.00/);
  assert.match(source, /总权重已满/);
  assert.match(source, /max=\{rowMax\}/);
});

test('ImageNode lets Jimeng CLI request up to 10 images without lifting other providers past 4', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');

  assert.match(source, /const isJimengCliImageSelected = isExternalSelected && providerSelection\.provider\?\.protocol === 'jimeng-cli'/);
  assert.match(source, /const externalImageCountLimit = isJimengCliImageSelected \? 10 : 4/);
  assert.match(source, /Math\.min\(externalImageCountLimit,\s*Number\(d\?\.providerParams\?\.n \|\| 1\)\)/);
  assert.match(source, /生成数量/);
  assert.match(source, /自定义宽高（v\{JIMENG_CLI_SUPPORTED_VERSION\}）/);
  assert.match(source, /Seedream 3\.0\/3\.1 支持 1K\/2K；5\.0 Pro 支持 1\.5K\/2K\/4K/);
  assert.match(source, /图生图支持 1-10 张参考图/);
});

test('VideoNode keeps Jimeng Seedance media limits separate from Grok FAL controls', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');

  assertProductionNodeSchema('video', {
    label: '视频',
    category: 'core',
    inputs: ['text', 'image', 'video', 'audio'],
    outputs: ['video'],
    executable: true,
  });

  assert.match(source, /JIMENG_CLI_SEEDANCE25_LIMITS/);
  assert.match(source, /JIMENG_CLI_SEEDANCE20_LIMITS/);
  assert.match(source, /jimengSeedanceDurationOptions\(externalProviderModel\)/);
  assert.match(source, /jimengSeedanceResolutionOptions\(externalProviderModel/);
  assert.match(source, /全能参考素材合计最多/);
  assert.match(source, /showBuiltinFalControls = !isExternalSelected && isFal/);
  assert.match(source, /accepts:\s*isJimengSeedanceSelected\s*\?\s*\['image', 'video', 'audio', 'text'\]/);
  assert.match(source, /jimengSeedanceMode === 'multiframe'[\s\S]*\['720p', '1080p'\]/);
  assert.match(source, /videos: videoRefs/);
  assert.match(source, /audios: audioRefs/);
  assert.match(source, /图\$\{refs\.length\}\/视\$\{videoRefs\.length\}\/音\$\{audioRefs\.length\}/);
});

test('SeedanceNode exposes explicit Jimeng intelligent multiframe mode only for Jimeng CLI', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/SeedanceNode.tsx', import.meta.url), 'utf8');

  assert.match(source, /type SeedanceFrameMode = 'auto' \| 'first' \| 'firstlast' \| 'multiframe'/);
  assert.match(source, /\(!isJimengCliSelected \|\| isJimengSeedance25\) && frameMode === 'multiframe'/);
  assert.match(source, /frameMode: activeFrameMode/);
  assert.match(source, /isJimengCliSelected && !isJimengSeedance25 && \(\s*<option value="multiframe"/);
  assert.match(source, /智能多帧\(multiframe\)/);
});

test('SeedanceNode exposes Zhenzhen mini model and native4K resolution', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/SeedanceNode.tsx', import.meta.url), 'utf8');
  const seedanceConfig = fs.readFileSync(new URL('../src/config/seedance.ts', import.meta.url), 'utf8');
  const generation = fs.readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8');

  assert.match(source, /LEGACY_SEEDANCE_MODEL_OPTIONS as MODEL_OPTIONS/);
  assert.match(source, /LEGACY_SEEDANCE_RESOLUTION_OPTIONS as RESOLUTION_OPTIONS/);
  assert.match(seedanceConfig, /value: 'doubao-seedance-2\.0-mini'/);
  assert.match(seedanceConfig, /label: 'seedance-2\.0-mini'/);
  assert.match(seedanceConfig, /LEGACY_SEEDANCE_RESOLUTION_OPTIONS = \[[^\]]*'native4K'[^\]]*\]/);
  assert.match(generation, /doubao-seedance-2\.0-mini/);
  assert.match(generation, /native4K/);
});

test('zhenzhen local group selection extension points are wired without making private code public', () => {
  const apiSettings = fs.readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
  const imageNode = fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
  const videoNode = fs.readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
  const seedanceNode = fs.readFileSync(new URL('../src/components/nodes/SeedanceNode.tsx', import.meta.url), 'utf8');
  const audioNode = fs.readFileSync(new URL('../src/components/nodes/AudioNode.tsx', import.meta.url), 'utf8');
  const generation = fs.readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8');
  const emptyExtensions = fs.readFileSync(new URL('../src/extensions/emptyLocalExtensions.tsx', import.meta.url), 'utf8');
  const proxy = fs.readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');

  assert.match(apiSettings, /LocalSettingsAddonSlot/);
  for (const source of [imageNode, videoNode, seedanceNode, audioNode]) {
    assert.match(source, /LocalNodeAddonSlot/);
    assert.match(source, /providerParams/);
  }
  assert.match(generation, /providerParams\?: Record<string, any>/);
  assert.match(generation, /fd\.append\('providerParams', JSON\.stringify\(providerParams\)\)/);
  assert.match(emptyExtensions, /LocalNodeAddonSlot: FC<LocalNodeAddonSlotProps> = \(\) => null/);
  assert.match(emptyExtensions, /LocalSettingsAddonSlot: FC<LocalSettingsAddonSlotProps> = \(\) => null/);
  assert.match(proxy, /route: 'seedance\/submit'/);
  assert.match(proxy, /kind: 'seedance'/);
  assert.match(proxy, /ensureKeyOrSelectedGroup\(settings, res, 'seedance', 'Seedance', providerParams\)/);
});

test('Agnes provider settings and video node controls are exposed', () => {
  const settings = fs.readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
  const videoNode = fs.readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');

  assert.match(settings, /agnes:\s*'Agnes AI'/);
  assert.match(settings, /https:\/\/apihub\.agnes-ai\.com\/v1/);
  assert.match(settings, /AGNES_API_KEY_URL = 'https:\/\/platform\.agnes-ai\.com\/settings\/apiKeys'/);
  assert.match(videoNode, /providerSelection\.provider\?\.protocol === 'agnes'/);
  assert.match(videoNode, /Agnes 视频参数/);
  assert.match(videoNode, /frameRate/);
  assert.match(videoNode, /numFrames/);
});

test('OpenAI compatible provider settings advertise image edit endpoint', () => {
  const settings = fs.readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');

  assert.match(settings, /\/v1\/images\/generations/);
  assert.match(settings, /\/v1\/images\/edits/);
  assert.match(settings, /\/v1\/chat\/completions/);
});

test('advanced provider API keys have bounded visibility toggles', () => {
  const settings = fs.readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

  assert.match(settings, /advancedSecretShows/);
  assert.match(settings, /setAdvancedSecretShows/);
  assert.match(settings, /t8-api-settings-secret-field/);
  assert.match(settings, /t8-api-settings-secret-toggle/);
  assert.match(settings, /type=\{advancedSecretShows\[provider\.id\] \? 'text' : 'password'\}/);
  assert.match(settings, /\{advancedSecretShows\[provider\.id\] \? <EyeOff size=\{14\} \/> : <Eye size=\{14\} \/>}/);
  assert.match(styles, /\.t8-api-settings-secret-field\s*\{[\s\S]*position:\s*relative/);
  assert.match(styles, /\.t8-api-settings-secret-field\s+\.t8-api-settings-input\s*\{[\s\S]*padding-right:\s*42px/);
  assert.match(styles, /\.t8-api-settings-secret-toggle\s*\{[\s\S]*right:\s*8px/);
});

test('local private zhenzhen group extension is opt-in and keeps FAL out when present', () => {
  const privateFrontendUrl = new URL('../local-private/extensions/frontend/index.tsx', import.meta.url);
  const privateBackendUrl = new URL('../local-private/extensions/backend/zhenzhenGroups.cjs', import.meta.url);
  if (!fs.existsSync(privateFrontendUrl) || !fs.existsSync(privateBackendUrl)) return;

  const frontend = fs.readFileSync(privateFrontendUrl, 'utf8');
  const backend = fs.readFileSync(privateBackendUrl, 'utf8');
  const proxy = fs.readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');

  assert.match(frontend, /const \[enabled, setEnabled\] = useState\(false\)/);
  assert.match(frontend, /启用 New API 分组令牌高级模式/);
  assert.match(frontend, /默认使用普通贞贞 API Key/);
  assert.match(frontend, /API 地址自动使用/);
  assert.match(frontend, /https:\/\/ai\.t8star\.org \/ https:\/\/ai\.t8star\.cn/);
  assert.match(frontend, /令牌名默认/);
  assert.match(frontend, /生成全套 API Key 大约需要 3 分钟/);
  assert.match(frontend, /个人中心 - 安全设置/);
  assert.match(frontend, /昵称右边的数字 ID/);
  assert.doesNotMatch(frontend, /手动令牌池/);
  assert.doesNotMatch(frontend, /saveManual/);
  assert.match(frontend, /isFalChannel/);
  assert.match(frontend, /if \(!status\?\.enabled\) return null/);
  assert.match(frontend, /\/api\/local\/zhenzhen-groups\/enabled/);
  assert.match(frontend, /const GROUP_STATUS_EVENT = 't8:zhenzhen-groups-status-changed'/);
  assert.match(frontend, /function notifyGroupStatusChanged/);
  assert.match(frontend, /notifyGroupStatusChanged\(nextStatus\)/);
  assert.match(frontend, /window\.addEventListener\(GROUP_STATUS_EVENT, handleStatusChanged\)/);
  assert.match(frontend, /const GROUP_PREFERENCES_STORAGE_KEY = 't8:zhenzhen-group-preferences:v1'/);
  assert.match(frontend, /const GROUP_PREFERENCES_EVENT = 't8:zhenzhen-group-preferences-changed'/);
  assert.match(frontend, /schema: 't8-zhenzhen-group-preferences'/);
  assert.match(frontend, /function readGroupPreferences/);
  assert.match(frontend, /function writeGroupPreferences/);
  assert.match(frontend, /function rememberPreferredGroup/);
  assert.match(frontend, /function groupPreferenceKeysForNode/);
  assert.match(frontend, /function preferredGroupForNode/);
  assert.match(frontend, /applyRememberedGroup/);
  assert.match(frontend, /导出习惯/);
  assert.match(frontend, /导入习惯/);
  assert.match(frontend, /不包含令牌密钥/);
  assert.match(frontend, /const \[statusRevision, setStatusRevision\] = useState\(0\)/);
  assert.match(frontend, /fetchGroupStatus\(model, statusRevision > 0\)/);
  assert.match(frontend, /JSON\.stringify\(\{ userId, accessToken, enabled: true, bootstrap: true \}\)/);
  assert.match(frontend, /正在后台建立分组令牌/);
  assert.match(frontend, /status\?\.bootstrapJob\?\.status !== 'running'/);
  assert.match(frontend, /补齐分组令牌/);

  assert.match(backend, /enabled: false/);
  assert.match(backend, /const DEFAULT_NEWAPI_BASE_URL = 'https:\/\/ai\.t8star\.org'/);
  assert.match(backend, /const NEWAPI_BASE_URLS = \['https:\/\/ai\.t8star\.org', 'https:\/\/ai\.t8star\.cn'\]/);
  assert.match(backend, /const DEFAULT_TOKEN_NAME_PREFIX = 'T8'/);
  assert.match(backend, /const CACHE_TTL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(backend, /const PRICING_PATH = '\/api\/pricing'/);
  assert.match(backend, /const TOKEN_BOOTSTRAP_DELAY_MS = 8500/);
  assert.match(backend, /function isFalGroup\(group\)/);
  assert.match(backend, /managedGroupList\(data\.usable_group\)/);
  assert.match(backend, /\['seedance-2\.0', 'doubao-seedance-2-0-fast-260128'\]/);
  assert.match(backend, /let pricingFetchPromise = null/);
  assert.match(backend, /let bootstrapPromise = null/);
  assert.match(backend, /apiPathJson\(secret, apiPath/);
  assert.match(backend, /getTokenKeysBatch/);
  assert.match(backend, /function cleanTokenKey\(value\)/);
  assert.match(backend, /function newApiBearerKey\(value\)/);
  assert.match(backend, /apiKey: newApiBearerKey\(entry\.key\)|const apiKey = newApiBearerKey\(entry\.key\)/);
  assert.match(backend, /function invalidateGroupToken\(payload = \{\}\)/);
  assert.match(backend, /zhenzhen\.invalidateApiKey/);
  assert.match(backend, /groups: group/);
  assert.match(backend, /async function fetchJsonWithRetry/);
  assert.match(backend, /接口返回非 JSON/);
  assert.match(backend, /router\.post\('\/enabled'/);
  assert.match(backend, /boolValue\(secret\.enabled, false\) && !readCachedPricingOnly\(\)/);
  assert.match(backend, /if \(!boolValue\(secret\.enabled, false\)\) return \{\}/);
  assert.match(backend, /startBootstrapJob\(next, cache\.groups, 'bind'\)/);
  assert.match(backend, /startBootstrapJob\(secret, groups, 'manual'\)/);

  assert.match(proxy, /function isInvalidApiKeyError\(errorText\)/);
  assert.match(proxy, /async function invalidateZhenzhenProviderKey\(providerContext, apiKey, errorText\)/);
  assert.match(proxy, /runLocalHooks\('zhenzhen\.invalidateApiKey'/);
});
