'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCreatorAgentLlmRuntime,
} = require('../backend/src/services/creatorAgentLlmRuntime.js');
const {
  normalizeCreatorWorkProposal,
} = require('../backend/src/services/creatorAgentWorkArtifacts.js');

function readyReceipt() {
  return {
    schema: 't8-creator-model-decision-receipt-v1',
    receiptDigest: 'a'.repeat(64),
    decisions: [{
      kind: 'llm',
      status: 'ready',
      selected: {
        provider: 'seedance-nz',
        model: 'bytedance/doubao-seed-2.1-pro',
        executable: true,
      },
      inputCompatibility: {
        schema: 't8-creator-model-input-compatibility-v1',
        status: 'compatible',
        confidence: 5,
        reasons: ['test text compatibility'],
        limitations: [],
        request: { creativeKind: 'story' },
      },
    }],
  };
}

function structuredStory(suffix = '初稿') {
  return {
    schema: 't8-creator-work-model-response-v1',
    displayMarkdown: [
      `## 雨夜重逢 · ${suffix}`,
      '两个多年未见的朋友在末班车前重逢。一个人想开口道歉，另一个人准备离开。',
      '短片用雨棚、车灯和一张旧车票串起六个镜头；前半段保持距离，结尾让两个人走入同一束暖光。',
      '开场先用站牌和急促雨声建立场景，人物隔着雨幕认出彼此；中段让旧车票成为误会与道歉的可拍动作，最后在列车进站前完成选择。',
      '镜头从远景逐步推进到手部近景，再回到双人全景；对白保持克制，环境声承担停顿，人物服装、站位和光向在六镜之间连续。',
      '所有人物姓名与外貌保持待确认，不编造用户未提供的身份信息。',
    ].join('\n\n'),
    taskProfile: {
      family: 'story',
      intent: '制作一支可拍摄的雨夜重逢短片',
      deliveryKind: 'vertical-short-film',
      modalities: ['text', 'video', 'audio'],
      targetPlatform: 'mobile',
      qualityMode: 'standard',
    },
    artifacts: [
      {
        kind: 'TaskProfile', title: '任务画像', fields: {
          family: 'story', intent: '雨夜重逢', deliveryKind: 'vertical-short-film',
          modalities: ['text', 'video', 'audio'], qualityMode: 'standard',
        },
      },
      {
        kind: 'ProductionBrief', title: '创作简报', fields: {
          title: '雨夜重逢', outcome: '30 秒竖屏短片', audience: '情感短片观众',
          format: '9:16', durationSeconds: 30, assumptions: ['姓名与外貌待确认'],
        },
      },
      {
        kind: 'ScriptDoc', title: '剧本', fields: {
          title: '雨夜重逢', logline: '两个旧友在末班车前决定是否重新同行。',
          scenes: [{ id: 'scene-1', action: '两人在雨棚下对视，旧车票被雨水打湿' }],
        },
      },
      {
        kind: 'CharacterBible', title: '人物设定', fields: {
          characters: [{ id: 'friend-a', goal: '说出迟到的道歉' }],
          identityLocks: ['两位成年旧友'],
        },
      },
      {
        kind: 'AssetNeed', title: '素材需求', fields: {
          items: ['雨夜站台', '两位人物参考'], existing: [], missing: ['人物参考图'],
        },
      },
      {
        kind: 'ShotList', title: '六镜头表', fields: {
          shots: [
            { id: 'shot-1', durationSeconds: 4, action: '雨滴掠过站牌' },
            { id: 'shot-2', durationSeconds: 5, action: '两人隔着雨幕对视' },
          ],
          totalDurationSeconds: 30,
        },
      },
      {
        kind: 'Storyboard', title: '分镜', fields: {
          frames: [{ shotId: 'shot-1', composition: '站牌前景，两人在深处' }], missingFrames: [],
        },
      },
      {
        kind: 'AudioPlan', title: '声音方案', fields: {
          dialogue: ['这次别再错过了。'], ambience: ['雨声', '远处列车'], music: '克制钢琴',
        },
      },
      {
        kind: 'PromptPack', title: '提示词包', fields: {
          prompts: [{ shotId: 'shot-1', prompt: '雨夜站台，电影光线，站牌前景' }],
          negativePrompts: ['人物身份漂移'],
        },
      },
    ],
    toolProposals: [],
  };
}

function input(qualityMode = 'standard') {
  return {
    prompt: '把两个朋友在雨夜重逢的故事做成 30 秒竖屏短片',
    kind: 'story',
    recipe: 'general',
    qualityMode,
    requireStructuredWork: true,
    logicalRequestId: `request-${qualityMode}`,
    attachments: [],
    session: { events: [] },
    modelDecisionReceipt: readyReceipt(),
  };
}

