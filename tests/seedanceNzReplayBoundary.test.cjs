const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerSubmissionContextMiddleware } = require('../backend/src/services/providerSubmissionContext');

const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 't8-seedance-replay-')));
test.after(() => {
  const relative = path.relative(fs.realpathSync.native(os.tmpdir()), temporary);
  assert.ok(relative && !path.isAbsolute(relative) && !relative.startsWith('..'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

// Compile the unchanged production module and substitute only transport/config
// dependencies. No real authority file, user database or Provider is opened.
function loadProvider(recoveryFetch) {
  const filename = require.resolve('../backend/src/providers/seedanceNz.js');
  const configPath = require.resolve('../backend/src/config');
  const previous = require.cache[configPath];
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    PORT: 18766, BASE_DIR: temporary, INPUT_DIR: temporary, OUTPUT_DIR: temporary,
    DATA_DIR: temporary, ZHENZHEN_SD2_BASE_URL: 'https://api.seedance.nz',
  } };
  try {
    const localRequire = Module.createRequire(filename), loaded = new Module(filename, module);
    loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded.require = name => name === 'undici' ? { ...localRequire(name), fetch: recoveryFetch } : localRequire(name);
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loaded.exports;
  } finally { if (previous) require.cache[configPath] = previous; else delete require.cache[configPath]; }
}
function submission(key, work) {
  return new Promise((resolve, reject) => providerSubmissionContextMiddleware({ get: () => key }, {}, () => Promise.resolve().then(work).then(resolve, reject)));
}
function networkFailure(code, message = 'EXAMPLE connection lost after request write') {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), code ? { code } : {}) });
}
const request = { prompt: 'EXAMPLE ONLY blue ceramic teapot', resolution: '1k' };
const accepted = () => Response.json({ task_id: 'task_EXAMPLE_ACCEPTED' });

test('seedance default transport never replays an ambiguous paid POST, including requests carrying a stable submission key', async () => {
  const original = global.fetch;
  try {
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ETIMEDOUT', 'ENETUNREACH']) for (const key of ['', 'EXAMPLE_SUBMISSION_0001']) {
      let primary = 0, recovery = 0, seenKey;
      const provider = loadProvider(async () => { recovery++; return accepted(); });
      global.fetch = async (_url, init) => { primary++; assert.equal(init.method, 'POST'); assert.equal(init.dispatcher, undefined); seenKey = new Headers(init.headers).get('Idempotency-Key'); throw networkFailure(code); };
      await assert.rejects(submission(key, () => provider.submitImageTask(request, 'EXAMPLE_TEST_ONLY_KEY')), error => error.code === 'SEEDANCE_UPSTREAM_UNAVAILABLE');
      assert.equal(primary, 1, `${code}: one primary request`); assert.equal(recovery, 0, `${code}: no alternate paid request`); assert.equal(seenKey, key || null);
    }
  } finally { global.fetch = original; }
});

test('certificate-looking error text alone does not prove that a paid POST failed before submission', async () => {
  const original = global.fetch; let recovery = 0;
  const provider = loadProvider(async () => { recovery++; return accepted(); });
  try {
    for (const code of [undefined, 'ECONNRESET']) {
      global.fetch = async () => { throw networkFailure(code, 'EXAMPLE certificate reset after request write'); };
      await assert.rejects(provider.submitImageTask(request, 'EXAMPLE_TEST_ONLY_KEY'), error => error.code === 'SEEDANCE_UPSTREAM_UNAVAILABLE');
    }
    assert.equal(recovery, 0);
  } finally { global.fetch = original; }
});

test('an exact pre-request certificate verification failure retains one verified TLS recovery attempt', async () => {
  const original = global.fetch; let primary = 0, recovery = 0;
  const provider = loadProvider(async (_url, init) => { recovery++; assert.ok(init.dispatcher); assert.equal(init.method, 'POST'); return accepted(); });
  try {
    global.fetch = async () => { primary++; throw networkFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'); };
    assert.equal((await provider.submitImageTask(request, 'EXAMPLE_TEST_ONLY_KEY')).taskId, 'task_EXAMPLE_ACCEPTED');
    assert.equal(primary, 1); assert.equal(recovery, 1);
  } finally { global.fetch = original; }
});

test('read-only task recovery still uses fresh connections and the final read-only DNS fallback', async () => {
  const original = global.fetch; let primary = 0, recovery = 0; const dispatchers = [];
  const provider = loadProvider(async (_url, init) => { recovery++; dispatchers.push(init.dispatcher); assert.equal(init.method || 'GET', 'GET'); assert.equal(new Headers(init.headers).get('Idempotency-Key'), null); if (recovery === 1) throw networkFailure('ECONNRESET'); return Response.json({ id: 'task_EXAMPLE_ORIGINAL', status: 'completed', metadata: { url: 'https://media.example.com/EXAMPLE.mp4' } }); });
  try {
    global.fetch = async () => { primary++; throw networkFailure('ECONNRESET'); };
    const result = await submission('EXAMPLE_SUBMISSION_READ', () => provider.queryTask('task_EXAMPLE_ORIGINAL', 'EXAMPLE_TEST_ONLY_KEY'));
    assert.equal(result.status, 'succeeded'); assert.equal(primary, 1); assert.equal(recovery, 2); assert.notEqual(dispatchers[0], dispatchers[1]);
  } finally { global.fetch = original; }
});

test('an aborted paid submission does not enter a fallback connection', async () => {
  const original = global.fetch, controller = new AbortController(); let recovery = 0;
  const provider = loadProvider(async () => { recovery++; return accepted(); });
  try {
    global.fetch = async () => { controller.abort(); throw networkFailure('ECONNRESET'); };
    await assert.rejects(submission('EXAMPLE_SUBMISSION_ABORT', () => provider.submitImageTask(request, 'EXAMPLE_TEST_ONLY_KEY', { signal: controller.signal })), error => error.code === 'SEEDANCE_REQUEST_ABORTED');
    assert.equal(recovery, 0);
  } finally { global.fetch = original; }
});

test('HTTP errors and an unreadable accepted response never cause a replacement paid request', async () => {
  const original = global.fetch; let recovery = 0;
  const provider = loadProvider(async () => { recovery++; return accepted(); });
  try {
    for (const mode of ['server-error', 'invalid-json', 'interrupted-response']) {
      let primary = 0;
      global.fetch = async () => { primary++; return mode === 'server-error' ? Response.json({ error: { message: 'EXAMPLE_PROVIDER_FAILURE' } }, { status: 503 }) : mode === 'invalid-json' ? new Response('EXAMPLE_BAD_JSON') : new Response(new ReadableStream({ start(stream) { stream.error(new Error('EXAMPLE_AFTER_ACCEPTANCE')); } })); };
      await assert.rejects(submission('EXAMPLE_SUBMISSION_RESPONSE', () => provider.submitImageTask(request, 'EXAMPLE_TEST_ONLY_KEY')));
      assert.equal(primary, 1); assert.equal(recovery, 0);
    }
  } finally { global.fetch = original; }
});
