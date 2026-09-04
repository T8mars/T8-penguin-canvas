'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CREATOR_LLM_RESPONSE_SCHEMA,
  CreatorLlmRuntimeError,
  createCreatorLlmRuntimeV2,
  mergeWorkingBrief,
  turnPolicy,
} = require('../backend/src/services/creatorLlmRuntimeV2.js');

const settingsProvider = () => ({
  zhenzhenSd2ApiKey: 'test-only-not-persisted',
  zhenzhenSd2BaseUrl: 'https://api.seedance.nz',
});

const workingBrief = { goal: '完成作品', format: '短片', audience: '', style: '', story: '', assets: '', constraints: '', decisions: '', openQuestion: '' };
const phaseDecision = { phase: 'idea', transition: 'stay', reason: '还在明确方向' };
const suggestionSet = (labels = ['直接生成', '再暗一点', '换成清晨']) => labels.map((label, index) => ({
  label,
  sendText: label,
  intentKind: ['recommended-next-step', 'alternative-direction', 'execute-or-confirm'][index],
  role: ['recommended', 'alternative', 'execute'][index],
  inputAssetIds: [],
}));

const responseEnvelope = (overrides = {}) => ({
  schema: CREATOR_LLM_RESPONSE_SCHEMA,
  replyMarkdown: '我先把作品方向收紧到一个清楚、可继续推进的版本。',
  workingBrief,
  phaseDecision,
  suggestions: suggestionSet(),
  proposedAction: null,
  ...overrides,
});

test('Creator LLM v2 uses one real provider call and binds a versioned image action', async () => {
  let calls = 0;
  let capturedProvider = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (provider, input) => {
      calls += 1;
      capturedProvider = provider;
      assert.equal(input.stream, true);
      assert.equal(input.response_format.type, 'json_object');
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '我把画面定成冷蓝雨夜，列车暖灯会成为唯一视觉焦点。',
          workingBrief,
          phaseDecision,
          suggestions: suggestionSet(),
          proposedAction: {
            type: 'image',
            prompt: '雨夜车站电影海报，冷蓝环境，暖色列车灯，纵深构图',
            parameters: { ratio: '16:9', count: 1 },
            inputAssetIds: [],
          },
        }),
      };
    },
  });
  const result = await runtime.respond({ prompt: '帮我做一张雨夜车站电影海报' });
  assert.equal(calls, 1);
  assert.equal(capturedProvider.apiKey, 'test-only-not-persisted');
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.suggestions.length, 3);
  assert.equal(result.proposedAction.type, 'image');
  assert.equal(result.proposedAction.modelSnapshot.providerId, 'seedance-nz');
  assert.equal(result.proposedAction.modelSnapshot.modelId, 'zhenzhen-image-gk-v2');
  assert.match(result.proposedAction.modelSnapshot.catalogDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes('test-only-not-persisted'), false);
});

test('Creator LLM v2 never silently falls back when credentials or provider calls fail', async () => {
  const missing = createCreatorLlmRuntimeV2({ settingsProvider: () => ({}) });
  await assert.rejects(() => missing.respond({ prompt: '写一个短片' }), (error) => (
    error instanceof CreatorLlmRuntimeError && error.code === 'CREATOR_LLM_CREDENTIAL_REQUIRED'
  ));

  const failed = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({ ok: false, code: 'timeout', error: 'upstream timeout' }),
  });
  await assert.rejects(() => failed.respond({ prompt: '写一个短片' }), (error) => (
    error instanceof CreatorLlmRuntimeError && error.code === 'CREATOR_LLM_FAILED'
  ));

  const rejectedCredential = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({ ok: false, code: 'http_error', upstreamHttpStatus: 401, error: 'Unauthorized' }),
  });
  await assert.rejects(() => rejectedCredential.respond({ prompt: '写一个短片' }), (error) => (
    error instanceof CreatorLlmRuntimeError
      && error.code === 'CREATOR_LLM_CREDENTIAL_INVALID'
      && error.status === 401
  ));
});

test('Creator LLM v2 rejects invalid suggestion/action contracts and any cost text', async () => {
  const invoke = (payload) => createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({ ok: true, text: JSON.stringify({ schema: CREATOR_LLM_RESPONSE_SCHEMA, ...payload }) }),
  }).respond({ prompt: '开始' });

  await assert.rejects(() => invoke({
    replyMarkdown: '这是回复',
    workingBrief,
    phaseDecision,
    suggestions: ['一', '二'],
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '预计费用需要一元。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['一', '二', '三']),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_FORBIDDEN_COST_TEXT');

  await assert.rejects(() => invoke({
    replyMarkdown: '准备好了。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['直接生成', '查看价格', '换个构图']),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_FORBIDDEN_COST_TEXT');

  await assert.rejects(() => invoke({
    replyMarkdown: '准备好了。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['一', '二', '三']),
    proposedAction: { type: 'audio', prompt: '生成音乐' },
  }), (error) => error?.code === 'CREATOR_LLM_ACTION_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '我已经理解你的需求，现在进入当前阶段。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['先定画面', '换个故事', '开始生成']),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_TONE_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '好的，我会先把人物关系整理清楚。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['先定人物', '换个冲突', '开始写剧本']),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_TONE_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '我会让雨夜里的暖灯成为画面重点。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet().map((item, index) => ({
      ...item,
      sendText: ['直接生成这张雨夜车站图', '立即生成这张雨夜车站图', '马上生成这张雨夜车站图'][index],
    })),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '我会让雨夜里的暖灯成为画面重点。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(['这是一个明显超过十四个汉字的建议标签', '改用清晨逆光', '锁定当前方向']),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_POLICY_INVALID');

  await assert.rejects(() => invoke({
    replyMarkdown: '我会让雨夜里的暖灯成为画面重点。',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet().map((item, index) => index === 0 ? { ...item, sendText: '镜头'.repeat(141) } : item),
    proposedAction: null,
  }), (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_INVALID');

  const normalizedLayout = await invoke({
    replyMarkdown: '### 画面方向\n\n- **主体**：雨夜站台上的独行人\n- `光线`：列车暖灯切开冷蓝雨幕',
    workingBrief,
    phaseDecision,
    suggestions: suggestionSet(),
    proposedAction: null,
  });
  assert.equal(normalizedLayout.replyMarkdown, '画面方向\n\n主体：雨夜站台上的独行人\n光线：列车暖灯切开冷蓝雨幕');
});

test('Creator LLM v2 honors explicit model preferences without switching provider', async () => {
  let observed = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (provider, input) => {
      observed = {
        provider: provider.id,
        model: input.model,
        systemPrompt: String(input.messages?.[0]?.content || ''),
      };
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '我先把人物和冲突整理清楚。',
          workingBrief,
          phaseDecision: { phase: 'script', transition: 'advance', reason: '目标已明确' },
          suggestions: suggestionSet(['继续写剧本', '先定人物', '换一个冲突']),
          proposedAction: null,
        }),
      };
    },
  });
  await runtime.respond({
    prompt: '写一个三分钟短片',
    preferences: {
      providerId: 'seedance-nz',
      llm: { providerId: 'seedance-nz', modelId: 'qwen/qwen3.8-max' },
    },
  });
  assert.equal(observed.provider, 'seedance-nz');
  assert.equal(observed.model, 'qwen/qwen3.8-max');
  assert.match(observed.systemPrompt, /开放式问题/u);
  assert.match(observed.systemPrompt, /不要把用户已经说出的 A\/B/u);
  assert.match(observed.systemPrompt, /recommended 与 execute 不能要求同一种交付物/u);
  assert.match(observed.systemPrompt, /execute 也必须沿用正文的明确倾向，表示不再讨论/u);
  assert.match(observed.systemPrompt, /不能重新比较用户原来的 A\/B/u);
  assert.match(observed.systemPrompt, /不得写成“先不定、暂时留白/u);
  assert.match(observed.systemPrompt, /alternative 必须用“改成\/换成\/换个视角”/u);
  assert.match(observed.systemPrompt, /不能只是复述新结尾后再要求写完整脚本/u);
});

