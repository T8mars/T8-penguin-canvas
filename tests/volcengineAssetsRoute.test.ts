import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const { createVolcengineAssetsRouter } = await import('../backend/src/routes/volcengineAssets.js');

async function startRouter(options: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/volcengine-assets', createVolcengineAssetsRouter(options));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  return {
    base: `http://127.0.0.1:${address.port}/api/volcengine-assets`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('Volcengine Assets routes keep credentials server-side and forward only allow-listed actions', async () => {
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-volc-assets-route-'));
  const fixture = await startRouter({
    catalogFile: path.join(temp, 'catalog.json'),
    jobsFile: path.join(temp, 'jobs.json'),
    loadSettings: () => ({
      advancedProviders: [{
        id: 'volcengine', protocol: 'volcengine',
        volcengineConfig: { project: 'demo', region: 'cn-beijing', accessKeyId: 'AK', secretAccessKey: 'SK' },
      }],
    }),
    requestAssets: async ({ action, body }: { action: string; body: Record<string, unknown> }) => {
      calls.push({ action, body });
      if (action === 'ListAssetGroups') return { Result: { Items: [{ Id: 'group-1', Name: 'Demo' }] } };
      if (action === 'ListAssets') return { Result: { Items: [{ Id: 'asset-AbC', Name: 'Shot', AssetType: 'Image', Status: 'Active' }] } };
      if (action === 'CreateAsset') return { Result: { Id: 'asset-New' } };
      return { Result: {} };
    },
  });
  try {
    const status = await (await fetch(`${fixture.base}/status`)).json();
    assert.deepEqual(status, { success: true, data: { profileId: 'volcengine', project: 'demo', region: 'cn-beijing', configured: true } });
    assert.equal(JSON.stringify(status).includes('AK'), false);
    assert.equal(JSON.stringify(status).includes('SK'), false);

    const groups = await (await fetch(`${fixture.base}/groups/list`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })).json();
    assert.equal(groups.success, true);
    assert.equal(calls[0].action, 'ListAssetGroups');
    assert.deepEqual(calls[0].body, { ProjectName: 'demo', Filter: { GroupType: 'AIGC' } });

    const assets = await (await fetch(`${fixture.base}/assets/list`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groupId: 'group-1', pageSize: 999 }),
    })).json();
    assert.equal(assets.success, true);
    assert.equal(calls[1].action, 'ListAssets');
    assert.deepEqual(calls[1].body, {
      ProjectName: 'demo', Filter: { GroupType: 'AIGC', GroupIds: ['group-1'] }, PageNumber: 1, PageSize: 100,
    });
  } finally {
    await fixture.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Volcengine Assets import validates public URLs and local tags persist atomically', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-volc-assets-route-'));
  const catalogFile = path.join(temp, 'catalog.json');
  const calls: string[] = [];
  const options = {
    catalogFile,
    jobsFile: path.join(temp, 'jobs.json'),
    loadSettings: () => ({ advancedProviders: [{ id: 'volcengine', protocol: 'volcengine', volcengineConfig: { project: 'demo', accessKeyId: 'AK', secretAccessKey: 'SK' } }] }),
    requestAssets: async ({ action }: { action: string }) => {
      calls.push(action);
      if (action === 'GetAsset') return { Result: { Asset: { Id: 'asset-New', Status: 'Active' } } };
      return { Result: { Id: 'asset-New', Status: 'Processing' }, ResponseMetadata: { RequestId: 'request-safe' } };
    },
  };
  const first = await startRouter(options);
  try {
    const rejected = await fetch(`${first.base}/assets/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: 'group-1', kind: 'Image', url: 'http://127.0.0.1/private.png' }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(calls, []);

    const imported = await (await fetch(`${first.base}/assets/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: 'group-1', kind: 'Image', url: 'https://cdn.example.com/a.png', name: 'A' }),
    })).json();
    assert.equal(imported.success, true);
    assert.equal(imported.data.assetUri, 'asset://asset-New');
    assert.equal(imported.data.status, 'processing');
    assert.equal(Object.hasOwn(imported.data, 'response'), false);

    const persistedJobText = fs.readFileSync(options.jobsFile, 'utf8');
    assert.equal(persistedJobText.includes('https://cdn.example.com/a.png'), false);
    assert.equal(persistedJobText.includes('secretAccessKey'), false);
    assert.equal(persistedJobText.includes(temp), false);

    const tagged = await (await fetch(`${first.base}/assets/asset-New/tags`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['hero', ' hero ', 'night'] }),
    })).json();
    assert.deepEqual(tagged.data.tags, ['hero', 'night']);
  } finally {
    await first.close();
  }

  const second = await startRouter(options);
  try {
    const metadata = await (await fetch(`${second.base}/assets/tags?assetIds=asset-New`)).json();
    assert.deepEqual(metadata.data.assets, { 'asset-New': ['hero', 'night'] });

    const listed = await (await fetch(`${second.base}/jobs?profileId=volcengine&projectName=demo`)).json();
    assert.equal(listed.data.jobs.length, 1);
    assert.equal(listed.data.jobs[0].status, 'processing');

    const refreshed = await (await fetch(`${second.base}/jobs/${listed.data.jobs[0].id}/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'volcengine', projectName: 'demo' }),
    })).json();
    assert.equal(refreshed.data.status, 'active');
    assert.equal(calls.at(-1), 'GetAsset');

    const crossScope = await fetch(`${second.base}/jobs/${listed.data.jobs[0].id}/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'volcengine', projectName: 'another-project' }),
    });
    assert.equal(crossScope.status, 404);
  } finally {
    await second.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
