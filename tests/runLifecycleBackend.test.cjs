const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RUN_EVENT_TYPES,
  normalizeRunStatus,
  normalizeNodeRunStatus,
  runEventTypeForStatus,
  nodeRunEventTypeForStatus,
  normalizeRunEventType,
} = require('../backend/src/services/runLifecycle');
const { normalizeRunError } = require('../backend/src/services/runErrors');

test('backend lifecycle protocol maps storage statuses to canonical event names', () => {
  assert.equal(runEventTypeForStatus('queued'), 'run.queued');
  assert.equal(runEventTypeForStatus('running'), 'run.running');
  assert.equal(nodeRunEventTypeForStatus('queued'), 'node.queued');
  assert.equal(nodeRunEventTypeForStatus('running'), 'node.started');
  assert.equal(nodeRunEventTypeForStatus('polling'), 'node.polling');
  assert.equal(nodeRunEventTypeForStatus('succeeded'), 'node.succeeded');
  assert.equal(nodeRunEventTypeForStatus('failed'), 'node.failed');
  assert.equal(nodeRunEventTypeForStatus('stopped'), 'node.stopped');
});

test('backend lifecycle protocol accepts the complete frozen event vocabulary and rejects guesses', () => {
  for (const type of [
    'run.queued', 'run.running', 'run.succeeded', 'run.failed', 'run.stopped', 'run.interrupted',
    'node.queued', 'node.started', 'node.progress', 'node.polling', 'node.output',
    'node.succeeded', 'node.failed', 'node.stopped', 'node.interrupted',
    'provider.request', 'provider.submitted', 'provider.polling', 'provider.response', 'provider.usage',
  ]) {
    assert.equal(RUN_EVENT_TYPES.has(type), true, `${type} must be part of the protocol`);
    assert.equal(normalizeRunEventType(type.toUpperCase()), type);
  }
  assert.throws(() => normalizeRunStatus('success'), /不支持/);
  assert.throws(() => normalizeNodeRunStatus('cancelled'), /不支持/);
  assert.throws(() => normalizeRunEventType('node.maybe-done'), /不支持/);
});

test('project run routes force queued creation, redact payloads and map running to started', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'routes', 'projectRuns.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  const postBuild = fs.readFileSync(path.join(__dirname, '..', 'electron', '_post_build.cjs'), 'utf8');
  const runHook = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'useRunTrigger.ts'), 'utf8');
  const imageNode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'nodes', 'ImageNode.tsx'), 'utf8');
  const videoNode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'nodes', 'VideoNode.tsx'), 'utf8');
  assert.match(source, /database\.createRun\(\{[\s\S]*status: 'queued'/);
  assert.match(source, /database\.createNodeRun\(\{[\s\S]*status: 'queued'/);
  assert.match(source, /normalizeRunEventType\(req\.body\?\.type\)/);
  assert.match(source, /nodeRunEventTypeForStatus\(requestedStatus\)/);
  assert.match(source, /eventPayload/);
  assert.match(source, /commitRunOutputArtifacts/);
  assert.match(source, /assetIndexer\.commitHostRunOutputAssets/);
  assert.match(source, /const \{ publicAsset, redactLocalPaths \} = require\('\.\.\/services\/assetPublicView'\)/);
  assert.match(source, /assets: result\.assets\.map\(publicAsset\)/);
  assert.match(source, /const incomingMetadata = redactAndScanRunValue\(req\.body\?\.metadata \|\| \{\}\)/);
  assert.match(source, /metadata: incomingMetadata/);
  assert.match(source, /metadata: req\.body\?\.metadata === undefined \? undefined : redactAndScanRunValue\(req\.body\.metadata\)/);
  assert.match(source, /function authoritativeRunEventPayload[\s\S]*redactAndScanRunValue/);
  assert.match(source, /delete userPayload\[key\]/);
  assert.match(source, /database\.claimRunIntent/);
  assert.match(source, /database\.finishRunIntentForRun/);
  assert.match(source, /broadcastHostRunState/);
  assert.match(source, /broadcastHostRunOutput/);
  assert.match(source, /getRunRecoveryManager/);
  assert.match(source, /router\.get\('\/recovery'/);
  assert.match(source, /recoveryManager\.recoverPendingRuns\(\)/);
  assert.match(server, /startupRunRecoveryPromise = Promise\.resolve\(\)\s*\.then\(\(\) => runs\.recoveryManager\.recoverPendingRuns\(\)\)/);
  assert.match(server, /await shutdownRunRecoveryLifecycle\(\)/);
  assert.match(runHook, /inferRunRecoveryDescriptor/);
  assert.match(runHook, /metadata: \{ lastProviderEvent: 'provider\.polling', \.\.\.\(recovery \? \{ recovery \} : \{\}\) \}/);
  assert.match(runHook, /type === 'provider\.submitted' \|\| type === 'provider\.polling'/);
  assert.match(imageNode, /kind: 'image-fal'/);
  assert.match(imageNode, /kind: 'mj'/);
  assert.match(videoNode, /kind: 'video-fal'/);
  const recoveryFamilies = {
    isH3Lowprice: 'h3-lowprice', isMuse: 'muse', isWan: 'wan', isAnimate: 'animate',
    isSeedance25: 'seedance', isFlux3: 'flux3', isHailuo: 'hailuo', isKling: 'kling',
    isTopaz: 'topaz', isVosr2: 'vosr2', isFashVsr: 'fashvsr', isUpscaler: 'upscaler', isVidu: 'vidu',
    isHappyHorse: 'happyhorse', isApimartBudgetVideo: 'seedance',
  };
  const recoveryExpression = videoNode.match(/kind: (isH3Lowprice[^\r\n]+)/)?.[1].replace(/,\s*$/, '');
  assert.ok(recoveryExpression, 'actual VideoNode recovery discriminator must be present');
  // Repository-owned expression only; verify each family and precedence rather
  // than an obsolete one-line spelling that omitted already shipped models.
  const familyNames = Object.keys(recoveryFamilies);
  const recoveryKind = new Function(...familyNames, `return (${recoveryExpression});`);
  assert.equal(recoveryKind(...familyNames.map(() => false)), 'video');
  for (const [first, expected] of Object.entries(recoveryFamilies)) {
    assert.equal(recoveryKind(...familyNames.map(name => name === first)), expected);
    for (const second of familyNames.slice(familyNames.indexOf(first) + 1)) {
      assert.equal(recoveryKind(...familyNames.map(name => name === first || name === second)), expected);
    }
  }
  assert.match(postBuild, /services', 'runLifecycle\.t8c'/);
  assert.match(postBuild, /services', 'runErrors\.t8c'/);
  assert.match(postBuild, /services', 'runUsage\.t8c'/);
  assert.match(postBuild, /services', 'runRecovery\.t8c'/);
});

test('backend error normalization preserves one stable safe error vocabulary', () => {
  assert.deepEqual(normalizeRunError({ status: 401, message: 'invalid API key' }), {
    kind: 'authentication',
    message: 'invalid API key',
    httpStatus: 401,
    retryable: false,
  });
  assert.equal(normalizeRunError(new Error('HTTP 429 too many requests')).kind, 'rate_limit');
  assert.equal(normalizeRunError({ code: 'ENOSPC', message: 'disk full' }).kind, 'local_io');
  assert.equal(normalizeRunError({ status: 503, message: 'upstream unavailable' }).retryable, true);
  assert.equal(normalizeRunError({ transportHttpStatus: 429, message: 'proxy request rejected' }).kind, 'rate_limit');
});
