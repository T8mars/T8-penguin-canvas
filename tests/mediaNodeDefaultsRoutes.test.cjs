const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express');
const config = require('../backend/src/config');

test('real settings HTTP persists exact media defaults, rejects invalid values, and fails closed on corrupt initial preferences', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-media-defaults-http-'));
  const original = config.SETTINGS_FILE;
  let server;
  try {
    config.SETTINGS_FILE = path.join(temporary, 'settings.json');
    const app = express(); app.use(express.json()); app.use('/settings', require('../backend/src/routes/settings'));
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const endpoint = `http://127.0.0.1:${server.address().port}/settings`;
    const request = async (body) => {
      const response = await fetch(endpoint, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request()).status, 200); // Missing file is a genuine fresh installation.
    const defaults = { version: 1, imageSource: 'seedance-nz', videoSource: 'zhenzhen' };
    assert.equal((await request({ preferences: { mediaNodeDefaults: defaults, uiLocale: 'en-US' } })).status, 200);
    assert.deepEqual((await request()).body.data.preferences.mediaNodeDefaults, defaults);
    assert.deepEqual(JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8')).preferences.mediaNodeDefaults, defaults);
    const verifiedBytes = fs.readFileSync(config.SETTINGS_FILE);
    for (const invalid of [null, {}, { ...defaults, version: 2 }, { ...defaults, imageSource: 'guess' }, { ...defaults, videoSource: false }, { ...defaults, apiKey: 'forbidden' }]) {
      assert.equal((await request({ preferences: { mediaNodeDefaults: invalid } })).status, 400);
      assert.deepEqual(fs.readFileSync(config.SETTINGS_FILE), verifiedBytes);
    }
    assert.equal((await request({ preferences: { theme: 'light' } })).status, 200);
    assert.deepEqual((await request()).body.data.preferences.mediaNodeDefaults, defaults);
    fs.writeFileSync(config.SETTINGS_FILE, '{broken');
    assert.equal((await request()).status, 503);
    fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ preferences: { mediaNodeDefaults: { version: 99 } } }));
    assert.equal((await request()).body.code, 'media_node_defaults_not_ready');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    config.SETTINGS_FILE = original;
    assert.ok(path.resolve(temporary).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
