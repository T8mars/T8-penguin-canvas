import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findMediaMentionQuery,
  insertMediaMention,
  type MediaMention,
} from '../src/components/nodes/mediaMentions.ts';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('prompt editor shortcut is registered globally', () => {
  const shortcuts = read('../src/utils/keyboardShortcuts.ts');

  assert.match(shortcuts, /id:\s*'editor\.expand-prompt'/);
  assert.match(shortcuts, /label:\s*'放大编辑提示词'/);
  assert.match(shortcuts, /defaults:\s*\[\{\s*key:\s*'Enter',\s*alt:\s*true\s*\}\]/);
});

test('shared prompt editor components expose modal and textarea affordances', () => {
  const modal = read('../src/components/PromptExpandModal.tsx');
  const textarea = read('../src/components/PromptTextarea.tsx');

  assert.match(modal, /data-canvas-floating-ui="prompt-expand-editor"/);
  assert.match(modal, /flex min-h-0 flex-1 flex-col p-4/);
  assert.match(modal, /shared\.editorStats/);
  assert.match(modal, /readOnly \? t\('shared\.readOnlyField'\)/);
  assert.match(modal, /editorKind\?:\s*PromptExpandEditorKind/);
  assert.match(modal, /shared\.formatJson/);
  assert.match(modal, /shared\.validateJson/);
  assert.match(modal, /shared\.normalizeList/);
  assert.match(modal, /toolMessageError/);
  assert.match(modal, /stripCompositionLeak/);
  assert.match(modal, /createPlainInputRunSnapshot/);
  assert.match(modal, /compositionLeakRef/);
  assert.match(modal, /paddingLeft:\s*10/);

  assert.match(textarea, /PromptExpandModal/);
  assert.match(textarea, /data-prompt-expand-trigger/);
  assert.match(textarea, /matchesAnyShortcut\(expandCombos,\s*event\.nativeEvent\)/);
  assert.match(textarea, /shortcuts\['editor\.expand-prompt'\]/);
  assert.match(textarea, /editorKind=\{editorKind\}/);
  assert.match(textarea, /composingRef/);
  assert.match(textarea, /isImeCompositionInput/);
  assert.match(textarea, /stripCompositionLeak/);
  assert.match(textarea, /createPlainInputRunSnapshot/);
  assert.match(textarea, /compositionLeakRef/);
  assert.match(textarea, /onBeforeInput=\{handleBeforeInput\}/);
  assert.match(textarea, /onCompositionEnd=\{handleCompositionEnd\}/);
  assert.match(textarea, /paddingLeft:\s*textareaStyle\?\.paddingLeft \?\? 10/);
});

