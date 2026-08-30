import type { LlmMessage } from '../services/generation';

export const LOCALIZATION_PROJECT_SCHEMA = 't8-localization-project-v1' as const;
export const LOCALIZATION_DUBBING_LANGUAGES = ['ZH', 'EN', 'JA', 'ES', 'AR'] as const;
export const LOCALIZATION_TARGET_LANGUAGES = [
  'ZH', 'EN', 'JA', 'ES', 'AR', 'KO', 'FR', 'DE', 'IT', 'PT', 'RU', 'TH', 'VI', 'ID', 'TR', 'HI',
] as const;

export type LocalizationDubbingLanguage = typeof LOCALIZATION_DUBBING_LANGUAGES[number];
export type LocalizationTargetLanguage = typeof LOCALIZATION_TARGET_LANGUAGES[number];
export type LocalizationMode = 'subtitle-only' | 'dubbing-only' | 'full';
export type LocalizationStage = 'materials' | 'transcript' | 'translation' | 'review' | 'voices' | 'dubbing' | 'delivery';
export type LocalizationTimingMode = 'pad' | 'native' | 'natural' | 'exact';

export interface LocalizationTranslationReceipt {
  schema: 't8-localization-translation-receipt-v1';
  requestDigest: string;
  requestId?: string;
  provider: string;
  model: string;
  createdAt: number;
}

export interface LocalizationTtsReceipt {
  schema: 't8-localization-tts-receipt-v2';
  requestId?: string;
  jobId?: string;
  reused?: boolean;
  recovery?: { schema: 't8-localization-tts-recovery-v1'; status: string; recoveredAt?: number };
  engine: 'embedded-index-tts-2.5';
  audioUrl: string;
  subtitleUrl?: string;
  rewrittenSrt: string;
  generationReport: Record<string, unknown>;
  createdAt: number;
}

export interface LocalizationTranslationUnit {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  role: string;
  sourceText: string;
  translatedText: string;
  backTranslation?: string;
  pronunciation?: string;
  emotion?: string;
  confidence?: number;
  warnings?: string[];
  locked?: boolean;
  approved: boolean;
  asrText?: string;
  asrPassed?: boolean;
  asrSimilarity?: number;
}

export interface LocalizationVoiceProfile {
  id: string;
  role: string;
  language: LocalizationDubbingLanguage;
  referenceUrl: string;
  consentConfirmed: boolean;
}

export interface LocalizationRuntimeReceipt {
  schema: 't8-indextts25-runtime-receipt-v2';
  checkedAt: number;
  ready: boolean;
  online: boolean;
  engineReady: boolean;
  dependenciesReady: boolean;
  modelReady: boolean;
  pythonVersion: string;
  device: 'cuda' | 'mps' | 'cpu';
  deviceName: string;
  torchVersion: string;
  engineRepository: string;
  engineRevision: string;
  modelRepository: string;
  modelRevision: string;
  modelFingerprint: string;
  modelLicenseUrl: string;
  requiresComfyUI: false;
  install: {
    running: boolean;
    stage: string;
    progress: number;
    message: string;
    error: string;
    startedAt: number;
    finishedAt: number;
  };
  message: string;
}

export interface LocalizationDeliveryManifest {
  schema: 't8-localization-delivery-manifest-v1';
  createdAt: number;
  targetLanguage: LocalizationTargetLanguage;
  mode: LocalizationMode;
  sourceMediaUrl: string;
  subtitleUrl?: string;
  subtitleText: string;
  dubbedAudioUrl?: string;
  localizedVideoUrl?: string;
  generationReport?: Record<string, unknown>;
  qc: {
    unitCount: number;
    approvedCount: number;
    asrReviewedCount: number;
    asrPassedCount: number;
    warnings: string[];
  };
}

export interface LocalizationLanguageBranch {
  schema: 't8-localization-language-branch-v1';
  language: LocalizationTargetLanguage;
  revision: number;
  stage: LocalizationStage;
  units: LocalizationTranslationUnit[];
  voiceProfiles: LocalizationVoiceProfile[];
  translationReceipt?: LocalizationTranslationReceipt;
  ttsReceipt?: LocalizationTtsReceipt;
  delivery?: LocalizationDeliveryManifest;
  warnings: string[];
  updatedAt: number;
}

