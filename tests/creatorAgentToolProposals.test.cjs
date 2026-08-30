'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const surfaces = require('../backend/src/shared/creativeCapabilitySurfaces.json');
const {
  VERSIONED_TOOL_REQUEST_SCHEMA,
} = require('../backend/src/services/agentControlCapabilityTools.js');
const {
  CreatorAgentToolProposalError,
  assertCreatorToolProposalCurrent,
  compileCreatorToolProposal,
} = require('../backend/src/services/creatorAgentToolProposals.js');
const {
  CreatorAgentSessionError,
  createCreatorAgentSessionStore,
} = require('../backend/src/services/creatorAgentSessions.js');
const {
  createCreatorWorkProposal,
} = require('../backend/src/services/creatorAgentWorkArtifacts.js');

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

function responseEvidence(overrides = {}) {
  const value = {
    schema: 't8-creator-agent-response-evidence-v1',
    mode: 'online-model',
    status: 'completed',
    providerCalls: 1,
    provider: 'seedance-nz',
    model: 'glm-5',
    finishReason: 'stop',
    requestId: 'request-tool-proposals',
    errorCode: null,
    qualityCode: 'response-usable',
    modelDecisionDigest: 'b'.repeat(64),
    ...overrides,
  };
  value.evidenceDigest = crypto.createHash('sha256')
    .update(stableString(value))
    .digest('hex');
  return value;
}

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-tool-proposal-'));
  const store = createCreatorAgentSessionStore({ rootDir });
  const session = store.create({
    projectId: 'project-local',
    canvasId: 'canvas-tool-proposals',
    context: { canvasRevision: 12 },
  });
  const plan = {
    ready: true,
    kind: 'image',
    planId: 'plan-tool-proposals-1',
    planDigest: 'a'.repeat(64),
    impact: { patchOperationCount: 0 },
  };
  const workProposal = createCreatorWorkProposal({
    logicalRequestId: 'request-tool-proposals',
    taskFamily: 'mixed',
    qualityMode: 'standard',
    modelValue: {
      schema: 't8-creator-work-model-response-v1',
      displayMarkdown: '## 角色主视觉\n\n建立可编辑的角色主视觉任务画像与创作简报，保留版本、来源和后续操作边界。',
      taskProfile: {
        family: 'mixed',
        intent: '创作一张电影感角色主视觉',
        deliveryKind: 'editable-work',
        modalities: ['text', 'image'],
        targetPlatform: 'canvas',
        qualityMode: 'standard',
      },
      artifacts: [
        {
          kind: 'TaskProfile',
          title: '任务画像',
          fields: {
            family: 'mixed',
            intent: '创作一张电影感角色主视觉',
            deliveryKind: 'editable-work',
            modalities: ['text', 'image'],
            targetPlatform: 'canvas',
            qualityMode: 'standard',
          },
        },
        {
          kind: 'ProductionBrief',
          title: '创作简报',
          fields: {
            title: '角色主视觉',
            outcome: '一张可继续修改的电影感角色主视觉',
            audience: '当前项目创作者',
            format: '16:9',
            style: '电影感',
          },
        },
      ],
      toolProposals: [],
    },
  });
  assert.ok(workProposal);
  const turn = store.appendTurn(session.id, {
    text: '先做一版电影感角色主视觉',
    assistantText: '这是已经完成并可编辑的角色主视觉 V0，包含主体、构图、光线和下一步。',
    responseEvidence: responseEvidence(),
    clientRequestId: 'request-tool-proposals',
    qualityMode: 'standard',
    workProposal,
    plan,
  });
  return {
    rootDir,
    store,
    sessionId: session.id,
    assistantEvent: turn.assistantEvent,
    session: turn.session,
    plan,
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

function request(operation = 'plan', input = {}) {
  return {
    schema: VERSIONED_TOOL_REQUEST_SCHEMA,
    tool: 'zcanvas_create_image',
    version: surfaces.capabilityManifestVersion,
    operation,
    projectId: 'project-local',
    canvasId: 'canvas-tool-proposals',
    clientRequestId: 'creator-tool-proposal-request-1',
    input: {
      prompt: '电影感角色主视觉',
      ratio: '16:9',
      ...input,
    },
  };
}

function rawProposal(overrides = {}) {
  return {
    schema: 't8-creator-model-tool-proposal-v1',
    request: request(),
    ...overrides,
  };
}

test('model tool proposal compiles against exact response/plan/canvas bindings and never executes', () => {
  const fx = fixture();
  try {
    const proposal = compileCreatorToolProposal({
      proposal: rawProposal(),
      session: fx.session,
      assistantEvent: fx.assistantEvent,
      createdAt: '2026-07-29T00:00:00.000Z',
    });
    assert.equal(proposal.binding.sessionId, fx.sessionId);
    assert.equal(proposal.binding.responseId, fx.assistantEvent.payload.responseId);
    assert.equal(proposal.binding.responseDigest, fx.assistantEvent.payload.responseDigest);
    assert.equal(proposal.binding.planId, 'plan-tool-proposals-1');
    assert.equal(proposal.binding.planDigest, 'a'.repeat(64));
    assert.equal(proposal.binding.canvasRevision, 12);
    assert.equal(proposal.binding.workId, fx.session.creatorWork.workId);
    assert.equal(proposal.binding.workRevision, fx.session.creatorWork.revision);
    assert.equal(proposal.binding.workDigest, fx.session.creatorWork.workDigest);
    assert.equal(proposal.tool.version, surfaces.capabilityManifestVersion);
    assert.equal(proposal.tool.creatorLabel, '生成图片');
    assert.equal(proposal.gate.riskLevel, 'L0');
    assert.equal(proposal.gate.dispatchAllowed, false);
    assert.deepEqual(proposal.execution, {
      status: 'not-started',
      canvasWrites: 0,
      providerCalls: 0,
      fileWrites: 0,
    });

    const stored = fx.store.recordToolProposal(fx.sessionId, { proposal });
    assert.equal(stored.duplicate, false);
    assert.equal(stored.session.toolProposals.length, 1);
    assert.equal(stored.event.type, 'assistant.tool-proposal.validated');
    assert.equal(stored.event.payload.execution.providerCalls, 0);
    assert.equal(stored.event.payload.workId, fx.session.creatorWork.workId);
    assert.equal(stored.event.payload.workRevision, fx.session.creatorWork.revision);
    assert.equal(stored.event.payload.workDigest, fx.session.creatorWork.workDigest);
    const repeated = fx.store.recordToolProposal(fx.sessionId, { proposal });
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.session.toolProposals.length, 1);
  } finally {
    fx.cleanup();
  }
});

