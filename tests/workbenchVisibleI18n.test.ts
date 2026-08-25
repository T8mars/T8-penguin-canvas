import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import LocalizedVisibleTree, { localizeWorkbenchVisibleString } from '../src/i18n/LocalizedVisibleTree';
import {
  CREATOR_AGENT_STARTER_ENGLISH,
  localizeCreatorAgentStarterIdea,
} from '../src/i18n/creatorAgentStarterEnglish';
import {
  CREATOR_AGENT_VISIBLE_CATALOG,
  VIDEO_EDIT_VISIBLE_CATALOG,
  type WorkbenchVisibleCatalog,
} from '../src/i18n/workbenchVisibleCatalog';
import { INSPIRATION_VISIBLE_CATALOG } from '../src/i18n/inspirationVisibleCatalog';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function detectedVisibleChinese(value: string) {
  const entries = new Set<string>();
  const patterns = [
    />\s*([^<>{}\n]*[\u3400-\u9fff][^<>{}\n]*)\s*</g,
    /\b(?:title|placeholder|aria-label|aria-description)\s*=\s*["']([^"']*[\u3400-\u9fff][^"']*)["']/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of value.matchAll(pattern)) entries.add(String(match[1]).trim().replace(/\s+/g, ' '));
  });
  return entries;
}

function assertCatalogCoversVisibleSource(relativePath: string, catalog: WorkbenchVisibleCatalog) {
  const uncovered = Array.from(detectedVisibleChinese(source(relativePath)))
    .filter((entry) => !catalog.englishByChinese[entry]);
  assert.deepEqual(uncovered, []);
}

test('video editor visible literals are paired and both compact and portal surfaces use the locale boundary', () => {
  const node = source('src/components/nodes/VideoEditNode.tsx');
  assertCatalogCoversVisibleSource('src/components/nodes/VideoEditNode.tsx', VIDEO_EDIT_VISIBLE_CATALOG);
  assert.match(node, /function VideoEditVisible/);
  assert.match(node, /createPortal\(\s*<VideoEditVisible>/);
  assert.equal(localizeWorkbenchVisibleString(' 视频剪辑 ', 'videoEdit', VIDEO_EDIT_VISIBLE_CATALOG), ' Video Editor ');
  assert.equal(localizeWorkbenchVisibleString('3 段', 'videoEdit', VIDEO_EDIT_VISIBLE_CATALOG), '3 clips');
  assert.equal(localizeWorkbenchVisibleString('用户自己的提示词', 'videoEdit', VIDEO_EDIT_VISIBLE_CATALOG), '用户自己的提示词');
});

test('Creator Agent visible literals are paired while user/provider content remains outside translation matching', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assertCatalogCoversVisibleSource('src/components/CreatorAgentPanel.tsx', CREATOR_AGENT_VISIBLE_CATALOG);
  assert.match(panel, /function CreatorAgentVisible/);
  assert.match(panel, /<CreatorAgentVisible>[\s\S]*data-canvas-floating-ui="creator-agent-launcher"/);
  assert.match(panel, /function CreatorAgentMessageText/);
  assert.doesNotMatch(panel.slice(panel.indexOf('function CreatorAgentMessageText'), panel.indexOf('function eventReadinessReceipt')), /<CreatorAgentVisible>/);
  assert.equal(localizeWorkbenchVisibleString('贞贞创作 Agent', 'creatorAgent', CREATOR_AGENT_VISIBLE_CATALOG), 'Zhenzhen Creator Agent');
  assert.equal(localizeWorkbenchVisibleString('已引用 4', 'creatorAgent', CREATOR_AGENT_VISIBLE_CATALOG), '4 referenced');
  assert.equal(localizeWorkbenchVisibleString('当前状态：待确认', 'creatorAgent', CREATOR_AGENT_VISIBLE_CATALOG), 'Current status: Awaiting confirmation');
  assert.equal(localizeWorkbenchVisibleString('用户粘贴的中文剧本', 'creatorAgent', CREATOR_AGENT_VISIBLE_CATALOG), '用户粘贴的中文剧本');
});