test('mention prompt input keeps media mentions in expanded editor', () => {
  const mention = read('../src/components/nodes/MentionPromptInput.tsx');

  assert.match(mention, /title\?:\s*string/);
  assert.match(mention, /expandable\?:\s*boolean/);
  assert.match(mention, /PromptExpandModal/);
  assert.match(mention, /data-prompt-expand-trigger/);
  assert.match(mention, /matchesAnyShortcut\(expandShortcuts,\s*e\.nativeEvent\)/);
  assert.match(mention, /isImeCompositionInput/);
  assert.match(mention, /stripCompositionLeak/);
  assert.match(mention, /createPlainInputRunSnapshot/);
  assert.match(mention, /compositionLeakRef\.current = createCompositionLeakSnapshot\(lastPlainInputRef\.current, now\)/);
  assert.match(mention, /onBeforeInput=\{\(event\) =>/);
  assert.match(mention, /if \(isImeCompositionInput\(event\.nativeEvent\)\) composingRef\.current = true/);
  assert.match(mention, /const nativeEvent = event\?\.nativeEvent/);
  assert.match(mention, /Some Chromium IME paths leave the component in a composing state/);
  assert.match(mention, /if \(composingRef\.current\) \{[\s\S]*composingRef\.current = false;/);
  assert.match(mention, /const flushEditorToData = \(\) =>/);
  assert.match(mention, /onBlur=\{\(\) => \{\s*composingRef\.current = false;\s*flushEditorToData\(\)/);
  assert.match(mention, /zIndex:\s*expandable \? 10050 : 10120/);
  assert.match(mention, /const fillLayout = fillHeight \|\| !expandable/);
  assert.match(mention, /height:\s*fillLayout \? '100%' : style\?\.height/);
  assert.match(mention, /minHeight:\s*fillLayout \? 0 : \(style\?\.minHeight \?\? 56\)/);
  assert.match(mention, /paddingLeft:\s*style\?\.paddingLeft \?\? 10/);
  assert.match(mention, /'display:inline-block'/);
  assert.match(mention, /'width:24px'/);
  assert.match(mention, /'height:24px'/);
  assert.match(mention, /'vertical-align:middle'/);
  assert.match(mention, /const content = document\.createElement\('span'\)/);
  assert.match(mention, /span\.replaceChildren\(content\)/);
  assert.match(mention, /expandable=\{false\}/);
  assert.match(mention, /setDraftMentions\(nextMentions\)/);
});

test('mention query ignores an existing media chip token before normal text', () => {
  const mentions: MediaMention[] = [
    {
      id: 'm-image',
      kind: 'image',
      materialKey: 'image:/files/input/monkey.png',
      url: '/files/input/monkey.png',
      token: '@image1',
      start: 0,
      end: '@image1'.length,
    },
  ];

  assert.equal(findMediaMentionQuery('@image1的女人在和', '@image1的女人在和'.length, mentions), null);
  assert.equal(findMediaMentionQuery('@猴 ', '@猴 '.length, []), null);
  assert.deepEqual(findMediaMentionQuery('@image1 @猴', '@image1 @猴'.length, mentions), {
    start: '@image1 '.length,
    end: '@image1 @猴'.length,
    query: '猴',
  });
});

test('mention query can start immediately after normal prompt text', () => {
  assert.deepEqual(findMediaMentionQuery('女人@', '女人@'.length, []), {
    start: '女人'.length,
    end: '女人@'.length,
    query: '',
  });
  assert.deepEqual(findMediaMentionQuery('女人@猴', '女人@猴'.length, []), {
    start: '女人'.length,
    end: '女人@猴'.length,
    query: '猴',
  });

  const material = {
    kind: 'image',
    url: '/files/input/monkey.png',
    label: '猴子',
  } as any;
  const result = insertMediaMention('女人@', [], material, [material], '女人'.length, '女人@'.length);
  assert.equal(result.text, '女人 @image1 ');
  assert.equal(result.caret, '女人 @image1 '.length);
  assert.equal(result.mentions.length, 1);
  assert.equal(result.mentions[0].start, '女人 '.length);
  assert.equal(result.mentions[0].end, '女人 @image1'.length);
});

test('text node media mentions can read downstream generation node media', () => {
  const textNode = read('../src/components/nodes/TextNode.tsx');
  const materialsHook = read('../src/components/nodes/useUpstreamMaterials.ts');
  const mediaMentions = read('../src/components/nodes/mediaMentions.ts');

  assert.match(textNode, /useDownstreamMediaMaterials/);
  assert.match(textNode, /const downstreamMedia = useDownstreamMediaMaterials\(id\)/);
  assert.match(textNode, /uniqueMentionMaterials\(\[/);
  assert.match(textNode, /\.\.\.downstreamMedia/);

  assert.match(materialsHook, /export function useDownstreamMediaMaterials/);
  assert.match(materialsHook, /useEdges/);
  assert.match(materialsHook, /handleType:\s*'source'/);
  assert.match(materialsHook, /conns\.map\(\(c\) => c\.target\)/);
  assert.match(materialsHook, /siblingMediaSourceIds/);
  assert.match(materialsHook, /targets\.has\(edge\.target\) && edge\.source !== nodeId/);
  assert.match(materialsHook, /\[\.\.\.siblingList,\s*\.\.\.downstreamList\]/);
  assert.match(materialsHook, /collectMentionableMediaFromNodeData/);
  assert.match(materialsHook, /referenceImages/);
  assert.match(materialsHook, /localRefImages/);
  assert.match(materialsHook, /localRefVideos/);
  assert.match(materialsHook, /localRefAudios/);
  assert.match(materialsHook, /localRefAudio/);
  assert.match(materialsHook, /generatedImages/);
  assert.match(materialsHook, /tracks/);

  assert.match(mediaMentions, /function tokenMatchesMentionKind/);
  assert.match(mediaMentions, /tokenMatchesMentionKind\(mention\) && text\.slice\(mention\.start,\s*mention\.end\) === mention\.token/);
});

test('core generation nodes use expanded prompt editing', () => {
  const image = read('../src/components/nodes/ImageNode.tsx');
  const video = read('../src/components/nodes/VideoNode.tsx');
  const seedance = read('../src/components/nodes/SeedanceNode.tsx');
  const audio = read('../src/components/nodes/AudioNode.tsx');
  const llm = read('../src/components/nodes/LLMNode.tsx');
  const panorama = read('../src/components/nodes/Panorama3DNode.tsx');

  assert.match(image, /import PromptTextarea from '\.\.\/PromptTextarea'/);
  assert.match(image, /title=\{translate\('nodes:image\.promptTitle'\)\}/);
  assert.match(image, /title="ComfyUI 正向 Prompt"/);
  assert.match(image, /title="ComfyUI 负向 Prompt"/);
  assert.match(image, /title="图像扩展模型 System Prompt"/);

  assert.match(video, /title=\{translate\('nodes:video\.promptTitle'\)\}/);
  assert.match(seedance, /title=\{isSeedance25 \? 'SD2\.5 Prompt' : 'SD2\.0 Prompt'\}/);
  assert.match(audio, /title=\{translate\('nodes:audio\.promptTitle'\)\}/);
  assert.match(llm, /title=\{t\('llm\.systemPromptTitle'\)\}/);
  assert.match(llm, /title=\{t\('llm\.userInputTitle'\)\}/);
  assert.match(panorama, /title="3D 全景提示词"/);
});

test('dynamic RH and ComfyUI text parameters use expanded prompt editing', () => {
  const runningHub = read('../src/components/nodes/RunningHubNode.tsx');
  const rhTools = read('../src/components/nodes/RHToolsNode.tsx');
  const comfyStore = read('../src/components/nodes/ComfyUIStoreNode.tsx');

  assert.match(runningHub, /import PromptTextarea from '\.\.\/PromptTextarea'/);
  assert.match(runningHub, /title=\{`RunningHub 参数 · \$\{it\.fieldName \|\| '文本'\} #\$\{it\.nodeId \|\| ''\}`\}/);
  assert.match(runningHub, /<PromptTextarea[\s\S]*readOnly/);

  assert.match(rhTools, /import PromptTextarea from '\.\.\/PromptTextarea'/);
  assert.match(rhTools, /title=\{`RH 工具箱参数 · \$\{it\.fieldName \|\| '文本'\} #\$\{it\.nodeId \|\| ''\}`\}/);
  assert.match(rhTools, /<PromptTextarea[\s\S]*readOnly/);

  assert.match(comfyStore, /import PromptTextarea from '\.\.\/PromptTextarea'/);
  assert.match(comfyStore, /title=\{`ComfyUI 参数 · \$\{param\.label\}`\}/);
  assert.match(comfyStore, /onValueChange=\{\(value\) => setParam\(param\.key,\s*value\)\}/);
});

test('configuration JSON and list editors reuse expanded prompt editing', () => {
  const apiSettings = read('../src/components/ApiSettings.tsx');
  const comfyMaker = read('../src/components/nodes/ComfyUIAppMakerNode.tsx');
  const rhEditor = read('../src/components/nodes/RHToolEditorModal.tsx');

  assert.match(apiSettings, /import PromptTextarea from '\.\/PromptTextarea'/);
  assert.match(apiSettings, /title="ComfyUI Workflow JSON"/);
  assert.match(apiSettings, /title="ComfyUI fields JSON"/);
  assert.match(apiSettings, /editorKind="json"/);
  assert.match(apiSettings, /editorKind="lines"/);
  assert.match(apiSettings, /title=\{t\('providerForm\.modelEditorTitle', \{ provider: provider\.label \|\| protocolLabel, kind: t\('providerForm\.imageKind'\) \}\)\}/);

  assert.match(comfyMaker, /import PromptTextarea from '\.\.\/PromptTextarea'/);
  assert.match(comfyMaker, /title="ComfyUI Workflow JSON"/);
  assert.match(comfyMaker, /title="ComfyUI 自动映射排除规则"/);

  assert.match(rhEditor, /title="RH 超市应用简介"/);
});
