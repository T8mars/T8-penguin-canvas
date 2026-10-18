import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import {
  buildBatchTagPrompt,
  buildBatchTagSidecarNames,
  classifyBatchTagFile,
  parseBatchTagOutput,
  recommendedBatchTagModel,
  summarizeBatchTagSidecarDestination,
  type BatchTagMode,
  type BatchTagMediaKind,
} from '../src/utils/batchTagger.ts';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

const require = createRequire(import.meta.url);

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

test('batch tagger utilities classify image/video files and keep sidecar names aligned to source prefixes', () => {
  assert.equal(classifyBatchTagFile('portrait.PNG', 'image/png'), 'image');
  assert.equal(classifyBatchTagFile('clip.webm', ''), 'video');
  assert.equal(classifyBatchTagFile('notes.txt', 'text/plain'), null);

  assert.deepEqual(
    buildBatchTagSidecarNames({
      name: '角色 01.final.png',
      relativePath: 'sets/角色 01.final.png',
      formats: ['txt', 'json'],
    }),
    {
      txt: 'sets/角色_01.final.txt',
      json: 'sets/角色_01.final.json',
    },
  );

  assert.equal(
    buildBatchTagSidecarNames({
      name: 'clip.mp4',
      relativePath: 'video/day/clip.mp4',
      formats: ['txt'],
    }).txt,
    'video/day/clip.txt',
  );
});

test('batch tagger prompt and parser support tags, short captions, and structured JSON output', () => {
  const tagsPrompt = buildBatchTagPrompt({
    mode: 'tags',
    mediaKind: 'image',
    fileName: 'demo.png',
    language: 'zh-CN',
    maxTags: 12,
  });
  assert.match(tagsPrompt, /逗号分隔/);
  assert.match(tagsPrompt, /最多 12 个/);
  assert.match(tagsPrompt, /不要输出 Markdown/);
  assert.match(tagsPrompt, /Only output|直接输出|不要包含任何开场白/);
  assert.doesNotMatch(tagsPrompt, /looking for information|would you like|是否需要我/i);
  assert.equal(
    buildBatchTagPrompt({
      mode: 'tags',
      mediaKind: 'image',
      customPrompt: '只输出英文训练标签',
    }).includes('只输出英文训练标签'),
    false,
  );

  const captionPrompt = buildBatchTagPrompt({
    mode: 'caption',
    mediaKind: 'image',
    fileName: 'portrait.png',
    language: 'zh-CN',
  });
  assert.match(captionPrompt, /Output the description directly|直接输出/);
  assert.doesNotMatch(captionPrompt, /Are you looking|would you like|需要.*帮助/i);

  const ideogramPrompt = buildBatchTagPrompt({
    mode: 'json',
    mediaKind: 'image',
    fileName: 'portrait.png',
    language: 'zh-CN',
    maxTags: 20,
  });
  assert.match(ideogramPrompt, /Ideogram-?4/i);
  assert.match(ideogramPrompt, /high_level_description/);
  assert.match(ideogramPrompt, /style_description/);
  assert.match(ideogramPrompt, /compositional_deconstruction/);
  assert.match(ideogramPrompt, /bbox/);
  assert.match(ideogramPrompt, /no markdown|不要 Markdown/i);
  assert.doesNotMatch(ideogramPrompt, /shortCaption|audioUnsupported|segments/);

  assert.deepEqual(parseBatchTagOutput('cat, blue eyes, blue eyes, studio light', 'tags'), {
    text: 'cat, blue eyes, studio light',
    tags: ['cat', 'blue eyes', 'studio light'],
    caption: '',
    shortCaption: '',
    metadata: null,
    rawText: 'cat, blue eyes, blue eyes, studio light',
  });

  assert.equal(parseBatchTagOutput('一只蓝眼猫坐在窗边', 'short').shortCaption, '一只蓝眼猫坐在窗边');

  const parsedJson = parseBatchTagOutput('```json\n{"high_level_description":"A cat on a sofa.","style_description":{"aesthetics":"quiet","lighting":"soft daylight","photo":"phone snapshot","medium":"photograph","color_palette":["#abcdef"]},"compositional_deconstruction":{"background":"plain sofa","elements":[{"type":"obj","bbox":[100,200,800,900],"desc":"Grey cat sitting upright."}]}}\n```', 'json');
  assert.deepEqual(parsedJson.tags, []);
  assert.equal(parsedJson.caption, 'A cat on a sofa.');
  assert.equal(parsedJson.metadata?.high_level_description, 'A cat on a sofa.');
  assert.deepEqual(parsedJson.metadata?.style_description?.color_palette, ['#abcdef']);

  const wrappedJson = parseBatchTagOutput('结果如下：\n{"high_level_description":"Blue cup on a table.","style_description":{"aesthetics":"minimal","lighting":"soft daylight","photo":"product photo","medium":"photograph","color_palette":["#1B3A5C"]},"compositional_deconstruction":{"background":"white tabletop","elements":[]}}\n请保存。', 'json');
  assert.deepEqual(wrappedJson.tags, []);
  assert.equal(wrappedJson.caption, 'Blue cup on a table.');
});

