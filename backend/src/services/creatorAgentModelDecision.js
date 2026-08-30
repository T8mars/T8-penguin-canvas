'use strict';

const crypto = require('crypto');

const CREATOR_MODEL_DECISION_SCHEMA = 't8-model-decision-receipt-v1';
const MODEL_KINDS = Object.freeze(['llm', 'image', 'video', 'audio']);
const MODEL_KIND_LABELS = Object.freeze({
  llm: '语言',
  image: '图像',
  video: '视频',
  audio: '音频',
});
const DEFAULT_MODEL_IDS = Object.freeze({
  llm: 'llm:zhenzhen:gemini-3.5-flash',
  image: 'image:zhenzhen:gpt-image-2',
  video: 'video:zhenzhen:doubao-seedance-2-0-fast-260128',
  audio: 'audio:zhenzhen:suno-v5.5-generate',
});
const PROVIDER_ORDER = Object.freeze(['zhenzhen', 'seedance-nz', 'fal', 'grok-oauth']);

function stableStringify(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function text(value, maximum = 500) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readinessFor(item) {
  const readiness = record(item?.readiness);
  const available = item?.available !== false && readiness.available !== false;
  const executable = readiness.executable === true
    || (!item?.readiness && item?.configured === true && available);
  const blockers = Array.isArray(readiness.blockers)
    ? readiness.blockers.map((blocker) => ({
        code: text(blocker?.code, 120) || 'runtime-not-ready',
        message: text(blocker?.message, 500) || '当前模型运行环境未就绪',
      })).slice(0, 8)
    : [];
  if (!executable && blockers.length === 0) {
    blockers.push({
      code: item?.configured === false ? 'credential-missing' : 'runtime-not-ready',
      message: item?.configured === false ? '还没有完成这个平台的 API Key 配置' : '当前模型运行环境未就绪',
    });
  }
  return {
    known: readiness.known !== false,
    installed: readiness.installed ?? null,
    credentialReady: readiness.credentialReady ?? (item?.configured === true ? true : null),
    regionReady: readiness.regionReady ?? null,
    available,
    executable,
    blockers,
  };
}

function requiredModelKinds(kind, recipe = '') {
  const normalized = text(kind, 40).toLowerCase();
  const normalizedRecipe = text(recipe, 80).toLowerCase();
  if (normalized === 'story' && normalizedRecipe === 'shot-breakdown') return ['llm'];
  if (normalized === 'story') return [...MODEL_KINDS];
  if (normalized === 'script') return ['llm'];
  if (['image', 'edit-image'].includes(normalized)) return ['llm', 'image'];
  if (['video', 'edit-video'].includes(normalized)) return ['llm', 'video'];
  if (normalized === 'audio') return ['llm', 'audio'];
  if (normalized === 'delivery') return [];
  return ['llm'];
}

function optionalModelKinds(kind, recipe = '') {
  const normalized = text(kind, 40).toLowerCase();
  const normalizedRecipe = text(recipe, 80).toLowerCase();
  if (normalized === 'story' && normalizedRecipe === 'shot-breakdown') return ['audio'];
  return [];
}

function normalizedPreference(value) {
  const input = record(value);
  const provider = text(input.provider, 160);
  const model = text(input.model, 240);
  if (!provider && !model) return null;
  return { provider, model };
}

function modelPreferencesFromCreativeInput(value = {}) {
  const input = record(value);
  const kind = text(input.kind, 40).toLowerCase();
  const preferences = {};
  for (const modelKind of MODEL_KINDS) {
    const preference = normalizedPreference({
      provider: input[`${modelKind}Provider`],
      model: input[`${modelKind}Model`],
    });
    if (preference) preferences[modelKind] = preference;
  }
  const generic = normalizedPreference({
    provider: input.provider,
    model: input.model,
  });
  const genericKind = kind === 'script'
    ? 'llm'
    : ['image', 'edit-image'].includes(kind)
      ? 'image'
      : ['video', 'edit-video'].includes(kind)
        ? 'video'
        : kind === 'audio' ? 'audio' : '';
  if (generic && genericKind && !preferences[genericKind]) preferences[genericKind] = generic;
  return preferences;
}

function modelPreferenceNeedsDynamicCatalog(catalog = {}, preferences = {}) {
  const source = record(catalog);
  return Object.entries(record(preferences)).some(([kind, rawPreference]) => {
    const preference = normalizedPreference(rawPreference);
    if (!preference?.provider || !preference?.model) return false;
    return !(Array.isArray(source[kind]) ? source[kind] : [])
      .some((item) => item?.provider === preference.provider && item?.model === preference.model);
  });
}

function runtimeDecisionModels(input = {}) {
  const catalog = record(input.catalog);
  const capabilityGraph = record(input.capabilityGraph);
  const runtimeById = new Map(
    (Array.isArray(capabilityGraph?.runtime?.entries) ? capabilityGraph.runtime.entries : [])
      .map((item) => [text(item?.id, 500), item?.readiness]),
  );
  const models = [];
  for (const modelKind of MODEL_KINDS) {
    for (const item of Array.isArray(catalog[modelKind]) ? catalog[modelKind] : []) {
      const readiness = runtimeById.get(text(item?.id, 500));
      models.push({
        kind: modelKind,
        ...item,
        configured: readiness?.credentialReady === true,
        readiness,
      });
    }
  }
  for (const item of Array.isArray(input.dynamicItems) ? input.dynamicItems : []) {
    const modelKind = text(item?.kind, 40).toLowerCase();
    if (!MODEL_KINDS.includes(modelKind) || !item?.provider || !item?.model) continue;
    if (!models.some((known) => (
      known.kind === modelKind
      && known.provider === item.provider
      && known.model === item.model
    ))) {
      models.push({ ...item, kind: modelKind });
    }
  }
  return models;
}

function isShotBreakdownRequest(request) {
  return request.kind === 'story' && request.recipe === 'shot-breakdown';
}

function isDirectVideoTranscriptionModel(item) {
  const parameters = record(item?.parameters);
  return item?.kind === 'audio'
    && text(item?.provider, 160) === 'seedance-nz'
    && text(item?.model, 240).toLowerCase() === 'whisper-1'
    && (text(item?.family, 160).toLowerCase() === 'whisper'
      || text(parameters.family, 160).toLowerCase() === 'whisper');
}

function effectivePreference(kind, request, preferences, models) {
  const preference = normalizedPreference(preferences[kind]);
  if (!preference || !isShotBreakdownRequest(request)) return preference;
  if (kind === 'image' || kind === 'video') return null;
  if (kind !== 'audio') return preference;
  const selected = models.find((item) => (
    item.kind === 'audio'
    && item.provider === preference.provider
    && item.model === preference.model
  ));
  // Story 中保存的 Suno/配乐偏好不应误绑到“参考视频语音转写”。
  return isDirectVideoTranscriptionModel(selected) ? preference : null;
}

function compatibilityFor(item, request) {
  const parameters = record(item?.parameters);
  const capabilities = new Set(
    (Array.isArray(parameters.capabilities) ? parameters.capabilities : [])
      .map((value) => text(value, 80).toLowerCase())
      .filter(Boolean),
  );
  const attachmentKinds = new Set(
    (Array.isArray(request.attachments) ? request.attachments : [])
      .map((attachment) => text(attachment?.kind, 24).toLowerCase())
      .filter(Boolean),
  );
  const reasons = [];
  const limitations = [];
  let compatible = item?.available !== false;
  let status = compatible ? 'compatible' : 'incompatible';
  let confidence = 1;
  const markIncompatible = (message) => {
    compatible = false;
    status = 'incompatible';
    limitations.push(message);
  };
  const markUnverified = (message) => {
    if (status !== 'incompatible') status = 'unverified';
    limitations.push(message);
  };

  if (item.kind === 'llm'
    && (attachmentKinds.has('image') || attachmentKinds.has('video'))) {
    if (parameters.vision === true) {
      confidence += 5;
      reasons.push(
        request.kind === 'story' && request.recipe === 'shot-breakdown'
          ? '目录明确声明支持视觉输入，可分析受控参考视频采样帧'
          : '目录明确声明支持视觉输入，可核验当前图片或视频参考素材',
      );
    } else if (parameters.vision === false) {
      markIncompatible('模型明确不支持视觉输入，不能读取当前图片或视频参考素材');
    } else {
      markUnverified('目录没有明确声明视觉输入能力，不能据此自动选择或声称已读取素材');
    }
  }

  if (item.kind === 'llm' && attachmentKinds.has('audio')) {
    const audioAttachments = (Array.isArray(request.attachments) ? request.attachments : [])
      .filter((attachment) => text(attachment?.kind, 24).toLowerCase() === 'audio');
    const transcriptGrounded = audioAttachments.length > 0 && audioAttachments.every((attachment) => (
      /^[a-f0-9]{64}$/u.test(text(
        attachment?.observationDigest || attachment?.audioObservation?.observationDigest,
        128,
      ).toLowerCase())
    ));
    if (transcriptGrounded) {
      confidence += 4;
      reasons.push('音频已先形成绑定素材版本的可核验转写，语言模型只读取转写证据');
    } else if (parameters.audioInput === true) {
      confidence += 4;
      reasons.push('目录明确声明支持音频输入');
    } else {
      markIncompatible('当前创作对话输入链路没有该模型的可核验音频理解能力');
    }
  }

  if (item.kind === 'audio'
    && isShotBreakdownRequest(request)
    && attachmentKinds.has('video')) {
    if (isDirectVideoTranscriptionModel(item)) {
      confidence += 5;
      reasons.push('支持直接接收 MP4 并转写参考视频中的语音');
      limitations.push('请求 Provider 分段时间窗；仅在实际返回有效分段时作为语音窗口证据，否则保持 untimed，均不等于逐词时间戳或精确镜头归属');
    } else {
      markIncompatible('该音频模型不是已验证的 MP4 语音转写能力');
    }
  }

  if (item.kind === 'image') {
    const needsReference = attachmentKinds.has('image');
    if (needsReference) {
      const explicitlySupported = parameters.supportsReference === true
        || capabilities.has('i2i')
        || capabilities.has('edit');
      const explicitlyUnsupported = parameters.supportsReference === false
        && !capabilities.has('i2i')
        && !capabilities.has('edit');
      if (explicitlySupported) {
        confidence += 3;
        reasons.push('支持当前图片参考或编辑输入');
      } else {
        if (explicitlyUnsupported) {
          markIncompatible('模型明确不支持当前图片参考或编辑输入');
        } else {
          markUnverified('模型目录未明确声明参考图能力，不能据此自动选择');
        }
      }
    } else {
      if (capabilities.has('t2i') || parameters.supportsPrompt === true) {
        confidence += 2;
        reasons.push('支持当前文生图输入');
      } else if (capabilities.size > 0 || parameters.supportsPrompt === false) {
        markIncompatible('模型明确未声明文生图能力');
      } else {
        markUnverified('模型目录未明确声明文生图能力，不能据此自动选择');
      }
    }
  }

  if (item.kind === 'video' && attachmentKinds.has('image')) {
    if (parameters.supportsImages === false) {
      markIncompatible('模型明确不支持当前图片参考输入');
    } else if (parameters.supportsImages === true) {
      confidence += 3;
      reasons.push('支持当前图片参考输入');
    } else {
      markUnverified('模型目录未明确声明图片参考能力，不能据此自动选择');
    }
  }

  const ratio = text(request.ratio, 20);
  const ratios = Array.isArray(parameters.ratios)
    ? parameters.ratios
    : Array.isArray(parameters.aspectRatios) ? parameters.aspectRatios : [];
  if (['image', 'video'].includes(item.kind) && ratio && ratio.toLowerCase() !== 'auto') {
    if (ratios.length === 0) {
      markUnverified(`模型目录未提供 ${ratio} 画幅兼容证据，不能据此自动选择`);
    } else if (ratios.map(String).includes(ratio)) {
      confidence += 2;
      reasons.push(`支持 ${ratio} 画幅`);
    } else {
      markIncompatible(`模型目录未声明支持 ${ratio} 画幅`);
    }
  }

  const duration = Number(request.duration);
  const durations = Array.isArray(parameters.durations) ? parameters.durations.map(Number) : [];
  if (item.kind === 'video' && request.kind !== 'story'
    && Number.isFinite(duration) && duration > 0) {
    if (durations.length === 0) {
      markUnverified(`模型目录未提供 ${duration} 秒时长兼容证据，不能据此自动选择`);
    } else if (durations.includes(duration)) {
      confidence += 2;
      reasons.push(`支持 ${duration} 秒时长`);
    } else {
      markIncompatible(`模型目录未声明支持 ${duration} 秒时长`);
    }
  }

  if (status === 'compatible' && reasons.length === 0) reasons.push('与当前创作类型兼容');
  return { compatible, status, confidence, reasons, limitations };
}

function compatibilityEvidence(compatibility, request) {
  const attachmentKinds = [...new Set(
    (Array.isArray(request.attachments) ? request.attachments : [])
      .map((attachment) => text(attachment?.kind, 24).toLowerCase())
      .filter(Boolean),
  )].sort();
  return {
    status: compatibility.status || (compatibility.compatible ? 'compatible' : 'incompatible'),
    confidence: Number(compatibility.confidence) || 0,
    reasons: [...compatibility.reasons],
    limitations: [...compatibility.limitations],
    request: {
      creativeKind: request.kind,
      recipe: request.recipe || '',
      attachmentKinds,
      attachmentEvidenceDigest: request.attachmentEvidenceDigest,
      ratio: request.ratio || 'auto',
      duration: Number(request.duration) || 0,
    },
  };
}

function providerRank(provider) {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index >= 0 ? index : PROVIDER_ORDER.length;
}

function publicModel(item, compatibility, request) {
  const readiness = readinessFor(item);
  return {
    id: text(item.id, 500),
    kind: item.kind,
    provider: text(item.provider, 160),
    platformLabel: text(item.platformLabel || item.provider, 160),
    model: text(item.model, 240),
    label: text(item.label || item.model, 240),
    family: text(item.family, 160),
    executable: readiness.executable,
    blockers: readiness.blockers,
    limitations: compatibility.limitations,
    compatibility: compatibilityEvidence(compatibility, request),
  };
}

function createDecision(kind, request, models, preference, required) {
  const candidates = models
    .filter((item) => item.kind === kind && item.provider && item.model)
    .map((item) => ({
      item,
      readiness: readinessFor(item),
      compatibility: compatibilityFor(item, request),
    }));
  const compatibleCandidates = candidates
    .filter((candidate) => candidate.compatibility.status === 'compatible');

  let selectedCandidate = null;
  let mode = 'smart';
  if (preference) {
    mode = 'fixed';
    selectedCandidate = candidates.find(({ item }) => (
      item.provider === preference.provider && item.model === preference.model
    ) && compatibilityFor(item, request).status !== 'incompatible') || null;
    if (!preference.provider || !preference.model) {
      return {
        error: {
          code: 'CREATOR_MODEL_PREFERENCE_INCOMPLETE',
          message: `${MODEL_KIND_LABELS[kind]}模型需要同时选择平台和模型`,
        },
      };
    }
    if (!selectedCandidate) {
      const known = models.find((item) => (
        item.kind === kind
        && item.provider === preference.provider
        && item.model === preference.model
      ));
      const incompatibility = known ? compatibilityFor(known, request).limitations[0] : '';
      return {
        error: {
          code: 'CREATOR_MODEL_PREFERENCE_UNAVAILABLE',
          message: known
            ? `${MODEL_KIND_LABELS[kind]}模型 ${preference.model} 与本次输入不兼容：${incompatibility || '缺少可验证兼容证据'}；已保留固定选择，没有自动改用其他模型`
            : `${MODEL_KIND_LABELS[kind]}模型 ${preference.model} 当前不在可验证目录中；已保留固定选择，没有自动改用其他平台`,
        },
      };
    }
    if (!selectedCandidate.readiness.executable) {
      const reason = selectedCandidate.readiness.blockers[0]?.message || '当前模型运行环境未就绪';
      return {
        error: {
          code: 'CREATOR_MODEL_RUNTIME_NOT_READY',
          message: `${MODEL_KIND_LABELS[kind]}模型 ${preference.model} 暂时不能执行：${reason}。已保留固定选择，没有自动切换平台或模型`,
        },
      };
    }
  } else {
    compatibleCandidates.sort((left, right) => (
      Number(right.readiness.executable) - Number(left.readiness.executable)
      || right.compatibility.confidence - left.compatibility.confidence
      || Number(right.item.id === DEFAULT_MODEL_IDS[kind]) - Number(left.item.id === DEFAULT_MODEL_IDS[kind])
      || providerRank(left.item.provider) - providerRank(right.item.provider)
      || String(left.item.id).localeCompare(String(right.item.id))
    ));
    selectedCandidate = compatibleCandidates[0] || null;
  }

  if (!selectedCandidate) {
    return {
      decision: {
        kind,
        kindLabel: MODEL_KIND_LABELS[kind],
        required,
        mode,
        status: 'blocked',
        selected: null,
        reasons: ['当前目录没有与本次输入兼容的已知模型'],
        blockers: [{ code: 'compatible-model-missing', message: '当前目录没有与本次输入兼容的已知模型' }],
        alternatives: [],
        inputCompatibility: {
          status: 'unverified',
          confidence: 0,
          reasons: [],
          limitations: ['当前目录没有可验证模型，无法完成输入兼容校验'],
          request: compatibilityEvidence({
            compatible: false,
            confidence: 0,
            reasons: [],
            limitations: [],
          }, request).request,
        },
        estimates: {
          cost: { status: 'unknown', message: '没有可验证模型，无法估算费用' },
          latency: { status: 'unknown', message: '没有可验证模型，无法估算耗时' },
        },
      },
    };
  }

  const selected = publicModel(selectedCandidate.item, selectedCandidate.compatibility, request);
  const alternatives = compatibleCandidates
    .filter((candidate) => candidate.item.id !== selectedCandidate.item.id)
    .slice(0, 3)
    .map((candidate) => publicModel(candidate.item, candidate.compatibility, request));
  const reasons = mode === 'fixed'
    ? [
        '你已明确固定这个平台和模型',
        ...selectedCandidate.compatibility.reasons,
        ...(selectedCandidate.compatibility.status === 'unverified'
          ? ['部分输入约束缺少目录证据；已把限制写入回执，未替你切换模型']
          : []),
        '组件、凭据与当前运行状态已核对',
      ]
    : [
        ...selectedCandidate.compatibility.reasons,
        selectedCandidate.readiness.executable
          ? '组件、凭据与当前运行状态均已就绪'
          : '当前只形成可编辑计划；运行前仍需解除下方阻断',
      ];
  return {
    decision: {
      kind,
      kindLabel: MODEL_KIND_LABELS[kind],
      required,
      mode,
      status: selected.executable ? 'ready' : 'blocked',
      selected,
      reasons,
      blockers: selected.blockers,
      alternatives,
      inputCompatibility: selected.compatibility,
      estimates: {
        cost: {
          status: 'unknown',
          message: '当前目录没有可验证的统一计价数据，运行确认前不得猜测费用',
        },
        latency: {
          status: 'unknown',
          message: '当前目录没有可验证的实时队列数据，运行确认前不得猜测耗时',
        },
      },
    },
    modelField: selected,
  };
}

function approvalBoundaryForDecisions(decisions = []) {
  return {
    providerSelections: (Array.isArray(decisions) ? decisions : [])
      .map((decision) => ({
        kind: text(decision?.kind, 40),
        mode: text(decision?.mode, 40),
        status: text(decision?.status, 40),
        provider: text(decision?.selected?.provider, 160),
        model: text(decision?.selected?.model, 240),
      }))
      .filter((selection) => selection.kind && (selection.provider || selection.model))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    costTier: {
      status: 'unknown',
      message: '当前模型目录没有可验证的统一价格等级；审批不会猜测费用，后续价格等级变化必须重新确认。',
    },
    privacyBoundary: {
      status: 'unknown',
      message: '当前模型目录没有可验证的数据驻留与隐私边界；审批不会猜测，后续隐私边界变化必须重新确认。',
    },
  };
}

function receiptDigestPayload(receipt) {
  return {
    schema: receipt.schema,
    mode: receipt.mode,
    catalogDigest: receipt.catalogDigest,
    requestDigest: receipt.requestDigest,
    attachmentEvidenceDigest: receipt.attachmentEvidenceDigest,
    decisions: receipt.decisions,
    approvalBoundary: receipt.approvalBoundary,
    fallbackPolicy: receipt.fallbackPolicy,
  };
}

function assertCreatorModelDecisionReceipt(value) {
  const receipt = record(value);
  const fail = (message) => {
    const error = new Error(message);
    error.code = 'CREATOR_MODEL_DECISION_RECEIPT_INVALID';
    throw error;
  };
  if (receipt.schema !== CREATOR_MODEL_DECISION_SCHEMA) fail('模型选择回执版本无效');
  if (receipt.providerCalls !== 0 || receipt.canvasWrites !== 0) fail('模型选择回执不是只读决策');
  if (!Array.isArray(receipt.decisions)) fail('模型选择回执缺少决策列表');
  const kinds = receipt.decisions.map((decision) => text(decision?.kind, 40));
  if (new Set(kinds).size !== kinds.length || kinds.some((kind) => !MODEL_KINDS.includes(kind))) {
    fail('模型选择回执包含重复或未知类型');
  }
  for (const decision of receipt.decisions) {
    if (!['smart', 'fixed'].includes(decision?.mode)
      || !['ready', 'blocked'].includes(decision?.status)
      || !Array.isArray(decision?.reasons)
      || decision.reasons.some((reason) => !text(reason, 1000))) {
      fail('模型选择决策状态或理由无效');
    }
    if (!Array.isArray(decision?.alternatives)
      || !record(decision?.estimates?.cost).status
      || !record(decision?.estimates?.latency).status
      || !text(decision?.estimates?.cost?.message, 1000)
      || !text(decision?.estimates?.latency?.message, 1000)) {
      fail('模型选择决策缺少替代项或估计证据');
    }
    const selected = record(decision?.selected);
    const compatibility = record(decision?.inputCompatibility);
    if (Object.keys(selected).length > 0) {
      if (!text(selected.id, 500) || !text(selected.provider, 160) || !text(selected.model, 240)) {
        fail('模型选择决策缺少模型身份');
      }
      if (!['compatible', ...(decision.mode === 'fixed' ? ['unverified'] : [])].includes(compatibility.status)
        || !Array.isArray(compatibility.reasons)
        || !text(compatibility?.request?.creativeKind, 40)) {
        fail('模型选择决策缺少输入兼容证据');
      }
    } else if (decision.status !== 'blocked' || compatibility.status !== 'unverified') {
      fail('无模型决策必须保持阻断并标记未验证');
    }
    for (const alternative of decision.alternatives) {
      if (!text(alternative?.id, 500)
        || !text(alternative?.provider, 160)
        || !text(alternative?.model, 240)
        || record(alternative?.compatibility).status !== 'compatible') {
        fail('模型替代项缺少身份或输入兼容证据');
      }
      if (alternative.id === selected.id) fail('模型替代项与已选模型重复');
    }
  }
  const ready = receipt.decisions
    .filter((decision) => decision.required === true)
    .every((decision) => decision.status === 'ready');
  if (receipt.ready !== ready) fail('模型选择回执就绪状态漂移');
  const expectedBoundary = approvalBoundaryForDecisions(receipt.decisions);
  if (stableStringify(receipt.approvalBoundary) !== stableStringify(expectedBoundary)) {
    fail('模型选择回执的 Provider、费用或隐私边界漂移');
  }
  if (receipt.receiptDigest !== digest(receiptDigestPayload(receipt))) {
    fail('模型选择回执摘要无效');
  }
  if (!/^[a-f0-9]{64}$/.test(text(receipt.attachmentEvidenceDigest, 128))) {
    fail('模型选择回执缺少附件版本证据');
  }
  if (/api[_-]?key|bearer|sk-[A-Za-z0-9_-]{8,}/i.test(JSON.stringify(receipt))) {
    fail('模型选择回执不得包含凭据');
  }
  return receipt;
}

function createCreatorModelDecision(input = {}) {
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const attachmentEvidenceDigest = digest(attachments.map((attachment) => ({
    assetId: text(attachment?.assetId, 160),
    contentHash: text(attachment?.contentHash, 128).toLowerCase().replace(/^sha256:/, ''),
    contentRevision: Math.max(0, Math.trunc(Number(attachment?.contentRevision) || 0)),
    kind: text(attachment?.kind, 24).toLowerCase(),
    mimeType: text(attachment?.mimeType, 120).toLowerCase(),
    size: Math.max(0, Math.trunc(Number(attachment?.size) || 0)),
    width: Math.max(0, Math.trunc(Number(attachment?.width) || 0)),
    height: Math.max(0, Math.trunc(Number(attachment?.height) || 0)),
    duration: Math.max(0, Number(attachment?.duration) || 0),
    observationDigest: text(
      attachment?.observationDigest || attachment?.audioObservation?.observationDigest,
      128,
    ).toLowerCase(),
  })));
  const request = {
    kind: text(input.kind, 40).toLowerCase(),
    recipe: text(input.recipe, 80).toLowerCase(),
    ratio: text(input.ratio, 20),
    duration: Number(input.duration) || 0,
    profile: text(input.profile, 40) || 'balanced',
    attachments,
    attachmentEvidenceDigest,
  };
  const models = (Array.isArray(input.models) ? input.models : [])
    .filter((item) => MODEL_KINDS.includes(item?.kind))
    .map((item) => ({ ...item }));
  const preferences = record(input.preferences);
  const requiredKinds = requiredModelKinds(request.kind, request.recipe);
  const optionalKinds = optionalModelKinds(request.kind, request.recipe);
  const requestedKinds = MODEL_KINDS.filter((kind) => effectivePreference(kind, request, preferences, models));
  const decisionKinds = [...new Set([...requiredKinds, ...optionalKinds, ...requestedKinds])];
  const decisions = [];
  const modelFields = {};
  const errors = [];
  for (const kind of decisionKinds) {
    const preference = effectivePreference(kind, request, preferences, models);
    const result = createDecision(kind, request, models, preference, requiredKinds.includes(kind));
    if (result.error) {
      errors.push({ kind, ...result.error });
      continue;
    }
    decisions.push(result.decision);
    if (result.modelField && (requiredKinds.includes(kind) || result.decision.status === 'ready')) {
      modelFields[`${kind}Provider`] = result.modelField.provider;
      modelFields[`${kind}Model`] = result.modelField.model;
    }
  }
  const fixedCount = decisions.filter((decision) => decision.mode === 'fixed').length;
  const mode = fixedCount === 0 ? 'smart' : fixedCount === decisions.length ? 'fixed' : 'mixed';
  const generatedAt = new Date(Number(input.now) || Date.now()).toISOString();
  const receipt = {
    schema: CREATOR_MODEL_DECISION_SCHEMA,
    mode,
    generatedAt,
    providerCalls: 0,
    canvasWrites: 0,
    catalogDigest: text(input.catalogDigest, 128),
    attachmentEvidenceDigest,
    requestDigest: digest({
      kind: request.kind,
      recipe: request.recipe,
      ratio: request.ratio,
      duration: request.duration,
      profile: request.profile,
      attachmentKinds: request.attachments.map((item) => text(item?.kind, 24)),
      attachmentEvidenceDigest,
      preferences: Object.fromEntries(MODEL_KINDS.map((kind) => [kind, effectivePreference(kind, request, preferences, models)])
        .filter(([, value]) => value)),
    }),
    decisions,
    ready: decisions.filter((decision) => decision.required).every((decision) => decision.status === 'ready'),
    approvalBoundary: approvalBoundaryForDecisions(decisions),
    fallbackPolicy: {
      silentProviderFallback: false,
      silentCostTierFallback: false,
      silentPrivacyBoundaryFallback: false,
      providerChangeRequiresApproval: true,
      message: '不会静默更换平台、费用等级或隐私边界；需要改选时必须显示新回执并由创作者确认。',
    },
  };
  receipt.receiptDigest = digest(receiptDigestPayload(receipt));
  assertCreatorModelDecisionReceipt(receipt);
  return { errors, modelFields, receipt };
}

module.exports = {
  CREATOR_MODEL_DECISION_SCHEMA,
  MODEL_KINDS,
  approvalBoundaryForDecisions,
  assertCreatorModelDecisionReceipt,
  createCreatorModelDecision,
  modelPreferenceNeedsDynamicCatalog,
  modelPreferencesFromCreativeInput,
  requiredModelKinds,
  runtimeDecisionModels,
};