export interface LocalizationProject {
  schema: typeof LOCALIZATION_PROJECT_SCHEMA;
  revision: number;
  stage: LocalizationStage;
  mode: LocalizationMode;
  sourceLanguage: LocalizationTargetLanguage | 'AUTO';
  targetLanguage: LocalizationTargetLanguage;
  targetLanguages: LocalizationTargetLanguage[];
  branches: LocalizationLanguageBranch[];
  sourceMediaUrl: string;
  sourceMediaKind: 'video' | 'audio' | 'none';
  sourceText: string;
  units: LocalizationTranslationUnit[];
  glossaryText: string;
  protectedTermsText: string;
  llmApiSource: 'seedance-nz' | 'zhenzhen';
  llmModel: string;
  providerSource: string;
  providerId: string;
  providerModel: string;
  providerParams: Record<string, unknown>;
  voiceProfiles: LocalizationVoiceProfile[];
  timelinePolicy: 'shift' | 'overlay';
  timingMode: LocalizationTimingMode;
  asrEnabled: boolean;
  asrRetryCount: number;
  asrThreshold: number;
  subtitleTimingMode: 'actual' | 'original';
  subtitleTextMode: 'asr_passed' | 'asr_all' | 'original';
  subtitleIncludeRole: boolean;
  postprocessPreset: 'off' | 'voice_clarity' | 'warm_narration' | 'broadcast_clean' | 'soft_deesser';
  postprocessStrength: number;
  advancedOpen: boolean;
  modelLicenseConfirmed: boolean;
  runtimeReceipt?: LocalizationRuntimeReceipt;
  translationReceipt?: LocalizationTranslationReceipt;
  ttsReceipt?: LocalizationTtsReceipt;
  delivery?: LocalizationDeliveryManifest;
  warnings: string[];
  updatedAt: number;
}

export const LOCALIZATION_LANGUAGE_LABELS: Record<LocalizationTargetLanguage | 'AUTO', { zh: string; en: string }> = {
  AUTO: { zh: '自动识别', en: 'Auto detect' },
  ZH: { zh: '中文', en: 'Chinese' },
  EN: { zh: '英语', en: 'English' },
  JA: { zh: '日语', en: 'Japanese' },
  ES: { zh: '西班牙语', en: 'Spanish' },
  AR: { zh: '阿拉伯语', en: 'Arabic' },
  KO: { zh: '韩语', en: 'Korean' },
  FR: { zh: '法语', en: 'French' },
  DE: { zh: '德语', en: 'German' },
  IT: { zh: '意大利语', en: 'Italian' },
  PT: { zh: '葡萄牙语', en: 'Portuguese' },
  RU: { zh: '俄语', en: 'Russian' },
  TH: { zh: '泰语', en: 'Thai' },
  VI: { zh: '越南语', en: 'Vietnamese' },
  ID: { zh: '印尼语', en: 'Indonesian' },
  TR: { zh: '土耳其语', en: 'Turkish' },
  HI: { zh: '印地语', en: 'Hindi' },
};

export function supportsLocalizationDubbing(language: string): language is LocalizationDubbingLanguage {
  return LOCALIZATION_DUBBING_LANGUAGES.includes(language as LocalizationDubbingLanguage);
}

function validTargetLanguage(value: unknown): value is LocalizationTargetLanguage {
  return LOCALIZATION_TARGET_LANGUAGES.includes(value as LocalizationTargetLanguage);
}

function cloneUnits(units: LocalizationTranslationUnit[]): LocalizationTranslationUnit[] {
  return (Array.isArray(units) ? units : []).map((unit) => ({ ...unit }));
}

function cloneVoices(profiles: LocalizationVoiceProfile[]): LocalizationVoiceProfile[] {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({ ...profile }));
}

function normalizedTargets(values: unknown, fallback: LocalizationTargetLanguage): LocalizationTargetLanguage[] {
  const requested = Array.isArray(values) ? values : [];
  const result = requested.filter(validTargetLanguage).filter((value, index, all) => all.indexOf(value) === index);
  return result.length ? result : [fallback];
}