test('standard work mode performs a draft and independent refinement, then emits only validated work text', async () => {
  const providerInputs = [];
  const emitted = [];
  const responses = [structuredStory('初稿'), structuredStory('标准精修稿')];
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'unit-test-key',
      zhenzhenSd2BaseUrl: 'https://example.test',
    }),
    generateChat: async (_provider, request, hooks) => {
      const current = responses[providerInputs.length];
      providerInputs.push(request);
      const text = JSON.stringify(current);
      if (hooks?.onDelta) {
        await hooks.onDelta(text.slice(0, 120));
        await hooks.onDelta(text.slice(120));
      }
      return {
        ok: true,
        text,
        model: 'bytedance/doubao-seed-2.1-pro',
        requestId: `provider-${providerInputs.length}`,
        finishReason: 'stop',
      };
    },
  });
  const result = await runtime.createResponse(input(), {
    onDelta: async (delta) => emitted.push(delta),
  });
  assert.equal(providerInputs.length, 2);
  assert.match(providerInputs[0].messages[0].content, /t8-creator-work-model-response-v1/);
  assert.match(providerInputs[0].messages[0].content, /恰好 6 条可编辑 ShotList/);
  assert.deepEqual(providerInputs[0].responseFormat, { type: 'json_object' });
  assert.equal(providerInputs[0].reasoningEffort, 'low');
  assert.equal(providerInputs[0].maxTokens, 8_192);
  assert.match(providerInputs[1].messages.at(-1).content, /2\/2/);
  assert.equal(result.text, structuredStory('标准精修稿').displayMarkdown);
  assert.equal(emitted.join(''), result.text);
  assert.doesNotMatch(emitted.join(''), /"schema"\s*:/);
  assert.equal(result.evidence.mode, 'online-model');
  assert.equal(result.evidence.status, 'completed');
  assert.equal(result.evidence.qualityMode, 'standard');
  assert.equal(result.evidence.providerCalls, 2);
  assert.deepEqual(result.evidence.calls.map((call) => call.role), ['draft', 'final-merger']);
  assert.deepEqual(normalizeCreatorWorkProposal(result.workProposal), result.workProposal);
  assert.equal(result.workProposal.taskProfile.family, 'story');
});

test('quick and quality modes expose exactly the promised provider call count', async () => {
  for (const [qualityMode, expected] of [['quick', 1], ['quality', 3]]) {
    let calls = 0;
    const runtime = createCreatorAgentLlmRuntime({
      settingsProvider: () => ({
        zhenzhenSd2ApiKey: 'unit-test-key',
        zhenzhenSd2BaseUrl: 'https://example.test',
      }),
      generateChat: async () => {
        calls += 1;
        const value = structuredStory(`第 ${calls} 版`);
        value.taskProfile.qualityMode = qualityMode;
        value.artifacts.find((item) => item.kind === 'TaskProfile').fields.qualityMode = qualityMode;
        return {
          ok: true,
          text: JSON.stringify(value),
          model: 'bytedance/doubao-seed-2.1-pro',
          requestId: `${qualityMode}-${calls}`,
          finishReason: 'stop',
        };
      },
    });
    const result = await runtime.createResponse(input(qualityMode));
    assert.equal(calls, expected);
    assert.equal(result.evidence.providerCalls, expected);
    assert.equal(result.evidence.calls.length, expected);
    assert.equal(result.evidence.qualityMode, qualityMode);
    assert.ok(result.workProposal);
  }
});

test('invalid structured output keeps chat fallback but creates no formal work proposal', async () => {
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'unit-test-key',
      zhenzhenSd2BaseUrl: 'https://example.test',
    }),
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: 't8-creator-work-model-response-v1',
        displayMarkdown: '只有正文，没有类型化作品。',
        taskProfile: { family: 'story' },
        artifacts: [],
      }),
      model: 'bytedance/doubao-seed-2.1-pro',
      requestId: 'provider-invalid',
      finishReason: 'stop',
    }),
  });
  const result = await runtime.createResponse(input('standard'));
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.providerCalls, 1);
  assert.equal('workProposal' in result, false);
  assert.equal('artifactProposal' in result, false);
  assert.match(result.text, /离线结构 V0/);
});

test('formal work mode rejects otherwise usable plain prose without a typed work envelope', async () => {
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'unit-test-key',
      zhenzhenSd2BaseUrl: 'https://example.test',
    }),
    generateChat: async () => ({
      ok: true,
      text: structuredStory('散文外壳').displayMarkdown,
      model: 'bytedance/doubao-seed-2.1-pro',
      requestId: 'provider-plain-prose',
      finishReason: 'stop',
    }),
  });
  const result = await runtime.createResponse({
    ...input('quick'),
    requireStructuredWork: true,
  });
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.qualityCode, 'work-schema-invalid');
  assert.equal('workProposal' in result, false);
  assert.equal('artifactProposal' in result, false);
  assert.doesNotMatch(result.text, /散文外壳/);
});

test('standard work mode fails closed when its required refinement is not valid structured work', async () => {
  let calls = 0;
  const runtime = createCreatorAgentLlmRuntime({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'unit-test-key',
      zhenzhenSd2BaseUrl: 'https://example.test',
    }),
    generateChat: async () => {
      calls += 1;
      return {
        ok: true,
        text: calls === 1 ? JSON.stringify(structuredStory('初稿')) : '审校轮返回了坏格式',
        model: 'bytedance/doubao-seed-2.1-pro',
        requestId: `provider-refinement-${calls}`,
        finishReason: 'stop',
      };
    },
  });
  const result = await runtime.createResponse({
    ...input('standard'),
    requireStructuredWork: true,
  });
  assert.equal(calls, 2);
  assert.equal(result.evidence.providerCalls, 2);
  assert.equal(result.evidence.mode, 'offline-fallback');
  assert.equal(result.evidence.qualityCode, 'work-schema-invalid');
  assert.equal('workProposal' in result, false);
});
