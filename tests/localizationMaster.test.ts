import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workflowManifestToFragment } from '../src/utils/workflowResource.ts';
import {
  applyLocalizationTranslationResponse,
  buildLocalizationQc,
  buildLocalizationTranslationMessages,
  createLocalizationProject,
  inspectLocalizationSourceText,
  localizationRoles,
  MAX_LOCALIZATION_ROLES,
  parseLocalizationText,
  resetLocalizationBranches,
  setLocalizationTargetLanguages,
  serializeLocalizationSrt,
  supportsLocalizationDubbing,
  switchLocalizationBranch,
  syncActiveLocalizationBranch,
  validateLocalizationTranslationUnit,
  validateLocalizationForDubbing,
} from '../src/utils/localizationMaster.ts';

test('localization parser preserves timed units, roles, and Unicode text', () => {
  const units = parseLocalizationText([
    '1',
    '00:00:01,250 --> 00:00:03,500',
    '[小明] 我们现在出发。',
    '',
    '2',
    '00:00:03.600 --> 00:00:05.900',
    'Narrator: The door opens.',
  ].join('\n'));
  assert.equal(units.length, 2);
  assert.deepEqual(units.map((unit) => [unit.index, unit.startMs, unit.endMs, unit.role, unit.sourceText]), [
    [1, 1250, 3500, '小明', '我们现在出发。'],
    [2, 3600, 5900, 'Narrator', 'The door opens.'],
  ]);
  assert.match(serializeLocalizationSrt(units), /00:00:01,250 --> 00:00:03,500/);
  assert.match(serializeLocalizationSrt(units), /\[小明\] 我们现在出发。/);
});

test('context translation contract is strict, complete, and keeps stable ids', () => {
  const units = parseLocalizationText('[甲] 第一行\n[乙] 第二行');
  const project = createLocalizationProject({
    sourceLanguage: 'ZH',
    targetLanguage: 'EN',
    units,
    glossaryText: '企鹅 = penguin',
    protectedTermsText: 'T8',
  });
  const messages = buildLocalizationTranslationMessages(project);
  assert.match(String(messages[0].content), /Preserve every id exactly/);
  assert.match(String(messages[0].content), /complete target-language spoken script/);
  assert.match(String(messages[1].content), /Timed dialogue JSON/);
  const response = JSON.stringify({
    units: units.map((unit, index) => ({
      id: unit.id,
      translation: index === 0 ? 'First line.' : 'Second line.',
      pronunciation: '',
      emotion: index === 0 ? 'calm' : 'urgent',
    })),
  });
  const translated = applyLocalizationTranslationResponse(project, response);
  assert.deepEqual(translated.map((unit) => unit.translatedText), ['First line.', 'Second line.']);
  assert.equal(translated[0].approved, false);
  assert.throws(() => applyLocalizationTranslationResponse(project, JSON.stringify({ units: [{ id: units[0].id, translation: 'Only one.' }] })), /missing 1/);
  assert.throws(() => applyLocalizationTranslationResponse(project, JSON.stringify({ units: [...JSON.parse(response).units, { id: 'invented', translation: 'No.' }] })), /extra 1/);
});

test('translation quality gate preserves protected terms, glossary targets, placeholders, tags, and numbers', () => {
  const units = parseLocalizationText('[旁白] T8 在 2026 年显示 {count} 个 <b>企鹅</b>。');
  const project = createLocalizationProject({
    sourceLanguage: 'ZH',
    targetLanguage: 'EN',
    units,
    glossaryText: '企鹅 = penguin',
    protectedTermsText: 'T8',
  });
  const good = 'T8 shows {count} <b>penguin</b> items in 2026.';
  assert.equal(validateLocalizationTranslationUnit(project, units[0], good).passed, true);
  const bad = 'It shows many birds.';
  const quality = validateLocalizationTranslationUnit(project, units[0], bad);
  assert.equal(quality.passed, false);
  assert.ok(quality.failures.some((item) => /protected term/i.test(item)));
  assert.ok(quality.failures.some((item) => /glossary/i.test(item)));
  assert.ok(quality.failures.some((item) => /placeholders/i.test(item)));
  assert.ok(quality.failures.some((item) => /numbers/i.test(item)));
  assert.throws(() => applyLocalizationTranslationResponse(project, JSON.stringify({
    units: [{ id: units[0].id, translation: bad, back_translation: '错误', confidence: 0.2, warnings: [] }],
  })), /quality gate failed/i);
});

test('IndexTTS dubbing is fixed to its supported five-language boundary and fails closed before runtime approval', () => {
  for (const language of ['ZH', 'EN', 'JA', 'ES', 'AR']) assert.equal(supportsLocalizationDubbing(language), true);
  for (const language of ['KO', 'FR', 'DE']) assert.equal(supportsLocalizationDubbing(language), false);
  const project = createLocalizationProject({
    targetLanguage: 'EN',
    units: [{
      id: 'line-1', index: 1, startMs: 0, endMs: 2000, role: 'Narrator',
      sourceText: 'Hello.', translatedText: 'Hello.', approved: true,
    }],
  });
  const errors = validateLocalizationForDubbing(project);
  assert.ok(errors.some((item) => /license/i.test(item)));
  assert.ok(errors.some((item) => /runtime preflight/i.test(item)));
  assert.ok(errors.some((item) => /reference voice/i.test(item)));
});