function blankBranchUnits(units: LocalizationTranslationUnit[]): LocalizationTranslationUnit[] {
  return cloneUnits(units).map((unit) => ({
    ...unit,
    translatedText: '',
    backTranslation: '',
    pronunciation: '',
    emotion: '',
    confidence: undefined,
    warnings: [],
    locked: false,
    approved: false,
    asrText: undefined,
    asrPassed: undefined,
    asrSimilarity: undefined,
  }));
}

function languageBranch(
  language: LocalizationTargetLanguage,
  units: LocalizationTranslationUnit[],
  overrides: Partial<LocalizationLanguageBranch> = {},
): LocalizationLanguageBranch {
  const merged: LocalizationLanguageBranch = {
    schema: 't8-localization-language-branch-v1',
    language,
    revision: 0,
    stage: units.length ? 'translation' : 'materials',
    units: cloneUnits(units),
    voiceProfiles: [],
    warnings: [],
    updatedAt: Date.now(),
    ...overrides,
  };
  return {
    ...merged,
    schema: 't8-localization-language-branch-v1',
    language,
    units: cloneUnits(overrides.units || units),
    voiceProfiles: cloneVoices(overrides.voiceProfiles || []),
    warnings: Array.isArray(overrides.warnings) ? [...overrides.warnings] : [],
  };
}

function branchFromProjection(project: LocalizationProject): LocalizationLanguageBranch {
  const previous = project.branches.find((branch) => branch.language === project.targetLanguage);
  return languageBranch(project.targetLanguage, project.units, {
    ...previous,
    revision: previous ? previous.revision + 1 : 1,
    stage: project.stage,
    units: project.units,
    voiceProfiles: project.voiceProfiles,
    translationReceipt: project.translationReceipt,
    ttsReceipt: project.ttsReceipt,
    delivery: project.delivery,
    warnings: project.warnings,
    updatedAt: project.updatedAt,
  });
}

function projectWithBranch(project: LocalizationProject, branch: LocalizationLanguageBranch): LocalizationProject {
  return {
    ...project,
    targetLanguage: branch.language,
    stage: branch.stage,
    units: cloneUnits(branch.units),
    voiceProfiles: cloneVoices(branch.voiceProfiles),
    translationReceipt: branch.translationReceipt,
    ttsReceipt: branch.ttsReceipt,
    delivery: branch.delivery,
    warnings: [...branch.warnings],
  };
}

/** Persist the editable active-language projection into its durable branch. */
export function syncActiveLocalizationBranch(project: LocalizationProject): LocalizationProject {
  const targetLanguages = normalizedTargets(project.targetLanguages, project.targetLanguage);
  const active = branchFromProjection(project);
  const byLanguage = new Map(project.branches.map((branch) => [branch.language, branch]));
  byLanguage.set(active.language, active);
  const branches = targetLanguages.map((language) => byLanguage.get(language)
    || languageBranch(language, blankBranchUnits(project.units)));
  return { ...project, targetLanguages, branches };
}

/** Switch language without losing edits, approvals, TTS receipts, or delivery evidence from the old branch. */
export function switchLocalizationBranch(
  project: LocalizationProject,
  language: LocalizationTargetLanguage,
): LocalizationProject {
  if (!validTargetLanguage(language)) return project;
  const saved = syncActiveLocalizationBranch(project);
  const targetLanguages = normalizedTargets([...saved.targetLanguages, language], language);
  const branch = saved.branches.find((item) => item.language === language)
    || languageBranch(language, blankBranchUnits(saved.units));
  return projectWithBranch({ ...saved, targetLanguages, branches: [...saved.branches, ...(saved.branches.some((item) => item.language === language) ? [] : [branch])] }, branch);
}