test('Creator LLM v2 rejects explicit non-vision models before sending visual media', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => { calls += 1; return { ok: false }; },
  });
  await assert.rejects(() => runtime.respond({
    prompt: '参考这张图继续',
    preferences: {
      providerId: 'seedance-nz',
      llm: { providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro' },
    },
    attachments: [{ assetId: 'asset-image-1', kind: 'image', mediaUrl: 'C:\\media\\image.png' }],
  }), (error) => error?.code === 'CREATOR_LLM_VISION_REQUIRED' && error?.status === 409);
  assert.equal(calls, 0);
});

test('Creator LLM v2 automatic selection chooses the documented vision model for visual media', async () => {
  let observedProvider = null;
  let observedModel = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (provider, input) => {
      observedProvider = provider.id;
      observedModel = input.model;
      return { ok: true, text: JSON.stringify(responseEnvelope({
        replyMarkdown: '我看到主体位于画面中央，冷蓝背景里有一处暖色高光，可以沿这个关系继续。',
      })) };
    },
  });
  const result = await runtime.respond({
    prompt: '参考这张图继续，不要反问',
    preferences: { providerId: 'auto', llm: null },
    attachments: [{ assetId: 'asset-image-auto', kind: 'image', previewUrl: '/api/project-assets/asset-image-auto/media' }],
  });
  assert.equal(observedProvider, 'seedance-nz');
  assert.equal(observedModel, 'zhenzhen/gk-4.6');
  assert.equal(result.evidence.modelId, 'zhenzhen/gk-4.6');
});

test('Creator LLM v2 performs at most one full-response repair and fails closed when both outputs are invalid', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return { ok: true, text: JSON.stringify({ schema: 'wrong-schema' }) };
    },
  });
  await assert.rejects(
    () => runtime.respond({ prompt: '给我一个自然的创作建议' }),
    (error) => error?.code === 'CREATOR_LLM_SCHEMA_INVALID',
  );
  assert.equal(calls, 2);
});

test('Creator LLM v2 quickly retries one empty provider response without exceeding two calls', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, code: 'empty_text', error: '扩展 LLM 没有返回文本。' };
      return { ok: true, text: JSON.stringify(responseEnvelope()) };
    },
  });
  const result = await runtime.respond({ prompt: '给我一个自然的创作判断' });
  assert.equal(calls, 2);
  assert.equal(result.evidence.providerCalls, 2);

  let invalidCalls = 0;
  const invalidAfterEmpty = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      invalidCalls += 1;
      if (invalidCalls === 1) return { ok: false, code: 'empty_text', error: '扩展 LLM 没有返回文本。' };
      return { ok: true, text: JSON.stringify({ schema: 'wrong-schema' }) };
    },
  });
  await assert.rejects(
    () => invalidAfterEmpty.respond({ prompt: '给我一个自然的创作判断' }),
    (error) => error?.code === 'CREATOR_LLM_SCHEMA_INVALID',
  );
  assert.equal(invalidCalls, 2);
});

test('Creator LLM v2 retries one fast transient provider overload but not a long timeout loop', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    retryDelayMs: 0,
    generateChat: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          code: 'http_error',
          upstreamHttpStatus: 503,
          error: 'system cpu overloaded',
        };
      }
      return { ok: true, text: JSON.stringify(responseEnvelope()) };
    },
  });
  const result = await runtime.respond({ prompt: '写一个短片' });
  assert.equal(calls, 2);
  assert.equal(result.evidence.providerCalls, 2);
});

test('Creator LLM v2 binds real media parts, selection evidence and working brief in the same single call', async () => {
  let captured = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, input) => {
      captured = input;
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '我看到了雨夜站台的冷蓝环境和画面右侧的暖灯列车，可以沿这个明暗关系继续。',
          workingBrief: { ...workingBrief, assets: '雨夜站台参考图；右侧暖灯列车' },
          phaseDecision: { phase: 'assets', transition: 'advance', reason: '参考素材已明确' },
          suggestions: suggestionSet(['沿这个方向细化', '改成清晨', '生成图片']),
          proposedAction: null,
        }),
      };
    },
  });
  const result = await runtime.respond({
    prompt: '参考这张图继续',
    workingBrief: { ...workingBrief, goal: '做电影海报' },
    selectedNodes: [{ nodeId: 'node-image-1', type: 'upload', label: '雨夜站台', assetId: 'asset-image-1' }],
    attachments: [{ assetId: 'asset-image-1', kind: 'image', title: '雨夜站台.png', previewUrl: '/api/project-assets/asset-image-1/media' }],
  });
  assert.ok(Array.isArray(captured.messages.at(-1).content));
  assert.equal(captured.messages.at(-1).content.some((part) => part.type === 'image_url' && part.image_url.url.includes('asset-image-1')), true);
  assert.match(captured.messages.at(-1).content[0].text, /workingBrief/u);
  assert.match(captured.messages.at(-1).content[0].text, /当前可信阶段：idea/u);
  assert.match(captured.messages.at(-1).content[0].text, /node-image-1/u);
  assert.equal(result.workingBrief.assets.includes('雨夜站台'), true);
  assert.equal(result.phaseDecision.phase, 'assets');
  assert.deepEqual(result.suggestions.map((item) => item.role), ['recommended', 'alternative', 'execute']);
});

test('Creator LLM v2 excludes interrupted assistant system copy from later creative context', async () => {
  let captured = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, input) => {
      captured = input;
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '我沿用已经确认的冷蓝雨夜，把列车暖灯继续作为视觉焦点。',
          workingBrief,
          phaseDecision,
          suggestions: suggestionSet(),
          proposedAction: null,
        }),
      };
    },
  });
  await runtime.respond({
    prompt: '继续完善',
    history: [
      { role: 'user', status: 'completed', body: '做一张雨夜车站海报' },
      { role: 'assistant', status: 'failed', body: '这次没有生成成功，请重试。' },
      { role: 'assistant', status: 'stopped', body: '已停止。' },
      { role: 'assistant', status: 'completed', body: '我会用冷蓝雨夜和暖色列车灯。' },
    ],
  });
  const serialized = JSON.stringify(captured.messages);
  assert.equal(serialized.includes('这次没有生成成功'), false);
  assert.equal(serialized.includes('已停止'), false);
  assert.equal(serialized.includes('冷蓝雨夜和暖色列车灯'), true);
});

test('Creator LLM v2 treats “你决定” as zero-question delegation', async () => {
  let calls = 0;
  let firstRequest = null;
  let repairRequest = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, input) => {
      calls += 1;
      if (calls === 1) firstRequest = input;
      else repairRequest = input;
      return {
        ok: true,
        text: JSON.stringify(calls === 1
          ? responseEnvelope({
            replyMarkdown: '你更喜欢冷色还是暖色？我直接采用冷蓝环境配暖色主体光，画面会更有层次。',
            workingBrief: { ...workingBrief, openQuestion: '你更喜欢冷色还是暖色？' },
          })
          : responseEnvelope({
            replyMarkdown: '我直接采用冷蓝环境配暖色主体光，让主体从雨夜里自然跳出来，层次会更稳。',
            workingBrief: { ...workingBrief, openQuestion: '' },
          })),
      };
    },
  });
  const result = await runtime.respond({ prompt: '你决定吧，直接给我最好的方案', workingBrief });
  assert.equal(calls, 2);
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);
  assert.equal(result.workingBrief.openQuestion, '');
  assert.match(result.replyMarkdown, /直接采用冷蓝/u);
  assert.match(firstRequest.messages.at(-1).content[0].text, /"delegated":true/u);
  assert.match(JSON.stringify(repairRequest.messages), /CREATOR_LLM_QUESTION_CONTRACT_INVALID/u);
  assert.equal(repairRequest.model, firstRequest.model);
});

test('Creator turn policy does not mistake explicit negation for delegation or ending-only scope', () => {
  assert.equal(turnPolicy('不要你决定，先问我一个真正关键的问题').delegated, false);
  assert.equal(turnPolicy('不要只改结尾，开头也需要一起调整').scopedBriefFields.length, 0);
});

test('Creator turn policy captures language, no-question, no-generation and style-only intent', () => {
  const noGeneration = turnPolicy('先不要生成图片或视频，只把方案改好，不要反问');
  assert.equal(noGeneration.generationProhibited, true);
  assert.equal(noGeneration.requestedActionType, null);
  assert.equal(noGeneration.maxQuestions, 0);
  assert.equal(noGeneration.replyLanguage, '简体中文');

  const styleOnly = turnPolicy('不是治愈，是冷峻；只改风格，其他不变，不要反问');
  assert.deepEqual(styleOnly.scopedBriefFields, ['style']);
  assert.equal(styleOnly.maxQuestions, 0);

  assert.equal(turnPolicy('结尾和解还是分开我还没想好').criticalChoiceUnresolved, true);

  const english = turnPolicy('Keep this in restrained English and do not ask me another question.');
  assert.equal(english.replyLanguage, 'English');
  assert.equal(english.maxQuestions, 0);
});

