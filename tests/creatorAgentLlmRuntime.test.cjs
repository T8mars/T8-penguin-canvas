const test = require('node:test');
const assert = require('node:assert/strict');

const {
  creatorToolProposalContract,
  createCreatorAgentLlmRuntime,
  mediaObservationQuality,
  offlineV0,
  providerForDecision,
  responseQuality,
  taskResponseContract,
} = require('../backend/src/services/creatorAgentLlmRuntime.js');
const {
  normalizeCreatorArtifactProposal,
} = require('../backend/src/services/creatorAgentArtifacts.js');

function readyReceipt(provider = 'zhenzhen', model = 'gemini-3.5-flash') {
  return {
    schema: 't8-creator-model-decision-receipt-v1',
    receiptDigest: 'a'.repeat(64),
    decisions: [{
      kind: 'llm',
      status: 'ready',
      selected: {
        provider,
        model,
        executable: true,
      },
      inputCompatibility: {
        schema: 't8-creator-model-input-compatibility-v1',
        status: 'compatible',
        confidence: 5,
        reasons: ['test vision compatibility'],
        limitations: [],
        request: { creativeKind: 'story' },
      },
    }],
  };
}

test('tool proposal contract exposes one exact scoped plan request without low-level execution fields', () => {
  const contract = creatorToolProposalContract({
    projectId: 'project-local',
    canvasId: 'canvas-creator-agent',
    kind: 'image',
    logicalRequestId: 'creator-request-1',
  });
  assert.match(contract, /t8-creator-model-tool-proposal-v1/);
  assert.match(contract, /zcanvas_create_image/);
  assert.match(contract, /"operation":"plan"/);
  assert.match(contract, /"projectId":"project-local"/);
  assert.match(contract, /"canvasId":"canvas-creator-agent"/);
  assert.doesNotMatch(contract, /apiKey|Authorization|Bearer|canvasPatch|"nodes"|"edges"/i);
  assert.match(creatorToolProposalContract({ kind: 'image' }), /必须返回空数组/);
});

test('tool proposal contract routes explicit five-language localization requests to the staged workbench', () => {
  const contract = creatorToolProposalContract({
    projectId: 'project-local',
    canvasId: 'canvas-creator-agent',
    kind: 'audio',
    prompt: '把这个作品做成中英日西阿五语完整本地化，先让我审译文再配音。',
    logicalRequestId: 'creator-localization-1',
  });
  assert.match(contract, /zcanvas_localization_create/);
  assert.match(contract, /"targetLanguages":\["ZH","EN","JA","ES","AR"\]/);
  assert.match(contract, /"sourceLanguage":"AUTO"/);
  assert.match(contract, /"mode":"full"/);
  assert.match(contract, /input\.instruction/);
  assert.doesNotMatch(contract, /apiKey|Authorization|Bearer|canvasPatch|"nodes"|"edges"/i);
});

test('offline V0 is substantive, task-specific, and honest about zero model calls', async () => {
  let calls = 0;
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({}),
    generateChat: async () => {
      calls += 1;
      throw new Error('must not call');
    },
  });
  const result = await runtime.createResponse({
    prompt: '帮我做一套护肤品电商商品图',
    kind: 'image',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: {
      receiptDigest: 'b'.repeat(64),
      decisions: [{ kind: 'llm', status: 'blocked', selected: null }],
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.evidence.schema, 't8-creator-agent-response-evidence-v1');
  assert.equal(result.evidence.mode, 'offline-structure');
  assert.equal(result.evidence.providerCalls, 0);
  assert.match(result.text, /离线结构 V0/);
  assert.match(result.text, /套图顺序/);
  assert.match(result.text, /不编造功效、材质或认证/);
  assert.doesNotMatch(JSON.stringify(result), /apiKey|Authorization|Bearer|sk-/i);
  assert.equal(responseQuality(result.text, '帮我做一套护肤品电商商品图').ok, true);
  assert.equal('artifactProposal' in result, false);
  assert.equal('workProposal' in result, false);
});

