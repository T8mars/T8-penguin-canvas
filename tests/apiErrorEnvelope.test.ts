import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import i18n from '../src/i18n';
import { localizeApiError } from '../src/i18n/apiErrors';
import { parseApiErrorEnvelope } from '../src/services/api';

const require = createRequire(import.meta.url);
const {
  normalizeApiErrorPayload,
  sanitizeApiErrorParams,
} = require('../backend/src/utils/apiErrorEnvelope.js') as {
  normalizeApiErrorPayload: (payload: Record<string, unknown>, status: number) => Record<string, unknown>;
  sanitizeApiErrorParams: (params: Record<string, unknown>, status: number) => Record<string, unknown>;
};

test('backend error envelope preserves the legacy message and adds a stable localization contract', () => {
  const payload = normalizeApiErrorPayload({
    success: false,
    code: 'canvas_revision_conflict',
    error: '画布版本已变更',
    params: { revision: 42, token: 'must-not-leak', path: 'C:\\private' },
  }, 409);
  assert.equal(payload.code, 'canvas_revision_conflict');
  assert.equal(payload.messageKey, 'errors.api.conflict');
  assert.equal(payload.error, '画布版本已变更');
  assert.deepEqual(payload.params, { status: 409, revision: 42 });
});

test('error params reject sensitive or unbounded transport details', () => {
  assert.deepEqual(sanitizeApiErrorParams({
    count: 3,
    retryable: true,
    url: 'https://signed.example/secret',
    apiKey: 'secret',
    note: 'x'.repeat(500),
  }, 502), {
    status: 502,
    count: 3,
    retryable: true,
    note: 'x'.repeat(160),
  });
});

test('frontend parses and localizes the same error without depending on Chinese message text', async () => {
  const envelope = parseApiErrorEnvelope({
    code: 'origin_forbidden',
    messageKey: 'errors.api.forbidden',
    params: { status: 403 },
    error: '请求来源未获本地后端授权',
  }, 403);
  assert.equal(envelope.code, 'origin_forbidden');
  await i18n.changeLanguage('en-US');
  assert.equal(localizeApiError(envelope), 'This operation is not authorized');
  await i18n.changeLanguage('zh-CN');
  assert.equal(localizeApiError(envelope), '当前操作未获授权');
});

test('server installs the envelope before routes and has API 404 plus terminal error handling', () => {
  const source = readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('app.use(apiErrorEnvelopeMiddleware)') < source.indexOf("app.use('/api/canvas'"));
  assert.match(source, /app\.use\('\/api', \(req, res\) => sendApiError/);
  assert.match(source, /app\.use\(\(error, req, res, next\) =>/);
});
