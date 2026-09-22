const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  COLLABORATION_RELEASE_EVIDENCE_CONTRACT,
  COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
  COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_VERSION,
  COLLABORATION_RELEASE_REQUIRED_CHECKS,
  assertCollaborationReleaseEvidence,
  assertCollaborationReleaseEvidenceForPublish,
} = require('../scripts/collaboration-release-evidence.cjs');

const TARGET = 'a'.repeat(40);
const VERSION = COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_VERSION;
const GENERATED_AT = '2026-07-20T00:00:00.000Z';
const NOW = Date.parse('2026-07-20T00:01:00.000Z');
const DEVICE_A = '1'.repeat(64);
const DEVICE_B = '2'.repeat(64);
const CLIENT_CHROME = '3'.repeat(64);
const CLIENT_EDGE = '4'.repeat(64);
const CLIENT_ELECTRON = '5'.repeat(64);
const CHALLENGE = '9'.repeat(64);
const SESSION_CHROME = 'a'.repeat(64);
const SESSION_EDGE = 'b'.repeat(64);
const SESSION_ELECTRON = 'c'.repeat(64);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function metricsFor(name) {
  if (name === 'lanMultiClient') {
    return {
      devices: 2,
      clients: 3,
      simultaneousDifferentNodeMoves: 1,
      sameNodeConflictsResolved: 1,
      simultaneousTextEdits: 1,
      deleteEditConflictsResolved: 1,
      silentDataLoss: 0,
      resurrectedDeletes: 0,
      staleRunResultWrites: 0,
    };
  }
  if (name === 'offline60Seconds') {
    return {
      offlineDurationMs: 60_000,
      clientsRecovered: 2,
      operationGapsRecovered: 1,
      silentDataLoss: 0,
      resurrectedDeletes: 0,
      staleRunResultWrites: 0,
    };
  }
  if (name === 'hostRestartRecovery') {
    return {
      restartCount: 1,
      clientsReconnected: 3,
      backupRestoreVerified: true,
      quickCheckOk: true,
      foreignKeyViolations: 0,
      silentDataLoss: 0,
      resurrectedDeletes: 0,
      staleRunResultWrites: 0,
    };
  }
  if (name === 'publicHealth') {
    return { statusCode: 200, tlsAuthorized: true, dnsResolvedPublic: true, totalDurationMs: 250 };
  }
  if (name === 'inviteRedeem') {
    return { successfulRedeems: 3, replayRejected: 1, expiredRejected: 1 };
  }
  if (name === 'websocketUpgrade') {
    return { statusCode: 101, joinedClients: 3, unexpectedCloses: 0 };
  }
  if (name === 'upload100MiB') {
    return {
      bytes: 100 * 1024 * 1024,
      completedUploads: 1,
      sha256Verified: true,
      unexpectedErrors: 0,
    };
  }
  if (name === 'rangePlayback') {
    return { bytes: 100 * 1024 * 1024, partialResponses: 2, seekVerified: true };
  }
  if (name === 'assetIndex100k') return { assets: 100_000 };
  if (name === 'connectionLoad') return { peakConnections: 100, unexpectedDisconnects: 0 };
  if (name === 'operationThroughput') return { operations: 10_000, durationMs: 20_000, unexpectedErrors: 0 };
  if (name === 'storageGrowth') {
    return { withinConfiguredBudget: true, observedGrowthBytes: 1024 * 1024, durationMs: 60_000 };
  }
  if (name === 'privateSurfaceScan') return { exposedPrivateEndpoints: 0 };
  if (name === 'sensitiveLogScan') return { findings: 0 };
  if (['reviewerAuthorizationRedTeam', 'pathMimeCompressionRedTeam',
    'ssrfDeepJsonRedTeam', 'replayRedTeam'].includes(name)) return { unexpectedBypasses: 0 };
  if (['loginRateLimit', 'uploadRateLimit', 'downloadRateLimit'].includes(name)) {
    return { limitedRequests: 1, stableRetryAfter: true };
  }
  if (name === 'messageRateLimit') return { limitedMessages: 1, stableCloseSemantics: true };
  if (name === 'electronInstallUpgrade') {
    return {
      installedPackageVerified: true,
      upgradeVerified: true,
      downgradeRejected: true,
      betterSqlite3Loaded: true,
      dataMigrationVerified: true,
    };
  }
  if (name === 'chromeCompatibility' || name === 'edgeCompatibility') {
    return { scenariosPassed: 8, unexpectedErrors: 0 };
  }
  return {};
}