test('language branches preserve independent translation, approval, TTS, and delivery progress', () => {
  const sourceUnits = parseLocalizationText('[旁白] 欢迎来到企鹅画布。');
  let project = createLocalizationProject({ sourceLanguage: 'ZH', targetLanguage: 'EN', units: sourceUnits });
  project = resetLocalizationBranches(project, sourceUnits);
  project = setLocalizationTargetLanguages(project, ['EN', 'JA', 'ES', 'AR']);
  project = {
    ...project,
    units: project.units.map((unit) => ({ ...unit, translatedText: 'Welcome to Penguin Canvas.', approved: true })),
    stage: 'delivery',
    ttsReceipt: {
      schema: 't8-localization-tts-receipt-v2',
      engine: 'embedded-index-tts-2.5',
      audioUrl: '/files/output/en.wav',
      rewrittenSrt: 'English',
      generationReport: {},
      createdAt: 1,
    },
    delivery: {
      schema: 't8-localization-delivery-manifest-v1',
      createdAt: 1,
      targetLanguage: 'EN',
      mode: 'full',
      sourceMediaUrl: '',
      subtitleText: 'English',
      dubbedAudioUrl: '/files/output/en.wav',
      qc: { unitCount: 1, approvedCount: 1, asrReviewedCount: 0, asrPassedCount: 0, warnings: [] },
    },
  };
  project = syncActiveLocalizationBranch(project);
  project = switchLocalizationBranch(project, 'JA');
  assert.equal(project.targetLanguage, 'JA');
  assert.equal(project.units[0].translatedText, '');
  assert.equal(project.delivery, undefined);
  project = {
    ...project,
    units: project.units.map((unit) => ({ ...unit, translatedText: 'ペンギンキャンバスへようこそ。', approved: true })),
    stage: 'review',
  };
  project = switchLocalizationBranch(project, 'EN');
  assert.equal(project.units[0].translatedText, 'Welcome to Penguin Canvas.');
  assert.equal(project.units[0].approved, true);
  assert.equal(project.ttsReceipt?.audioUrl, '/files/output/en.wav');
  assert.equal(project.delivery?.targetLanguage, 'EN');
  project = switchLocalizationBranch(project, 'JA');
  assert.equal(project.units[0].translatedText, 'ペンギンキャンバスへようこそ。');
  assert.equal(project.stage, 'review');
  assert.deepEqual(project.targetLanguages, ['EN', 'JA', 'ES', 'AR']);
  project = setLocalizationTargetLanguages(project, ['EN', 'ES', 'AR']);
  assert.equal(project.branches.find((branch) => branch.language === 'JA')?.active, false);
  assert.equal(project.branches.find((branch) => branch.language === 'JA')?.units[0].translatedText, 'ペンギンキャンバスへようこそ。');
  project = setLocalizationTargetLanguages(project, ['EN', 'JA', 'ES', 'AR']);
  project = switchLocalizationBranch(project, 'JA');
  assert.equal(project.units[0].translatedText, 'ペンギンキャンバスへようこそ。');
});

test('localization QC includes per-line warnings and low-confidence evidence', () => {
  const project = createLocalizationProject({
    units: [{
      id: 'line-1', index: 1, startMs: 0, endMs: 1000, role: '旁白', sourceText: '你好',
      translatedText: 'Hello', approved: true, confidence: 0.61, warnings: ['line-1: timing risk'],
    }],
    mode: 'subtitle-only',
  });
  const qc = buildLocalizationQc(project);
  assert.ok(qc.warnings.some((warning) => /timing risk/.test(warning)));
  assert.ok(qc.warnings.some((warning) => /low translation confidence/.test(warning)));
  assert.doesNotMatch(serializeLocalizationSrt(project.units, { translated: true, includeRole: true }), /旁白/);
});

test('mixed malformed timed subtitles fail closed and roles are never silently truncated', () => {
  const source = '1\n00:00:00,000 --> 00:00:01,000\nHello\n\nThis block has no timestamp';
  const inspection = inspectLocalizationSourceText(source);
  assert.equal(inspection.blocked, true);
  assert.ok(inspection.warnings.length > 0);
  const roles = localizationRoles(Array.from({ length: MAX_LOCALIZATION_ROLES + 1 }, (_, index) => ({
    id: `line-${index}`, index, startMs: index * 1000, endMs: index * 1000 + 900,
    role: `Role ${index}`, sourceText: 'x', translatedText: 'x', approved: true,
  })));
  assert.equal(roles.length, MAX_LOCALIZATION_ROLES + 1);
});

test('example workflow restores a direct no-ComfyUI localization node with stable defaults', () => {
  const raw = readFileSync(new URL('../docs/workflows/localization-master.json', import.meta.url), 'utf8');
  const fragment = workflowManifestToFragment(JSON.parse(raw));
  assert.equal(fragment?.nodes.length, 1);
  assert.equal(fragment?.nodes[0]?.type, 'localization-master');
  const data = fragment?.nodes[0]?.data as Record<string, any>;
  assert.equal(data.providerModel, 'bytedance/doubao-seed-2.1-pro');
  assert.equal(data.localizationProject?.schema, 't8-localization-project-v1');
  assert.equal(data.localizationProject?.modelLicenseConfirmed, false);
  assert.equal(data.localizationProject?.stage, 'materials');
});

test('localization workbench keeps the real workflow progressive and exposes targeted line recovery', () => {
  const node = readFileSync(new URL('../src/components/nodes/LocalizationMasterNode.tsx', import.meta.url), 'utf8');
  assert.match(node, /type LocalizationWorkbenchStep = 'source' \| 'translate' \| 'voice' \| 'deliver'/);
  assert.match(node, /role="tablist"/);
  assert.match(node, /activeWorkbenchStep === 'source'/);
  assert.match(node, /activeWorkbenchStep === 'translate'/);
  assert.match(node, /activeWorkbenchStep === 'voice'/);
  assert.match(node, /activeWorkbenchStep === 'deliver'/);
  assert.match(node, /requestAction\('dub-line'\)/);
  assert.match(node, /project\.ttsStaleUnitIds\.length > 0/);
});
