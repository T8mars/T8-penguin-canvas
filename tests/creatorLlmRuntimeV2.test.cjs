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
  assert.match(observed.systemPrompt, /alternative 可以改变表现方法/u);
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
  let captured = null;
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async (_provider, input) => {
      captured = input;
      return {
        ok: true,
        text: JSON.stringify({
          schema: CREATOR_LLM_RESPONSE_SCHEMA,
          replyMarkdown: '你更喜欢冷色还是暖色？我直接采用冷蓝环境配暖色主体光，画面会更有层次。',
          workingBrief: { ...workingBrief, openQuestion: '你更喜欢冷色还是暖色？' },
          phaseDecision,
          suggestions: suggestionSet(),
          proposedAction: null,
        }),
      };
    },
  });
  const result = await runtime.respond({ prompt: '你决定吧，直接给我最好的方案', workingBrief });
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);
  assert.equal(result.workingBrief.openQuestion, '');
  assert.match(result.replyMarkdown, /直接采用冷蓝/u);
  assert.match(captured.messages.at(-1).content[0].text, /"delegated":true/u);
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

  const english = turnPolicy('Keep this in restrained English and do not ask me another question.');
  assert.equal(english.replyLanguage, 'English');
  assert.equal(english.maxQuestions, 0);
});

test('Creator LLM v2 prevents generation when the user explicitly says not to generate', async () => {
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '先把人物动机和最后一个镜头收紧，画面方案保持在可审阅状态。',
        workingBrief,
        phaseDecision,
        suggestions: suggestionSet(['精修人物动机', '改用主观视角', '保留当前方案']),
        proposedAction: {
          type: 'image',
          prompt: '不应执行的图片动作',
          parameters: { ratio: '16:9', count: 1 },
          inputAssetIds: [],
        },
      }),
    }),
  });
  const result = await runtime.respond({ prompt: '先不要生成图片或视频，只把方案改好，不要反问', workingBrief });
  assert.equal(result.proposedAction, null);
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);

  const suggestionViolation = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '先把方案停在文字审阅阶段。',
        workingBrief,
        phaseDecision,
        suggestions: suggestionSet(['精修文字方案', '换个叙事视角', '直接生成图片']),
        proposedAction: null,
      }),
    }),
  });
  const repaired = await suggestionViolation.respond({ prompt: '只评价方案，不要生成', workingBrief });
  assert.equal(repaired.proposedAction, null);
  assert.equal(/(?:生成|出图|出视频|渲染)/u.test(repaired.suggestions.map((item) => item.sendText).join('\n')), false);
  assert.match(repaired.suggestions[0].sendText, /只评价/u);
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
        suggestions: suggestionSet(['看人物动机', '看镜头节奏', '保留这版判断']),
        proposedAction: null,
      }),
    }),
  });
  const result = await runtime.respond({ prompt: '只评价这版，不要改也不要生成', workingBrief: original });
  assert.deepEqual(result.workingBrief, original);
  assert.equal(/[?？]/u.test(result.replyMarkdown), false);
  assert.equal(result.proposedAction, null);
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
          suggestions: suggestionSet(['Refine the opening beat', 'Try a tighter viewpoint', 'Lock this direction']),
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
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
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
    }),
  });
  const result = await runtime.respond({ prompt: '只改结尾，其他设定和约束全部不变', workingBrief: original });
  assert.match(result.workingBrief.story, /晨光/u);
  assert.match(result.suggestions[0].sendText, /镜头|节奏|表演|声音|转场/u);
  assert.doesNotMatch(result.suggestions[0].sendText, /完整.{0,8}(?:脚本|分镜)/u);
  for (const field of ['goal', 'format', 'audience', 'style', 'assets', 'constraints', 'decisions']) {
    assert.equal(result.workingBrief[field], original[field], `${field} must remain unchanged`);
  }
});

test('Creator LLM v2 reduces a critical ambiguity to one visible question', async () => {
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider,
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: CREATOR_LLM_RESPONSE_SCHEMA,
        replyMarkdown: '你希望主角最终离开吗？还是留下来？结尾要开放式吗？',
        workingBrief: { ...workingBrief, openQuestion: '主角离开吗？还是留下来？' },
        phaseDecision,
        suggestions: suggestionSet(),
        proposedAction: null,
      }),
    }),
  });
  const result = await runtime.respond({ prompt: '我还没想好主角最终是否离开', workingBrief });
  assert.equal((result.replyMarkdown.match(/[?？]/gu) || []).length, 1);
  assert.equal((result.workingBrief.openQuestion.match(/[?？]/gu) || []).length, 1);
  assert.equal(result.workingBrief.openQuestion, '这支作品最终必须让观众留下怎样的情绪和理解？');
  assert.match(result.replyMarkdown, /怎样的情绪和理解/u);
});