function subjectsFor(name) {
  if (name === 'lanMultiClient' || name === 'hostRestartRecovery') {
    return {
      subjectDeviceIds: [DEVICE_A, DEVICE_B],
      subjectClientIds: [CLIENT_CHROME, CLIENT_EDGE, CLIENT_ELECTRON],
    };
  }
  if (name === 'electronInstallUpgrade') {
    return { subjectDeviceIds: [DEVICE_A, DEVICE_B] };
  }
  if (name === 'chromeCompatibility') {
    return { subjectDeviceIds: [DEVICE_A], subjectClientIds: [CLIENT_CHROME] };
  }
  if (name === 'edgeCompatibility') {
    return { subjectDeviceIds: [DEVICE_B], subjectClientIds: [CLIENT_EDGE] };
  }
  if (name === 'offline60Seconds') {
    return {
      subjectDeviceIds: [DEVICE_A, DEVICE_B],
      subjectClientIds: [CLIENT_CHROME, CLIENT_EDGE],
    };
  }
  if (name === 'upload100MiB') {
    return { subjectDeviceIds: [DEVICE_A], subjectClientIds: [CLIENT_CHROME] };
  }
  if (name === 'rangePlayback') {
    return { subjectDeviceIds: [DEVICE_B], subjectClientIds: [CLIENT_EDGE] };
  }
  return {};
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-collab-release-evidence-'));
  const artifactDefinitions = [
    { id: 'combined-report', kind: 'report', content: { ok: true } },
    {
      id: 'device-a-attestation',
      kind: 'json',
      content: {
        contractVersion: 't8-collaboration-device-attestation-v1',
        capturedAt: GENERATED_AT,
        challengeDigest: CHALLENGE,
        sourceCommit: TARGET,
        deviceId: DEVICE_A,
        platform: 'win32',
        physical: true,
        arch: 'x64',
        osBuild: '10.0.26100',
      },
    },
    {
      id: 'device-b-attestation',
      kind: 'json',
      content: {
        contractVersion: 't8-collaboration-device-attestation-v1',
        capturedAt: GENERATED_AT,
        challengeDigest: CHALLENGE,
        sourceCommit: TARGET,
        deviceId: DEVICE_B,
        platform: 'win32',
        physical: true,
        arch: 'x64',
        osBuild: '10.0.22631',
      },
    },
    {
      id: 'client-chrome-evidence',
      kind: 'json',
      content: {
        contractVersion: 't8-collaboration-client-attestation-v1',
        capturedAt: GENERATED_AT,
        challengeDigest: CHALLENGE,
        sourceCommit: TARGET,
        clientId: CLIENT_CHROME,
        profileId: '6'.repeat(64),
        sessionIdDigest: SESSION_CHROME,
        deviceId: DEVICE_A,
        browser: 'chrome',
      },
    },
    {
      id: 'client-edge-evidence',
      kind: 'json',
      content: {
        contractVersion: 't8-collaboration-client-attestation-v1',
        capturedAt: GENERATED_AT,
        challengeDigest: CHALLENGE,
        sourceCommit: TARGET,
        clientId: CLIENT_EDGE,
        profileId: '7'.repeat(64),
        sessionIdDigest: SESSION_EDGE,
        deviceId: DEVICE_B,
        browser: 'edge',
      },
    },
    {
      id: 'client-electron-evidence',
      kind: 'json',
      content: {
        contractVersion: 't8-collaboration-client-attestation-v1',
        capturedAt: GENERATED_AT,
        challengeDigest: CHALLENGE,
        sourceCommit: TARGET,
        clientId: CLIENT_ELECTRON,
        profileId: '8'.repeat(64),
        sessionIdDigest: SESSION_ELECTRON,
        deviceId: DEVICE_A,
        browser: 'electron',
      },
    },
  ];
  const artifacts = artifactDefinitions.map(({ id, kind, content }, index) => {
    const body = Buffer.from(`${JSON.stringify({ sequence: index + 1, ...content })}\n`, 'utf8');
    const filename = `${id}.json`;
    fs.writeFileSync(path.join(directory, filename), body);
    return { id, kind, path: filename, bytes: body.length, sha256: sha256(body) };
  });
  const allArtifactIds = artifacts.map((artifact) => artifact.id);
  const checks = Object.fromEntries(COLLABORATION_RELEASE_REQUIRED_CHECKS.map((name) => [name, {
    status: 'passed',
    completedAt: GENERATED_AT,
    artifactIds: allArtifactIds,
    metrics: metricsFor(name),
    ...subjectsFor(name),
  }]));
  const manifest = {
    contractVersion: COLLABORATION_RELEASE_EVIDENCE_CONTRACT,
    releaseVersion: VERSION,
    sourceCommit: TARGET,
    generatedAt: GENERATED_AT,
    environment: {
      challengeDigest: CHALLENGE,
      devices: [
        {
          id: DEVICE_A,
          platform: 'win32',
          physical: true,
          arch: 'x64',
          osBuild: '10.0.26100',
          attestationArtifactId: 'device-a-attestation',
        },
        {
          id: DEVICE_B,
          platform: 'win32',
          physical: true,
          arch: 'x64',
          osBuild: '10.0.22631',
          attestationArtifactId: 'device-b-attestation',
        },
      ],
      clients: [
        {
          id: CLIENT_CHROME,
          deviceId: DEVICE_A,
          browser: 'chrome',
          profileId: '6'.repeat(64),
          sessionIdDigest: SESSION_CHROME,
          evidenceArtifactId: 'client-chrome-evidence',
        },
        {
          id: CLIENT_EDGE,
          deviceId: DEVICE_B,
          browser: 'edge',
          profileId: '7'.repeat(64),
          sessionIdDigest: SESSION_EDGE,
          evidenceArtifactId: 'client-edge-evidence',
        },
        {
          id: CLIENT_ELECTRON,
          deviceId: DEVICE_A,
          browser: 'electron',
          profileId: '8'.repeat(64),
          sessionIdDigest: SESSION_ELECTRON,
          evidenceArtifactId: 'client-electron-evidence',
        },
      ],
      publicBaseUrl: 'https://canvas.example.com/collab',
      proxy: {
        kind: 'nginx',
        tlsVerified: true,
        sniVerified: true,
        webSocketUpgradeVerified: true,
        rangeVerified: true,
        certificateHostname: 'canvas.example.com',
      },
    },
    artifacts,
    checks,
  };
  const evidencePath = path.join(directory, 'manifest.json');
  const write = () => fs.writeFileSync(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  write();
  return { directory, evidencePath, manifest, write };
}

function validate(item) {
  return assertCollaborationReleaseEvidence({
    root: path.resolve(__dirname, '..'),
    evidencePath: item.evidencePath,
    version: VERSION,
    target: TARGET,
    now: NOW,
  });
}

test('current owner-approved deferral accepts only a missing manifest and never marks evidence passed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-collab-evidence-deferral-'));
  const evidencePath = path.join(directory, 'manifest.json');
  try {
    const result = assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: VERSION,
      target: TARGET,
      deferralApproval: COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
    });
    assert.equal(result.deferred, true);
    assert.equal(result.releaseVersion, VERSION);
    assert.equal(result.sourceCommit, TARGET);
    assert.equal(result.reason, 'owner-approved-post-release-evidence');
    assert.equal(Object.hasOwn(result, 'checkCount'), false);

    for (const version of ['3.1.9', '3.2.1']) {
      assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
        root: path.resolve(__dirname, '..'),
        evidencePath,
        version,
        target: TARGET,
        deferralApproval: COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
      }), /manifest is missing/);
    }
    assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: VERSION,
      target: TARGET,
      deferralApproval: 'owner-approved-post-release-v3.1.8',
    }), /manifest is missing/);

    assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: VERSION,
      target: TARGET,
      deferralApproval: 'wrong-approval',
    }), /manifest is missing/);
    assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: '2.6.0',
      target: TARGET,
      deferralApproval: COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
    }), /manifest is missing/);
    assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: '2.7.5',
      target: TARGET,
      deferralApproval: COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
    }), /manifest is missing/);

    fs.writeFileSync(evidencePath, '{}\n', 'utf8');
    assert.throws(() => assertCollaborationReleaseEvidenceForPublish({
      root: path.resolve(__dirname, '..'),
      evidencePath,
      version: VERSION,
      target: TARGET,
      deferralApproval: COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL,
    }), /contractVersion/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('F8-F10 release evidence v2 accepts source-bound device, client, public and load evidence', () => {
  const item = fixture();
  try {
    const result = validate(item);
    assert.equal(result.contractVersion, COLLABORATION_RELEASE_EVIDENCE_CONTRACT);
    assert.equal(result.sourceCommit, TARGET);
    assert.equal(result.publicBaseUrl, 'https://canvas.example.com/collab');
    assert.equal(result.deviceCount, 2);
    assert.equal(result.clientCount, 3);
    assert.equal(result.checkCount, COLLABORATION_RELEASE_REQUIRED_CHECKS.length);
    assert.equal(result.artifactCount, 6);
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test('F8-F10 release evidence v2 rejects weak identities, incomplete scenarios, and tampered evidence', () => {
  const mutations = [
    (item) => { item.manifest.contractVersion = 't8-collaboration-release-evidence-v1'; },
    (item) => { delete item.manifest.checks.rangePlayback; },
    (item) => { item.manifest.environment.publicBaseUrl = 'http://canvas.example.com'; },
    (item) => { item.manifest.environment.publicBaseUrl = 'https://canvas.example.com/not-collab'; },
    (item) => { item.manifest.environment.challengeDigest = '0'.repeat(64); },
    (item) => { item.manifest.environment.devices.pop(); },
    (item) => { item.manifest.environment.devices[0].physical = false; },
    (item) => { item.manifest.environment.devices[0].osBuild = '10.0.19045'; },
    (item) => { item.manifest.environment.clients[1].profileId = item.manifest.environment.clients[0].profileId; },
    (item) => { item.manifest.environment.clients[1].sessionIdDigest = SESSION_CHROME; },
    (item) => { item.manifest.environment.clients[1].deviceId = '9'.repeat(64); },
    (item) => {
      item.manifest.artifacts.find((artifact) => artifact.id === 'device-a-attestation').kind = 'report';
    },
    (item) => { item.manifest.checks.lanMultiClient.subjectClientIds.pop(); },
    (item) => { item.manifest.checks.lanMultiClient.metrics.silentDataLoss = 1; },
    (item) => { item.manifest.checks.offline60Seconds.metrics.offlineDurationMs = 59_999; },
    (item) => { item.manifest.checks.offline60Seconds.metrics.clientsRecovered = 1; },
    (item) => { item.manifest.checks.hostRestartRecovery.metrics.backupRestoreVerified = false; },
    (item) => { item.manifest.checks.chromeCompatibility.subjectClientIds = [CLIENT_EDGE]; },
    (item) => { item.manifest.checks.publicHealth.metrics.tlsAuthorized = false; },
    (item) => { item.manifest.checks.inviteRedeem.metrics.replayRejected = 0; },
    (item) => { item.manifest.checks.websocketUpgrade.metrics.joinedClients = 2; },
    (item) => { item.manifest.checks.upload100MiB.metrics.bytes -= 1; },
    (item) => { item.manifest.checks.upload100MiB.metrics.sha256Verified = false; },
    (item) => { item.manifest.checks.rangePlayback.metrics.seekVerified = false; },
    (item) => { item.manifest.checks.assetIndex100k.metrics.assets -= 1; },
    (item) => { item.manifest.checks.reviewerAuthorizationRedTeam.metrics.unexpectedBypasses = 1; },
    (item) => { item.manifest.checks.loginRateLimit.metrics.stableRetryAfter = false; },
    (item) => { item.manifest.checks.connectionLoad.metrics.peakConnections = 99; },
    (item) => { item.manifest.checks.operationThroughput.metrics.operations = 9_999; },
    (item) => { item.manifest.checks.electronInstallUpgrade.metrics.betterSqlite3Loaded = false; },
    (item) => { item.manifest.checks.lanMultiClient.artifactIds = ['combined-report']; },
    (item) => { item.manifest.sourceCommit = 'b'.repeat(40); },
    (item) => { item.manifest.artifacts[0].sha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const item = fixture();
    try {
      mutate(item);
      item.write();
      assert.throws(() => validate(item), (error) => (
        error?.code === 'collaboration_release_evidence_invalid'
        && !JSON.stringify(error).includes(item.directory)
      ));
    } finally {
      fs.rmSync(item.directory, { recursive: true, force: true });
    }
  }
});

test('formal Electron and GitHub release entry points invoke the F8-F10 gate but dry-run remains nonpublishing', () => {
  const dist = fs.readFileSync(path.resolve(__dirname, '../scripts/dist-release.cjs'), 'utf8');
  const github = fs.readFileSync(path.resolve(__dirname, '../scripts/release-github.cjs'), 'utf8');
  const guide = fs.readFileSync(path.resolve(__dirname, '../docs/collaboration-release-evidence.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.match(dist, /assertCollaborationReleaseEvidenceForPublish\(\{[\s\S]*target: releaseTarget/);
  assert.match(github, /if \(!dryRun\) \{[\s\S]*assertCollaborationReleaseEvidenceForPublish\(\{[\s\S]*target: releaseTarget/);
  assert.match(guide, /不得手工把未执行项目改写为 `passed`/);
  assert.match(guide, /owner-approved-post-release-v2\.6\.5/);
  assert.match(guide, /T8_COLLAB_RELEASE_EVIDENCE/);
  assert.match(guide, /至少 100 MiB 上传/);
  assert.match(guide, /独立设备和客户端/);
  assert.match(guide, /t8-collaboration-release-evidence-v2/);
  assert.match(guide, /只接受 64 位小写 session SHA-256/);
  assert.equal(
    pkg.scripts['collaboration:evidence:attest'],
    'node scripts/collaboration-evidence-attestation.cjs',
  );
});
