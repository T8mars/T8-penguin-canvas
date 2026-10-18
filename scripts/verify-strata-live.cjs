'use strict';
// Explicit, bounded local inference. No engine control, downloads or retries.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { testProviderConnection, generateChatWithProvider } = require('../backend/src/providers/adapters');
async function main() {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run required; set STRATA_BASE_URL to the actual API URL.');
  if (!['--text', '--multi-turn', '--json', '--vision', '--cancel'].some(flag => process.argv.includes(flag))) throw new Error('Choose --text, --multi-turn, --json, --vision or --cancel explicitly.');
  const baseUrl = process.env.STRATA_BASE_URL;
  if (!baseUrl) throw new Error('STRATA_BASE_URL required; ports are not scanned.');
  const provider = { id: 'strata-live-verification', label: 'Strata verification', protocol: 'openai-compatible', profile: 'strata', enabled: true,
    baseUrl, authMode: process.env.STRATA_API_KEY ? 'bearer' : 'none', apiKey: process.env.STRATA_API_KEY || '', chatModels: [] };
  const discovery = await testProviderConnection(provider);
  assert.equal(discovery.ok, true, discovery.error);
  const model = discovery.discovery.model;
  const reports = [];
  async function run(name, input, options = {}) {
    const start = Date.now();
    const result = await generateChatWithProvider(provider, { model, max_tokens: 96, reasoningEffort: 'none', ...input }, options);
    assert.equal(result.ok, true, `${name}: ${result.code} ${result.error}`);
    const report = { name, ok: true, elapsedMs: Date.now() - start, finishReason: result.finishReason, output: result.text };
    reports.push(report); process.stdout.write(`${JSON.stringify(report)}\n`);
    return result;
  }
  if (process.argv.includes('--text')) {
    const result = await run('text-stream', { prompt: 'Reply with exactly STRATA_OK and nothing else.', stream: true });
    assert.equal(result.text.trim(), 'STRATA_OK');
  }
  if (process.argv.includes('--multi-turn')) {
    const result = await run('multi-turn-history', { stream: true, messages: [
      { role: 'user', content: 'Remember this code for the next turn: STRATA_MULTI_42.' },
      { role: 'assistant', content: 'I will remember the code.' },
      { role: 'user', content: 'Return only the exact code I gave you in the previous user turn, with no other text.' },
    ] });
    assert.equal(result.text.trim(), 'STRATA_MULTI_42');
  }
  if (process.argv.includes('--json')) {
    const result = await run('json-object', { prompt: 'Return exactly one JSON object: {"strata_ok":true}. No other fields or explanation.', response_format: { type: 'json_object' } });
    assert.equal(JSON.parse(result.text).strata_ok, true);
  }
  if (process.argv.includes('--vision')) {
    assert.equal(discovery.discovery.vision, true, 'Vision not declared by service');
    const bytes = await require('sharp')({ create: { width: 128, height: 128, channels: 3, background: '#f00000' } }).png().toBuffer();
    const result = await run('image-understanding', { messages: [{ role: 'user', content: [
      { type: 'text', text: 'Name the dominant color of this image using one English word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } },
    ] }] });
    assert.match(result.text.toLowerCase(), /red/);
  }
  if (process.argv.includes('--cancel')) {
    const controller = new AbortController(); let deltas = 0;
    const result = await generateChatWithProvider(provider, { model, max_tokens: 4096, reasoningEffort: 'none', stream: true,
      prompt: 'Count from 1 to 1000, writing one number per line. Continue until 1000.' }, {
      signal: controller.signal, onDelta: () => { deltas++; controller.abort(); },
    });
    assert.ok(deltas > 0); assert.equal(result.ok, false); assert.equal(result.code, 'request_aborted');
    reports.push({ name: 'cancel-after-first-delta', ok: true, code: result.code, deltas });
  }
  const report = { passed: true, at: new Date().toISOString(), service: discovery.discovery.service, model, reports,
    boundary: 'User-started Strata API on this PC only; not LAN, other GPUs, installed Electron or native video acceptance. No automatic retries.' };
  if (process.argv.includes('--report')) {
    const root = path.resolve(__dirname, '..');
    report.sourceHashes = Object.fromEntries(['backend/src/providers/strata.js', 'backend/src/providers/llmDeadline.js', 'backend/src/providers/openaiCompatible.js', 'backend/src/providers/adapters.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    const directory = path.join(root, 'local-private/strata-llm-verification-20261018'); fs.mkdirSync(directory, { recursive: true });
    const filename = reports.length === 1 && process.argv.includes('--multi-turn') ? 'live-report-multi-turn.json' : 'live-report.json';
    fs.writeFileSync(path.join(directory, filename), JSON.stringify(report, null, 2));
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