test('batch tagger completion notice reports browser-sidecar and upload-copy fallbacks honestly', () => {
  assert.equal(
    summarizeBatchTagSidecarDestination([
      {
        sourcePath: '',
        outputFiles: [
          {
            path: 'browser-fs://ComfyUI_00006_fhrxf_1782377039.txt',
            directory: '浏览器授权的原素材目录',
          },
        ],
      },
    ]),
    '批量打标完成，结果已写回浏览器授权的原素材目录',
  );

  assert.equal(
    summarizeBatchTagSidecarDestination([
      {
        sourcePath: '',
        outputFiles: [
          {
            path: 'E:\\PenguinPravite\\T8-penguin-canvas\\input\\ComfyUI_00006_fhrxf_1782377039-11.txt',
            directory: 'E:\\PenguinPravite\\T8-penguin-canvas\\input',
          },
        ],
      },
    ]),
    '批量打标完成，但有结果仅保存到上传副本目录（input）；请授权原素材目录后重试',
  );

  assert.equal(
    summarizeBatchTagSidecarDestination([
      {
        sourcePath: 'C:\\Users\\Administrator\\Desktop\\工作流(2)\\demo.png',
        outputFiles: [
          {
            path: 'C:\\Users\\Administrator\\Desktop\\工作流(2)\\demo.txt',
            directory: 'C:\\Users\\Administrator\\Desktop\\工作流(2)',
          },
        ],
      },
    ]),
    '批量打标完成，结果已保存到原素材目录',
  );
});

test('batch tagger recommends ModelScope Qwen3-VL 235B for visual tagging', () => {
  assert.equal(
    recommendedBatchTagModel({
      providerSource: 'modelscope',
      requestedModel: '',
      mediaKind: 'image',
      chatModels: ['Qwen/Qwen3-235B-A22B', 'Qwen/Qwen3-VL-235B-A22B-Instruct'],
    }),
    'Qwen/Qwen3-VL-235B-A22B-Instruct',
  );
  assert.equal(
    recommendedBatchTagModel({
      providerSource: 'modelscope',
      requestedModel: 'Qwen/Qwen3-235B-A22B',
      mediaKind: 'video',
      chatModels: ['Qwen/Qwen3-235B-A22B', 'Qwen/Qwen3-VL-235B-A22B-Instruct'],
    }),
    'Qwen/Qwen3-VL-235B-A22B-Instruct',
  );
  assert.equal(
    recommendedBatchTagModel({
      providerSource: 'zhenzhen',
      requestedModel: '',
      mediaKind: 'image',
    }),
    'gpt-4o-mini',
  );
});