test('ready model produces a substantive online response with one provider call and bounded history', async () => {
  const captured = [];
  const secret = 'unit-test-key-not-for-network';
  const answer = [
    '## 素材观察',
    '- 素材 1 画面中央是一只直立的圆柱形水杯，杯身占据主体位置，外轮廓完整可见。',
    '- 杯体以低饱和蓝灰色为主，背景较简洁，正面没有可确认的品牌文字或功效信息。',
    '## 商品图创作 V0',
    '目标是保留素材 1 的蓝灰色圆柱杯身和完整轮廓，为移动端首屏建立可信、清晰的商品识别，并让每张图只承担一个卖点。',
    '第一张采用产品正面近景和简洁背景，标题只写一个可验证利益点；第二张展示使用场景；第三张用细节说明杯盖与杯口结构。',
    '未知参数统一保留占位符，不编造功效或材质。画面使用统一主光和留白，最后检查裁切安全区、文字可读性与商品外观一致性。',
  ].join('\n\n');
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      llmApiKey: secret,
      llmBaseUrl: 'https://example.test',
    }),
    generateChat: async (provider, input) => {
      captured.push({ provider, input });
      return {
        ok: true,
        text: answer,
        model: 'gemini-3.5-flash',
        finishReason: 'stop',
        requestId: 'request-1',
      };
    },
  });
  const result = await runtime.createResponse({
    prompt: '给这个水杯做三张电商主图',
    kind: 'image',
    recipe: 'general',
    attachments: [{ kind: 'image', name: '水杯.png', ref: '/input/cup.png' }],
    session: {
      events: [
        { type: 'user.message', payload: { text: '旧要求' } },
        { type: 'assistant.plan', payload: { text: '请先回答三个问题再继续。' } },
        { type: 'assistant.response.completed', payload: { text: '旧回复' } },
      ],
    },
    modelDecisionReceipt: readyReceipt(),
    requestBaseUrl: 'http://127.0.0.1:18766',
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].provider.id, 'zhenzhen');
  assert.equal(captured[0].provider.defaults.chatEndpoint, '/v1/chat/completions');
  assert.equal(captured[0].input.model, 'gemini-3.5-flash');
  assert.equal(captured[0].input.stream, false);
  assert.equal(captured[0].input.messages[0].role, 'system');
  assert.match(captured[0].input.messages[0].content, /直接帮助创作者产出可编辑内容/);
  assert.match(captured[0].input.messages[0].content, /商品真值/);
  assert.match(captured[0].input.messages[0].content, /## 素材观察/);
  assert.doesNotMatch(JSON.stringify(captured[0].input.messages), /请先回答三个问题再继续/);
  const latestUserMessage = captured[0].input.messages.at(-1);
  assert.equal(Array.isArray(latestUserMessage.content), true);
  assert.equal(latestUserMessage.content[1].type, 'image_url');
  assert.equal(latestUserMessage.content[1].image_url.url, '/input/cup.png');
  assert.equal(result.text, answer);
  assert.equal(result.evidence.mode, 'online-model');
  assert.equal(result.evidence.mediaGrounding.status, 'confirmed');
  assert.match(result.evidence.mediaGrounding.observationDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.evidence.provider, 'zhenzhen');
  assert.equal(result.evidence.model, 'gemini-3.5-flash');
  assert.doesNotMatch(JSON.stringify(result.evidence), new RegExp(secret));
  assert.deepEqual(normalizeCreatorArtifactProposal(result.artifactProposal), result.artifactProposal);
  assert.equal(result.artifactProposal.taskFamily, 'commerce');
  assert.equal(result.artifactProposal.content.bodyMarkdown, answer);
});