test('Creator LLM v2 prevents generation when the user explicitly says not to generate', async () => {
  let noGenerationCalls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      noGenerationCalls += 1;
      return {
        ok: true,
        text: JSON.stringify(noGenerationCalls === 1
          ? responseEnvelope({
            replyMarkdown: '先把人物动机和最后一个镜头收紧，画面方案保持在可审阅状态。',
            suggestions: suggestionSet(['精修人物动机', '改用主观视角', '保留当前方案']),
            proposedAction: {
              type: 'image',
              prompt: '不应执行的图片动作',
              parameters: { ratio: '16:9', count: 1 },
              inputAssetIds: [],
            },
          })
          : responseEnvelope({
            replyMarkdown: '先把人物动机和最后一个镜头收紧，画面方案保持在可审阅状态。',
            suggestions: suggestionSet(['精修人物动机', '改用主观视角', '保留当前方案']),
          })),
      };
    },
  });
  const result = await runtime.respond({ prompt: '先不要生成图片或视频，只把方案改好，不要反问', workingBrief });
  assert.equal(noGenerationCalls, 1);
  assert.equal(result.proposedAction, null);
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);

  let suggestionRepairCalls = 0;
  let suggestionRepairInput = null;
  const suggestionViolation = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      suggestionRepairCalls += 1;
      if (suggestionRepairCalls === 2) {
        suggestionRepairInput = request;
        return {
          ok: true,
          text: JSON.stringify(responseEnvelope({
            replyMarkdown: '先把方案停在文字审阅阶段；人物动机和镜头节奏是最值得看的两处。',
            suggestions: [
              { label: '判断能否继续', sendText: '只评价当前方案能否进入下一阶段，给出明确结论和最大风险，不提出修改也不生成。', intentKind: 'review-readiness', role: 'recommended', inputAssetIds: [] },
              { label: '看镜头节奏', sendText: '只从镜头节奏和情绪递进评价当前方案，不修改也不生成。', intentKind: 'review-shot-rhythm', role: 'alternative', inputAssetIds: [] },
              { label: '评价到此为止', sendText: '评价到此为止，保持现有方案，不修改也不生成。', intentKind: 'finish-review', role: 'execute', inputAssetIds: [] },
            ],
          })),
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '先把方案停在文字审阅阶段。',
          workingBrief,
          phaseDecision,
          suggestions: suggestionSet(['精修文字方案', '换个叙事视角', '直接生成图片']),
          proposedAction: null,
        }),
      };
    },
  });
  const repaired = await suggestionViolation.respond({ prompt: '只评价方案，不要生成', workingBrief });
  assert.equal(suggestionRepairCalls, 2);
  assert.match(JSON.stringify(suggestionRepairInput.messages), /只评价方案/u);
  assert.match(JSON.stringify(suggestionRepairInput.messages), /CREATOR_LLM_SUGGESTIONS_POLICY_INVALID/u);
  assert.equal(repaired.proposedAction, null);
  assert.equal(repaired.evidence.providerCalls, 2);
  assert.equal(repaired.suggestions.some((item) => /(?:直接|开始|立即|马上)(?:生成|出图|出视频|渲染)/u.test(item.sendText)), false);
  assert.match(repaired.suggestions[0].sendText, /只评价/u);
});

test('Creator LLM v2 asks the selected LLM to repair the full response instead of substituting fixed templates', () => {
  const runtimeSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../backend/src/services/creatorLlmRuntimeV2.js'),
    'utf8',
  );
  assert.match(runtimeSource, /function responseRepairSystemPrompt\(\)/);
  assert.match(runtimeSource, /userRequest: prompt/);
  assert.match(runtimeSource, /rejectedOutput: bounded\(result\.text/);
  assert.match(runtimeSource, /rejectionCode: responseError\.code/);
  assert.match(runtimeSource, /rejectionReason: responseError\.message/);
  assert.match(runtimeSource, /providerCalls \+= 1/);
  assert.match(runtimeSource, /必须重写全部三条/);
  assert.doesNotMatch(runtimeSource, /const fallbacks = english/);
});

test('Creator LLM v2 accepts English choices that repeat locked facts but perform three different jobs', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: 'Keep the camera almost still. She crosses the empty platform before dawn and leaves without looking back. Hold the final beats on the vacant station.',
          workingBrief: {
            goal: 'A restrained 20-second station film', format: '20-second film', audience: '',
            style: 'Still, restrained, pre-dawn blue', story: 'A woman leaves an empty station before dawn.',
            assets: '', constraints: 'No dialogue. Do not generate yet.', decisions: 'End on the empty platform.', openQuestion: '',
          },
          suggestions: [
            { label: 'Draft timed beats', sendText: 'Write a revisable 20-second beat sheet for the still wide version: her walk, the exit, then a hold on the empty platform.', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
            { label: 'Follow her coat close', sendText: 'Drop the still wide. Stay tight on her coat and breath as she leaves, so the station is only glimpsed around her.', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
            { label: 'Lock the empty ending', sendText: 'Lock the still-wide, no-dialogue, hold-on-emptiness plan and move to the next stage without generating.', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
          ],
        })),
      };
    },
  });
  const result = await runtime.respond({
    prompt: 'Plan a restrained 20-second station film in natural English. Do not ask questions, and do not generate yet.',
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.suggestions.map((item) => item.role), ['recommended', 'alternative', 'execute']);
});

test('Creator LLM v2 still rejects English paraphrases that do not change suggestion jobs', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: 'Keep the film restrained and hold on the empty platform.',
          suggestions: [
            { label: 'Draft timed beats', sendText: 'Write the 20-second shot list for the empty platform now.', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
            { label: 'Try the same draft', sendText: 'Write the same 20-second shot list for the empty platform with a little more detail.', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
            { label: 'Do it now', sendText: 'Write the 20-second shot list for the empty platform immediately.', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
          ],
        })),
      };
    },
  });
  await assert.rejects(
    () => runtime.respond({ prompt: 'Plan the film in English.' }),
    (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_POLICY_INVALID',
  );
  assert.equal(calls, 2);
});

test('Creator LLM v2 rejects generic English shortcut labels even when their send text is specific', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: 'Keep the camera wide and let the empty platform carry the final beat.',
          suggestions: [
            { label: 'Draft the 20s beats', sendText: 'Write a revisable timed beat sheet for the empty-platform version.', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
            { label: 'Follow her coat close', sendText: 'Change to a close viewpoint that follows her coat and footsteps to the exit.', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
            { label: 'Lock this approach', sendText: 'Lock the restrained empty-platform ending and move to the script stage.', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
          ],
        })),
      };
    },
  });
  await assert.rejects(
    () => runtime.respond({ prompt: 'Plan this film in natural English.' }),
    (error) => error?.code === 'CREATOR_LLM_SUGGESTIONS_POLICY_INVALID',
  );
  assert.equal(calls, 2);
});

test('Creator LLM v2 preserves the brief for feedback-only turns', async () => {
  const original = {
    goal: '完成雨夜品牌短片', format: '30 秒 16:9', audience: '年轻通勤者', style: '冷蓝电影感',
    story: '女主独自在站台等车。', assets: '女主参考图', constraints: '不要字幕',
    decisions: '列车暖灯是唯一高光', openQuestion: '',
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '这一版最强的是冷暖光关系，主要问题是人物动机还没有通过动作落到画面里。',
        workingBrief: { ...workingBrief, goal: '被模型误改', style: '治愈明亮', openQuestion: '要继续吗？' },
        phaseDecision,
        suggestions: [
          { label: '还不值得进分镜', sendText: '评价结论：这一版还不值得进入分镜，光线规则强，品牌落点弱。只下结论，不改也不生成。', intentKind: 'review-readiness', role: 'recommended', inputAssetIds: [] },
          { label: '看受众理解', sendText: '只从年轻通勤者能否读懂品牌意义的角度评价，不要改也不要生成。', intentKind: 'review-audience', role: 'alternative', inputAssetIds: [] },
          { label: '评价到此为止', sendText: '评价结束并保持现状，不修改剧本和设定，不生成任何内容。', intentKind: 'end-review', role: 'execute', inputAssetIds: [] },
        ],
        proposedAction: null,
      }),
    }),
  });
  const result = await runtime.respond({ prompt: '只评价这版，不要改也不要生成', workingBrief: original });
  assert.deepEqual(result.workingBrief, original);
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);
  assert.equal(result.proposedAction, null);
});