test('batch tagger node is registered as an image/video toolbox node with UI and feature metadata', () => {
  const types = read('src/types/canvas.ts');
  const canvas = read('src/components/Canvas.tsx');
  const loop = read('src/components/nodes/LoopNode.tsx');
  const placement = read('src/utils/nodePlacement.ts');
  const server = read('backend/src/server.js');
  const postBuild = read('electron/_post_build.cjs');
  const node = read('src/components/nodes/BatchTaggerNode.tsx');
  const batchRoute = read('backend/src/routes/batchTags.js');
  const features = read('features.json');
  const preload = read('electron/preload.cjs');
  const electronMain = read('electron/main.cjs');
  const filesRoute = read('backend/src/routes/files.js');
  const imageOps = read('src/services/imageOps.ts');
  const viteEnv = read('src/vite-env.d.ts');
  const styles = read('src/styles/index.css');

  assertProductionNodeSchema('batch-tagger', {
    label: '批量打标',
    category: 'toolbox',
    inputs: ['image', 'video', 'text'],
    outputs: ['text', 'metadata'],
    executable: true,
  });
  assert.match(types, /\|\s*'batch-tagger'/);
  assert.match(canvas, /const BatchTaggerNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/BatchTaggerNode'\)/);
  assert.match(canvas, /'batch-tagger':\s*BatchTaggerNode/);
  assert.match(canvas, /'batch-tagger':\s*\{[\s\S]*batchTagMode:\s*'tags'[\s\S]*batchTagFormats:\s*\['txt'\]/);
  assert.match(loop, /EXECUTABLE_NODE_TYPES\.has\(n\.type as string\)/);
  assert.match(placement, /'batch-tagger':\s*\{\s*w:\s*720,\s*h:\s*620\s*\}/);
  assert.match(server, /batchTagsRouter/);
  assert.match(postBuild, /routes',\s*'batchTags\.t8c'/);
  assert.match(features, /"nodeType":\s*"batch-tagger"/);
  assert.match(node, /Qwen\/Qwen3-VL-235B-A22B-Instruct/);
  assert.match(node, /BATCH_TAGGER_EXTERNAL_TOOL_URL = 'https:\/\/zhaotutu\.xyz'/);
  assert.match(node, /最好的打标工具-图图打标器：点击获取/);
  assert.match(node, /t8-batch-tagger-tool-link/);
  assert.match(node, /background:\s*'#f8fafc'/);
  assert.match(node, /color:\s*'#0f172a'/);
  assert.match(node, /border:\s*'1px solid rgba\(15,\s*23,\s*42,\s*0\.45\)'/);
  assert.match(styles, /button\.t8-batch-tagger-tool-link/);
  assert.match(styles, /button\.t8-batch-tagger-tool-link \*/);
  assert.match(styles, /color:\s*#0f172a\s*!important/);
  assert.match(styles, /text-shadow:\s*none\s*!important/);
  assert.match(styles, /opacity:\s*1\s*!important/);
  assert.match(node, /openBatchTaggerExternalTool/);
  assert.match(node, /window\.t8pc\?\.openExternal/);
  assert.match(node, /result\?\.success === true/);
  assert.match(node, /window\.open\(BATCH_TAGGER_EXTERNAL_TOOL_URL,\s*'_blank',\s*'noopener,noreferrer'\)/);
  assert.match(node, /webkitdirectory/);
  assert.match(node, /停止/);
  assert.match(node, /output\/batch-tags/);
  assert.match(node, /原素材目录/);
  assert.match(node, /const selectedFormat: BatchTagSidecarFormat =/);
  assert.match(node, /requestedFormats\.includes\('json'\) && !requestedFormats\.includes\('txt'\) \? 'json' : 'txt'/);
  assert.match(node, /const formats = \[selectedFormat\] as BatchTagSidecarFormat\[\]/);
  assert.match(node, /const selectFormat = \(format: BatchTagSidecarFormat\) =>/);
  assert.match(node, /nativePathForFile\(file\)/);
  assert.match(node, /sourcePath:\s*nativeSourcePath/);
  assert.match(node, /importLocalBatchTagPath/);
  assert.match(node, /pickMediaFiles/);
  assert.match(node, /openLocalPath/);
  assert.match(node, /browserSidecarTargetsRef/);
  assert.match(node, /showDirectoryPicker/);
  assert.match(node, /writeBrowserDirectoryText/);
  assert.match(node, /mirrorBrowserSidecars/);
  assert.match(node, /needsBrowserSidecarTarget/);
  assert.match(node, /ensureBrowserSidecarTargetsForRun/);
  assert.match(node, /await ensureBrowserSidecarTargetsForRun\(workEntries\.map\(\(entry\) => entry\.item\)\)/);
  assert.match(node, /summarizeBatchTagSidecarDestination\(nextItems\)/);
  assert.match(node, /createWritable/);
  assert.match(node, /latestOutputDir/);
  assert.match(node, /latestOutputPath/);
  assert.match(node, /allOutputFiles/);
  assert.match(node, /showAllOutputPaths/);
  assert.match(node, /查看全部路径/);
  assert.match(node, /data-batch-tag-output-paths/);
  assert.match(node, /openLocalPath\(latestOutputPath \|\| latestOutputDir,\s*\{ selectFile: Boolean\(latestOutputPath\) \}\)/);
  assert.match(filesRoute, /router\.post\('\/import-local'/);
  assert.match(filesRoute, /router\.post\('\/open-local-path'/);
  assert.match(filesRoute, /selectFile/);
  assert.match(imageOps, /export async function openLocalPath/);
  assert.match(imageOps, /selectFile\?: boolean/);
  assert.match(electronMain, /dialog/);
  assert.match(electronMain, /ipcMain\.handle\('t8pc:pick-media-files'/);
  assert.match(preload, /pickMediaFiles:\s*\(options\)/);
  assert.match(preload, /webUtils/);
  assert.match(preload, /getPathForFile:\s*\(file\)/);
  assert.match(viteEnv, /pickMediaFiles\?:/);
  assert.match(viteEnv, /getPathForFile\?:\s*\(file:\s*File\)\s*=>\s*string/);
  assert.match(node, /type="radio"/);
  assert.match(node, /checked=\{selectedFormat === 'txt'\}/);
  assert.match(node, /checked=\{selectedFormat === 'json'\}/);
  assert.doesNotMatch(node, /toggleFormat\(/);
  assert.doesNotMatch(node, /formats\.includes\('txt'\)/);
  assert.match(node, /gridTemplateColumns:\s*'minmax\(0, 1fr\) 300px'/);
  assert.match(node, /gridTemplateColumns:\s*'14px 38px minmax\(0, 1fr\) 64px 28px'/);
  assert.match(node, /upstream\.texts/);
  assert.match(node, /已使用上游触发词/);
  assert.match(node, /统一触发词/);
  assert.match(node, /triggerText:\s*effectiveTrigger/);
  assert.doesNotMatch(node, /自定义 PROMPT/);
  assert.doesNotMatch(node, /customPrompt:\s*effectivePrompt/);
  assert.doesNotMatch(node, /batchTagMode:\s*event\.target\.value\.trim\(\)\s*\?/);
  assert.match(node, /submissionKey = baseKey[\s\S]*`\$\{baseKey\}:batch-tag:\$\{entry\.index\}`/);
  assert.match(node, /'X-T8-Provider-Submission': submissionKey/);
  assert.match(node, /await reporter\?\.providerRequest/);
  assert.match(node, /await reporter\?\.providerResponse/);
  assert.match(node, /await runBatch\(retryOnly, reporter\)/);
  assert.match(batchRoute, /router\.use\(providerSubmissionContextMiddleware\)/);
});

test('batch tagger plain file upload does not open a second browser directory picker', () => {
  const node = read('src/components/nodes/BatchTaggerNode.tsx');
  const fileChangeMatch = node.match(/const handleFileChange =[\s\S]*?const handleDrop =/);
  assert.ok(fileChangeMatch, 'handleFileChange block should exist');
  assert.doesNotMatch(fileChangeMatch[0], /pickBrowserSidecarDirectory/);
  assert.doesNotMatch(fileChangeMatch[0], /请选择原素材所在文件夹/);

  const runPermissionMatch = node.match(/const ensureBrowserSidecarTargetsForRun =[\s\S]*?const mirrorBrowserSidecars =/);
  assert.ok(runPermissionMatch, 'ensureBrowserSidecarTargetsForRun block should exist');
  assert.doesNotMatch(runPermissionMatch[0], /pickBrowserSidecarDirectory/);
  assert.doesNotMatch(runPermissionMatch[0], /showDirectoryPicker/);
  assert.match(runPermissionMatch[0], /浏览器文件上传无法自动写回原目录/);
  assert.match(runPermissionMatch[0], /文件夹.*导入/);
});

test('batch tagger material queue exposes per-item delete without leaving stale results', () => {
  const node = read('src/components/nodes/BatchTaggerNode.tsx');

  assert.match(node, /Trash2/);
  assert.match(node, /const removeItem = \(index: number\) =>/);
  assert.match(node, /const nextItems = allItems\.filter\(\(_, itemIndex\) => itemIndex !== index\)/);
  assert.match(node, /const successItems = nextItems\.filter\(\(item\) => item\.status === 'success'\)/);
  assert.match(node, /batchTagItems:\s*nextItems/);
  assert.match(node, /batchTagResults:\s*nextItems\.filter\(\(item\) => item\.status === 'success' \|\| item\.status === 'error'\)/);
  assert.match(node, /batchTagProgress:\s*summarizeBatchProgress\(nextItems as any\)/);
  assert.match(node, /outputText:\s*successItems\.map/);
  assert.match(node, /data-batch-tag-item-action="delete"/);
  assert.match(node, /aria-label=\{`删除素材 \$\{index \+ 1\}`\}/);
  assert.match(node, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); removeItem\(index\); \}\}/);
  assert.match(node, /disabled=\{running\}/);
});

test('batch tagger zhenzhen model picker offers LLM vision presets while keeping custom models', () => {
  const node = read('src/components/nodes/BatchTaggerNode.tsx');
  const models = read('src/providers/models.ts');

  assert.match(node, /import \{ LLM_MODELS \} from '..\/..\/providers\/models'/);
  assert.match(node, /const BATCH_TAGGER_ZHENZHEN_MODELS = LLM_MODELS\.filter\(\(model\) => model\.vision && !model\.imageOutput\)/);
  assert.match(node, /const isZhenzhenCustomModel = d\.batchTagUseCustomModel === true/);
  assert.match(node, /const zhenzhenModelPresetValue = isZhenzhenCustomModel \|\| !BATCH_TAGGER_ZHENZHEN_MODELS\.some/);
  assert.match(models, /gemini-3\.1-flash-lite-preview/);
  assert.match(models, /Gemini 3\.5 Flash/);
  assert.match(models, /gpt-4o/);
  assert.match(models, /gemini-3\.1-pro-preview/);
  assert.match(models, /gpt-5/);
  assert.match(models, /imageOutput:\s*true/);
  assert.match(node, /<option value="__custom__">Custom \/ 自定义<\/option>/);
  assert.match(node, /value=\{zhenzhenModelPresetValue\}/);
  assert.match(node, /batchTagProviderModel: event\.target\.value/);
  assert.match(node, /batchTagUseCustomModel/);
  assert.match(node, /batchTagUseCustomModel:\s*true/);
  assert.match(node, /batchTagUseCustomModel:\s*false/);
  assert.match(node, /zhenzhenModelPresetValue === '__custom__'/);
});

test('batch tagger route helpers build provider messages and write same-prefix txt/json sidecars', async () => {
  const route = require('../backend/src/routes/batchTags.js');
  assert.equal(typeof route.buildBatchTagMessages, 'function');
  assert.equal(typeof route.writeBatchTagSidecars, 'function');
  assert.match(read('backend/src/routes/batchTags.js'), /clientGone/);

  const modes: BatchTagMode[] = ['tags', 'caption', 'short', 'json'];
  const kinds: BatchTagMediaKind[] = ['image', 'video'];
  assert.equal(modes.includes('json') && kinds.includes('video'), true);

  const messages = route.buildBatchTagMessages({
    item: {
      kind: 'video',
      url: '/files/input/clip.mp4',
      name: 'clip.mp4',
    },
    mode: 'json',
    model: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
    videoMode: 'frames',
    frameCount: 8,
    customPrompt: 'zhenzhen,',
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Ideogram-?4/i);
  assert.match(messages[0].content, /high_level_description/);
  assert.doesNotMatch(messages[0].content, /zhenzhen/);
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content.some((part: any) => part.type === 'video_url'), true);
  assert.match(messages[1].content[0].text, /Analyze the provided video/i);
  assert.doesNotMatch(messages[1].content[0].text, /shortCaption|audioUnsupported/);

  const dir = mkdtempSync(join(tmpdir(), 't8-batch-tags-'));
  try {
    const saved = route.writeBatchTagSidecars({
      outputRoot: dir,
      item: { name: '角色 01.png', relativePath: 'setA/角色 01.png' },
      parsed: {
        text: '{"high_level_description":"A grey cat on a sofa.","style_description":{"aesthetics":"quiet","lighting":"soft daylight","photo":"phone snapshot","medium":"photograph","color_palette":["#abcdef"]},"compositional_deconstruction":{"background":"plain sofa","elements":[{"type":"obj","bbox":[100,200,800,900],"desc":"Grey cat sitting upright."}]}}',
        tags: [],
        caption: 'A grey cat on a sofa.',
        shortCaption: '',
        metadata: {
          high_level_description: 'A grey cat on a sofa.',
          style_description: {
            aesthetics: 'quiet',
            lighting: 'soft daylight',
            photo: 'phone snapshot',
            medium: 'photograph',
            color_palette: ['#abcdef'],
          },
          compositional_deconstruction: {
            background: 'plain sofa',
            elements: [{ type: 'obj', bbox: [100, 200, 800, 900], desc: 'Grey cat sitting upright.' }],
          },
        },
        rawText: '{"high_level_description":"A grey cat on a sofa."}',
      },
      formats: ['txt', 'json'],
      mode: 'json',
      triggerText: 'zhenzhen,',
      overwrite: false,
    });

    assert.equal(saved.length, 2);
    assert.equal(saved[0].name, 'setA/角色_01.txt');
    assert.equal(saved[1].name, 'setA/角色_01.json');
    const savedTxt = readFileSync(saved[0].path, 'utf8');
    assert.match(savedTxt, /"high_level_description": "zhenzhen, A grey cat on a sofa\."/);
    const savedJson = JSON.parse(readFileSync(saved[1].path, 'utf8'));
    assert.equal(savedJson.high_level_description, 'zhenzhen, A grey cat on a sofa.');
    assert.equal(savedJson.sourceFile, undefined);
    assert.equal(savedJson.trigger, undefined);
    assert.equal(savedJson.caption, undefined);
    assert.deepEqual(savedJson.style_description.color_palette, ['#ABCDEF']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch tagger trigger words prefix saved text without changing top mode output shape', async () => {
  const route = require('../backend/src/routes/batchTags.js');
  const dir = mkdtempSync(join(tmpdir(), 't8-batch-tags-trigger-'));
  try {
    const saved = route.writeBatchTagSidecars({
      outputRoot: dir,
      item: { name: 'portrait.png', relativePath: 'setB/portrait.png' },
      parsed: {
        text: 'A woman holding a glass of red wine.',
        tags: [],
        caption: 'A woman holding a glass of red wine.',
        shortCaption: '',
        metadata: null,
        rawText: 'A woman holding a glass of red wine.',
      },
      formats: ['txt', 'json'],
      mode: 'caption',
      triggerText: 'zhenzhen，',
      overwrite: false,
    });

    assert.equal(saved.length, 2);
    assert.equal(saved[0].name, 'setB/portrait.txt');
    assert.equal(saved[1].name, 'setB/portrait.json');
    const txt = readFileSync(saved[0].path, 'utf8');
    const jsonSuffixText = readFileSync(saved[1].path, 'utf8');
    assert.equal(txt, 'zhenzhen, A woman holding a glass of red wine.\n');
    assert.equal(jsonSuffixText, txt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch tagger defaults to txt sidecars and saves local file tags beside the source material', async () => {
  const route = require('../backend/src/routes/batchTags.js');
  const config = require('../backend/src/config.js');
  const oldConfig = {
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
  };
  const root = mkdtempSync(join(tmpdir(), 't8-batch-tags-local-'));
  try {
    config.INPUT_DIR = join(root, 'input');
    config.OUTPUT_DIR = join(root, 'output');
    mkdirSync(join(config.INPUT_DIR, 'setA'), { recursive: true });
    mkdirSync(config.OUTPUT_DIR, { recursive: true });

    const saved = route.writeBatchTagSidecars({
      item: {
        kind: 'image',
        name: 'portrait.png',
        url: '/files/input/setA/portrait.png',
      },
      parsed: {
        text: 'portrait, studio light',
        tags: ['portrait', 'studio light'],
        caption: '',
        shortCaption: '',
        metadata: null,
        rawText: 'portrait, studio light',
      },
      overwrite: false,
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].format, 'txt');
    assert.equal(saved[0].name, 'portrait.txt');
    assert.equal(saved[0].url, '/files/input/setA/portrait.txt');
    assert.equal(saved[0].path, join(config.INPUT_DIR, 'setA', 'portrait.txt'));
    assert.match(readFileSync(saved[0].path, 'utf8'), /portrait, studio light/);
    assert.equal(existsSync(join(config.OUTPUT_DIR, 'batch-tags', 'portrait.txt')), false);

    const sourceDir = join(root, 'native-source');
    mkdirSync(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, 'native portrait.png');
    writeFileSync(sourcePath, 'placeholder');
    const nativeSaved = route.writeBatchTagSidecars({
      item: {
        kind: 'image',
        name: 'native portrait.png',
        url: '/files/input/up_renamed.png',
        sourcePath,
      },
      parsed: {
        text: 'native portrait, soft light',
        tags: ['native portrait', 'soft light'],
        caption: '',
        shortCaption: '',
        metadata: null,
        rawText: 'native portrait, soft light',
      },
      overwrite: false,
    });

    assert.equal(nativeSaved.length, 1);
    assert.equal(nativeSaved[0].name, 'native_portrait.txt');
    assert.equal(nativeSaved[0].path, join(sourceDir, 'native_portrait.txt'));
    assert.equal(nativeSaved[0].directory, sourceDir);
    assert.equal(nativeSaved[0].url, '');
    assert.match(readFileSync(nativeSaved[0].path, 'utf8'), /native portrait, soft light/);
    assert.equal(existsSync(join(config.OUTPUT_DIR, 'batch-tags', 'native_portrait.txt')), false);
  } finally {
    config.INPUT_DIR = oldConfig.INPUT_DIR;
    config.OUTPUT_DIR = oldConfig.OUTPUT_DIR;
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch tagger saves sidecars beside source files placed at a drive root without mkdiring the root', () => {
  const route = require('../backend/src/routes/batchTags.js');
  const fsModule = require('node:fs');
  const rootDir = parse(process.cwd()).root;
  const sourcePath = join(rootDir, 'ComfyUI_00001_root_source.png');
  const targetPath = join(rootDir, 'ComfyUI_00001_root_source.txt');
  const original = {
    statSync: fsModule.statSync,
    existsSync: fsModule.existsSync,
    mkdirSync: fsModule.mkdirSync,
    writeFileSync: fsModule.writeFileSync,
  };
  const mkdirCalls: string[] = [];
  const writes: Array<{ path: string; text: string }> = [];
  try {
    fsModule.statSync = (target: string) => {
      if (target === sourcePath) return { isFile: () => true, isDirectory: () => false };
      return original.statSync(target);
    };
    fsModule.existsSync = (target: string) => {
      if (target === rootDir) return true;
      if (target === targetPath) return false;
      return original.existsSync(target);
    };
    fsModule.mkdirSync = (target: string, options?: unknown) => {
      mkdirCalls.push(target);
      if (target === rootDir || target === dirname(targetPath)) {
        throw new Error(`mkdir should not be called for root: ${target}`);
      }
      return original.mkdirSync(target, options as any);
    };
    fsModule.writeFileSync = (target: string, text: string, options?: unknown) => {
      if (target === targetPath) {
        writes.push({ path: target, text });
        return;
      }
      return original.writeFileSync(target, text, options as any);
    };

    const saved = route.writeBatchTagSidecars({
      item: {
        kind: 'image',
        name: 'ComfyUI_00001_root_source.png',
        url: '/files/input/up_root_source.png',
        sourcePath,
      },
      parsed: {
        text: 'root source, sidecar',
        tags: ['root source', 'sidecar'],
        caption: '',
        shortCaption: '',
        metadata: null,
        rawText: 'root source, sidecar',
      },
      formats: ['txt'],
      overwrite: false,
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].path, targetPath);
    assert.equal(saved[0].directory, rootDir);
    assert.deepEqual(mkdirCalls, []);
    assert.deepEqual(writes, [{ path: targetPath, text: 'root source, sidecar\n' }]);
  } finally {
    fsModule.statSync = original.statSync;
    fsModule.existsSync = original.existsSync;
    fsModule.mkdirSync = original.mkdirSync;
    fsModule.writeFileSync = original.writeFileSync;
  }
});

test('batch tagger local import preserves native source path and opens the actual saved directory', async () => {
  const express = require('express');
  const batchTagsRoute = require('../backend/src/routes/batchTags.js');
  const config = require('../backend/src/config.js');
  const oldConfig = {
    DATA_DIR: config.DATA_DIR,
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
    THUMBNAILS_DIR: config.THUMBNAILS_DIR,
    PROJECT_DB_FILE: config.PROJECT_DB_FILE,
    PROJECT_DB_BACKUP_FILE: config.PROJECT_DB_BACKUP_FILE,
  };
  const root = mkdtempSync(join(tmpdir(), 't8-batch-tags-import-'));
  let projectDatabase: any = null;
  try {
    config.DATA_DIR = join(root, 'data');
    config.INPUT_DIR = join(root, 'input');
    config.OUTPUT_DIR = join(root, 'output');
    config.THUMBNAILS_DIR = join(root, 'thumbnails');
    config.PROJECT_DB_FILE = join(config.DATA_DIR, 't8-projects.sqlite3');
    config.PROJECT_DB_BACKUP_FILE = join(config.DATA_DIR, 't8-projects.sqlite3.backup');
    mkdirSync(config.DATA_DIR, { recursive: true });
    mkdirSync(config.INPUT_DIR, { recursive: true });
    mkdirSync(config.OUTPUT_DIR, { recursive: true });
    mkdirSync(config.THUMBNAILS_DIR, { recursive: true });
    const filesRouter = require('../backend/src/routes/files.js');
    projectDatabase = require('../backend/src/services/projectDatabase.js').getProjectDatabase(config);
    const sourceDir = join(root, '工作流(2)');
    mkdirSync(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, 'ComfyUI_00006_fhrxf_1782377039.png');
    writeFileSync(sourcePath, 'fake image bytes');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/files', filesRouter);
    const server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const importRes = await fetch(`${base}/api/files/import-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath }),
      });
      const imported = await importRes.json();
      assert.equal(importRes.ok, true, JSON.stringify(imported));
      assert.equal(imported.success, true);
      assert.equal(imported.data.sourcePath, sourcePath);
      assert.equal(imported.data.originalName, 'ComfyUI_00006_fhrxf_1782377039.png');
      assert.match(imported.data.url, /^\/files\/input\/up_/);
      assert.equal(existsSync(imported.data.path), true);

      const saved = batchTagsRoute.writeBatchTagSidecars({
        item: {
          kind: 'image',
          name: imported.data.originalName,
          url: imported.data.url,
          sourcePath: imported.data.sourcePath,
        },
        parsed: {
          text: 'gold dress, warm fireplace',
          tags: ['gold dress', 'warm fireplace'],
          caption: '',
          shortCaption: '',
          metadata: null,
          rawText: 'gold dress, warm fireplace',
        },
        formats: ['txt'],
        overwrite: false,
      });
      assert.equal(saved.length, 1);
      assert.equal(saved[0].directory, sourceDir);
      assert.equal(saved[0].path, join(sourceDir, 'ComfyUI_00006_fhrxf_1782377039.txt'));
      assert.equal(existsSync(saved[0].path), true);
      assert.equal(existsSync(join(config.INPUT_DIR, 'ComfyUI_00006_fhrxf_1782377039.txt')), false);

      const openRes = await fetch(`${base}/api/files/open-local-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: saved[0].path, selectFile: true, dryRun: true }),
      });
      const opened = await openRes.json();
      assert.equal(openRes.ok, true, JSON.stringify(opened));
      assert.equal(opened.success, true);
      assert.equal(opened.data.path, sourceDir);
      assert.equal(opened.data.targetPath, saved[0].path);
      assert.equal(opened.data.selectFile, true);
      assert.equal(opened.data.opened, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (projectDatabase) {
      try { await projectDatabase.createBackup(); } catch {}
      try { await projectDatabase.close(); } catch {}
    }
    config.DATA_DIR = oldConfig.DATA_DIR;
    config.INPUT_DIR = oldConfig.INPUT_DIR;
    config.OUTPUT_DIR = oldConfig.OUTPUT_DIR;
    config.THUMBNAILS_DIR = oldConfig.THUMBNAILS_DIR;
    config.PROJECT_DB_FILE = oldConfig.PROJECT_DB_FILE;
    config.PROJECT_DB_BACKUP_FILE = oldConfig.PROJECT_DB_BACKUP_FILE;
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch tagger infers browser development sources from configured external source roots', async () => {
  const route = require('../backend/src/routes/batchTags.js');
  const config = require('../backend/src/config.js');
  const oldConfig = {
    BASE_DIR: config.BASE_DIR,
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
    DATA_DIR: config.DATA_DIR,
    THUMBNAILS_DIR: config.THUMBNAILS_DIR,
    IS_PACKAGED: config.IS_PACKAGED,
  };
  const oldEnv = process.env.T8PC_BATCH_TAG_SOURCE_ROOTS;
  const root = mkdtempSync(join(tmpdir(), 't8-batch-tags-external-dev-'));
  const externalRoot = mkdtempSync(join(tmpdir(), 't8-batch-tags-external-root-'));
  try {
    const projectDir = join(root, 'T8-penguin-canvas');
    const sourceDir = join(externalRoot, '工作流(2)');
    config.BASE_DIR = projectDir;
    config.INPUT_DIR = join(projectDir, 'input');
    config.OUTPUT_DIR = join(projectDir, 'output');
    config.DATA_DIR = join(projectDir, 'data');
    config.THUMBNAILS_DIR = join(projectDir, 'thumbnails');
    config.IS_PACKAGED = false;
    process.env.T8PC_BATCH_TAG_SOURCE_ROOTS = externalRoot;
    mkdirSync(config.INPUT_DIR, { recursive: true });
    mkdirSync(config.OUTPUT_DIR, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const sourceName = 'ComfyUI_00001_ambrx_1783572999.png';
    const sourcePath = join(sourceDir, sourceName);
    const bytes = Buffer.alloc(212400, 8);
    writeFileSync(sourcePath, bytes);
    writeFileSync(join(config.INPUT_DIR, 'up_external_copy.png'), bytes);

    const saved = route.writeBatchTagSidecars({
      item: {
        kind: 'image',
        name: sourceName,
        relativePath: sourceName,
        url: '/files/input/up_external_copy.png',
        sourcePath: '',
        size: bytes.length,
      },
      parsed: {
        text: 'sports field, young woman',
        tags: ['sports field', 'young woman'],
        caption: '',
        shortCaption: '',
        metadata: null,
        rawText: 'sports field, young woman',
      },
      formats: ['txt'],
      overwrite: false,
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].directory, sourceDir);
    assert.equal(saved[0].path, join(sourceDir, 'ComfyUI_00001_ambrx_1783572999.txt'));
    assert.equal(existsSync(saved[0].path), true);
    assert.equal(existsSync(join(config.INPUT_DIR, 'ComfyUI_00001_ambrx_1783572999.txt')), false);
  } finally {
    config.BASE_DIR = oldConfig.BASE_DIR;
    config.INPUT_DIR = oldConfig.INPUT_DIR;
    config.OUTPUT_DIR = oldConfig.OUTPUT_DIR;
    config.DATA_DIR = oldConfig.DATA_DIR;
    config.THUMBNAILS_DIR = oldConfig.THUMBNAILS_DIR;
    config.IS_PACKAGED = oldConfig.IS_PACKAGED;
    if (oldEnv == null) delete process.env.T8PC_BATCH_TAG_SOURCE_ROOTS;
    else process.env.T8PC_BATCH_TAG_SOURCE_ROOTS = oldEnv;
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('batch tagger infers the original sibling source in browser development uploads', async () => {
  const route = require('../backend/src/routes/batchTags.js');
  const config = require('../backend/src/config.js');
  const oldConfig = {
    BASE_DIR: config.BASE_DIR,
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
    DATA_DIR: config.DATA_DIR,
    THUMBNAILS_DIR: config.THUMBNAILS_DIR,
    IS_PACKAGED: config.IS_PACKAGED,
  };
  const root = mkdtempSync(join(tmpdir(), 't8-batch-tags-browser-dev-'));
  try {
    const projectDir = join(root, 'T8-penguin-canvas');
    const sourceDir = join(root, '工作流(2)');
    config.BASE_DIR = projectDir;
    config.INPUT_DIR = join(projectDir, 'input');
    config.OUTPUT_DIR = join(projectDir, 'output');
    config.DATA_DIR = join(projectDir, 'data');
    config.THUMBNAILS_DIR = join(projectDir, 'thumbnails');
    config.IS_PACKAGED = false;
    mkdirSync(config.INPUT_DIR, { recursive: true });
    mkdirSync(config.OUTPUT_DIR, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const sourceName = 'ComfyUI_00006_fhrxf_1782377039.png';
    const sourcePath = join(sourceDir, sourceName);
    const bytes = Buffer.alloc(2283158, 7);
    writeFileSync(sourcePath, bytes);
    writeFileSync(join(config.INPUT_DIR, 'up_browser_copy.png'), bytes);

    const saved = route.writeBatchTagSidecars({
      item: {
        kind: 'image',
        name: sourceName,
        relativePath: sourceName,
        url: '/files/input/up_browser_copy.png',
        sourcePath: '',
        size: bytes.length,
      },
      parsed: {
        text: 'gold dress, warm fireplace',
        tags: ['gold dress', 'warm fireplace'],
        caption: '',
        shortCaption: '',
        metadata: null,
        rawText: 'gold dress, warm fireplace',
      },
      formats: ['txt'],
      overwrite: false,
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].directory, sourceDir);
    assert.equal(saved[0].path, join(sourceDir, 'ComfyUI_00006_fhrxf_1782377039.txt'));
    assert.equal(existsSync(saved[0].path), true);
    assert.equal(existsSync(join(config.INPUT_DIR, 'ComfyUI_00006_fhrxf_1782377039.txt')), false);
  } finally {
    config.BASE_DIR = oldConfig.BASE_DIR;
    config.INPUT_DIR = oldConfig.INPUT_DIR;
    config.OUTPUT_DIR = oldConfig.OUTPUT_DIR;
    config.DATA_DIR = oldConfig.DATA_DIR;
    config.THUMBNAILS_DIR = oldConfig.THUMBNAILS_DIR;
    config.IS_PACKAGED = oldConfig.IS_PACKAGED;
    rmSync(root, { recursive: true, force: true });
  }
});