test('empty or question-only provider output is rejected and replaced by an honest offline fallback', async () => {
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'unit-test-seedance-key',
      zhenzhenSd2BaseUrl: 'https://api.seedance.test',
    }),
    generateChat: async () => ({
      ok: true,
      text: '你想做什么？什么风格？什么尺寸？',
      model: 'glm-5',
      finishReason: 'stop',
    }),
  });
  const result = await runtime.createResponse({
    prompt: '把这个想法做成一支十五秒短视频',
    kind: 'video',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt('seedance-nz', 'glm-5'),
  });
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.evidence.qualityCode, 'response-too-short');
  assert.match(result.text, /离线结构 V0/);
  assert.match(result.text, /第一版镜头节奏/);
});

test('provider failure keeps the request and returns task-matched offline content', async () => {
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key' }),
    config: { ZHENZHEN_BASE_URL: 'https://example.test' },
    generateChat: async () => ({
      ok: false,
      code: 'network_error',
      error: 'offline',
    }),
  });
  const result = await runtime.createResponse({
    prompt: '写一个两个人在雨夜重逢的短片',
    kind: 'story',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  });
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.evidence.errorCode, 'network_error');
  assert.match(result.text, /创意简报/);
  assert.doesNotMatch(result.text, /本阶段待确认/);
  assert.match(result.text, /可编辑 V0：创意简报/);
});

test('ready model streams exact provider deltas and exposes truthful started evidence', async () => {
  const secret = 'unit-test-stream-key';
  const emitted = [];
  const answerParts = [
    '## 短视频执行 V0\n\n',
    '前 2 秒用一个明确动作建立冲突，随后用三个连续镜头推进人物目标；',
    '中段保留一个可编辑转折，结尾用同一视觉锚点完成回收。画面统一色温、人物服装与空间方向，未知产品或人物真值保留占位符。执行时先做低成本分镜预览，采用后再生成素材；每个镜头标注景别、动作、时长、声音和转场，确保方案可以直接修改和比较。',
  ];
  const answer = answerParts.join('');
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: secret, llmBaseUrl: 'https://example.test' }),
    generateChat: async (_provider, input, options) => {
      assert.equal(input.stream, true);
      for (const delta of answerParts) await options.onDelta(delta, { providerEvent: true });
      return {
        ok: true,
        text: answer,
        model: 'gemini-3.5-flash',
        finishReason: 'stop',
        requestId: 'request-stream-1',
      };
    },
  });
  const input = {
    prompt: '帮我做一支十五秒角色短视频',
    kind: 'video',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  };
  const prepared = runtime.prepareResponse(input);
  assert.equal(prepared.startedEvidence.mode, 'online-model');
  assert.equal(prepared.startedEvidence.status, 'streaming');
  assert.equal(prepared.startedEvidence.providerCalls, 1);
  assert.doesNotMatch(JSON.stringify(prepared.startedEvidence), new RegExp(secret));

  const result = await runtime.createResponse(input, {
    prepared,
    onDelta: async (delta, meta) => emitted.push({ delta, meta }),
  });
  assert.equal(result.text, answer);
  assert.equal(result.streamed, true);
  assert.equal(emitted.map((item) => item.delta).join(''), answer);
  assert.deepEqual(emitted.map((item) => item.meta.index), [0]);
  assert.equal(emitted.every((item) => item.meta.grounded === true), true);
  assert.equal(result.evidence.mode, 'online-model');
  assert.equal(result.evidence.status, 'completed');
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.evidence.requestId, 'request-stream-1');
  assert.deepEqual(normalizeCreatorArtifactProposal(result.artifactProposal), result.artifactProposal);
  assert.equal(result.artifactProposal.taskFamily, 'video');
  assert.equal(result.artifactProposal.content.bodyMarkdown, emitted.map((item) => item.delta).join(''));
});

