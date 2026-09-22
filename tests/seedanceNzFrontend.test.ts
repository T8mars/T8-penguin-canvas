import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEEDANCE_NZ_MODEL_OPTIONS,
  SEEDANCE_NZ_RATIO_OPTIONS,
  SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS,
} from '../src/config/seedance.ts';
import { SUNO_NZ_ACTIONS } from '../src/providers/models.ts';
import { buildWhisperTranscriptEvidence } from '../src/services/generation.ts';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Seedance shared frontend catalog exposes six families that expand to 18 task models', () => {
  assert.equal(SEEDANCE_NZ_MODEL_OPTIONS.length, 6);
  assert.deepEqual(SEEDANCE_NZ_RATIO_OPTIONS, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
  assert.ok(SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS.includes('native4k'));
});

test('new SD2 and director nodes default to automatic main API while old data stays legacy-compatible', () => {
  const canvas = read('../src/components/Canvas.tsx');
  const seedanceNode = read('../src/components/nodes/SeedanceNode.tsx');
  const directorNode = read('../src/components/nodes/DirectorStoryboardNode.tsx');

  assert.match(canvas, /seedance:\s*\{[\s\S]*seedanceApiSource: 'auto'[\s\S]*seedanceNzModel: 'fast'/);
  assert.match(canvas, /'director-storyboard':\s*\{[\s\S]*seedanceApiSource: 'auto'[\s\S]*seedanceNzModel: 'fast'/);
  assert.match(seedanceNode, /savedBuiltinSource[\s\S]*: 'zhenzhen-legacy'/);
  assert.match(directorNode, /savedBuiltinSource[\s\S]*: 'zhenzhen-legacy'/);
});

test('SD2 node exposes built-in provider choices and preserves provider during polling', () => {
  const node = read('../src/components/nodes/SeedanceNode.tsx');
  const generation = read('../src/services/generation.ts');

  assert.match(node, /主力 API（自动：优先平价AI小屋）/);
  assert.match(node, /贞贞的平价AI小屋 · api\.seedance\.nz/);
  assert.match(node, /贞贞的AI工坊（海外） · ai\.t8star\.org/);
  assert.match(node, /taskProvider:\s*isSeedance25\s*\?\s*'seedance-nz'\s*:\s*builtinSource/);
  assert.match(node, /querySeedance\(tid, taskProvider\)/);
  assert.match(node, /lastTaskProvider/);
  assert.match(generation, /taskProvider=\$\{encodeURIComponent\(taskProvider\)\}/);
});

test('audio node exposes the official 34-action Suno platform without replacing legacy Suno', () => {
  const audioNode = read('../src/components/nodes/AudioNode.tsx');
  const i18n = read('../src/i18n/resources.ts');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');

  assert.equal(SUNO_NZ_ACTIONS.length, 34);
  assert.equal(new Set(SUNO_NZ_ACTIONS.map((item) => item.value)).size, 34);
  assert.equal(SUNO_NZ_ACTIONS[0].value, 'suno-generation');
  assert.equal(SUNO_NZ_ACTIONS.at(-1)?.value, 'suno-add-stem');
  assert.deepEqual(
    SUNO_NZ_ACTIONS.slice(1, 4).map((item) => [item.value, item.action, item.resultFamily, item.referenceType]),
    [
      ['suno-create-model', 'create-model', 'model', 'model_audios'],
      ['suno-upload-cover', 'upload-cover', 'audio', 'url'],
      ['suno-upload-extend', 'upload-extend', 'audio', 'url'],
    ],
  );
  assert.match(audioNode, /translate\('nodes:audio\.workshopLegacy'\)/);
  assert.match(audioNode, /translate\('nodes:generation\.budgetHouse'\)/);
  assert.match(i18n, /workshopLegacy: '贞贞的AI工坊（原有）'/);
  assert.match(i18n, /workshopLegacy: 'Zhenzhen AI Workshop \(legacy\)'/);
  assert.match(audioNode, /SUNO_NZ_ACTIONS\.map/);
  assert.match(audioNode, /submitAudio\(\{/);
  assert.match(audioNode, /submitSunoNz\(\{/);
  assert.match(audioNode, /sunoNzLocalRefAudios/);
  assert.match(audioNode, /multiple=\{isSunoNzCreateModel\}/);
  assert.match(audioNode, /sunoNzCustomModelId/);
  assert.match(audioNode, /sunoNzGptDescription/);
  assert.match(audioNode, /sunoNzStyleWeight/);
  assert.match(audioNode, /sunoNzWeirdness/);
  assert.match(audioNode, /sunoNzAudioWeight/);
  assert.match(audioNode, /sunoNzTargetDurationSeconds/);
  assert.match(audioNode, /suno-upload-extend[^]*continue_at/);
  assert.match(generation, /\/api\/proxy\/audio\/suno-nz\/submit/);
  assert.match(generation, /\/api\/proxy\/audio\/suno-nz\/status\//);
  assert.match(proxy, /router\.post\('\/audio\/suno-nz\/submit'/);
  assert.match(proxy, /router\.get\('\/audio\/suno-nz\/status\/:tid'/);
});

test('all interval-based generation polling never overlaps a slow status request', () => {
  const seedanceNode = read('../src/components/nodes/SeedanceNode.tsx');
  const videoNode = read('../src/components/nodes/VideoNode.tsx');
  const audioNode = read('../src/components/nodes/AudioNode.tsx');
  const runningHubNode = read('../src/components/nodes/RunningHubNode.tsx');
  const rhToolsNode = read('../src/components/nodes/RHToolsNode.tsx');

  assert.match(seedanceNode, /let pollInFlight = false;[\s\S]*?if \(pollInFlight\) return;[\s\S]*?pollInFlight = true;[\s\S]*?finally \{[\s\S]*?pollInFlight = false;/);
  assert.equal((videoNode.match(/let pollInFlight = false;/g) || []).length, 2);
  assert.equal((videoNode.match(/if \(pollInFlight\) return;/g) || []).length, 2);
  assert.equal((videoNode.match(/pollInFlight = false;/g) || []).length, 4);
  assert.equal((audioNode.match(/let pollInFlight = false;/g) || []).length, 5);
  assert.equal((audioNode.match(/if \(pollInFlight\) return;/g) || []).length, 5);
  assert.equal((audioNode.match(/pollInFlight = false;/g) || []).length, 10);
  assert.match(runningHubNode, /let pollInFlight = false;[\s\S]*?if \(pollInFlight\) return;/);
  assert.match(rhToolsNode, /let pollInFlight = false;[\s\S]*?if \(pollInFlight\) return;/);
});

test('all async generation surfaces retain completed tasks while TUN output is materializing', () => {
  const imageNode = read('../src/components/nodes/ImageNode.tsx');
  const videoNode = read('../src/components/nodes/VideoNode.tsx');
  const seedanceNode = read('../src/components/nodes/SeedanceNode.tsx');
  const audioNode = read('../src/components/nodes/AudioNode.tsx');
  const runningHubNode = read('../src/components/nodes/RunningHubNode.tsx');
  const rhToolsNode = read('../src/components/nodes/RHToolsNode.tsx');
  const rhToolbox = read('../src/services/rhToolbox.ts');
  const falToolbox = read('../src/services/falToolbox.ts');
  const panorama = read('../src/components/nodes/Panorama3DNode.tsx');
  const director = read('../src/components/nodes/DirectorStoryboardNode.tsx');
  const story = read('../src/components/nodes/StoryNode.tsx');

  for (const source of [
    imageNode,
    videoNode,
    seedanceNode,
    audioNode,
    runningHubNode,
    rhToolsNode,
    rhToolbox,
    falToolbox,
    panorama,
    director,
    story,
  ]) {
    assert.match(source, /materializing/i);
  }
  assert.match(rhToolbox, /remoteTaskCompleted = true;[\s\S]*?正在适配 TUN\/代理网络并安全下载/);
  assert.match(story, /音频已经生成，正在适配 TUN\/代理网络并安全下载/);
});

test('proxy routes seedance.nz independently and immediately stores completed output locally', () => {
  const proxy = read('../backend/src/routes/proxy.js');
  const settings = read('../backend/src/routes/settings.js');

  assert.match(proxy, /requestedTaskProvider === seedanceNz\.PROVIDER_ID/);
  assert.match(proxy, /seedanceNz\.submitTask/);
  assert.match(proxy, /seedanceNz\.queryTask/);
  assert.match(proxy, /materializeRemoteTaskOutput\(\{[\s\S]*?remoteUrl: result\.videoUrl,[\s\S]*?kind: 'video',[\s\S]*?materializationKey: `\$\{seedanceNz\.PROVIDER_ID\}:\$\{taskId\}`,[\s\S]*?providerFetchImpl: seedanceNz\.fetchRemote/);
  assert.match(proxy, /materializeRemoteTaskOutput\(\{[\s\S]*?status: st,[\s\S]*?remoteUrl: vUrl,[\s\S]*?kind: 'video',[\s\S]*?materializationKey: `zhenzhen-legacy:\$\{taskId\}`/);
  assert.match(proxy, /provider: 'zhenzhen-legacy'/);
  assert.match(settings, /zhenzhenSd2ApiKey/);
  assert.match(settings, /zhenzhenSd2BaseUrl: config\.ZHENZHEN_SD2_BASE_URL/);
});

test('video node exposes Happy Horse as an isolated built-in model family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  for (const model of ['happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v']) {
    assert.match(models, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(models, /label: 'Happy Horse'/);
  assert.match(models, /durations: \[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15\]/);
  assert.match(models, /resolutions: \['720p', '1080p'\]/);
  assert.match(node, /submitHappyHorse/);
  assert.match(node, /happyHorseMode === 'i2v' \? 1 : 9/);
  assert.match(node, /文生视频只使用提示词，不发送画布中的参考图/);
  assert.match(generation, /\/api\/proxy\/video\/happyhorse\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/happyhorse\/status/);
});

test('video node exposes Wan 2.7 Spicy as an isolated built-in i2v family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');

  assert.match(models, /label: 'Wan'/);
  assert.match(models, /value: 'wan-2\.7-spicy-i2v'/);
  assert.match(models, /durations: \[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15\]/);
  assert.match(node, /submitWan/);
  assert.match(node, /Wan 2\.7 Spicy 仅支持图生视频/);
  assert.match(node, /wanNegativePrompt/);
  assert.match(node, /wanAudioUrl/);
  assert.match(node, /wanPromptExtend/);
  assert.match(generation, /\/api\/proxy\/video\/wan\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/wan\/status/);
  assert.match(proxy, /seedanceNz\.submitWanTask/);
});

test('video node exposes Hailuo 2.3 and H3 as one isolated budget-house family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');
  for (const model of [
    'hailuo-2.3-t2v-standard',
    'hailuo-2.3-t2v-pro',
    'hailuo-2.3-i2v-standard',
    'hailuo-2.3-i2v-pro',
    'hailuo-2.3-fast-i2v',
    'hailuo-2.3-fast-pro-i2v',
    'hailuo-h3-t2v',
    'hailuo-h3-i2v',
    'hailuo-h3-multi',
    'hailuo-h3-global-t2v',
    'hailuo-h3-global-i2v',
    'hailuo-h3-global-multi',
    'minimax-h3-ow-i2v-fast',
    'minimax-h3-ow-r2v-fast',
    'minimax-h3-ow-ref2va-audio-drive-fast',
    'minimax-h3-ow-fl2va-audio-drive-fast',
    'minimax-h3-ow-t2v-fast',
  ]) {
    assert.match(models, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(models, /label: 'Hailuo'/);
  assert.match(models, /durations: \[6, 10\]/);
  assert.match(models, /resolutions: \['768p', '1080p'\]/);
  assert.match(models, /Hailuo H3 国内多模态参考；最多 9 图、3 视频、3 音频，支持 768P\/2K/);
  assert.match(node, /submitHailuo/);
  assert.match(node, /queryHailuo/);
  assert.match(node, /hailuoMode === 'multi'/);
  assert.match(node, /imageUrls\.slice\(0, 9\)/);
  assert.match(node, /videoUrls\.slice\(0, 3\)/);
  assert.match(node, /audioUrls\.slice\(0, 3\)/);
  assert.match(node, /768P \/ 2K/);
  assert.match(node, /首帧图短边需大于 300px/);
  assert.match(node, /1080p 仅 6 秒/);
  assert.match(generation, /\/api\/proxy\/video\/hailuo\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/hailuo\/status/);
  assert.match(proxy, /seedanceNz\.submitHailuoTask/);
  assert.match(proxy, /recallTaskMeta\(req\.params\.tid, 'hailuo-nz'\)/);
});

test('video node exposes Vidu Q3 as an isolated 15-model built-in family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');
  for (const model of [
    'vidu-q3-pro-t2v',
    'vidu-q3-turbo-t2v',
    'vidu-q3-pro-fast-t2v',
    'vidu-q3-pro-i2v',
    'vidu-q3-turbo-i2v',
    'vidu-q3-pro-fast-i2v',
    'vidu-q3-pro-start-end',
    'vidu-q3-turbo-start-end',
    'vidu-q3-pro-fast-start-end',
    'vidu-q3-r2v',
    'vidu-q3-mix-r2v',
    'vidu-q3-ad-r2v',
    'vidu-q3-drama-r2v',
    'vidu-q3-drama-short-play',
    'vidu-q3-ad-short-play',
  ]) {
    assert.match(models, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(models, /label: 'Vidu'/);
  assert.match(models, /durations: \[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15\]/);
  assert.match(models, /resolutions: \['default', '720p', '1080p'\]/);
  assert.match(node, /submitVidu/);
  assert.match(node, /queryVidu/);
  assert.match(node, /viduMode === 'start-end'/);
  assert.match(node, /短剧成片把 Prompt 作为脚本内容/);
  assert.match(node, /1-14 张图片构造参考资产/);
  assert.match(node, /isViduUpstreamUnavailable/);
  assert.match(node, /fail_to_fetch_task/);
  assert.match(models, /vidu-q3-r2v[^\n]+disabled: true/);
  assert.match(models, /vidu-q3-ad-short-play[^\n]+disabled: true/);
  assert.match(generation, /\/api\/proxy\/video\/vidu\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/vidu\/status/);
  assert.match(proxy, /seedanceNz\.submitViduTask/);
  assert.match(proxy, /recallTaskMeta\(req\.params\.tid, 'vidu-nz'\)/);
});

test('video node exposes Kling as an isolated 21-model built-in family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');
  const provider = read('../backend/src/providers/seedanceNz.js');
  for (const model of [
    'kling-v3.0-std-t2v',
    'kling-v3.0-pro-t2v',
    'kling-v3-turbo-std-t2v',
    'kling-v3-turbo-pro-t2v',
    'kling-v3-4k-t2v',
    'kling-o3-std-t2v',
    'kling-o3-pro-t2v',
    'kling-o3-4k-t2v',
    'kling-v3.0-std-i2v',
    'kling-v3.0-pro-i2v',
    'kling-v3-turbo-std-i2v',
    'kling-v3-turbo-pro-i2v',
    'kling-v3-4k-i2v',
    'kling-o3-std-i2v',
    'kling-o3-pro-i2v',
    'kling-o3-4k-i2v',
    'kling-o3-std-r2v',
    'kling-o3-pro-r2v',
    'kling-o3-4k-r2v',
    'kling-o3-std-edit',
    'kling-o3-pro-edit',
  ]) {
    assert.match(models, new RegExp(model.replaceAll('.', '\\.')));
    assert.match(provider, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(models, /label: 'Kling'/);
  assert.match(models, /durations: \[5, 10\]/);
  assert.match(node, /submitKling/);
  assert.match(node, /queryKling/);
  assert.match(node, /klingMode === 'edit'/);
  assert.match(node, /Kling 视频编辑必须连接或拖入 1 个输入视频/);
  assert.match(node, /negativePrompt: klingNegativePrompt/);
  assert.match(node, /isKlingUpstreamUnavailable/);
  assert.match(models, /kling-o3-std-r2v[^\n]+disabled: true/);
  assert.match(models, /kling-o3-pro-r2v[^\n]+disabled: true/);
  assert.match(generation, /\/api\/proxy\/video\/kling\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/kling\/status/);
  assert.match(proxy, /seedanceNz\.submitKlingTask/);
  assert.match(proxy, /recallTaskMeta\(req\.params\.tid, 'kling-nz'\)/);
  assert.doesNotMatch(models, /kling-v3\.0-std-motion|kling-elements-advanced|kling-lip-sync/);
});

test('video node exposes Zhenzhen Upscaler as a dedicated single-MP4 family', () => {
  const models = read('../src/providers/models.ts');
  const node = read('../src/components/nodes/VideoNode.tsx');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');
  const provider = read('../backend/src/providers/seedanceNz.js');

  assert.match(models, /label: 'Upscaler'/);
  assert.match(models, /kind: 'upscaler'/);
  assert.match(models, /resolutions: \['720p', '1080p', '2k', '4k'\]/);
  assert.match(models, /supportVideos: true/);
  assert.match(node, /submitUpscaler/);
  assert.match(node, /queryUpscaler/);
  assert.match(node, /Zhenzhen Upscaler 必须连接或拖入且只能保留 1 个 MP4 视频/);
  assert.match(node, /videos: \[videoUrls\[0\]\]/);
  assert.match(node, /!isUpscaler && !isAnimate && <div>/);
  assert.match(generation, /\/api\/proxy\/video\/upscaler\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/upscaler\/status/);
  assert.match(proxy, /seedanceNz\.submitUpscalerTask/);
  assert.match(proxy, /recallTaskMeta\(req\.params\.tid, 'upscaler-nz'\)/);
  assert.match(provider, /prompt: 'upscale'/);
  assert.match(provider, /content: \[\{ type: 'video_url', video_url: \{ url: videoUrl \} \}\]/);
});

test('Seedream NZ selector distinguishes domestic and Dola overseas model families', () => {
  const node = read('../src/components/nodes/ImageNode.tsx');
  const generation = read('../src/services/generation.ts');
  const provider = read('../backend/src/providers/seedanceNz.js');

  assert.match(node, /Seedream v5 Pro（国内模型）/);
  assert.match(node, /Dola Seedream 5\.0 Pro（海外模型）/);
  assert.match(node, /dola-seedream-5\.0-pro-t2i/);
  assert.match(node, /dola-seedream-5\.0-pro-i2i/);
  assert.match(node, /modelFamily: isZhenzhenBudgetImageSelected \|\| isQwenImageTab \|\| isQwenImage21Tab \|\| isSeedreamLayerTab \|\| isWanImageTab \? undefined : seedreamNzModelFamily/);
  assert.match(generation, /modelFamily\?: 'domestic' \| 'overseas'/);
  assert.match(provider, /dola-seedream-5\.0-pro-t2i/);
  assert.match(provider, /dola-seedream-5\.0-pro-i2i/);
});

test('audio node exposes Seed Audio without replacing Suno and supports image/audio references', () => {
  const node = read('../src/components/nodes/AudioNode.tsx');
  const generation = read('../src/services/generation.ts');
  const apiSettings = read('../src/components/ApiSettings.tsx');
  const i18n = read('../src/i18n/resources.ts');
  assert.match(node, /audioProviderMode.*seed-audio/);
  assert.match(node, /doubao-seed-audio-1\.0/);
  assert.match(node, /submitSeedAudio/);
  assert.match(node, /querySeedAudio/);
  assert.match(node, /Seed Audio 的音色 ID、参考图和参考音频只能选择一种/);
  assert.match(node, /\['wav', 'mp3', 'pcm', 'ogg_opus'\]/);
  assert.match(node, /\['8000', '16000', '24000', '32000', '44100'\]/);
  assert.match(node, /submitAudio\(/);
  assert.match(generation, /\/api\/proxy\/audio\/seed-audio\/submit/);
  assert.match(generation, /\/api\/proxy\/audio\/seed-audio\/status/);
  assertProductionNodeSchema('audio', {
    label: '音频',
    category: 'core',
    inputs: ['text', 'image', 'audio', 'video'],
    outputs: ['audio', 'text', 'video'],
    executable: true,
  });
  assert.match(apiSettings, /descKey: 'keys\.zhenzhenBudget\.description'/);
  assert.match(i18n, /Seedream\/Qwen\/Wan\/Grok 图像，以及 Seed Audio、Qwen3-TTS、MiniMax、Mureka 音频/);
  assert.match(i18n, /Seedream\/Qwen\/Wan\/Grok images, and Seed Audio\/Qwen3-TTS\/MiniMax\/Mureka audio/);
});

test('APIMart image, video and Whisper models are wired to the budget provider without replacing existing tabs', () => {
  const imageNode = read('../src/components/nodes/ImageNode.tsx');
  const videoNode = read('../src/components/nodes/VideoNode.tsx');
  const audioNode = read('../src/components/nodes/AudioNode.tsx');
  const i18n = read('../src/i18n/resources.ts');
  const models = read('../src/providers/models.ts');
  const generation = read('../src/services/generation.ts');
  const proxy = read('../backend/src/routes/proxy.js');

  for (const model of [
    'zhenzhen-image-g-v2-lowprice',
    'zhenzhen-image-gk-v15',
    'zhenzhen-image-gk-v15-edit',
    'zhenzhen-image-nb-pro',
    'zhenzhen-image-nb-2-lite',
    'zhenzhen-image-nb-2',
    'zhenzhen-video-g-omni-flash',
    'zhenzhen-video-gk-v15',
    'zhenzhen-video-v31-lite',
    'zhenzhen-video-v31-fast',
    'zhenzhen-video-v31-quality',
  ]) {
    assert.match(models, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(imageNode, /贞贞的平价AI小屋 · \$\{apiModel\}/);
  assert.match(videoNode, /贞贞的平价AI小屋 · \{apiModel\}/);
  assert.match(videoNode, /querySeedance\(tid, 'seedance-nz'\)/);
  assert.match(audioNode, /audioProviderMode === 'whisper'/);
  assert.match(audioNode, /`whisper-1 · \$\{translate\('nodes:generation\.budgetHouse'\)\}`/);
  assert.match(audioNode, /translate\('nodes:audio\.startTranscription'\)/);
  assert.match(i18n, /startTranscription: '开始转写'/);
  assert.match(i18n, /startTranscription: 'Start transcription'/);
  assert.match(audioNode, /官方接口不支持 webm/);
  assert.match(audioNode, /visibleUpstreamVideos/);
  assert.match(audioNode, /isWhisper \? \['video', 'audio'\]/);
  assert.match(audioNode, /orderedVideos\[0\]\?\.url/);
  assert.match(audioNode, /videos=\{orderedVideos\}/);
  assert.match(generation, /\/api\/proxy\/audio\/whisper\/transcribe/);
  assert.match(audioNode, /transcriptSegments: evidence\.segments/);
  assert.match(audioNode, /transcriptAttribution: evidence\.attribution/);
  assert.match(proxy, /seedanceNz\.transcribeAudio/);
  assert.match(proxy, /segments: Array\.isArray\(result\.segments\) \? result\.segments : \[\]/);
});

test('Whisper transcript evidence uses real provider segment windows and degrades to untimed text', () => {
  const segmented = buildWhisperTranscriptEvidence({
    text: 'raw transcript',
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    segments: [
      { start: 1.2, end: 3.456, text: ' 第一段 ' },
      { start: 5, end: 4, text: 'invalid' },
      { start: 3661.007, end: 3663, text: 'second\nsegment' },
    ],
  });
  assert.equal(segmented.attribution, 'provider-segments');
  assert.deepEqual(segmented.segments, [
    { start: 1.2, end: 3.456, text: '第一段' },
    { start: 3661.007, end: 3663, text: 'second segment' },
  ]);
  assert.equal(
    segmented.text,
    [
      '以下为 Whisper 返回的语音分段时间窗（非逐词时间戳）：',
      '[00:00:01.200 - 00:00:03.456] 第一段',
      '[01:01:01.007 - 01:01:03.000] second segment',
    ].join('\n'),
  );

  const untimed = buildWhisperTranscriptEvidence({
    text: 'plain transcript',
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    segments: [],
  });
  assert.deepEqual(untimed, {
    text: 'plain transcript',
    segments: [],
    attribution: 'untimed',
  });
});

test('proxy keeps Happy Horse and Seed Audio on the domestic key and stores outputs locally', () => {
  const proxy = read('../backend/src/routes/proxy.js');
  assert.match(proxy, /seedanceNz\.submitHappyHorseTask/);
  assert.match(proxy, /seedanceNz\.submitAudioTask/);
  assert.match(proxy, /settings\?\.zhenzhenSd2ApiKey/);
  assert.match(proxy, /materializeRemoteTaskOutput\(\{[\s\S]*?remoteUrl: result\.videoUrl,[\s\S]*?kind: 'video',[\s\S]*?materializationKey: `happyhorse-nz:\$\{req\.params\.tid\}`,[\s\S]*?providerFetchImpl: seedanceNz\.fetchRemote/);
  assert.match(proxy, /materializeSeedanceNzAudioResults\(result, req\.params\.tid\)/);
  assert.match(proxy, /remoteUrls\[index\][\s\S]*?kind: 'audio',[\s\S]*?materializationKey: `seed-audio-nz:\$\{taskId\}:\$\{index\}`/);
});