test('Creator LLM v2 accepts a natural feedback verdict with words between worth and advance', async () => {
  let calls = 0;
  const original = {
    goal: '完成雨夜品牌短片', format: '30 秒 16:9', audience: '年轻通勤者', style: '冷蓝电影感',
    story: '女主在雨夜站台等车后上车离开', assets: '女主参考图', constraints: '不要字幕', decisions: '列车灯是唯一暖色', openQuestion: '',
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '最强的是冷蓝雨夜里唯一的暖色列车灯，最弱的是人物动机仍然偏薄。只看现在这一版，视觉骨架已经成立。',
          workingBrief: original,
          suggestions: [
            { label: '值得进下一阶段', sendText: '只评价不修改：视觉已经够撑，值得按现有方向进入下一阶段。', intentKind: 'review-verdict', role: 'recommended', inputAssetIds: [] },
            { label: '换品牌视角再评', sendText: '不要改也不要生成，只从品牌记忆点的视角评价这一版。', intentKind: 'review-brand', role: 'alternative', inputAssetIds: [] },
            { label: '评价到此为止', sendText: '评价结束，保持现状，不修改也不生成任何内容。', intentKind: 'end-review', role: 'execute', inputAssetIds: [] },
          ],
        })),
      };
    },
  });
  const result = await runtime.respond({ prompt: '只评价这一版最强和最弱，不要改，也不要生成。', workingBrief: original });
  assert.equal(calls, 1);
  assert.deepEqual(result.workingBrief, original);
});

test('Creator LLM v2 changes only style for an explicit style-only correction', async () => {
  const original = {
    goal: '完成人物短片', format: '20 秒 9:16', audience: '城市青年', style: '温暖治愈',
    story: '女主在清晨走出便利店。', assets: '女主参考图', constraints: '无对白',
    decisions: '结尾停在街道远景', openQuestion: '',
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '风格改为冷峻克制，用硬质侧光和低饱和街景压住情绪。',
        workingBrief: {
          goal: '另做海报', format: '1:1', audience: '所有人', style: '冷峻克制；硬质侧光；低饱和',
          story: '被模型误改的故事', assets: '', constraints: '', decisions: '', openQuestion: '',
        },
        phaseDecision,
        suggestions: suggestionSet(['精修冷硬光线', '改用固定长镜头', '锁定冷峻风格']),
        proposedAction: null,
      }),
    }),
  });
  const result = await runtime.respond({
    prompt: '不是治愈，是冷峻；只改风格，其他不变，不要反问', workingBrief: original,
  });
  assert.match(result.workingBrief.style, /冷峻/u);
  for (const field of ['goal', 'format', 'audience', 'story', 'assets', 'constraints', 'decisions']) {
    assert.equal(result.workingBrief[field], original[field], `${field} must remain unchanged`);
  }
});

test('Creator LLM v2 follows the latest user language and rejects a mismatched explicit action type', async () => {
  let captured = null;
  const englishRuntime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, input) => {
      captured = input;
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: 'Keep the camera restrained and let the final empty frame carry the emotional turn.',
          workingBrief,
          phaseDecision,
          suggestions: suggestionSet(['Refine the opening beat', 'Try a tighter viewpoint', 'Lock the empty ending']),
          proposedAction: null,
        }),
      };
    },
  });
  const english = await englishRuntime.respond({ prompt: 'Plan a restrained 20-second station film in English. Do not ask me questions.' });
  assert.doesNotMatch(english.replyMarkdown, /\p{Script=Han}/u);
  assert.match(captured.messages.at(-1).content[0].text, /"replyLanguage":"English"/u);
  assert.match(String(captured.messages[0].content), /英文用户就全部用自然英文/u);

  const mismatched = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '画面会用冷蓝雨幕和暖色站台灯形成明确层次。',
        workingBrief,
        phaseDecision,
        suggestions: suggestionSet(['细化画面层次', '改用清晨光线', '锁定当前构图']),
        proposedAction: {
          type: 'video', prompt: '错误的视频动作', parameters: { ratio: '16:9', duration: 6, resolution: '720p' }, inputAssetIds: [],
        },
      }),
    }),
  });
  await assert.rejects(
    () => mismatched.respond({ prompt: '直接生成一张 16:9 的雨夜车站海报，不要反问' }),
    (error) => error?.code === 'CREATOR_LLM_ACTION_TYPE_MISMATCH',
  );
});

test('Creator working brief replaces an explicitly changed output constraint instead of keeping a contradiction', () => {
  const merged = mergeWorkingBrief(
    { ...workingBrief, constraints: '16:9 横屏；30 秒；不要字幕' },
    { ...workingBrief, constraints: '9:16 竖屏；30 秒；不要字幕' },
    turnPolicy('改成 9:16 竖屏，其他保持不变'),
    '改成 9:16 竖屏，其他保持不变',
  );
  assert.equal(merged.constraints, '9:16 竖屏；30 秒；不要字幕');
  assert.equal(merged.constraints.includes('16:9'), false);
});

test('Creator LLM v2 keeps every unrelated brief field when the user says only change the ending', async () => {
  const original = {
    goal: '完成一支品牌短片',
    format: '16:9 短片',
    audience: '年轻通勤者',
    style: '冷蓝电影感',
    story: '人物在雨夜等车，列车驶入后结束。',
    assets: '女主参考图；雨夜站台图',
    constraints: '总长 30 秒；不要字幕；人物造型保持一致',
    decisions: '暖色列车灯是唯一高光',
    openQuestion: '',
  };
  let scopedSuggestionCalls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      scopedSuggestionCalls += 1;
      if (scopedSuggestionCalls === 2) {
        return {
          ok: true,
          text: JSON.stringify(responseEnvelope({
            replyMarkdown: '结尾改为列车驶过后，女主独自站在空站台上，看见第一束晨光。',
            workingBrief: {
              ...original,
              story: '人物在雨夜等车；结尾是列车驶过后，她在空站台上看见晨光。',
            },
            suggestions: [
              { label: '细化结尾节奏', sendText: '只细化晨光结尾的镜头、节奏、表演、声音和转场，其他设定不动。', intentKind: 'refine-ending-craft', role: 'recommended', inputAssetIds: [] },
              { label: '换个结尾镜头', sendText: '保留晨光结论，改用站台远景和列车尾灯消失的镜头语言呈现。', intentKind: 'alternative-ending-shot', role: 'alternative', inputAssetIds: [] },
              { label: '锁定这个结尾', sendText: '锁定当前晨光结尾并进入下一环节，不再改动其他设定。', intentKind: 'lock-ending', role: 'execute', inputAssetIds: [] },
            ],
          })),
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '结尾改为列车驶过后，女主在空站台上看见晨光。',
          workingBrief: {
            goal: '另做一张海报', format: '1:1', audience: '所有人', style: '卡通',
            story: '人物在雨夜等车；结尾是列车驶过后，她在空站台上看见晨光。',
            assets: '', constraints: '', decisions: '', openQuestion: '',
          },
          phaseDecision,
          suggestions: suggestionSet(),
          proposedAction: null,
        }),
      };
    },
  });
  const result = await runtime.respond({ prompt: '只改结尾，其他设定和约束全部不变', workingBrief: original });
  assert.equal(scopedSuggestionCalls, 2);
  assert.equal(result.evidence.providerCalls, 2);
  assert.match(result.workingBrief.story, /晨光/u);
  assert.match(result.suggestions[0].sendText, /镜头|节奏|表演|声音|转场/u);
  assert.doesNotMatch(result.suggestions[0].sendText, /完整.{0,8}(?:脚本|分镜)/u);
  for (const field of ['goal', 'format', 'audience', 'style', 'assets', 'constraints', 'decisions']) {
    assert.equal(result.workingBrief[field], original[field], `${field} must remain unchanged`);
  }
});