test('streaming quality failure keeps partial text and appends an honest task-specific fallback', async () => {
  const emitted = [];
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async (_provider, input, options) => {
      assert.equal(input.stream, true);
      await options.onDelta('你想做什么？');
      return { ok: true, text: '你想做什么？', model: 'gemini-3.5-flash' };
    },
  });
  const result = await runtime.createResponse({
    prompt: '给产品做一套三张电商主图',
    kind: 'image',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  }, {
    onDelta: async (delta) => emitted.push(delta),
  });
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.providerCalls, 1);
  assert.doesNotMatch(result.text, /^你想做什么？/);
  assert.match(result.text, /套图顺序/);
  assert.equal(result.text, emitted.join(''));
  assert.equal(result.continuationText, emitted.join(''));
  assert.equal('artifactProposal' in result, false);
  assert.equal('workProposal' in result, false);
});
test('provider resolution keeps workshop and low-cost-house credentials independent', () => {
  const workshop = providerForDecision(
    readyReceipt('zhenzhen', 'gemini-3.5-flash').decisions[0],
    { llmApiKey: 'workshop-key', zhenzhenSd2ApiKey: 'house-key' },
    { ZHENZHEN_BASE_URL: 'https://workshop.test', ZHENZHEN_SD2_BASE_URL: 'https://house.test' },
  );
  const house = providerForDecision(
    readyReceipt('seedance-nz', 'glm-5').decisions[0],
    { llmApiKey: 'workshop-key', zhenzhenSd2ApiKey: 'house-key' },
    { ZHENZHEN_BASE_URL: 'https://workshop.test', ZHENZHEN_SD2_BASE_URL: 'https://house.test' },
  );
  assert.equal(workshop.apiKey, 'workshop-key');
  assert.equal(workshop.baseUrl, 'https://workshop.test');
  assert.equal(house.apiKey, 'house-key');
  assert.equal(house.baseUrl, 'https://house.test');
  assert.equal(workshop.defaults.chatEndpoint, '/v1/chat/completions');
  assert.equal(house.defaults.chatEndpoint, '/v1/chat/completions');
});

test('offline renderer covers image, video, story, audio, and mixed tasks', () => {
  const cases = [
    ['image', '精修这张图片', /图像方案/],
    ['video', '做一条短视频', /视频结构/],
    ['story', '写一个故事', /创意简报/],
    ['audio', '做一段配音', /声音方案/],
    ['unknown', '帮我开始创作', /创作方向/],
  ];
  for (const [kind, prompt, pattern] of cases) {
    assert.match(offlineV0({ kind, prompt }), pattern);
  }
});

test('stopped online model output never proposes an editable artifact', async () => {
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async (_provider, _input, options) => {
      await options.onDelta('## 未完成方案\n');
      return {
        ok: false,
        code: 'stopped',
        text: '## 未完成方案\n',
        model: 'gemini-3.5-flash',
      };
    },
  });
  const result = await runtime.createResponse({
    prompt: '做一支十五秒视频',
    kind: 'video',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  }, {
    onDelta: async () => {},
  });
  assert.equal(result.stopped, true);
  assert.equal(result.evidence.status, 'stopped');
  assert.equal('artifactProposal' in result, false);
});
test('task response contracts require an editable V0 instead of a generic questionnaire', () => {
  assert.match(taskResponseContract({ kind: 'image', prompt: '精修一张人像' }), /保留区/);
  assert.match(taskResponseContract({ kind: 'video', prompt: '做十五秒视频' }), /镜头结构/);
  assert.match(taskResponseContract({ kind: 'story', prompt: '写一段短片剧本' }), /当前生产阶段/);
  assert.match(taskResponseContract({ kind: 'story', prompt: '写一段短片剧本' }), /不得越级/);
  assert.match(taskResponseContract({ kind: 'audio', prompt: '设计声音方案' }), /层次\/轨道/);
  assert.match(taskResponseContract({ kind: 'image', prompt: '做三张商品主图' }), /商品真值/);
});

