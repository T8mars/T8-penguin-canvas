import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROMPT_TEMPLATE_CATEGORIES,
  PROMPT_TEMPLATE_MIN_BUILTIN_PER_CATEGORY,
  countBuiltInPromptTemplatesByCategory,
  getBuiltInPromptTemplates,
  getPromptTemplateText,
  getPromptTemplateTitle,
} from '../src/data/promptTemplateLibrary.ts';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('built-in prompt template catalog covers image and video categories with 100+ templates each', () => {
  const templates = getBuiltInPromptTemplates();
  const counts = countBuiltInPromptTemplatesByCategory();
  const imageCategories = PROMPT_TEMPLATE_CATEGORIES.filter((category) => category.kind === 'image');
  const videoCategories = PROMPT_TEMPLATE_CATEGORIES.filter((category) => category.kind === 'video');

  assert.equal(imageCategories.length >= 8, true);
  assert.equal(videoCategories.length >= 8, true);
  for (const category of PROMPT_TEMPLATE_CATEGORIES) {
    assert.equal(
      (counts[category.id] || 0) >= PROMPT_TEMPLATE_MIN_BUILTIN_PER_CATEGORY,
      true,
      `${category.id} should have at least ${PROMPT_TEMPLATE_MIN_BUILTIN_PER_CATEGORY} built-in templates`,
    );
  }
  assert.ok(templates.find((item) => item.id === 'infinite-canvas-720-panorama'));
  assert.ok(templates.find((item) => item.source === 'infinite-canvas' && item.titleZh.includes('多机位九宫格')));
});

test('built-in prompt templates do not repeat titles or prompt bodies inside a category', () => {
  const templates = getBuiltInPromptTemplates();
  const byCategory = new Map<string, typeof templates>();
  for (const item of templates) {
    const list = byCategory.get(item.categoryId) || [];
    list.push(item);
    byCategory.set(item.categoryId, list);
  }

  for (const [categoryId, items] of byCategory) {
    const titles = new Set<string>();
    const prompts = new Set<string>();
    for (const item of items) {
      const title = getPromptTemplateTitle(item, 'zh').replace(/\s+/g, '');
      const prompt = getPromptTemplateText(item, 'zh', true).replace(/\s+/g, '');
      assert.equal(titles.has(title), false, `${categoryId} duplicate title: ${getPromptTemplateTitle(item, 'zh')}`);
      assert.equal(prompts.has(prompt), false, `${categoryId} duplicate prompt: ${getPromptTemplateTitle(item, 'zh')}`);
      titles.add(title);
      prompts.add(prompt);
    }
  }
});

test('built-in prompt template titles stay user-facing without source or ratio prefixes', () => {
  for (const item of getBuiltInPromptTemplates()) {
    const titleZh = getPromptTemplateTitle(item, 'zh');
    const titleEn = getPromptTemplateTitle(item, 'en');
    assert.doesNotMatch(titleZh, /^Infinite-Canvas\s*·/);
    assert.doesNotMatch(titleEn, /^Infinite-Canvas\s*·/);
    assert.doesNotMatch(titleZh, /^\d+:\d+\b/);
    assert.doesNotMatch(titleEn, /^\d+:\d+\b/);
    assert.doesNotMatch(titleZh, /^\d+\s*[x×]\s*\d+\b/i);
    assert.doesNotMatch(titleEn, /^\d+\s*[x×]\s*\d+\b/i);
    assert.equal(item.tags.some((tag) => /^Infinite-Canvas$/i.test(tag)), false);
  }
});

test('built-in video prompt templates use concrete Seedance-ready action structure', () => {
  const videoItems = getBuiltInPromptTemplates().filter((item) => item.kind === 'video');
  assert.ok(videoItems.length >= 800);
  for (const item of videoItems) {
    const promptZh = getPromptTemplateText(item, 'zh');
    assert.match(promptZh, /Seedance 2\.0 视频提示词/);
    assert.match(promptZh, /主体与动作：/);
    assert.match(promptZh, /镜头执行：/);
    assert.match(promptZh, /稳定约束：/);
    assert.doesNotMatch(promptZh, /主题：|创作目标：|场景\/语境：|只描述一个可执行/);
  }

  const cinematicTitles = videoItems
    .filter((item) => item.categoryId === 'video-cinematic-shot')
    .slice(0, 12)
    .map((item) => getPromptTemplateTitle(item, 'zh'));
  assert.ok(cinematicTitles.some((title) => title.includes('红伞行人穿过积水路口')));
  assert.equal(cinematicTitles.some((title) => title.endsWith('雨夜城市街角')), false);
});

