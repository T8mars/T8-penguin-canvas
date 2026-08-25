import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  resolveRunningHubDisplaySite,
  resolvedRhSiteFromAppInfo,
} from '../src/utils/runningHubResolvedSite.ts';

const require = createRequire(import.meta.url);
const routing = require('../backend/src/providers/runninghubSite.js');

test('RunningHub site routing keeps the legacy key on the domestic site', () => {
  const settings = { rhApiKey: 'cn-key', rhIntlApiKey: 'intl-key' };
  const domestic = routing.getRhSiteConfig(settings, 'cn');
  const overseas = routing.getRhSiteConfig(settings, 'intl');

  assert.equal(domestic.baseUrl, 'https://www.runninghub.cn');
  assert.equal(Object.prototype.hasOwnProperty.call(domestic, 'host'), false);
  assert.equal(domestic.apiKey, 'cn-key');
  assert.equal(overseas.baseUrl, 'https://www.runninghub.ai');
  assert.equal(Object.prototype.hasOwnProperty.call(overseas, 'host'), false);
  assert.equal(overseas.apiKey, 'intl-key');
  assert.equal(routing.normalizeRhSite(undefined), 'cn');
});

test('RunningHub URL owns the upstream authority and no route hand-writes Host', () => {
  const proxyRoute = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');
  const start = proxyRoute.indexOf("router.post('/runninghub/submit'");
  const end = proxyRoute.indexOf('module.exports = router;', start);
  assert.ok(start > 0 && end > start, 'RunningHub route block must remain discoverable');
  const runningHubRoutes = proxyRoute.slice(start, end);

  assert.doesNotMatch(runningHubRoutes, /\bHost\s*:/);
  assert.doesNotMatch(runningHubRoutes, /candidate\.host/);
  for (const path of [
    '/task/openapi/ai-app/run',
    '/task/openapi/outputs',
    '/task/openapi/cancel',
    '/task/openapi/upload',
    '/api/webapp/apiCallDemo',
  ]) {
    assert.match(runningHubRoutes, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('RunningHub site candidates prefer the selected site and can use the configured alternate', () => {
  const settings = { rhApiKey: 'cn-key', rhIntlApiKey: 'intl-key' };
  assert.deepEqual(
    routing.buildRhSiteCandidates(settings, 'intl').map((item: any) => [item.id, item.apiKey]),
    [['intl', 'intl-key'], ['cn', 'cn-key']],
  );
  assert.deepEqual(
    routing.buildRhSiteCandidates({ rhApiKey: 'cn-key' }, 'intl').map((item: any) => item.id),
    ['cn'],
  );
});

test('RunningHub automatic site fallback is limited to credentials and missing app or task errors', () => {
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 401 }, {}), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { code: 901 }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { code: 1002 }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { code: 1004 }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { code: 332 }), false);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { msg: 'API key invalid' }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { msg: 'webapp does not exist' }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { msg: 'task not found' }), true);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 200 }, { msg: 'Custom validation failed for node 12' }), false);
  assert.equal(routing.shouldRetryRhSiteResponse({ status: 500 }, { msg: 'server busy' }), false);
});

test('RunningHub display follows the WebApp site resolved by app-info', () => {
  const webappId = '2059288938585616386';

  assert.equal(
    resolveRunningHubDisplaySite('cn', webappId, { webappId, rhSite: 'intl' }),
    'intl',
  );
  assert.equal(
    resolveRunningHubDisplaySite('intl', webappId, { webappId, rhSite: 'cn' }),
    'cn',
  );
  assert.equal(
    resolveRunningHubDisplaySite('cn', 'new-app', { webappId: 'old-app', rhSite: 'intl' }),
    'cn',
  );
  assert.equal(resolvedRhSiteFromAppInfo({ rhSite: 'intl' }, webappId), 'intl');
});

test('RunningHub settings and RH node surfaces expose independent domestic and overseas configuration', () => {
  const settingsRoute = readFileSync(new URL('../backend/src/routes/settings.js', import.meta.url), 'utf8');
  const apiSettings = readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8');
  const runningHubNode = readFileSync(new URL('../src/components/nodes/RunningHubNode.tsx', import.meta.url), 'utf8');
  const rhToolsNode = readFileSync(new URL('../src/components/nodes/RHToolsNode.tsx', import.meta.url), 'utf8');
  const rhToolsEditor = readFileSync(new URL('../src/components/nodes/RHToolEditorModal.tsx', import.meta.url), 'utf8');
  const rhToolbox = readFileSync(new URL('../src/utils/rhToolbox.ts', import.meta.url), 'utf8');

  assert.match(settingsRoute, /rhIntlApiKey:\s*''/);
  assert.match(settingsRoute, /rhIntlApiKey:\s*maskKey\(settings\.rhIntlApiKey\)/);
  assert.match(apiSettings, /keys\.rhCn\.label/);
  assert.match(apiSettings, /keys\.rhIntl\.label/);
  assert.match(generation, /site\?: RhSite/);
  assert.match(generation, /site=\$\{encodeURIComponent\(site\)\}/);
  assert.match(runningHubNode, /runningHub\.siteCn/);
  assert.match(runningHubNode, /runningHub\.siteIntl/);
  assert.match(runningHubNode, /resolveRunningHubDisplaySite\(storedRhSite, webappId, appInfo\)/);
  assert.match(runningHubNode, /update\(\{ rhSite: resolvedAppInfoSite \}\)/);
  assert.match(runningHubNode, /webappId: e\.target\.value,\s+appInfo: null,/);
  assert.match(rhToolsNode, /resolveRunningHubDisplaySite\(configuredRhSite, webappId, appInfo\)/);
  assert.match(rhToolsNode, /displayedRhSite === 'intl' \? '海外站' : '国内站'/);
  assert.match(rhToolsEditor, /aria-label="RunningHub 站点"/);
  assert.match(rhToolsEditor, /data\?\.rhSite === 'intl' \|\| data\?\.rhSite === 'cn'/);
  assert.match(rhToolsEditor, /import \{ createPortal \} from 'react-dom'/);
  assert.match(rhToolsEditor, /createPortal\(modal, document\.body\)/);
  assert.match(rhToolsEditor, /data-rh-tool-editor-modal="true"/);
  assert.match(rhToolsEditor, /zIndex:\s*2147483000/);
  assert.match(rhToolbox, /rhSite\?: 'cn' \| 'intl'/);
});