test('Creator LLM v2 reduces a critical ambiguity to one visible question', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(calls === 1
          ? responseEnvelope({
            replyMarkdown: '你希望主角最终离开吗？还是留下来？结尾要开放式吗？',
            workingBrief: { ...workingBrief, openQuestion: '主角离开吗？还是留下来？' },
          })
          : responseEnvelope({
            replyMarkdown: '我倾向让主角离开，因为这能把前面的犹豫收成一个真正的决定。主角决定离开的那一刻，哪件事最不能被牺牲？',
            workingBrief: { ...workingBrief, openQuestion: '主角决定离开的那一刻，哪件事最不能被牺牲？' },
            suggestions: [
              { label: '先试离开那一幕', sendText: '不要写完整大纲或脚本，先只写主角决定离开的一个最小样段，用这个小样验证告别的分量是否成立。', intentKind: 'test-leaving-moment', role: 'recommended', inputAssetIds: [] },
              { label: '保留未完成动作', sendText: '不直接解释去留，换成一个未完成的动作来承载关系的余温。', intentKind: 'alternate-open-action', role: 'alternative', inputAssetIds: [] },
              { label: '锁定离开结局', sendText: '锁定主角最终离开的方向，不再讨论结局，进入下一环节。', intentKind: 'lock-leaving-ending', role: 'execute', inputAssetIds: [] },
            ],
          })),
      };
    },
  });
  const result = await runtime.respond({ prompt: '我还没想好主角最终是否离开', workingBrief });
  assert.equal(calls, 2);
  assert.equal((result.replyMarkdown.match(/[?？]/gu) || []).length, 1);
  assert.equal((result.workingBrief.openQuestion.match(/[?？]/gu) || []).length, 1);
  assert.equal(result.workingBrief.openQuestion, '主角决定离开的那一刻，哪件事最不能被牺牲？');
  assert.match(result.replyMarkdown, /主角决定离开/u);
  assert.match(result.suggestions[0].sendText, /验证/u);
});

test('Creator LLM v2 recognizes one explicitly bounded key scene as a valid critical-choice probe', async () => {
  let calls = 0;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '我倾向让他们彻底分开，因为和解会抹平已经发生的伤害。对门口停住的两个人来说，哪件已经发生的事最不能被结尾改写？',
          workingBrief: { ...workingBrief, openQuestion: '对门口停住的两个人来说，哪件已经发生的事最不能被结尾改写？' },
          suggestions: [
            { label: '先写门口那场戏', sendText: '按彻底分开的倾向，先只写他们最后一次在门口停住的那场关键戏，先不要完整短片大纲，这场戏我还要继续改。', intentKind: 'test-doorway-scene', role: 'recommended', inputAssetIds: [] },
            { label: '换成单人视角', sendText: '换个视角，只贴着那个不再追问的人来讲，看他何时停止替对方补完半句话。', intentKind: 'single-view-alternative', role: 'alternative', inputAssetIds: [] },
            { label: '锁定分开往下', sendText: '锁定彻底分开这个结尾，不再讨论和解，按这个方向进入下一步。', intentKind: 'lock-separation', role: 'execute', inputAssetIds: [] },
          ],
        })),
      };
    },
  });
  const result = await runtime.respond({ prompt: '结尾和解还是分开我还没想好，这会改变整支片。', workingBrief });
  assert.equal(calls, 1);
  assert.match(result.suggestions[0].sendText, /那场关键戏/u);
});

test('Creator LLM v2 sends only the authoritative current-scene pack and binds its ScenePatch', async () => {
  let capturedRequest = null;
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    scriptId: 'script_test',
    workId: 'cw_test',
    baseWorkRevision: 7,
    baseWorkDigest: 'a'.repeat(64),
    sceneId: 'scene_current_001',
    scenePartId: 'scene_part_current_001',
    scenePartIndex: 1,
    scenePartCount: 4,
    baseSceneRevision: 3,
    sourceRef: { documentVersionId: 'source_test', span: { start: 0, end: 40 }, digest: 'b'.repeat(64) },
    userIntent: '只细化当前场',
    allowedPaths: ['purpose', 'objective', 'activeEntityIds', 'exitState', 'status'],
    scene: { title: '雨夜车站', sourceText: '林溪握着旧车票等车。', purpose: '', objective: '', status: 'draft' },
    activeEntities: [],
    styleCanon: { palette: '冷蓝，唯一暖光来自列车' },
    unknowns: [],
    contextDigest: 'c'.repeat(64),
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      capturedRequest = request;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '这一场只收紧林溪等车的目标，让旧车票成为她是否离开的最后阻力。',
          suggestions: suggestionSet(['细化等车动作', '换成周野视角', '锁定车票阻力']),
          scenePatch: {
            schema: 't8-creator-scene-patch-v1',
            sceneId: sceneContext.sceneId,
            scenePartId: sceneContext.scenePartId,
            baseWorkRevision: sceneContext.baseWorkRevision,
            baseSceneRevision: sceneContext.baseSceneRevision,
            contextDigest: sceneContext.contextDigest,
            patch: { purpose: '建立离开与留下的选择', objective: '等到最后一班列车', status: 'draft' },
            entityProposals: [],
            conflicts: [],
          },
        })),
      };
    },
  });
  const result = await runtime.respond({
    prompt: '只细化当前场',
    history: [
      { role: 'user', body: '另一场发生在清晨天台。', status: 'completed' },
      { role: 'assistant', body: '另一场出现了周野。', status: 'completed' },
    ],
    sceneContext,
  });
  assert.equal(result.scenePatch.sceneId, sceneContext.sceneId);
  assert.equal(result.scenePatch.scenePartId, sceneContext.scenePartId);
  assert.equal(result.scenePatch.baseWorkRevision, 7);
  assert.equal(result.evidence.sceneContextDigest, sceneContext.contextDigest);
  assert.equal(capturedRequest.messages.length, 2);
  assert.equal(capturedRequest.max_tokens, 2_200);
  assert.equal(capturedRequest.temperature, 0.35);
  assert.equal(capturedRequest.stream, true);
  const sceneSystem = String(capturedRequest.messages[0]?.content || '');
  assert.match(sceneSystem, /Creator Agent 的逐场创作搭档/u);
  assert.match(sceneSystem, /当前长剧本场次上下文是本轮唯一权威来源/u);
  assert.match(sceneSystem, /只处理当前 scenePartId/u);
  assert.match(sceneSystem, /恰好三个不同建议/u);
  assert.doesNotMatch(sceneSystem, /你会收到实际图片或视频抽帧/u);
  assert.ok(sceneSystem.length < 6_500, `scene system prompt should stay concise, got ${sceneSystem.length} chars`);
  const serialized = JSON.stringify(capturedRequest.messages);
  assert.match(serialized, /雨夜车站/u);
  assert.doesNotMatch(serialized, /清晨天台/u);
  assert.doesNotMatch(serialized, /另一场出现了周野/u);
});