test('a long questionnaire is rejected even when it mentions task vocabulary', () => {
  const questionnaire = [
    '## 视频方案',
    '你更想做克制写实还是强动作节奏？你希望开场先展示角色还是先展示场景？',
    '镜头需要几秒？人物穿什么服装？画面使用冷色还是暖色？是否需要对白、环境音和转场？',
    '镜头是固定机位还是手持跟拍？冲突应该在第几秒出现？结尾是反转、留白还是明确收束？',
    '请先告诉我这些选择，我再根据你的回答继续整理镜头结构、动作节奏、声音和结尾；在你回答前我不会给出可编辑方案。',
  ].join('\n\n');
  const quality = responseQuality(questionnaire, '帮我做一支十五秒角色短视频', {
    kind: 'video',
    prompt: '帮我做一支十五秒角色短视频',
  });
  assert.equal(quality.ok, false);
  assert.match(quality.code, /questionnaire|only-questions|defers-work/);
});

test('a long restatement with one follow-up question is rejected', () => {
  const prompt = [
    '请为新品保温杯设计三张电商主图，第一张突出外观，第二张展示使用场景，',
    '第三张展示杯盖与杯口细节，整体使用克制的蓝白色调，未知参数不要编造。',
  ].join('');
  const repeated = `${prompt}\n\n${prompt}\n\n你还想补充什么要求？`;
  const quality = responseQuality(repeated, prompt, {
    kind: 'image',
    prompt,
  });
  assert.equal(quality.ok, false);
  assert.match(quality.code, /repeats-request|questionnaire|defers-work/);
});

test('quality failure performs exactly one provider call before honest fallback', async () => {
  let calls = 0;
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: '你希望是什么风格？请先告诉我尺寸和用途，我再继续。',
        model: 'gemini-3.5-flash',
      };
    },
  });
  const result = await runtime.createResponse({
    prompt: '帮我做一张新品海报',
    kind: 'image',
    recipe: 'general',
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  });
  assert.equal(calls, 1);
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.match(result.text, /离线结构 V0/);
});

test('media request without a verified vision model never fabricates an offline creative draft', async () => {
  let calls = 0;
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({}),
    generateChat: async () => {
      calls += 1;
      throw new Error('must not call');
    },
  });
  const result = await runtime.createResponse({
    prompt: '根据这张鸭子图片写一个温馨治愈的短剧本',
    kind: 'story',
    recipe: 'general',
    attachments: [{ kind: 'image', name: 'duck.png', ref: '/input/duck.png' }],
    session: { events: [] },
    modelDecisionReceipt: {
      receiptDigest: 'b'.repeat(64),
      decisions: [{
        kind: 'llm',
        status: 'blocked',
        selected: null,
        inputCompatibility: { status: 'unverified' },
      }],
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.evidence.mode, 'media-unavailable');
  assert.equal(result.evidence.providerCalls, 0);
  assert.equal(result.evidence.mediaGrounding.status, 'unavailable');
  assert.match(result.text, /无法核验参考素材/);
  assert.match(result.text, /不会假装看过素材/);
  assert.doesNotMatch(result.text, /离线结构 V0|叙事骨架|主角目标/);
  assert.equal('artifactProposal' in result, false);
});

test('generic provider prose that ignores an image is rejected without publishing a fake artifact', async () => {
  const emitted = [];
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async (_provider, input, options) => {
      const text = [
        '## 温馨故事 V0',
        '主角想得到陪伴，外部阻力让它暂时无法回家，随后通过一次选择解决冲突。',
        '故事分成建立人物、打破平静、误会升级和温暖收束四段，最后回到最初目标。',
      ].join('\n\n');
      await options.onDelta(text);
      return { ok: true, text, model: 'gemini-3.5-flash' };
    },
  });
  const result = await runtime.createResponse({
    prompt: '根据这张鸭子图片写一个温馨治愈的短剧本',
    kind: 'story',
    recipe: 'general',
    attachments: [{ kind: 'image', name: 'duck.png', ref: '/input/duck.png' }],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  }, {
    onDelta: async (delta) => emitted.push(delta),
  });
  assert.equal(result.evidence.mode, 'media-unavailable');
  assert.equal(result.evidence.qualityCode, 'media-observation-missing');
  assert.match(result.text, /无法核验参考素材/);
  assert.doesNotMatch(result.text, /主角想得到陪伴/);
  assert.equal(emitted.join(''), result.text);
  assert.equal('artifactProposal' in result, false);
});