/** Add/remove target-language branches while retaining every selected branch's independent progress. */
export function setLocalizationTargetLanguages(
  project: LocalizationProject,
  languages: LocalizationTargetLanguage[],
): LocalizationProject {
  const saved = syncActiveLocalizationBranch(project);
  const targetLanguages = normalizedTargets(languages, saved.targetLanguage);
  const activeLanguage = targetLanguages.includes(saved.targetLanguage) ? saved.targetLanguage : targetLanguages[0];
  const byLanguage = new Map(saved.branches.map((branch) => [branch.language, branch]));
  const branches = targetLanguages.map((language) => byLanguage.get(language)
    || languageBranch(language, blankBranchUnits(saved.units)));
  const active = branches.find((branch) => branch.language === activeLanguage)!;
  return projectWithBranch({ ...saved, targetLanguages, branches }, active);
}

/** A source transcript change invalidates every derived language branch, not only the visible one. */
export function resetLocalizationBranches(
  project: LocalizationProject,
  sourceUnits: LocalizationTranslationUnit[],
): LocalizationProject {
  const targetLanguages = normalizedTargets(project.targetLanguages, project.targetLanguage);
  const branches = targetLanguages.map((language) => languageBranch(language, blankBranchUnits(sourceUnits), {
    revision: (project.branches.find((branch) => branch.language === language)?.revision || 0) + 1,
    stage: sourceUnits.length ? 'translation' : 'materials',
    updatedAt: Date.now(),
  }));
  const active = branches.find((branch) => branch.language === project.targetLanguage) || branches[0];
  return projectWithBranch({ ...project, targetLanguages, branches }, active);
}

export function createLocalizationProject(overrides: Partial<LocalizationProject> = {}): LocalizationProject {
  const targetLanguage = validTargetLanguage(overrides.targetLanguage) ? overrides.targetLanguage : 'EN';
  const defaults = {
    schema: LOCALIZATION_PROJECT_SCHEMA,
    revision: 0,
    stage: 'materials',
    mode: 'full',
    sourceLanguage: 'AUTO',
    targetLanguage,
    targetLanguages: [targetLanguage],
    branches: [],
    sourceMediaUrl: '',
    sourceMediaKind: 'none',
    sourceText: '',
    units: [],
    glossaryText: '',
    protectedTermsText: '',
    llmApiSource: 'seedance-nz',
    llmModel: 'bytedance/doubao-seed-2.1-pro',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    providerParams: {},
    voiceProfiles: [],
    timelinePolicy: 'shift',
    timingMode: 'pad',
    asrEnabled: true,
    asrRetryCount: 1,
    asrThreshold: 0.82,
    subtitleTimingMode: 'actual',
    subtitleTextMode: 'asr_passed',
    subtitleIncludeRole: true,
    postprocessPreset: 'voice_clarity',
    postprocessStrength: 0.8,
    advancedOpen: false,
    modelLicenseConfirmed: false,
    warnings: [],
    updatedAt: Date.now(),
  } satisfies LocalizationProject;
  const project = { ...defaults, ...overrides, targetLanguage } as LocalizationProject;
  const targetLanguages = normalizedTargets(project.targetLanguages, targetLanguage);
  const persistedBranches = (Array.isArray(project.branches) ? project.branches : [])
    .filter((branch): branch is LocalizationLanguageBranch => Boolean(branch && validTargetLanguage(branch.language)))
    .map((branch) => languageBranch(branch.language, branch.units || [], branch));
  const active = persistedBranches.find((branch) => branch.language === targetLanguage)
    || languageBranch(targetLanguage, project.units, {
      revision: 0,
      stage: project.stage,
      units: project.units,
      voiceProfiles: project.voiceProfiles,
      translationReceipt: project.translationReceipt,
      ttsReceipt: project.ttsReceipt,
      delivery: project.delivery,
      warnings: project.warnings,
      updatedAt: project.updatedAt,
    });
  const byLanguage = new Map(persistedBranches.map((branch) => [branch.language, branch]));
  byLanguage.set(targetLanguage, active);
  const branches = targetLanguages.map((language) => byLanguage.get(language)
    || languageBranch(language, blankBranchUnits(project.units)));
  return projectWithBranch({ ...project, targetLanguages, branches }, active);
}

function parseTimestamp(value: string): number | null {
  const match = String(value || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(String(match[4]).padEnd(3, '0'));
  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite) || minutes > 59 || seconds > 59) return null;
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + milliseconds;
}