test('Creator LLM v2 scene mode returns one complete persisted draft for a short idea in one provider call', async () => {
  let capturedRequest = null;
  const draftText = '外景·末班车站·雨夜\n\n雨水沿站牌往下淌。林夏站在唯一亮着的路灯下，鞋边积水被风吹出细纹。她攥着一张已经发软的单程票，手机屏幕一次次亮起，“妈”的名字把她的指节照得发白。\n\n广播：开往北城的末班车即将进站。\n\n林夏按下接听，却没有说话。听筒里传来碗筷碰撞声，母亲问她什么时候回家。林夏望向街口，父亲那辆旧摩托停在雨里，车上没有人。\n\n她说：我今晚不回去了。\n\n电话那头安静下来。远处铁轨震动，积水里的灯影被切成两半。林夏把想说的话咽回去，挂断电话，又立刻重新拨出。\n\n她说：等我安顿好，会给你地址。\n\n车灯穿过雨幕。列车还没有完全停稳，林夏便提起箱子走向车门。她在黄线前停了一秒，把返程车票从夹层抽出来，撕成两半，纸片被雨水压在站台上。\n\n车门打开。她跨过黄线，没有回头。手机在口袋里再次亮起，这一次她没有关机。';
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    mode: 'scene-draft',
    scriptId: 'script_short_scene',
    workId: null,
    baseWorkRevision: 0,
    baseWorkDigest: null,
    sceneId: 'scene_short_001',
    scenePartId: 'scene_part_short_001',
    scenePartIndex: 0,
    scenePartCount: 1,
    baseSceneRevision: 1,
    sourceRef: { documentVersionId: 'source_short', span: { start: 0, end: 24 }, digest: 'b'.repeat(64) },
    sourcePartRef: { scenePartId: 'scene_part_short_001', index: 0, total: 1, span: { start: 0, end: 24 }, digest: 'd'.repeat(64) },
    userIntent: '一个女孩在雨夜末班车站，终于决定离开家乡。',
    allowedPaths: ['draftText', 'purpose', 'status', 'activeEntityIds'],
    requiredPaths: ['draftText'],
    requiredContinuityTerms: [],
    requiredContinuitySubjectNames: [],
    requiredContinuityBySubject: [],
    scene: { title: '雨夜末班车站', sourceText: '一个女孩在雨夜末班车站，终于决定离开家乡。', draftText: '', status: 'draft' },
    activeEntities: [],
    mentionedEntities: [],
    relationships: [],
    styleCanon: null,
    unknowns: [],
    contextDigest: 'c'.repeat(64),
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      capturedRequest = request;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: draftText,
          phaseDecision: { phase: 'script', transition: 'stay', reason: '正在完成当前场' },
          suggestions: suggestionSet(['细化离站动作', '改成车内视角', '锁定雨夜场稿']),
          scenePatch: {
            schema: 't8-creator-scene-patch-v1',
            sceneId: sceneContext.sceneId,
            scenePartId: sceneContext.scenePartId,
            baseWorkRevision: 0,
            baseSceneRevision: 1,
            contextDigest: sceneContext.contextDigest,
            patch: {
              draftText,
              purpose: '让离开成为不可逆的动作',
              status: 'draft',
              activeEntityIds: ['char_001'],
              // Some OpenAI-compatible models place these beside draft fields
              // even though the public contract makes them scenePatch peers.
              // Runtime canonicalization keeps the user's valid draft instead
              // of spending a second provider call on a mechanical JSON repair.
              entityProposals: [{
                tempId: 'char_001',
                kind: 'character',
                name: '林夏',
                description: '在雨夜赶末班车的年轻女孩',
                baseline: { name: '林夏' },
              }],
            },
            entityProposals: [],
            relationshipProposals: [],
            conflicts: [],
          },
        })),
      };
    },
  });
  const result = await runtime.respond({ prompt: sceneContext.userIntent, sceneContext });
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.replyMarkdown, draftText);
  assert.equal(result.scenePatch.patch.draftText, draftText);
  assert.equal(result.scenePatch.entityProposals.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.scenePatch.patch, 'entityProposals'), false);
  assert.equal(result.evidence.modelId, 'qwen/qwen3.7-max');
  assert.equal(capturedRequest.model, 'qwen/qwen3.7-max');
  assert.equal(capturedRequest.max_tokens, 4_000);
  assert.equal(capturedRequest.temperature, 0.45);
  const sceneDraftSystem = String(capturedRequest.messages[0]?.content || '');
  assert.match(sceneDraftSystem, /无论想法多短/u);
  assert.match(sceneDraftSystem, /明确的人物关系、事件、结果方向、数量、时长、先后关系和否定约束都是硬条件/u);
  assert.match(sceneDraftSystem, /不能为了制造反转而改成相反结果/u);
  assert.match(sceneDraftSystem, /不能额外增加同类人物或物品改变明确计数/u);
  assert.match(sceneDraftSystem, /换成盒、瓶等近义量词也不等于可以再拿第二个/u);
  assert.match(sceneDraftSystem, /全文搜索“第二、另一、又一、再拿、各自、每人”/u);
  assert.match(sceneDraftSystem, /双方共同接受一个很小但清楚的下一步/u);
  assert.match(sceneDraftSystem, /通常不再增加第二个象征道具/u);
  assert.match(sceneDraftSystem, /不要堆叠象征道具、刻意摆拍/u);
  assert.match(sceneDraftSystem, /常见机位/u);
});

test('Creator LLM v2 repairs a scene draft that expands an explicitly single physical prop', async () => {
  const requestText = '一名夜班护士偶遇弟弟，只用一杯热豆浆把关系往前推一步。不要生成图片或视频。';
  const badDraft = [
    '凌晨便利店只剩收银台上方一盏灯。姐姐推门进来，看见弟弟站在热饮柜旁，先把最后一杯热豆浆放到两人中间。',
    '弟弟把手缩回袖口，盯着杯盖冒出的白气。姐姐没问他为什么回来，只把吸管拆开，沿着桌面推过去。',
    '他没有接。姐姐转身去拿第二盒，放进微波炉加热。机器的转盘响了三十秒，两个人仍隔着货架。',
    '弟弟终于拿起第一杯，低声问她几点下班。姐姐把胸牌翻到背面，说还有一个小时。',
    '门外送货车倒车，白光扫过玻璃。弟弟把杯子往她那边推回一点，给她留出喝的位置。',
    '姐姐扶住杯底，没有推开。两人的手隔着纸杯停了一秒，随后并肩站到窗边，看着天色慢慢发白。',
  ].join('\n\n');
  const repairedDraft = [
    '凌晨便利店只剩收银台上方一盏灯。姐姐推门进来，看见弟弟站在热饮柜旁，便把最后一杯热豆浆放到两人中间。',
    '弟弟把手缩回袖口，盯着杯盖冒出的白气。姐姐没问他为什么回来，只把吸管拆开，沿着桌面推过去。',
    '他没有接。微波炉在柜台后空转着报时，机器响了三十秒，两个人仍隔着货架。姐姐把那杯豆浆又往前推了一寸。',
    '弟弟终于拿起来，低声问她几点下班。姐姐把胸牌翻到背面，说还有一个小时。他喝了一口，把杯沿擦干净。',
    '门外送货车倒车，白光扫过玻璃。弟弟把同一杯豆浆往她那边推回一点，给她留出喝的位置。',
    '姐姐扶住杯底，没有推开。两人的手隔着纸杯停了一秒，随后并肩站到窗边，轮流喝着那杯豆浆，看天色慢慢发白。',
  ].join('\n\n');
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1', mode: 'scene-draft', scriptId: 'script_single_prop', workId: null,
    baseWorkRevision: 0, baseWorkDigest: null, sceneId: 'scene_single_prop', scenePartId: 'scene_part_single_prop',
    scenePartIndex: 0, scenePartCount: 1, baseSceneRevision: 1,
    sourceRef: { documentVersionId: 'source_single_prop', span: { start: 0, end: requestText.length }, digest: 'b'.repeat(64) },
    sourcePartRef: { scenePartId: 'scene_part_single_prop', index: 0, total: 1, span: { start: 0, end: requestText.length }, digest: 'd'.repeat(64) },
    userIntent: requestText, allowedPaths: ['draftText'], requiredPaths: ['draftText'],
    requiredContinuityTerms: [], requiredContinuitySubjectNames: [], requiredContinuityBySubject: [],
    scene: { title: '便利店重逢', sourceText: requestText, draftText: '', status: 'draft' },
    activeEntities: [], mentionedEntities: [], relationships: [], styleCanon: null, unknowns: [], contextDigest: 'c'.repeat(64),
  };
  const requests = [];
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      requests.push(request);
      const replyMarkdown = requests.length === 1 ? badDraft : repairedDraft;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown,
          phaseDecision: { phase: 'script', transition: 'stay', reason: '完成当前场' },
          suggestions: suggestionSet(['细化沉默动作', '换成弟弟视角', '锁定豆浆结尾']),
          scenePatch: {
            schema: 't8-creator-scene-patch-v1', sceneId: sceneContext.sceneId, scenePartId: sceneContext.scenePartId,
            baseWorkRevision: 0, baseSceneRevision: 1, contextDigest: sceneContext.contextDigest,
            patch: { draftText: replyMarkdown }, entityProposals: [], relationshipProposals: [], conflicts: [],
          },
        })),
      };
    },
  });
  const result = await runtime.respond({ prompt: requestText, sceneContext });
  assert.equal(result.evidence.providerCalls, 2);
  assert.equal(result.replyMarkdown, repairedDraft);
  assert.doesNotMatch(result.replyMarkdown, /第二盒/u);
  assert.match(JSON.stringify(requests[1].messages), /用户明确限定整场只使用一个实物/u);

  const unrelatedPluralDraft = repairedDraft.replace(
    '弟弟把手缩回袖口，盯着杯盖冒出的白气。',
    '弟弟把手缩回袖口，盯着杯盖冒出的白气。旁边顾客拿着两盒泡面走向收银台。',
  );
  let unrelatedCalls = 0;
  const unrelatedRuntime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => {
      unrelatedCalls += 1;
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: unrelatedPluralDraft,
          phaseDecision: { phase: 'script', transition: 'stay', reason: '完成当前场' },
          suggestions: suggestionSet(['细化沉默动作', '换成弟弟视角', '锁定豆浆结尾']),
          scenePatch: {
            schema: 't8-creator-scene-patch-v1', sceneId: sceneContext.sceneId, scenePartId: sceneContext.scenePartId,
            baseWorkRevision: 0, baseSceneRevision: 1, contextDigest: sceneContext.contextDigest,
            patch: { draftText: unrelatedPluralDraft }, entityProposals: [], relationshipProposals: [], conflicts: [],
          },
        })),
      };
    },
  });
  const unrelatedResult = await unrelatedRuntime.respond({ prompt: requestText, sceneContext });
  assert.equal(unrelatedCalls, 1);
  assert.match(unrelatedResult.replyMarkdown, /两盒泡面/u);
});

