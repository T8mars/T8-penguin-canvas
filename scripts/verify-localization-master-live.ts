import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  applyLocalizationTranslationResponse,
  buildLocalizationTranslationMessages,
  createLocalizationProject,
  parseLocalizationText,
  type LocalizationTargetLanguage,
} from '../src/utils/localizationMaster.ts';

const require = createRequire(import.meta.url);
const config = require('../backend/src/config.js');
const { generateChat } = require('../backend/src/providers/openaiCompatible.js');
const { providerForDecision } = require('../backend/src/services/creatorAgentLlmRuntime.js');

const LANGUAGES: LocalizationTargetLanguage[] = ['ZH', 'EN', 'JA', 'ES', 'AR'];
const MODEL = 'bytedance/doubao-seed-2.1-pro';

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function safeError(error: unknown, secret: string): string {
  return String(error instanceof Error ? error.message : error)
    .replaceAll(secret, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url-redacted]')
    .slice(0, 2_000);
}

function settings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
}

async function main() {
  const currentSettings = settings();
  const apiKey = String(currentSettings.zhenzhenSd2ApiKey || '').trim();
  assert.match(apiKey, /^sk-[A-Za-z0-9_-]{20,}$/u, '贞贞的平价AI小屋 API Key 未就绪');
  const provider = providerForDecision({
    status: 'ready',
    selected: { provider: 'seedance-nz', model: MODEL, executable: true },
  }, currentSettings, config);
  assert.ok(provider, '无法构建平价AI小屋 2.1 Provider');

  const sourceText = '[Narrator] T8 将在 2026 年为 {count} 位创作者打开新世界。';
  const units = parseLocalizationText(sourceText);
  assert.equal(units.length, 1);
  const results: Array<Record<string, unknown>> = [];
  const priorAmbiguous = String(process.env.T8_LOCALIZATION_PRIOR_AMBIGUOUS || '').trim();
  for (const language of LANGUAGES) {
    const project = createLocalizationProject({
      sourceLanguage: 'ZH',
      targetLanguage: language,
      targetLanguages: [language],
      units,
      protectedTermsText: 'T8, {count}',
    });
    const messages = buildLocalizationTranslationMessages(project);
    const requestDigest = digest({ provider: provider.id, model: MODEL, language, messages });
    if (language === project.sourceLanguage) {
      results.push({
        language,
        status: 'source-identity',
        provider: 'deterministic-source-identity',
        model: 'none',
        requestDigest,
        responseDigest: digest(units[0].sourceText),
        translation: units[0].sourceText,
        backTranslation: units[0].sourceText,
        confidence: 1,
        warnings: [],
        elapsedMs: 0,
        qualityGate: 'passed',
      });
      continue;
    }
    const startedAt = Date.now();
    try {
      const response = await generateChat(provider, {
        model: MODEL,
        messages,
        temperature: 0.15,
        maxTokens: 8_192,
        responseFormat: { type: 'json_object' },
        reasoningEffort: 'low',
        stream: false,
      }, { timeoutMs: 180_000 });
      if (!response?.ok) throw new Error(response?.error || response?.code || 'unknown provider failure');
      const translated = applyLocalizationTranslationResponse(project, response.text);
      assert.equal(translated.length, 1);
      assert.ok(translated[0].translatedText);
      assert.match(translated[0].translatedText, /T8/u);
      assert.match(translated[0].translatedText, /2026/u);
      assert.match(translated[0].translatedText, /\{count\}/u);
      results.push({
        language,
        status: 'passed',
        provider: provider.id,
        model: response.model || MODEL,
        requestDigest,
        responseDigest: digest(response.text),
        translation: translated[0].translatedText,
        backTranslation: translated[0].backTranslation || '',
        confidence: translated[0].confidence ?? null,
        warnings: translated[0].warnings || [],
        finishReason: response.finishReason || '',
        usage: response.usage || null,
        elapsedMs: Date.now() - startedAt,
        qualityGate: 'passed',
      });
    } catch (error) {
      results.push({
        language,
        status: 'failed-no-retry',
        provider: provider.id,
        model: MODEL,
        requestDigest,
        elapsedMs: Date.now() - startedAt,
        error: safeError(error, apiKey),
        qualityGate: 'failed',
        automaticallyRetried: false,
      });
    }
  }

  const report = {
    schema: 't8-localization-master-live-translation-report-v1',
    createdAt: new Date().toISOString(),
    provider: 'seedance-nz',
    model: MODEL,
    sourceDigest: digest(sourceText),
    providerCallCount: results.filter((item) => item.provider === 'seedance-nz').length,
    sourceIdentityCount: results.filter((item) => item.status === 'source-identity').length,
    languages: results,
    ...(priorAmbiguous ? { priorAmbiguousAttempt: { summary: priorAmbiguous, automaticallyRetried: false } } : {}),
    keyPersisted: false,
    rawResponsesPersisted: false,
  };
  const serialized = JSON.stringify(report, null, 2);
  assert.equal(serialized.includes(apiKey), false, '验收报告不得包含 API Key');
  const output = path.resolve('artifacts', 'localization-master-live', 'translation-report.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${serialized}\n`, 'utf8');
  const failed = results.filter((item) => item.status === 'failed-no-retry');
  assert.equal(failed.length, 0, `${failed.length} 个语言分支未通过，已保留失败回执且没有自动重试`);
  process.stdout.write(`${JSON.stringify({ ok: true, report: output, providerCallCount: results.filter((item) => item.provider === 'seedance-nz').length, languages: LANGUAGES })}\n`);
}

main().catch((error) => {
  let secret = '';
  try { secret = String(settings().zhenzhenSd2ApiKey || ''); } catch { /* nothing */ }
  process.stderr.write(`${safeError(error, secret)}\n`);
  process.exitCode = 1;
});