function unitId(index: number, startMs: number, text: string): string {
  let hash = 2166136261;
  const source = `${index}|${startMs}|${text}`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `loc-${index}-${(hash >>> 0).toString(36)}`;
}

export function splitLocalizationRole(text: string, fallback = '旁白'): { role: string; text: string } {
  const clean = String(text || '').trim();
  const bracket = clean.match(/^\[([^\]\n]{1,40})\]\s*(.+)$/s);
  if (bracket) return { role: bracket[1].trim(), text: bracket[2].trim() };
  const colon = clean.match(/^([^：:\n]{1,32})[：:]\s*(.+)$/s);
  if (colon && !/[，。！？,.!?]/.test(colon[1])) return { role: colon[1].trim(), text: colon[2].trim() };
  return { role: fallback, text: clean };
}

export function parseLocalizationText(input: string): LocalizationTranslationUnit[] {
  const normalized = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.replace(/^WEBVTT[^\n]*\n+/i, '').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const timed: LocalizationTranslationUnit[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((item) => item.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;
    const [left, right] = lines[timeIndex].split('-->').map((item) => item.trim().split(/\s+/)[0]);
    const startMs = parseTimestamp(left);
    const endMs = parseTimestamp(right);
    const rawText = lines.slice(timeIndex + 1).join('\n').trim();
    if (startMs === null || endMs === null || endMs <= startMs || !rawText) continue;
    const parsed = splitLocalizationRole(rawText);
    const index = timed.length + 1;
    timed.push({ id: unitId(index, startMs, parsed.text), index, startMs, endMs, role: parsed.role, sourceText: parsed.text, translatedText: '', approved: false });
  }
  if (timed.length) return timed;

  const lines = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  return lines.map((line, offset) => {
    const parsed = splitLocalizationRole(line);
    const index = offset + 1;
    const startMs = offset * 3000;
    return { id: unitId(index, startMs, parsed.text), index, startMs, endMs: startMs + 2800, role: parsed.role, sourceText: parsed.text, translatedText: '', approved: false };
  });
}

export function unitsFromWhisperSegments(segments: Array<{ start: number; end: number; text: string }>): LocalizationTranslationUnit[] {
  return (Array.isArray(segments) ? segments : []).flatMap((segment, offset) => {
    const startMs = Math.max(0, Math.round(Number(segment?.start) * 1000));
    const endMs = Math.max(startMs + 1, Math.round(Number(segment?.end) * 1000));
    const parsed = splitLocalizationRole(String(segment?.text || ''));
    if (!parsed.text) return [];
    const index = offset + 1;
    return [{ id: unitId(index, startMs, parsed.text), index, startMs, endMs, role: parsed.role, sourceText: parsed.text, translatedText: '', approved: false }];
  });
}

function formatSrtTimestamp(value: number): string {
  const ms = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const milliseconds = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function serializeLocalizationSrt(units: LocalizationTranslationUnit[], options: { translated?: boolean; includeRole?: boolean } = {}): string {
  return units.map((unit, offset) => {
    const value = options.translated ? unit.translatedText.trim() : unit.sourceText.trim();
    const text = options.includeRole === false || !unit.role ? value : `[${unit.role}] ${value}`;
    return `${offset + 1}\n${formatSrtTimestamp(unit.startMs)} --> ${formatSrtTimestamp(unit.endMs)}\n${text}`;
  }).join('\n\n');
}

export function buildLocalizationTranslationMessages(project: LocalizationProject): LlmMessage[] {
  const glossary = project.glossaryText.trim() || '(none)';
  const protectedTerms = project.protectedTermsText.trim() || '(none)';
  const payload = project.units.map((unit) => ({ id: unit.id, role: unit.role, start_ms: unit.startMs, end_ms: unit.endMs, source: unit.sourceText }));
  return [
    {
      role: 'system',
      content: [
        'You are a professional audiovisual localization editor.',
        'Translate by scene context, speaker intent, register, continuity, and subtitle timing—not sentence-by-sentence in isolation.',
        'Preserve every id exactly. Do not merge, split, reorder, omit, or invent units.',
        'Keep protected terms, placeholders, markup tags, names, and every number unchanged. Use the glossary consistently.',
        'Make each translated line speakable within its source time slot without dropping meaning.',
        'pronunciation must be empty or the complete target-language spoken script for TTS; never return a partial pronunciation note. The translation remains the subtitle text.',
        'Back-translate every result to the source language so a reviewer can detect meaning drift.',
        'Return strict JSON only: {"units":[{"id":"...","translation":"...","back_translation":"...","pronunciation":"","emotion":"","confidence":0.0,"warnings":[]}]}.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Source language: ${project.sourceLanguage}`,
        `Target language: ${project.targetLanguage}`,
        `Glossary:\n${glossary}`,
        `Protected terms:\n${protectedTerms}`,
        `Timed dialogue JSON:\n${JSON.stringify(payload)}`,
      ].join('\n\n'),
    },
  ];
}

function sortedMatches(value: string, pattern: RegExp): string[] {
  return [...String(value || '').matchAll(pattern)].map((match) => match[0]).sort();
}

function protectedTerms(value: string): string[] {
  return String(value || '').split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean);
}

function glossaryPairs(value: string): Array<{ source: string; target: string }> {
  return String(value || '').split(/\n+/).flatMap((line) => {
    const match = line.match(/^\s*(.+?)\s*(?:=>|=|→|：:)\s*(.+?)\s*$/);
    return match ? [{ source: match[1].trim(), target: match[2].trim() }] : [];
  });
}

export interface LocalizationTranslationQuality {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

export function validateLocalizationTranslationUnit(
  project: LocalizationProject,
  unit: LocalizationTranslationUnit,
  translation: string,
): LocalizationTranslationQuality {
  const failures: string[] = [];
  const warnings: string[] = [];
  const source = unit.sourceText;
  const target = String(translation || '').trim();
  if (!target) failures.push(`${unit.id}: translation is empty`);
  const sourcePlaceholders = sortedMatches(source, /\{\{[^{}]+\}\}|\{[^{}]+\}|%\d*\$?[a-zA-Z]|<\/?[A-Za-z][^>]*>/g);
  const targetPlaceholders = sortedMatches(target, /\{\{[^{}]+\}\}|\{[^{}]+\}|%\d*\$?[a-zA-Z]|<\/?[A-Za-z][^>]*>/g);
  if (JSON.stringify(sourcePlaceholders) !== JSON.stringify(targetPlaceholders)) failures.push(`${unit.id}: placeholders or markup changed`);
  const sourceNumbers = sortedMatches(source, /\d+(?:[.,]\d+)*/g);
  const targetNumbers = sortedMatches(target, /\d+(?:[.,]\d+)*/g);
  if (JSON.stringify(sourceNumbers) !== JSON.stringify(targetNumbers)) failures.push(`${unit.id}: numbers changed`);
  for (const term of protectedTerms(project.protectedTermsText)) {
    if (source.includes(term) && !target.includes(term)) failures.push(`${unit.id}: protected term missing: ${term}`);
  }
  for (const pair of glossaryPairs(project.glossaryText)) {
    if (source.includes(pair.source) && !target.toLocaleLowerCase().includes(pair.target.toLocaleLowerCase())) {
      failures.push(`${unit.id}: glossary target missing: ${pair.target}`);
    }
  }
  const slotSeconds = Math.max(0.001, (unit.endMs - unit.startMs) / 1000);
  const estimatedCharactersPerSecond = target.length / slotSeconds;
  if (estimatedCharactersPerSecond > 22) warnings.push(`${unit.id}: likely too long for the ${slotSeconds.toFixed(2)}s slot`);
  return { passed: failures.length === 0, failures, warnings };
}

function parseJsonObject(text: string): any {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || raw;
  try { return JSON.parse(fenced); } catch { /* try bounded object below */ }
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM did not return a JSON object.');
  return JSON.parse(fenced.slice(start, end + 1));
}

export function applyLocalizationTranslationResponse(project: LocalizationProject, content: string): LocalizationTranslationUnit[] {
  const payload = parseJsonObject(content);
  if (!payload || !Array.isArray(payload.units)) throw new Error('Translation response is missing the units array.');
  const byId = new Map<string, any>();
  for (const item of payload.units) {
    const id = String(item?.id || '').trim();
    const translation = String(item?.translation || '').trim();
    if (!id || !translation || byId.has(id)) continue;
    byId.set(id, item);
  }
  const missing = project.units.filter((unit) => !byId.has(unit.id));
  const extras = [...byId.keys()].filter((id) => !project.units.some((unit) => unit.id === id));
  if (missing.length || extras.length || byId.size !== project.units.length) {
    throw new Error(`Translation response does not match the source units (missing ${missing.length}, extra ${extras.length}).`);
  }
  const qualityFailures: string[] = [];
  const qualityById = new Map<string, LocalizationTranslationQuality>();
  for (const unit of project.units) {
    const item = byId.get(unit.id);
    const quality = validateLocalizationTranslationUnit(project, unit, String(item?.translation || ''));
    qualityById.set(unit.id, quality);
    qualityFailures.push(...quality.failures);
  }
  if (qualityFailures.length) {
    throw new Error(`Translation quality gate failed: ${qualityFailures.slice(0, 12).join('; ')}`);
  }
  return project.units.map((unit) => {
    const item = byId.get(unit.id);
    const quality = qualityById.get(unit.id)!;
    const confidenceValue = Number(item.confidence);
    return {
      ...unit,
      translatedText: String(item.translation || '').trim(),
      backTranslation: String(item.back_translation || item.backTranslation || '').trim(),
      pronunciation: String(item.pronunciation || '').trim(),
      emotion: String(item.emotion || '').trim(),
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined,
      warnings: [...quality.warnings, ...(Array.isArray(item.warnings) ? item.warnings.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12) : [])],
      approved: false,
    };
  });
}

export function localizationRoles(units: LocalizationTranslationUnit[]): string[] {
  return [...new Set(units.map((unit) => unit.role.trim() || '旁白'))].slice(0, 16);
}

export function validateLocalizationForDubbing(project: LocalizationProject): string[] {
  const errors: string[] = [];
  if (!supportsLocalizationDubbing(project.targetLanguage)) errors.push(`IndexTTS 2.5 does not support ${project.targetLanguage} dubbing; use subtitle-only mode.`);
  if (!project.modelLicenseConfirmed) errors.push('Confirm the IndexTTS 2.5 model license before running local inference.');
  if (!project.runtimeReceipt?.ready || project.runtimeReceipt.requiresComfyUI !== false) errors.push('IndexTTS 2.5 embedded runtime preflight has not passed.');
  if (!project.units.length) errors.push('No translation units are available.');
  if (project.units.some((unit) => !unit.translatedText.trim())) errors.push('Every unit needs translated text.');
  if (project.units.some((unit) => !unit.approved)) errors.push('Every translated unit must be explicitly approved.');
  const profiles = new Map(project.voiceProfiles.map((profile) => [profile.role, profile]));
  for (const role of localizationRoles(project.units)) {
    const profile = profiles.get(role);
    if (!profile?.referenceUrl) errors.push(`Role ${role} has no reference voice.`);
    else if (!profile.consentConfirmed) errors.push(`Role ${role} is missing voice consent confirmation.`);
  }
  return errors;
}

export function buildLocalizationQc(project: LocalizationProject): LocalizationDeliveryManifest['qc'] {
  const asrReviewed = project.units.filter((unit) => typeof unit.asrPassed === 'boolean');
  const warnings = [...project.warnings];
  if (project.mode !== 'subtitle-only' && !asrReviewed.length) warnings.push('No per-line ASR review evidence is available.');
  if (asrReviewed.some((unit) => unit.asrPassed === false)) warnings.push('One or more dubbed lines did not pass the configured ASR threshold.');
  return {
    unitCount: project.units.length,
    approvedCount: project.units.filter((unit) => unit.approved).length,
    asrReviewedCount: asrReviewed.length,
    asrPassedCount: asrReviewed.filter((unit) => unit.asrPassed).length,
    warnings: [...new Set(warnings)],
  };
}