test('Creator LLM v2 locks an explicit whole-work style and prevents scene-level style drift', () => {
  const imported = mergeWorkingBrief(
    {},
    { ...workingBrief, style: '' },
    { sceneScoped: true },
    '全剧风格固定为潮湿冷蓝现实主义。只处理当前场。',
  );
  assert.equal(imported.style, '潮湿冷蓝现实主义');

  const retained = mergeWorkingBrief(
    imported,
    { ...workingBrief, style: '暖橙轻喜剧' },
    { sceneScoped: true },
    '只细化当前场的动作，不要改其他内容。',
  );
  assert.equal(retained.style, '潮湿冷蓝现实主义');

  const explicitlyChanged = mergeWorkingBrief(
    retained,
    { ...workingBrief, style: '' },
    { sceneScoped: true },
    '把全剧风格改成黑白纪实。',
  );
  assert.equal(explicitlyChanged.style, '黑白纪实');
});

test('Creator LLM v2 keeps import preview read-only and repairs an eager scene patch', async () => {
  const requests = [];
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    mode: 'import-preview',
    scriptId: 'script_import_preview',
    workId: null,
    baseWorkRevision: 0,
    baseWorkDigest: null,
    sceneId: 'scene_import_preview',
    baseSceneRevision: 1,
    sourceRef: { documentVersionId: 'source_import', span: { start: 0, end: 20 }, digest: 'b'.repeat(64) },
    userIntent: '导入两场剧本，先不要修改场次。',
    allowedPaths: ['purpose', 'status'],
    requiredPaths: [],
    requiredContinuityTerms: [],
    requiredContinuitySubjectNames: [],
    scene: { title: '雨夜车站', sourceText: '林溪等待列车。', status: 'draft' },
    activeEntities: [],
    mentionedEntities: [],
    styleCanon: null,
    unknowns: [],
    contextDigest: 'c'.repeat(64),
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      requests.push(request);
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '剧本已按原顺序整理好，先从雨夜车站开始。',
          suggestions: suggestionSet(['细化雨夜目标', '换个场内视角', '锁定顺序继续']),
          scenePatch: requests.length === 1 ? {
            schema: 't8-creator-scene-patch-v1',
            sceneId: sceneContext.sceneId,
            baseWorkRevision: 0,
            baseSceneRevision: 1,
            contextDigest: sceneContext.contextDigest,
            patch: { purpose: '提前修改' },
            entityProposals: [],
            conflicts: [],
          } : null,
        })),
      };
    },
  });
  const result = await runtime.respond({ prompt: sceneContext.userIntent, sceneContext });
  assert.equal(result.scenePatch, null);
  assert.equal(result.evidence.providerCalls, 2);
  assert.match(String(requests[1].messages[2]?.content || ''), /首次导入预览，scenePatch 必须为 null/u);
});

test('Creator LLM v2 repairs a missing explicitly requested scene exit state before commit', async () => {
  const requests = [];
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    scriptId: 'script_exit_state',
    workId: 'cw_exit_state',
    baseWorkRevision: 3,
    baseWorkDigest: 'a'.repeat(64),
    sceneId: 'scene_exit_state',
    baseSceneRevision: 1,
    sourceRef: { documentVersionId: 'source_exit', span: { start: 0, end: 20 }, digest: 'b'.repeat(64) },
    userIntent: '本场结束时林溪仍穿黑色风衣并握着旧车票。',
    allowedPaths: ['activeEntityIds', 'exitState', 'status'],
    requiredPaths: ['exitState'],
    requiredContinuityTerms: ['黑色风衣', '旧车票'],
    requiredContinuitySubjectNames: ['林溪'],
    scene: { title: '雨夜车站', sourceText: '林溪等待列车。', status: 'draft' },
    activeEntities: [{ entityId: 'entity-linxi', baseline: { name: '林溪' }, entry: null }],
    mentionedEntities: [],
    styleCanon: null,
    unknowns: [],
    contextDigest: 'c'.repeat(64),
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, request) => {
      requests.push(request);
      const scenePatch = {
        schema: 't8-creator-scene-patch-v1',
        sceneId: sceneContext.sceneId,
        baseWorkRevision: sceneContext.baseWorkRevision,
        baseSceneRevision: sceneContext.baseSceneRevision,
        contextDigest: sceneContext.contextDigest,
        patch: {
          activeEntityIds: ['entity-linxi'],
          exitState: requests.length === 1
            ? { 'entity-linxi': '仍穿黑色风衣并握着旧车票' }
            : { 'entity-linxi': { wardrobe: '黑色风衣', prop: '旧车票' } },
          status: 'draft',
        },
        entityProposals: [],
        conflicts: [],
      };
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '林溪离场时仍保留黑色风衣和旧车票，这两项会继续约束后续重现。',
          suggestions: suggestionSet(['细化离场动作', '换成车内目送', '锁定离场状态']),
          scenePatch,
        })),
      };
    },
  });
  const result = await runtime.respond({
    prompt: sceneContext.userIntent,
    sceneContext,
  });
  assert.equal(result.evidence.providerCalls, 2);
  assert.match(JSON.stringify(result.scenePatch.patch.exitState), /黑色风衣/u);
  assert.match(String(requests[1].messages[2]?.content || ''), /每个实体值必须是 JSON 对象/u);
});

test('Creator LLM v2 keeps the requested transport mode for scene repair', async () => {
  const streams = [];
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    stream: false,
    generateChat: async (_provider, request) => {
      streams.push(request.stream);
      if (streams.length === 1) {
        return { ok: true, text: '{"schema":"wrong"}' };
      }
      return {
        ok: true,
        text: JSON.stringify(responseEnvelope({
          replyMarkdown: '这一场先明确人物必须在列车到站前作出选择。',
          suggestions: suggestionSet(['细化到站选择', '换成车内视角', '锁定这场继续']),
          scenePatch: null,
        })),
      };
    },
  });
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    scriptId: 'script_test',
    workId: 'cw_test',
    baseWorkRevision: 7,
    baseWorkDigest: 'a'.repeat(64),
    sceneId: 'scene_current_001',
    baseSceneRevision: 3,
    sourceRef: { documentVersionId: 'source_test', span: { start: 0, end: 40 }, digest: 'b'.repeat(64) },
    userIntent: '只细化当前场',
    allowedPaths: ['purpose', 'objective', 'status'],
    scene: { title: '雨夜车站', sourceText: '林溪握着旧车票等车。', status: 'draft' },
    activeEntities: [],
    styleCanon: { palette: '冷蓝，唯一暖光来自列车' },
    unknowns: [],
    contextDigest: 'c'.repeat(64),
  };
  const result = await runtime.respond({ prompt: '只细化当前场', sceneContext });
  assert.deepEqual(streams, [false, false]);
  assert.equal(result.evidence.providerCalls, 2);
});

