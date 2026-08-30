'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CREATOR_MODEL_DECISION_SCHEMA,
  assertCreatorModelDecisionReceipt,
  createCreatorModelDecision,
  modelPreferenceNeedsDynamicCatalog,
  modelPreferencesFromCreativeInput,
  runtimeDecisionModels,
} = require('../backend/src/services/creatorAgentModelDecision');

function model(overrides = {}) {
  return {
    id: 'image:zhenzhen:gpt-image-2',
    kind: 'image',
    provider: 'zhenzhen',
    platformLabel: '贞贞 AI 工坊',
    model: 'gpt-image-2',
    label: 'GPT Image 2',
    family: 'gpt-image',
    available: true,
    configured: true,
    parameters: { capabilities: ['t2i', 'i2i'], ratios: ['1:1', '16:9'] },
    readiness: {
      known: true,
      installed: true,
      credentialReady: true,
      regionReady: true,
      available: true,
      executable: true,
      blockers: [],
    },
    ...overrides,
  };
}

function llmModel(overrides = {}) {
  return model({
    id: 'llm:zhenzhen:gemini-3.5-flash',
    kind: 'llm',
    model: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    family: 'gemini',
    parameters: { vision: true },
    ...overrides,
  });
}

function decisionFor(result, kind) {
  return result.receipt.decisions.find((decision) => decision.kind === kind);
}