test('every shared Creator Agent starter has a complete English interaction contract', () => {
  const catalog = JSON.parse(source('backend/src/shared/creatorAgentStarterCatalog.json')) as {
    modes: Record<string, Array<{
      id: string;
      batch: number;
      label: string;
      description: string;
      starterPrompt: string;
      intent: string;
      taskFamily: string;
      creatorKind: string;
      expectedFirstArtifact: string;
      requiredCapabilityIds: string[];
    }>>;
  };
  const ideas = Object.values(catalog.modes).flat();
  assert.deepEqual(Object.keys(CREATOR_AGENT_STARTER_ENGLISH).sort(), ideas.map((idea) => idea.id).sort());
  for (const idea of ideas) {
    const localized = localizeCreatorAgentStarterIdea(idea, 'en-US');
    assert.ok(localized.label && !/[\u3400-\u9fff]/.test(localized.label), `${idea.id} label`);
    assert.ok(localized.description && !/[\u3400-\u9fff]/.test(localized.description), `${idea.id} description`);
    assert.equal(localized.starterPrompt, idea.starterPrompt, `${idea.id} canonical starterPrompt`);
    assert.ok(localized.expectedFirstArtifact && !/[\u3400-\u9fff]/.test(localized.expectedFirstArtifact), `${idea.id} expectedFirstArtifact`);
    assert.equal(localizeCreatorAgentStarterIdea(idea, 'zh-CN'), idea);
  }
});

test('visible-tree boundary translates text and accessibility props while honoring explicit user-content skips', async () => {
  const instance = createInstance();
  await instance.init({ lng: 'en-US', resources: { 'en-US': { translation: {} } } });
  const markup = renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n: instance },
    createElement(
      LocalizedVisibleTree,
      { area: 'videoEdit', catalog: VIDEO_EDIT_VISIBLE_CATALOG },
      createElement('button', { key: 'button', title: '关闭' }, '视频剪辑'),
      createElement('span', { key: 'skip', 'data-i18n-skip': 'true' }, '取消'),
    ),
  ));
  assert.match(markup, /title="Close"/);
  assert.match(markup, />Video Editor<\/button>/);
  assert.match(markup, />取消<\/span>/);
});

test('the six inspiration nodes localize visible chrome while preserving persisted form values', async () => {
  const files = [
    'src/components/nodes/MiniMaxH3PromptEnhancerNode.tsx',
    'src/components/nodes/MiniMaxMusic3PromptEnhancerNode.tsx',
    'src/components/nodes/MinimaxH3OfficialPromptEnhancerNode.tsx',
    'src/components/nodes/Seedance20PromptEnhancerNode.tsx',
    'src/components/nodes/ArtistStyleMasterNode.tsx',
    'src/components/nodes/AnimeTagMasterNode.tsx',
  ];
  for (const file of files) assert.match(source(file), /InspirationVisible/);
  assert.match(source(files[4]), /createPortal\(\s*<InspirationVisible>/);
  assert.match(source(files[5]), /createPortal\(\s*<InspirationVisible>/);

  const instance = createInstance();
  await instance.init({ lng: 'en-US', resources: { 'en-US': { translation: {} } } });
  const markup = renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n: instance },
    createElement(
      LocalizedVisibleTree,
      { area: 'inspiration', catalog: INSPIRATION_VISIBLE_CATALOG },
      createElement('label', { key: 'label' }, '镜头数量'),
      createElement('button', { key: 'button', title: '打开动漫标签库' }, '艺术风格大师'),
      createElement('input', { key: 'input', value: '用户自己的中文提示词', readOnly: true }),
      createElement('option', { key: 'option', value: 'Ref2VA' }, 'Ref2VA · 参考图/视频'),
    ),
  ));
  assert.match(markup, />Shot count<\/label>/);
  assert.match(markup, /title="Open anime tag library"/);
  assert.match(markup, />Artist Style Master<\/button>/);
  assert.match(markup, /value="用户自己的中文提示词"/);
  assert.match(markup, /value="Ref2VA">Ref2VA · reference image\/video<\/option>/);
});