test('prepared proposal has zero side effects and writes authoritative lifecycle stages back to the same session', () => {
  const fx = fixture();
  try {
    const proposal = compileCreatorToolProposal({
      proposal: rawProposal({ request: request('apply') }),
      session: fx.session,
      assistantEvent: fx.assistantEvent,
    });
    fx.store.recordToolProposal(fx.sessionId, { proposal });
    const prepared = fx.store.prepareToolProposal(fx.sessionId, {
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      plan: fx.plan,
    });
    assert.equal(prepared.duplicate, false);
    assert.equal(prepared.event.type, 'assistant.tool-proposal.prepared');
    assert.deepEqual(prepared.event.payload.sideEffects, {
      canvasWrites: 0,
      providerCalls: 0,
      fileWrites: 0,
    });
    const repeated = fx.store.prepareToolProposal(fx.sessionId, {
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      plan: fx.plan,
    });
    assert.equal(repeated.duplicate, true);

    const applied = fx.store.appendLifecycle(fx.sessionId, 'plan.applied', {
      planId: fx.plan.planId,
      planDigest: fx.plan.planDigest,
      patchId: 'patch-tool-proposal-1',
      previewDigest: '9'.repeat(64),
      appliedRevision: 13,
      duplicate: false,
      canvasEvidence: {
        source: 'canvas-patch-ledger',
        status: 'applied',
        actorId: 'creator-agent-test',
        operationCount: 1,
      },
    });
    const writeback = applied.events.find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.proposalId === proposal.proposalId
    ));
    assert.ok(writeback);
    assert.equal(writeback.payload.stage, 'applied');
    assert.equal(writeback.payload.evidence.canvasWriteRecorded, true);
    assert.equal(writeback.payload.evidence.providerRunLinked, false);
    assert.equal(writeback.payload.evidence.physicalArtifactsVerified, false);

    const linked = fx.store.appendLifecycle(fx.sessionId, 'run.linked', {
      planId: fx.plan.planId,
      planDigest: fx.plan.planDigest,
      patchId: 'patch-tool-proposal-1',
      runId: 'run-tool-proposal-1',
      matchedNodeIds: ['node-tool-proposal-1'],
    });
    const runningWriteback = [...linked.events].reverse().find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.proposalId === proposal.proposalId
    ));
    assert.equal(runningWriteback.payload.stage, 'running');
    assert.equal(runningWriteback.payload.evidence.canvasWriteRecorded, true);
    assert.equal(runningWriteback.payload.evidence.providerRunLinked, true);
    assert.equal(runningWriteback.payload.evidence.physicalArtifactsVerified, false);

    const verified = fx.store.appendLifecycle(fx.sessionId, 'run.artifacts-verified', {
      runId: 'run-tool-proposal-1',
      verification: {
        verified: true,
        reasons: [],
        run: {
          runId: 'run-tool-proposal-1',
          status: 'succeeded',
          canvasRevision: 13,
          createdAt: 1,
          finishedAt: 2,
        },
        nodeRuns: [{
          nodeRunId: 'node-run-tool-proposal-1',
          nodeId: 'node-tool-proposal-1',
          status: 'succeeded',
          latestAttemptId: 'attempt-tool-proposal-1',
          latestAttemptStatus: 'succeeded',
          outputAssetIds: ['asset-tool-proposal-1'],
        }],
        assets: [{
          assetId: 'asset-tool-proposal-1',
          nodeRunId: 'node-run-tool-proposal-1',
          kind: 'image',
          mimeType: 'image/png',
          contentHash: 'a'.repeat(64),
          availability: 'available',
          stored: true,
          blobPresent: true,
          hashVerified: true,
          magicVerified: true,
          detectedKind: 'image',
          detectedMimeType: 'image/png',
          observedContentHash: 'a'.repeat(64),
          byteSize: 68,
          decodeEvidence: 'indexed-parser-verified',
          associationVerified: true,
          expectedNodeId: 'node-tool-proposal-1',
          expectedShotIds: [],
          observedShotIds: [],
          expectedCanvasRevision: 13,
        }],
      },
    });
    const verifiedWriteback = [...verified.events].reverse().find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.proposalId === proposal.proposalId
    ));
    assert.equal(verifiedWriteback.payload.stage, 'verified');
    assert.equal(verifiedWriteback.payload.evidence.canvasWriteRecorded, true);
    assert.equal(verifiedWriteback.payload.evidence.providerRunLinked, true);
    assert.equal(verifiedWriteback.payload.evidence.physicalArtifactsVerified, true);

    const snapshotPath = path.join(fx.rootDir, 'sessions', `${fx.sessionId}.json`);
    const legacySnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const legacyWriteback = [...legacySnapshot.events].reverse().find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.proposalId === proposal.proposalId
      && event.payload?.stage === 'verified'
    ));
    legacyWriteback.payload.evidence.canvasWriteRecorded = false;
    legacyWriteback.payload.evidence.providerRunLinked = false;
    fs.writeFileSync(snapshotPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`, 'utf8');

    const repaired = fx.store.reconcileToolProposalWritebacks(fx.sessionId);
    assert.equal(repaired.repaired, 1);
    const repairedWriteback = [...repaired.session.events].reverse().find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.proposalId === proposal.proposalId
    ));
    assert.equal(repairedWriteback.payload.stage, 'verified');
    assert.equal(repairedWriteback.payload.evidenceEventType, 'execution.reconciled');
    assert.equal(repairedWriteback.payload.evidence.canvasWriteRecorded, true);
    assert.equal(repairedWriteback.payload.evidence.providerRunLinked, true);
    assert.equal(repairedWriteback.payload.evidence.physicalArtifactsVerified, true);
    const repeatedRepair = fx.store.reconcileToolProposalWritebacks(fx.sessionId);
    assert.equal(repeatedRepair.repaired, 0);
    assert.equal(repeatedRepair.session.lastSequence, repaired.session.lastSequence);
  } finally {
    fx.cleanup();
  }
});

test('proposal becomes stale when the exact structured work version changes', () => {
  const fx = fixture();
  try {
    const proposal = compileCreatorToolProposal({
      proposal: rawProposal(),
      session: fx.session,
      assistantEvent: fx.assistantEvent,
    });
    fx.store.recordToolProposal(fx.sessionId, { proposal });
    const brief = fx.session.workArtifactVersions.find((version) => (
      version.kind === 'ProductionBrief'
    ));
    assert.ok(brief);
    const revised = fx.store.reviseWorkArtifactVersion(fx.sessionId, {
      artifactId: brief.artifactId,
      baseVersionId: brief.versionId,
      action: 'edit',
      field: 'outcome',
      value: '两张可比较、可继续修改的电影感角色主视觉',
      actor: 'creator',
    });
    assert.equal(revised.duplicate, false);
    assert.notEqual(revised.session.creatorWork.workDigest, proposal.binding.workDigest);
    assert.throws(
      () => assertCreatorToolProposalCurrent(proposal, revised.session),
      (error) => error instanceof CreatorAgentToolProposalError
        && error.code === 'CREATOR_TOOL_PROPOSAL_STALE'
        && ['workRevision', 'workDigest'].includes(error.details?.binding),
    );
  } finally {
    fx.cleanup();
  }
});

test('apply and run proposals remain approval-gated with zero side effects', () => {
  const fx = fixture();
  try {
    for (const [operation, riskLevel] of [['apply', 'L1'], ['run', 'L2']]) {
      const proposal = compileCreatorToolProposal({
        proposal: rawProposal({ request: request(operation) }),
        session: fx.session,
        assistantEvent: fx.assistantEvent,
      });
      assert.equal(proposal.gate.riskLevel, riskLevel);
      assert.equal(proposal.gate.approvalRequired, true);
      assert.equal(proposal.gate.previewRequired, true);
      assert.equal(proposal.gate.dispatchAllowed, false);
      assert.equal(proposal.execution.status, 'not-started');
      assert.equal(proposal.execution.canvasWrites, 0);
      assert.equal(proposal.execution.providerCalls, 0);
      assert.ok(proposal.gate.requiredScopes.length > 0);
      assert.throws(
        () => assertCreatorToolProposalCurrent(proposal, fx.session, { grantedScopes: [] }),
        (error) => error instanceof CreatorAgentToolProposalError
          && error.code === 'CREATOR_TOOL_PROPOSAL_SCOPE_REQUIRED',
      );
      assert.doesNotThrow(() => assertCreatorToolProposalCurrent(
        proposal,
        fx.session,
        { grantedScopes: proposal.gate.requiredScopes },
      ));
    }
  } finally {
    fx.cleanup();
  }
});

test('proposal compiler rejects low-level internals, credentials, URLs and canvas patches', () => {
  const fx = fixture();
  try {
    const forbidden = [
      ['url', 'https://example.invalid/private'],
      ['headers', { Authorization: 'Bearer secret' }],
      ['apiKey', 'sk-secret'],
      ['canvasPatch', { operations: [] }],
      ['nodes', []],
      ['edges', []],
      ['providerPayload', { raw: true }],
    ];
    for (const [key, value] of forbidden) {
      assert.throws(
        () => compileCreatorToolProposal({
          proposal: rawProposal({ request: request('plan', { nested: { [key]: value } }) }),
          session: fx.session,
          assistantEvent: fx.assistantEvent,
        }),
        (error) => error instanceof CreatorAgentToolProposalError
          && error.code === 'CAPABILITY_TOOL_LOW_LEVEL_FIELD_FORBIDDEN',
        key,
      );
    }
  } finally {
    fx.cleanup();
  }
});

test('proposal compiler fails closed on scope and stale response/plan/artifact/canvas bindings', () => {
  const fx = fixture();
  try {
    assert.throws(
      () => compileCreatorToolProposal({
        proposal: rawProposal({
          request: { ...request(), projectId: 'other-project' },
        }),
        session: fx.session,
        assistantEvent: fx.assistantEvent,
      }),
      (error) => error.code === 'CREATOR_TOOL_PROPOSAL_SCOPE_MISMATCH',
    );
    const staleCases = [
      { responseId: 'response-old' },
      { responseDigest: 'c'.repeat(64) },
      { planId: 'plan-old' },
      { planDigest: 'd'.repeat(64) },
      { artifactVersionId: 'cav_old' },
      { artifactDigest: 'e'.repeat(64) },
      { canvasRevision: 11 },
    ];
    for (const expected of staleCases) {
      assert.throws(
        () => compileCreatorToolProposal({
          proposal: rawProposal({ expected }),
          session: fx.session,
          assistantEvent: fx.assistantEvent,
        }),
        (error) => error instanceof CreatorAgentToolProposalError
          && error.code === 'CREATOR_TOOL_PROPOSAL_STALE',
        JSON.stringify(expected),
      );
    }
  } finally {
    fx.cleanup();
  }
});

test('same proposal id with changed content conflicts and old proposals become stale after a new response', () => {
  const fx = fixture();
  try {
    const proposalId = 'ctp_model_proposal_123456';
    const first = compileCreatorToolProposal({
      proposal: rawProposal({ proposalId }),
      session: fx.session,
      assistantEvent: fx.assistantEvent,
    });
    fx.store.recordToolProposal(fx.sessionId, { proposal: first });
    const changed = compileCreatorToolProposal({
      proposal: rawProposal({
        proposalId,
        request: request('plan', { prompt: '另一个完全不同的主视觉' }),
      }),
      session: fx.store.read(fx.sessionId),
      assistantEvent: fx.assistantEvent,
    });
    assert.throws(
      () => fx.store.recordToolProposal(fx.sessionId, { proposal: changed }),
      (error) => error instanceof CreatorAgentSessionError
        && error.code === 'CREATOR_TOOL_PROPOSAL_CONFLICT',
    );

    fx.store.appendTurn(fx.sessionId, {
      text: '把主视觉改成雨夜版本',
      assistantText: '雨夜版本 V1 已整理：保留角色身份，重做湿地反光、冷暖霓虹与镜头层次。',
      responseEvidence: responseEvidence({
        mode: 'offline-structure',
        status: 'completed',
        providerCalls: 0,
        provider: null,
        model: null,
        finishReason: null,
        requestId: null,
        errorCode: 'model-not-ready',
        qualityCode: 'response-usable',
        modelDecisionDigest: 'b'.repeat(64),
      }),
      plan: {
        ready: true,
        kind: 'image',
        planId: 'plan-tool-proposals-2',
        planDigest: 'f'.repeat(64),
        impact: { patchOperationCount: 0 },
      },
    });
    assert.throws(
      () => assertCreatorToolProposalCurrent(first, fx.store.read(fx.sessionId)),
      (error) => error instanceof CreatorAgentToolProposalError
        && error.code === 'CREATOR_TOOL_PROPOSAL_STALE',
    );
  } finally {
    fx.cleanup();
  }
});