test('grounded duck story passes only after concrete image observations and preserves streaming UX', async () => {
  const emitted = [];
  const answer = [
    '## 素材观察',
    '- 素材 1 画面中央是一只黄色小鸭，橙色扁嘴朝向右侧，身体由圆润的几何形状组成。',
    '- 小鸭抬起一只翅膀，浅蓝背景和脚下两道白色水纹让画面显得轻松、干净。',
    '## 温馨短剧本 V0《小鸭的晚安舞步》',
    '傍晚，小鸭在浅蓝色池塘边反复练习抬翅动作，想在妈妈回家前学会一支欢迎舞。',
    '风吹乱水纹，小鸭一度以为自己总是踩错节拍。它看见水面上的圆形倒影随着波纹轻轻晃动，便把每次晃动当成鼓点，重新一步一步跳起来。',
    '妈妈游近时，小鸭没有完成最标准的动作，却把橙色小嘴贴在妈妈翅膀旁说：“今天的最后一步，是抱抱。”两只鸭子的倒影靠在一起，白色水纹慢慢平静。',
  ].join('\n\n');
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async (_provider, input, options) => {
      await options.onDelta(answer.slice(0, 90));
      await options.onDelta(answer.slice(90));
      return { ok: true, text: answer, model: 'gemini-3.5-flash', requestId: 'duck-1' };
    },
  });
  const result = await runtime.createResponse({
    prompt: '根据这张鸭子图片写一个温馨治愈的短剧本',
    kind: 'story',
    recipe: 'general',
    attachments: [{ kind: 'image', name: 'duck.png', ref: '/input/duck.png' }],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  }, {
    onDelta: async (delta, meta) => emitted.push({ delta, meta }),
  });
  assert.equal(result.text, answer);
  assert.equal(result.evidence.mode, 'online-model');
  assert.equal(result.evidence.mediaGrounding.status, 'confirmed');
  assert.equal(result.artifactProposal.taskFamily, 'story');
  assert.equal(emitted.map((item) => item.delta).join(''), answer);
  assert.equal(emitted.every((item) => item.meta.grounded === true), true);
});

test('audio attachment is never described without a verified audio understanding path', async () => {
  let calls = 0;
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({ llmApiKey: 'unit-test-key', llmBaseUrl: 'https://example.test' }),
    generateChat: async () => {
      calls += 1;
      return { ok: true, text: 'should not happen' };
    },
  });
  const result = await runtime.createResponse({
    prompt: '根据这段录音写一个广告脚本',
    kind: 'audio',
    recipe: 'general',
    attachments: [{ kind: 'audio', name: 'voice.wav', ref: '/input/voice.wav' }],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  });
  assert.equal(calls, 0);
  assert.equal(result.evidence.mode, 'media-unavailable');
  assert.equal(result.evidence.errorCode, 'media-input-unsupported');
  assert.equal(result.evidence.mediaGrounding.status, 'unsupported');
  assert.match(result.text, /无法读取音频内容/);
  assert.equal('artifactProposal' in result, false);
});

test('media observation quality rejects attachment counts and accepts concrete visible facts', () => {
  const input = {
    kind: 'story',
    prompt: '根据图片写故事',
    attachments: [{ kind: 'image', name: 'duck.png', ref: '/input/duck.png' }],
  };
  assert.equal(mediaObservationQuality([
    '## 素材观察',
    '已上传 1 张图片，已参考这张素材。',
    '## 故事',
    '下面开始写故事。',
  ].join('\n'), input).ok, false);
  const accepted = mediaObservationQuality([
    '## 素材观察',
    '- 素材 1 中央是一只黄色小鸭，橙色嘴朝向右侧，圆润身体完整可见。',
    '- 浅蓝背景上有两道白色水纹，小鸭抬起左侧翅膀，画面光线均匀。',
    '## 故事',
    '小鸭开始跳舞。',
  ].join('\n'), input);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'confirmed');
});
