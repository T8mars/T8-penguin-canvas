import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assetsProvider = require('../backend/src/providers/volcengineAssets.js');

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

const settings = {
  advancedProviders: [{
    id: 'volcengine',
    protocol: 'volcengine',
    volcengineConfig: {
      project: 'default',
      region: 'cn-beijing',
      accessKeyId: 'AKLTEXAMPLE1234567890',
      secretAccessKey: 'example-secret',
    },
  }],
};

test('Volcengine Assets signer uses the root Action protocol without an explicit Host header', () => {
  const signed = assetsProvider.signVolcengineAssetsRequest({
    accessKeyId: 'AKLTEXAMPLE1234567890',
    secretAccessKey: 'example-secret',
    region: 'cn-beijing',
    action: 'ListAssets',
    body: { ProjectName: 'default' },
    now: new Date('2026-08-26T01:02:03Z'),
  });

  assert.equal(signed.url, 'https://open.volcengineapi.com/?Action=ListAssets&Version=2024-01-01');
  assert.equal(signed.body, '{"ProjectName":"default"}');
  assert.equal(signed.headers.Host, undefined);
  assert.equal(signed.headers.host, undefined);
  assert.equal(signed.headers['X-Date'], '20260826T010203Z');
  assert.equal(signed.headers['X-Content-Sha256'], '7e0a39e645f91c0fa13aea4108715f9f85a3f55f8d3e6af22c41b5b9d11fbde3');
  assert.equal(
    signed.headers.Authorization,
    'HMAC-SHA256 Credential=AKLTEXAMPLE1234567890/20260826/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=4b84e55069ecc0e89e44f8541d5b1690a4f9ce1cb33a4341f8ac196026d16ea1',
  );
});

test('Volcengine Assets profile keeps AK/SK server-side and reports configuration status without values', () => {
  const profile = assetsProvider.findVolcengineAssetsProfile(settings, 'volcengine');
  assert.equal(profile.project, 'default');
  assert.equal(profile.region, 'cn-beijing');
  assert.equal(profile.accessKeyId, 'AKLTEXAMPLE1234567890');
  assert.equal(profile.secretAccessKey, 'example-secret');

  const status = assetsProvider.volcengineAssetsProfileStatus(settings, 'volcengine');
  assert.deepEqual(status, {
    profileId: 'volcengine',
    project: 'default',
    region: 'cn-beijing',
    configured: true,
  });
  assert.equal(JSON.stringify(status).includes('AKLT'), false);
  assert.equal(JSON.stringify(status).includes('example-secret'), false);
});

test('Volcengine Assets request accepts only the audited action allow-list', async () => {
  await assert.rejects(
    assetsProvider.requestVolcengineAssets({ settings, action: 'DeleteAsset', body: {} }),
    /Action.*白名单/,
  );
});

test('Volcengine Assets import validation rejects local, private, data, and custom URLs', () => {
  for (const url of [
    'file:///C:/secret.png',
    'http://127.0.0.1:18766/input.png',
    'http://localhost/input.png',
    'http://10.0.0.2/input.png',
    'http://192.168.1.2/input.png',
    'http://172.16.0.2/input.png',
    'data:image/png;base64,AAA',
    'asset://asset-123',
  ]) {
    assert.throws(() => assetsProvider.validatePublicAssetUrl(url), /公网 HTTP\(S\)/);
  }
  assert.equal(assetsProvider.validatePublicAssetUrl('https://cdn.example.com/input.png'), 'https://cdn.example.com/input.png');
});

test('Volcengine Assets request sends bounded JSON and normalizes upstream errors without credential leakage', async () => {
  let call: any = null;
  const payload = await assetsProvider.requestVolcengineAssets({
    settings,
    profileId: 'volcengine',
    action: 'ListAssetGroups',
    body: { ProjectName: 'default', Filter: { GroupType: 'AIGC' }, PageNumber: 1, PageSize: 20 },
    now: new Date('2026-08-26T01:02:03Z'),
    fetchImpl: async (url: string, init: any) => {
      call = { url, init };
      return response({ Result: { Items: [{ Id: 'group-1', Name: 'A' }] } });
    },
  });
  assert.equal(call.url, 'https://open.volcengineapi.com/?Action=ListAssetGroups&Version=2024-01-01');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Host, undefined);
  assert.equal(payload.Result.Items[0].Id, 'group-1');

  await assert.rejects(
    assetsProvider.requestVolcengineAssets({
      settings,
      action: 'GetAsset',
      body: { ProjectName: 'default', Id: 'asset-bad' },
      fetchImpl: async () => response({
        ResponseMetadata: {
          RequestId: 'request-safe',
          Error: { Code: 'AccessDenied', Message: 'permission denied' },
        },
      }, 403),
    }),
    (error: any) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'AccessDenied');
      assert.equal(error.requestId, 'request-safe');
      assert.match(error.message, /permission denied/);
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes('AKLTEXAMPLE'), false);
      assert.equal(serialized.includes('example-secret'), false);
      assert.equal(serialized.includes('Authorization'), false);
      return true;
    },
  );
});

test('Volcengine asset references preserve exact IDs and reject malformed schemes', () => {
  assert.equal(
    assetsProvider.normalizeVolcengineAssetUri('asset://Asset-20260826-AbC123'),
    'asset://Asset-20260826-AbC123',
  );
  assert.equal(
    assetsProvider.normalizeVolcengineAssetUri('Asset://asset-20260826-xyz'),
    'asset://asset-20260826-xyz',
  );
  assert.throws(() => assetsProvider.normalizeVolcengineAssetUri('asset://../secret'), /素材引用/);
  assert.throws(() => assetsProvider.normalizeVolcengineAssetUri('https://example.com/a.png'), /素材引用/);
});