test('Creator LLM v2 rejects final generation prompts that leak internal scene state', async () => {
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '雨夜站台的动作已经收紧，可以生成这一镜。',
        suggestions: suggestionSet(['细化雨夜动作', '换成车内视角', '锁定当前镜头']),
        proposedAction: {
          type: 'video',
          prompt: '雨夜站台，scene_current_001，沿用 entryRefs 和 exitState 生成视频',
          parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
          inputAssetIds: [],
        },
      })),
    }),
  });
  await assert.rejects(
    () => runtime.respond({ prompt: '生成这一镜视频' }),
    (error) => error?.code === 'CREATOR_LLM_ACTION_CONTEXT_LEAK',
  );
});

test('Creator LLM v2 binds a current-scene generation to its exact private work context', async () => {
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    scriptId: 'script_action_binding',
    workId: 'work_action_binding',
    baseWorkRevision: 12,
    baseWorkDigest: 'd'.repeat(64),
    sceneId: 'scene_action_binding',
    scenePartId: 'scene_part_action_binding',
    scenePartIndex: 0,
    scenePartCount: 1,
    baseSceneRevision: 5,
    sourceRef: { documentVersionId: 'source_action_binding', span: { start: 0, end: 20 }, digest: 'e'.repeat(64) },
    userIntent: '生成当前场的一张关键帧图片。',
    allowedPaths: ['purpose', 'status'],
    requiredPaths: [],
    requiredContinuityTerms: [],
    requiredContinuitySubjectNames: [],
    requiredContinuityBySubject: [],
    scene: { title: '雨夜车站', sourceText: '林溪站在最后一班列车前。', status: 'draft' },
    activeEntities: [], mentionedEntities: [], relationships: [], styleCanon: null, unknowns: [],
    contextDigest: 'f'.repeat(64),
  };
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '关键帧只保留雨夜站台、林溪和最后一班列车，画面会更集中。',
        suggestions: suggestionSet(['细化站台动作', '换成车内视角', '锁定关键帧']),
        scenePatch: null,
        proposedAction: {
          type: 'image', prompt: '雨夜站台，林溪站在最后一班列车前，冷蓝环境，暖色车灯',
          parameters: { ratio: '16:9', count: 1 }, inputAssetIds: [],
        },
      })),
    }),
  });
  const result = await runtime.respond({ prompt: sceneContext.userIntent, sceneContext });
  assert.deepEqual(result.proposedAction.workBinding, {
    schema: 't8-creator-scene-action-binding-v1',
    workId: sceneContext.workId,
    workRevision: sceneContext.baseWorkRevision,
    workDigest: sceneContext.baseWorkDigest,
    sceneId: sceneContext.sceneId,
    scenePartId: sceneContext.scenePartId,
    sceneRevision: sceneContext.baseSceneRevision,
    contextDigest: sceneContext.contextDigest,
  });
  assert.equal(result.proposedAction.prompt.includes(sceneContext.sceneId), false);
});

test('Creator LLM v2 normalizes five current-scene shots and only accepts existing stable shot IDs', async () => {
  const sceneContext = {
    schema: 't8-creator-scene-context-pack-v1',
    scriptId: 'script_five_shots', workId: 'work_five_shots',
    baseWorkRevision: 8, baseWorkDigest: 'a'.repeat(64),
    sceneId: 'scene_five_shots', scenePartId: 'scene_part_five_shots',
    scenePartIndex: 0, scenePartCount: 1, baseSceneRevision: 3,
    sourceRef: { documentVersionId: 'source_five_shots', span: { start: 0, end: 20 }, digest: 'b'.repeat(64) },
    userIntent: '把当前场生成五个连续视频镜头。',
    allowedPaths: ['purpose', 'status'], requiredPaths: [],
    requiredContinuityTerms: [], requiredContinuitySubjectNames: [], requiredContinuityBySubject: [],
    scene: { title: '雨夜车站', sourceText: '林溪看见最后一班列车进站。', status: 'draft' },
    activeEntities: [], mentionedEntities: [], relationships: [], styleCanon: null, unknowns: [],
    currentShotPlan: {
      schema: 't8-creator-scene-production-v1', planDigest: 'c'.repeat(64),
      shots: [
        { shotId: 'shot_existing_wide', ordinal: 1, title: '站台全景', prompt: '旧全景' },
        { shotId: 'shot_existing_face', ordinal: 2, title: '人物近景', prompt: '旧近景' },
      ],
    },
    contextDigest: 'd'.repeat(64),
  };
  const proposedShots = Array.from({ length: 5 }, (_, index) => ({
    shotId: index === 0 ? 'shot_existing_wide' : index === 1 ? 'shot_existing_face' : null,
    sourceKey: `beat-${index + 1}`,
    title: `镜头 ${index + 1}`,
    purpose: `完成节拍 ${index + 1}`,
    prompt: `雨夜站台第 ${index + 1} 镜，林溪与列车保持连续。`,
    parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
    inputAssetIds: [],
  }));
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '这场拆成五个连续镜头，从站台空间推进到人物决定。',
        suggestions: suggestionSet(['细化列车进站', '换成车内视角', '锁定五镜继续']),
        proposedAction: {
          type: 'video', prompt: '雨夜站台五镜连续段落',
          parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
          inputAssetIds: [], shots: proposedShots,
        },
      })),
    }),
  });
  const result = await runtime.respond({ prompt: sceneContext.userIntent, sceneContext });
  assert.equal(result.proposedAction.shots.length, 5);
  assert.deepEqual(result.proposedAction.shots.slice(0, 2).map((shot) => shot.shotId), [
    'shot_existing_wide', 'shot_existing_face',
  ]);
  assert.ok(result.proposedAction.shots.slice(2).every((shot) => shot.shotId === null));
  assert.ok(result.proposedAction.shots.every((shot) => shot.parameters.resolution === '720p'));

  const rejectingRuntime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '这场仍按五镜推进。',
        suggestions: suggestionSet(['细化列车进站', '换成车内视角', '锁定五镜继续']),
        proposedAction: {
          type: 'video', prompt: '雨夜站台五镜连续段落',
          parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
          inputAssetIds: [],
          shots: [{ ...proposedShots[0], shotId: 'shot_invented_by_model' }],
        },
      })),
    }),
  });
  await assert.rejects(
    () => rejectingRuntime.respond({ prompt: sceneContext.userIntent, sceneContext }),
    (error) => error?.code === 'CREATOR_LLM_ACTION_INVALID',
  );
});

test('Creator LLM v2 uses selected-model defaults and rejects a model switch that would lose references', async () => {
  const preferences = {
    video: { providerId: 'seedance-nz', modelId: 'hailuo-h3-max-t2v' },
  };
  const validRuntime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '镜头会从空站台缓慢推进到列车灯光。',
        suggestions: suggestionSet(['细化列车入站', '换成高位俯拍', '锁定这个镜头']),
        proposedAction: {
          type: 'video',
          prompt: '雨夜空站台，列车暖光由远及近，缓慢推进镜头',
          parameters: {},
          inputAssetIds: [],
        },
      })),
    }),
  });
  const valid = await validRuntime.respond({ prompt: '生成这一镜视频', preferences });
  assert.deepEqual(valid.proposedAction.parameters, {
    ratio: '16:9',
    duration: 5,
    resolution: '480P',
  });

  const lossyPreferences = {
    video: { providerId: 'seedance-nz', modelId: 'hailuo-h3-i2v' },
  };
  const lossyRuntime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify(responseEnvelope({
        replyMarkdown: '会保留现有素材的动作和声音继续生成。',
        suggestions: suggestionSet(['细化动作节奏', '换成侧面跟拍', '锁定当前镜头']),
        proposedAction: {
          type: 'video',
          prompt: '角色在雨夜站台奔跑，镜头平稳跟随',
          parameters: { duration: 5, resolution: '768P' },
          inputAssetIds: ['asset-image', 'asset-video', 'asset-audio'],
        },
      })),
    }),
  });
  await assert.rejects(
    () => lossyRuntime.respond({
      prompt: '用这些素材生成视频',
      preferences: lossyPreferences,
      attachments: [
        { assetId: 'asset-image', kind: 'image', title: '首帧' },
        { assetId: 'asset-video', kind: 'video', title: '动作参考' },
        { assetId: 'asset-audio', kind: 'audio', title: '对白参考' },
      ],
    }),
    (error) => error?.code === 'CREATOR_LLM_ACTION_MODEL_MISMATCH',
  );
});