test('prompt template library supports custom management, import/export, and resource library save', () => {
  const service = read('../src/services/promptTemplateLibrary.ts');
  const modal = read('../src/components/PromptTemplateLibraryModal.tsx');

  assert.match(service, /PROMPT_TEMPLATE_STORAGE_KEY/);
  assert.match(service, /createCustomPromptTemplate/);
  assert.match(service, /exportPromptTemplateBackup/);
  assert.match(service, /importPromptTemplateBackup/);
  assert.match(service, /customCategories/);
  assert.match(service, /hiddenBuiltInIds/);
  assert.match(service, /normalizePromptTemplateAttachments/);
  assert.match(service, /createPromptTemplateFromMaterial/);

  assert.match(modal, /promptTemplates\.title/);
  assert.match(modal, /saveSelectedToResource/);
  assert.match(modal, /api\.addResourceSet/);
  assert.match(modal, /materialSetKind:\s*'text'/);
  assert.match(modal, /api\.addResourceCategory\('set', '提示词模板'\)/);
  assert.match(modal, /handleImport/);
  assert.match(modal, /handleExport/);
  assert.match(modal, /deleteSelected/);
  assert.match(modal, /addCategory/);
  assert.match(modal, /renameCategory/);
  assert.match(modal, /deleteCategory/);
  assert.match(modal, /promptTemplates\.contentLanguageToggle/);
  assert.match(modal, /Languages/);
  assert.match(modal, /data-prompt-template-media-preview/);
  assert.match(modal, /ImageHoverPreview/);
  assert.match(modal, /preload="metadata"/);
  assert.match(modal, /preload="none"/);
});

test('prompt template library avoids native prompt dialogs in Electron category flows', () => {
  const modal = read('../src/components/PromptTemplateLibraryModal.tsx');
  const contextMenu = read('../src/components/MaterialContextMenu.tsx');

  assert.doesNotMatch(modal, /window\.prompt/);
  assert.match(modal, /promptCategoryDialog/);
  assert.match(modal, /data-prompt-template-category-dialog/);
  assert.match(modal, /submitPromptCategoryDialog/);

  assert.doesNotMatch(contextMenu, /window\.prompt/);
  assert.match(contextMenu, /promptCategoryDraft/);
  assert.match(contextMenu, /data-material-prompt-category-form/);
  assert.match(contextMenu, /resourceCategoryDraft/);
  assert.match(contextMenu, /data-material-resource-category-form/);
  assert.match(contextMenu, /missingPromptDraft/);
});

test('custom prompt templates preserve lightweight media attachment schema', () => {
  const data = read('../src/data/promptTemplateLibrary.ts');
  const service = read('../src/services/promptTemplateLibrary.ts');

  assert.match(data, /PromptTemplateAttachmentKind = 'image' \| 'video' \| 'audio'/);
  assert.match(data, /attachments\?: PromptTemplateAttachment\[\]/);
  assert.match(service, /normalizePromptTemplateAttachments/);
  assert.match(service, /previewUrl/);
  assert.match(service, /sourceNodeId/);
  assert.match(service, /video-music-audio/);
  assert.match(service, /attachments:\s*\[/);
  assert.doesNotMatch(service, /base64Array|readAsDataURL/);
});

test('prompt template button is wired into shared prompt inputs and core media nodes', () => {
  const textarea = read('../src/components/PromptTextarea.tsx');
  const mention = read('../src/components/nodes/MentionPromptInput.tsx');
  const image = read('../src/components/nodes/ImageNode.tsx');
  const video = read('../src/components/nodes/VideoNode.tsx');
  const seedance = read('../src/components/nodes/SeedanceNode.tsx');
  const audio = read('../src/components/nodes/AudioNode.tsx');
  const llm = read('../src/components/nodes/LLMNode.tsx');
  const panorama = read('../src/components/nodes/Panorama3DNode.tsx');
  const runningHub = read('../src/components/nodes/RunningHubNode.tsx');
  const rhTools = read('../src/components/nodes/RHToolsNode.tsx');
  const comfyStore = read('../src/components/nodes/ComfyUIStoreNode.tsx');

  assert.match(textarea, /PromptTemplateLibraryModal/);
  assert.match(textarea, /promptTemplateKind\?:\s*PromptTemplateKind \| false/);
  assert.match(textarea, /data-prompt-template-trigger/);
  assert.match(mention, /PromptTemplateLibraryModal/);
  assert.match(mention, /promptTemplateKind\?:\s*PromptTemplateKind \| false/);
  assert.match(mention, /data-prompt-template-trigger/);

  assert.match(image, /promptTemplateKind="image"/);
  assert.match(video, /promptTemplateKind="video"/);
  assert.match(seedance, /promptTemplateKind="video"/);
  assert.match(audio, /promptTemplateKind="video"/);
  assert.match(llm, /promptTemplateKind="image"/);
  assert.match(panorama, /promptTemplateKind="image"/);
  assert.match(runningHub, /promptTemplateKind="image"/);
  assert.match(rhTools, /promptTemplateKind="image"/);
  assert.match(comfyStore, /promptTemplateKind="image"/);
});

test('generated materials can be saved to prompt templates from context menu', () => {
  const contextMenu = read('../src/components/MaterialContextMenu.tsx');
  const image = read('../src/components/nodes/ImageNode.tsx');
  const video = read('../src/components/nodes/VideoNode.tsx');
  const seedance = read('../src/components/nodes/SeedanceNode.tsx');
  const audio = read('../src/components/nodes/AudioNode.tsx');
  const output = read('../src/components/nodes/OutputNode.tsx');
  const llm = read('../src/components/nodes/LLMNode.tsx');

  assert.match(contextMenu, /保存到提示词模板库/);
  assert.match(contextMenu, /createPromptTemplateFromMaterial/);
  assert.match(contextMenu, /penguin:prompt-templates-changed/);

  for (const file of [image, video, seedance, audio, output, llm]) {
    assert.match(file, /data-prompt-template-prompt/);
    assert.match(file, /data-prompt-template-kind/);
  }
  assert.match(output, /mediaPromptByUrl/);
  assert.match(audio, /data-prompt-template-category="video-music-audio"/);
});