test('smart selection chooses a compatible executable model before a blocked default', () => {
  const result = createCreatorModelDecision({
    kind: 'image',
    ratio: '16:9',
    models: [
      llmModel(),
      model({
        readiness: {
          known: true,
          installed: true,
          credentialReady: false,
          regionReady: true,
          available: true,
          executable: false,
          blockers: [{ code: 'credential-missing', message: '还没有设置 API Key' }],
        },
      }),
      model({
        id: 'image:seedance-nz:zhenzhen-image-g2-t2i',
        provider: 'seedance-nz',
        platformLabel: '贞贞的平价 AI 小屋',
        model: 'zhenzhen-image-g2-t2i',
        label: 'Zhenzhen Image G2',
      }),
    ],
    now: 1_700_000_000_000,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.imageProvider, 'seedance-nz');
  assert.equal(result.modelFields.imageModel, 'zhenzhen-image-g2-t2i');
  assert.equal(result.receipt.schema, CREATOR_MODEL_DECISION_SCHEMA);
  assert.equal(result.receipt.mode, 'smart');
  assert.equal(result.receipt.ready, true);
  assert.equal(result.receipt.providerCalls, 0);
  assert.equal(result.receipt.canvasWrites, 0);
  const imageDecision = decisionFor(result, 'image');
  assert.equal(imageDecision.inputCompatibility.status, 'compatible');
  assert.match(imageDecision.inputCompatibility.reasons.join(' '), /16:9/);
  assert.equal(imageDecision.alternatives.length, 1);
  assert.equal(imageDecision.alternatives[0].model, 'gpt-image-2');
  assert.equal(imageDecision.alternatives[0].compatibility.status, 'compatible');
  assert.deepEqual(
    result.receipt.approvalBoundary.providerSelections.map((item) => item.provider),
    ['seedance-nz', 'zhenzhen'],
  );
});

test('fixed selection wins exactly and records that the creator chose it', () => {
  const result = createCreatorModelDecision({
    kind: 'image',
    preferences: {
      image: { provider: 'seedance-nz', model: 'zhenzhen-image-g2-t2i' },
    },
    models: [
      llmModel(),
      model(),
      model({
        id: 'image:seedance-nz:zhenzhen-image-g2-t2i',
        provider: 'seedance-nz',
        platformLabel: '贞贞的平价 AI 小屋',
        model: 'zhenzhen-image-g2-t2i',
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.imageProvider, 'seedance-nz');
  assert.equal(result.receipt.mode, 'mixed');
  assert.equal(decisionFor(result, 'llm').mode, 'smart');
  assert.equal(decisionFor(result, 'image').mode, 'fixed');
  assert.match(decisionFor(result, 'image').reasons.join(' '), /明确固定/);
});

test('fixed but blocked selection never silently falls back', () => {
  const result = createCreatorModelDecision({
    kind: 'image',
    preferences: {
      image: { provider: 'zhenzhen', model: 'gpt-image-2' },
    },
    models: [
      llmModel(),
      model({
        readiness: {
          known: true,
          installed: true,
          credentialReady: false,
          regionReady: true,
          available: true,
          executable: false,
          blockers: [{ code: 'credential-missing', message: '还没有设置 API Key' }],
        },
      }),
      model({
        id: 'image:seedance-nz:zhenzhen-image-g2-t2i',
        provider: 'seedance-nz',
        model: 'zhenzhen-image-g2-t2i',
      }),
    ],
  });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'CREATOR_MODEL_RUNTIME_NOT_READY');
  assert.match(result.errors[0].message, /没有自动切换平台或模型/);
  assert.deepEqual(result.modelFields, {
    llmProvider: 'zhenzhen',
    llmModel: 'gemini-3.5-flash',
  });
  assert.equal(result.modelFields.imageModel, undefined);
});

test('a version-bound audio transcript lets a normal LLM read evidence without native audio input', () => {
  const result = createCreatorModelDecision({
    kind: 'script',
    attachments: [{
      assetId: 'asset-audio-1',
      kind: 'audio',
      mimeType: 'audio/wav',
      contentRevision: 2,
      contentHash: 'a'.repeat(64),
      observationDigest: 'b'.repeat(64),
    }],
    models: [llmModel({ parameters: { vision: false, audioInput: false } })],
  });
  assert.deepEqual(result.errors, []);
  const llm = decisionFor(result, 'llm');
  assert.equal(llm.inputCompatibility.status, 'compatible');
  assert.match(llm.inputCompatibility.reasons.join(' '), /可核验转写/);
  assert.match(result.receipt.attachmentEvidenceDigest, /^[a-f0-9]{64}$/);
});

test('receipt keeps unknown estimates honest, excludes secrets and has a stable evidence digest', () => {
  const input = {
    kind: 'image',
    models: [llmModel(), model()],
    catalogDigest: 'a'.repeat(64),
  };
  const first = createCreatorModelDecision({ ...input, now: 1_700_000_000_000 });
  const second = createCreatorModelDecision({ ...input, now: 1_800_000_000_000 });
  const serialized = JSON.stringify(first.receipt);

  assert.equal(first.receipt.receiptDigest, second.receipt.receiptDigest);
  const imageDecision = decisionFor(first, 'image');
  assert.equal(imageDecision.estimates.cost.status, 'unknown');
  assert.equal(imageDecision.estimates.latency.status, 'unknown');
  assert.match(imageDecision.estimates.cost.message, /不得猜测费用/);
  assert.match(imageDecision.estimates.latency.message, /不得猜测耗时/);
  assert.equal(first.receipt.approvalBoundary.costTier.status, 'unknown');
  assert.equal(first.receipt.approvalBoundary.privacyBoundary.status, 'unknown');
  assert.equal(first.receipt.fallbackPolicy.silentProviderFallback, false);
  assert.equal(first.receipt.fallbackPolicy.providerChangeRequiresApproval, true);
  assert.doesNotMatch(serialized, /api[_-]?key|bearer|sk-[A-Za-z0-9_-]{8,}/i);
  assert.equal(assertCreatorModelDecisionReceipt(first.receipt), first.receipt);
});

test('receipt validation fails closed when provider, cost or privacy evidence drifts', () => {
  const original = createCreatorModelDecision({ kind: 'image', models: [llmModel(), model()] }).receipt;
  for (const mutate of [
    (receipt) => { receipt.approvalBoundary.providerSelections[0].provider = 'other'; },
    (receipt) => { receipt.approvalBoundary.costTier.status = 'known'; },
    (receipt) => { receipt.approvalBoundary.privacyBoundary.message = 'changed'; },
    (receipt) => { receipt.decisions[0].inputCompatibility.status = 'unverified'; },
  ]) {
    const tampered = JSON.parse(JSON.stringify(original));
    mutate(tampered);
    assert.throws(() => assertCreatorModelDecisionReceipt(tampered), /模型选择回执|模型选择决策/);
  }
});

test('creative input maps generic provider only to its current media kind and keeps explicit fields authoritative', () => {
  assert.deepEqual(modelPreferencesFromCreativeInput({
    kind: 'video',
    provider: 'seedance-nz',
    model: 'zhenzhen-video-v31-fast',
  }), {
    video: { provider: 'seedance-nz', model: 'zhenzhen-video-v31-fast' },
  });
  assert.deepEqual(modelPreferencesFromCreativeInput({
    kind: 'video',
    provider: 'seedance-nz',
    model: 'generic-video',
    videoProvider: 'fal',
    videoModel: 'fixed-video',
  }), {
    video: { provider: 'fal', model: 'fixed-video' },
  });
  assert.deepEqual(modelPreferencesFromCreativeInput({
    kind: 'story',
    provider: 'seedance-nz',
    model: 'ambiguous-model',
  }), {});
});

test('runtime catalog decoration is shared by Canvas Agent and zcanvas without duplicating known models', () => {
  const known = model();
  const readiness = {
    known: true,
    installed: true,
    credentialReady: false,
    regionReady: true,
    available: true,
    executable: false,
    blockers: [{ code: 'credential-missing', message: '还没有设置 API Key' }],
  };
  const catalog = { image: [known] };
  const preferences = { image: { provider: known.provider, model: known.model } };
  assert.equal(modelPreferenceNeedsDynamicCatalog(catalog, preferences), false);
  assert.equal(modelPreferenceNeedsDynamicCatalog(catalog, {
    image: { provider: 'custom', model: 'private-image-model' },
  }), true);

  const result = runtimeDecisionModels({
    catalog,
    capabilityGraph: {
      runtime: { entries: [{ id: known.id, readiness }] },
    },
    dynamicItems: [
      { ...known, configured: true },
      {
        id: 'image:custom:private-image-model',
        kind: 'image',
        provider: 'custom',
        model: 'private-image-model',
        configured: true,
      },
    ],
  });
  assert.equal(result.filter((item) => item.id === known.id).length, 1);
  assert.equal(result.find((item) => item.id === known.id).configured, false);
  assert.equal(result.find((item) => item.id === known.id).readiness.executable, false);
  assert.ok(result.some((item) => item.provider === 'custom' && item.model === 'private-image-model'));
});
test('direct video selection respects declared duration and ratio compatibility', () => {
  const result = createCreatorModelDecision({
    kind: 'video',
    ratio: '16:9',
    duration: 10,
    models: [
      llmModel(),
      model({
        id: 'video:zhenzhen:short-only',
        kind: 'video',
        model: 'short-only',
        parameters: { ratios: ['16:9'], durations: [5], supportsImages: true },
      }),
      model({
        id: 'video:seedance-nz:ten-second',
        kind: 'video',
        provider: 'seedance-nz',
        model: 'ten-second',
        parameters: { ratios: ['16:9'], durations: [10], supportsImages: true },
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.videoModel, 'ten-second');
  assert.match(decisionFor(result, 'video').reasons.join(' '), /10 秒/);
});

test('reference video breakdown requires a vision LLM and may add ready MP4 transcription evidence', () => {
  const result = createCreatorModelDecision({
    kind: 'story',
    recipe: 'shot-breakdown',
    attachments: [{ kind: 'video', assetId: 'asset-reference-video' }],
    models: [
      model({
        id: 'llm:zhenzhen:text-only',
        kind: 'llm',
        model: 'text-only',
        parameters: { vision: false },
      }),
      model({
        id: 'llm:zhenzhen:gemini-3.5-flash',
        kind: 'llm',
        model: 'gemini-3.5-flash',
        parameters: { vision: true },
      }),
      model({
        id: 'image:zhenzhen:gpt-image-2',
        kind: 'image',
        model: 'gpt-image-2',
      }),
      model({
        id: 'audio:seedance-nz:whisper-1',
        kind: 'audio',
        provider: 'seedance-nz',
        model: 'whisper-1',
        family: 'whisper',
        parameters: { family: 'whisper' },
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.modelFields), ['llmProvider', 'llmModel', 'audioProvider', 'audioModel']);
  assert.equal(result.modelFields.llmModel, 'gemini-3.5-flash');
  assert.equal(result.modelFields.audioModel, 'whisper-1');
  assert.deepEqual(result.receipt.decisions.map((decision) => decision.kind), ['llm', 'audio']);
  assert.match(result.receipt.decisions[0].reasons.join(' '), /视觉输入/);
  assert.match(result.receipt.decisions[1].reasons.join(' '), /MP4/);
  assert.match(result.receipt.decisions[1].selected.limitations.join(' '), /实际返回有效分段.*untimed/);
  assert.equal(result.receipt.decisions[1].required, false);
  assert.equal(result.receipt.ready, true);
  assert.equal(result.receipt.providerCalls, 0);
  assert.equal(result.receipt.canvasWrites, 0);
});

test('reference video breakdown ignores stored music preferences and honestly degrades when transcription is unavailable', () => {
  const result = createCreatorModelDecision({
    kind: 'story',
    recipe: 'shot-breakdown',
    attachments: [{ kind: 'video', assetId: 'asset-reference-video' }],
    preferences: {
      audio: { provider: 'zhenzhen', model: 'suno-v5.5-generate' },
    },
    models: [
      model({
        id: 'llm:zhenzhen:gemini-3.5-flash',
        kind: 'llm',
        model: 'gemini-3.5-flash',
        parameters: { vision: true },
      }),
      model({
        id: 'audio:zhenzhen:suno-v5.5-generate',
        kind: 'audio',
        model: 'suno-v5.5-generate',
        family: 'suno',
      }),
      model({
        id: 'audio:seedance-nz:whisper-1',
        kind: 'audio',
        provider: 'seedance-nz',
        model: 'whisper-1',
        family: 'whisper',
        parameters: { family: 'whisper' },
        readiness: {
          known: true,
          installed: true,
          credentialReady: false,
          regionReady: true,
          available: true,
          executable: false,
          blockers: [{ code: 'credential-missing', message: '还没有设置平价AI小屋 API Key' }],
        },
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.modelFields, {
    llmProvider: 'zhenzhen',
    llmModel: 'gemini-3.5-flash',
  });
  assert.deepEqual(result.receipt.decisions.map((decision) => decision.kind), ['llm', 'audio']);
  assert.equal(result.receipt.decisions[1].status, 'blocked');
  assert.equal(result.receipt.decisions[1].required, false);
  assert.equal(result.receipt.ready, true);
});

test('fixed text-only LLM for reference video breakdown fails closed without fallback', () => {
  const result = createCreatorModelDecision({
    kind: 'story',
    recipe: 'shot-breakdown',
    attachments: [{ kind: 'video', assetId: 'asset-reference-video' }],
    preferences: {
      llm: { provider: 'zhenzhen', model: 'text-only' },
    },
    models: [
      model({
        id: 'llm:zhenzhen:text-only',
        kind: 'llm',
        model: 'text-only',
        parameters: { vision: false },
      }),
      model({
        id: 'llm:zhenzhen:gemini-3.5-flash',
        kind: 'llm',
        model: 'gemini-3.5-flash',
        parameters: { vision: true },
      }),
    ],
  });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'CREATOR_MODEL_PREFERENCE_UNAVAILABLE');
  assert.match(result.errors[0].message, /明确不支持视觉输入/);
  assert.match(result.errors[0].message, /没有自动改用其他模型/);
  assert.deepEqual(result.modelFields, {});
});

test('attachment content evidence changes both request and receipt digests without changing its media kind', () => {
  const input = {
    kind: 'image',
    attachments: [{
      assetId: 'asset-reference-image',
      kind: 'image',
      mimeType: 'image/png',
      size: 8192,
      contentHash: 'a'.repeat(64),
      contentRevision: 1,
      width: 1024,
      height: 1024,
    }],
    models: [llmModel(), model()],
  };
  const first = createCreatorModelDecision(input).receipt;
  const second = createCreatorModelDecision({
    ...input,
    attachments: [{
      ...input.attachments[0],
      mimeType: 'image/webp',
      size: 16384,
      contentHash: 'b'.repeat(64),
      contentRevision: 2,
      width: 2048,
      height: 1152,
    }],
  }).receipt;

  assert.notEqual(first.attachmentEvidenceDigest, second.attachmentEvidenceDigest);
  assert.notEqual(first.requestDigest, second.requestDigest);
  assert.notEqual(first.receiptDigest, second.receiptDigest);
  assert.equal(first.decisions[0].inputCompatibility.request.attachmentKinds[0], 'image');
  assert.equal(second.decisions[0].inputCompatibility.request.attachmentKinds[0], 'image');
});

test('smart selection excludes a model whose reference-image capability is not declared', () => {
  const result = createCreatorModelDecision({
    kind: 'image',
    attachments: [{ kind: 'image', assetId: 'asset-reference-image' }],
    models: [
      llmModel(),
      model({
        id: 'image:zhenzhen:unknown-reference',
        model: 'unknown-reference',
        parameters: {},
      }),
      model({
        id: 'image:seedance-nz:verified-reference',
        provider: 'seedance-nz',
        model: 'verified-reference',
        parameters: { capabilities: ['i2i'], supportsReference: true },
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.imageModel, 'verified-reference');
  assert.equal(decisionFor(result, 'image').inputCompatibility.status, 'compatible');
  assert.equal(
    decisionFor(result, 'image').alternatives.some((item) => item.model === 'unknown-reference'),
    false,
  );
});

test('smart video selection excludes models with unknown ratio or duration evidence', () => {
  const result = createCreatorModelDecision({
    kind: 'video',
    ratio: '16:9',
    duration: 10,
    models: [
      llmModel(),
      model({
        id: 'video:zhenzhen:unknown-constraints',
        kind: 'video',
        model: 'unknown-constraints',
        parameters: {},
      }),
      model({
        id: 'video:seedance-nz:verified-constraints',
        kind: 'video',
        provider: 'seedance-nz',
        model: 'verified-constraints',
        parameters: { ratios: ['16:9'], durations: [10] },
      }),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.videoModel, 'verified-constraints');
  assert.equal(decisionFor(result, 'video').inputCompatibility.status, 'compatible');
  assert.match(decisionFor(result, 'video').reasons.join(' '), /16:9.*10 秒/);
});

test('general creative requests with image attachments only select a verified vision LLM', () => {
  const result = createCreatorModelDecision({
    kind: 'story',
    recipe: 'general',
    attachments: [{ kind: 'image', assetId: 'asset-duck-reference' }],
    models: [
      llmModel({
        id: 'llm:zhenzhen:text-only',
        model: 'text-only',
        parameters: { vision: false },
      }),
      llmModel({
        id: 'llm:zhenzhen:vision-ready',
        model: 'vision-ready',
        parameters: { vision: true },
      }),
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.llmModel, 'vision-ready');
  const llmDecision = decisionFor(result, 'llm');
  assert.equal(llmDecision.inputCompatibility.status, 'compatible');
  assert.match(llmDecision.inputCompatibility.reasons.join(' '), /视觉输入/);
  assert.equal(
    llmDecision.alternatives.some((item) => item.model === 'text-only'),
    false,
  );
});

test('fixed LLM without declared vision support fails closed for an ordinary image reference', () => {
  const result = createCreatorModelDecision({
    kind: 'story',
    recipe: 'general',
    attachments: [{ kind: 'image', assetId: 'asset-duck-reference' }],
    preferences: {
      llm: { provider: 'zhenzhen', model: 'catalog-unknown' },
    },
    models: [
      llmModel({
        id: 'llm:zhenzhen:catalog-unknown',
        model: 'catalog-unknown',
        parameters: {},
      }),
      llmModel({
        id: 'llm:zhenzhen:vision-ready',
        model: 'vision-ready',
        parameters: { vision: true },
      }),
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.modelFields.llmModel, 'catalog-unknown');
  const llmDecision = decisionFor(result, 'llm');
  assert.equal(llmDecision.mode, 'fixed');
  assert.equal(llmDecision.inputCompatibility.status, 'unverified');
  assert.match(llmDecision.inputCompatibility.limitations.join(' '), /视觉输入/);
});

test('audio attachment cannot be routed to an LLM without verified audio input support', () => {
  const result = createCreatorModelDecision({
    kind: 'audio',
    recipe: 'general',
    attachments: [{ kind: 'audio', assetId: 'asset-voice-reference' }],
    models: [
      llmModel({
        id: 'llm:zhenzhen:vision-only',
        model: 'vision-only',
        parameters: { vision: true },
      }),
      model({
        id: 'audio:seedance-nz:whisper-1',
        kind: 'audio',
        provider: 'seedance-nz',
        model: 'whisper-1',
        label: 'Whisper 1',
        parameters: { capabilities: ['stt'] },
      }),
    ],
  });
  const llmDecision = decisionFor(result, 'llm');
  assert.equal(llmDecision.status, 'blocked');
  assert.equal(llmDecision.inputCompatibility.status, 'unverified');
  assert.match(JSON.stringify(llmDecision.blockers), /兼容|音频/);
});
