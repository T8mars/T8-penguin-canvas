'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../backend/src/config');
const { generateChatWithProvider } = require('../backend/src/providers/adapters');
const {
  createCreatorLlmRuntimeV2,
  parseJsonEnvelope,
  providerFromSettings,
} = require('../backend/src/services/creatorLlmRuntimeV2');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'creator-agent-v2-llm-quality');
const CHECKPOINT_FILE = path.join(ARTIFACT_ROOT, 'checkpoint.json');
const ROBOTIC = /(?:我已经理解(?:你的)?需求|系统(?:已经)?检测到|当前阶段(?:为|是)|已完成\s*\d+\s*\/\s*6|请选择一个明确方向|I (?:have )?(?:understood|processed) (?:your )?(?:request|requirements)|the system (?:has )?(?:detected|processed)|current phase|workingBrief|phaseDecision|proposedAction|CanvasPatch|NodeRun|task[_ ]?id|assetId)/iu;
const RECEIPT_OPENING = /^\s*(?:好的|收到|明白(?:了)?|没问题|我知道了|我了解了|okay|ok|sure|got it|understood|certainly)(?:[，。,:：！!\s]|$)/iu;
const COST = /(?:价格|费用|余额|额度|账单|单价|cost|price|billing|balance|quota)/iu;
const GENERATION_CUE = /(?:生成|出图|出视频|渲染|generate|render|create (?:an? )?(?:image|video))/iu;

function readSettings() {
  return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
}

function qualitySourceDigest() {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(__filename))
    .update(fs.readFileSync(path.join(ROOT, 'backend', 'src', 'services', 'creatorLlmRuntimeV2.js')))
    .digest('hex');
}

function readCheckpoint(sourceDigest) {
  try {
    const value = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    if (value?.sourceDigest === sourceDigest && value?.turns && typeof value.turns === 'object') {
      value.creatorProviderCalls = Math.max(0, Number(value.creatorProviderCalls) || 0);
      return value;
    }
  } catch {
    // A missing or stale checkpoint starts a fresh quality run.
  }
  return {
    schema: 't8-creator-agent-v2-llm-quality-checkpoint-v1',
    sourceDigest,
    turns: {},
    judge: null,
    creatorProviderCalls: 0,
  };
}

function writeCheckpoint(value) {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const temporary = `${CHECKPOINT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, CHECKPOINT_FILE);
}

function normalized(value) {
  return String(value || '').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(value) {
  const text = normalized(value);
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function inspectTurn(id, response, expectation = {}) {
  const reply = String(response.replyMarkdown || '');
  const questions = (reply.match(/[?？]/gu) || []).length;
  const listLines = reply.split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.、])\s+/u.test(line)).length;
  assert.ok(reply.length >= 12 && reply.length <= 4_000, `${id}: 回复长度不自然`);
  assert.equal(ROBOTIC.test(reply), false, `${id}: 出现机械或内部话术`);
  assert.equal(RECEIPT_OPENING.test(reply), false, `${id}: 以流程回执开场`);
  assert.equal(COST.test(reply), false, `${id}: 出现费用信息`);
  assert.ok(listLines <= 1, `${id}: 回复退化为流程清单`);
  if (Number.isInteger(expectation.questions)) assert.equal(questions, expectation.questions, `${id}: 问题数量错误`);
  if (expectation.openQuestion) {
    const question = reply.match(/[^。！？?!\n]*[?？]/u)?.[0] || '';
    assert.ok(question, `${id}: 缺少必要的开放式问题`);
    assert.equal(/还是|或者|或是|二选一|是否|要不要|会不会|能不能|可不可以|你希望[^?？]{0,36}吗[?？]/u.test(question), false, `${id}: 把关键歧义退化成封闭式问题`);
    assert.equal(/^(?:do|does|did|would|should|could|can|is|are|was|were|have|has)\b[^?]{0,180}\?/iu.test(question), false, `${id}: 英文关键歧义退化成是非问题`);
    const recommended = String(response.suggestions?.[0]?.sendText || '');
    const execute = String(response.suggestions?.[2]?.sendText || '');
    assert.equal(/对比|比较|两种|两套|两个(?:方案|方向|结尾)|再决定|再选/u.test(recommended), false, `${id}: 推荐建议重新打开了已经给出倾向的 A/B`);
    assert.equal(/先不(?:要)?定|暂时留白|先留白|以后再说|之后再说|暂不决定|不急着定/u.test(execute), false, `${id}: 直接执行退回了未决状态`);
  }
  if (expectation.phase) assert.equal(response.phaseDecision.phase, expectation.phase, `${id}: 阶段建议错误`);
  if (expectation.transition) assert.equal(response.phaseDecision.transition, expectation.transition, `${id}: 阶段动作错误`);
  assert.equal(response.suggestions.length, 3, `${id}: 建议数量错误`);
  assert.deepEqual(response.suggestions.map((item) => item.role), ['recommended', 'alternative', 'execute']);
  const suggestionText = response.suggestions.map((item) => `${item.label} ${item.sendText}`);
  if (expectation.replyLanguage === 'English') {
    assert.equal(/\p{Script=Han}/u.test(`${reply}\n${suggestionText.join('\n')}`), false, `${id}: 英文创作混入中文可见回复`);
  }
  if (expectation.generationProhibited) {
    assert.equal(response.proposedAction, null, `${id}: 用户禁止生成但仍创建了动作`);
    const positiveSuggestionText = suggestionText.join('\n')
      .replace(/(?:先)?(?:不要|别|不|不用|无需|不需要|暂不)(?:再|立即|现在)?(?:生成|出图|出视频|渲染)/giu, '')
      .replace(/(?:do not|don't|dont|no need to) (?:generate|render|create (?:an? )?(?:image|video))|without (?:generating|rendering)/giu, '');
    assert.equal(GENERATION_CUE.test(positiveSuggestionText), false, `${id}: 建议绕过了用户“不生成”的要求`);
  }
  if (expectation.actionType) {
    assert.equal(response.proposedAction?.type, expectation.actionType, `${id}: 没有创建用户明确要求的 ${expectation.actionType} 动作`);
  }
  if (expectation.preserveBrief) assert.deepEqual(response.workingBrief, expectation.preserveBrief, `${id}: 只评价时修改了工作摘要`);
  if (expectation.scopedEdit) {
    const recommended = String(response.suggestions[0]?.sendText || '');
    const alternative = String(response.suggestions[1]?.sendText || '');
    assert.match(
      recommended,
      /镜头|景别|节奏|动作|表演|声音|音效|光线|转场|构图|留白|细化|优化|打磨|精修|小稿|草稿|试稿|尾段|结尾段落/u,
      `${id}: 限定修改的推荐没有给出可审阅的创作优化：${recommended}`,
    );
    assert.equal(/完整.{0,8}(?:脚本|分镜)|(?:脚本|分镜).{0,8}完整/u.test(recommended), false, `${id}: 限定修改的推荐退化为重复生成完整交付物`);
    if (expectation.forbiddenAlternative instanceof RegExp) {
      assert.equal(expectation.forbiddenAlternative.test(alternative), false, `${id}: 备选建议撤销了用户明确指定的修改`);
    }
  }
  const pairSimilarities = [
    similarity(suggestionText[0], suggestionText[1]),
    similarity(suggestionText[0], suggestionText[2]),
    similarity(suggestionText[1], suggestionText[2]),
  ];
  assert.ok(Math.max(...pairSimilarities) < 0.72, `${id}: 三个建议过于相似`);
  assert.equal(COST.test(suggestionText.join('\n')), false, `${id}: 建议出现费用信息`);
  return {
    id,
    prompt: expectation.prompt,
    replyMarkdown: reply,
    workingBrief: response.workingBrief,
    phaseDecision: response.phaseDecision,
    suggestions: response.suggestions,
    proposedAction: response.proposedAction ? {
      type: response.proposedAction.type,
      parameters: response.proposedAction.parameters,
      inputAssetIds: response.proposedAction.inputAssetIds,
    } : null,
    metrics: { questions, listLines, pairSimilarities: pairSimilarities.map((item) => Number(item.toFixed(4))) },
  };
}

function assertEndingScope(turn, original) {
  assert.match(turn.workingBrief.story, /晨光|天亮|清晨/u, 'ending-only: 结尾没有变化');
  for (const field of ['goal', 'format', 'audience', 'style', 'assets', 'constraints', 'decisions']) {
    assert.equal(turn.workingBrief[field], original[field], `ending-only: ${field} 被越界修改`);
  }
}

async function judgeOutputs(settings, turns) {
  const model = 'qwen/qwen3.8-max';
  const provider = providerFromSettings('seedance-nz', model, settings, config);
  assert.ok(provider, '缺少真实质量复核模型凭据');
  const result = await generateChatWithProvider(provider, {
    model,
    messages: [
      {
        role: 'system',
        content: [
          '你是独立中文创作产品质检员。只评价给出的 Creator Agent 对话，不续写作品。',
          '按 1-5 分评价 naturalPartner、concise、intentAlignment、suggestionDiversity、nextStepUsefulness。',
          '机械复述、多问、三个近义建议、内部技术词、越界修改或无视用户授权均属于 critical issue。',
          '必须服从本轮边界：用户说不要生成时不能产生生成动作或用建议偷偷引导生成；用户说只评价且不要改时不能改 workingBrief；用户明确纠正风格且说其他不变时只能更新风格；用户明确要图片或视频时动作类型必须一致。',
          'replyMarkdown 与三条建议必须跟随用户本轮主语言。英文请求若可见回复混入中文，或中文请求无故改成英文，属于 critical issue；用户专名不翻译不算问题。',
          '真正影响整部作品的关键歧义可以问一个问题；先给明确倾向再问开放式的情绪、意义或底线问题更像创作搭档，把用户原有 A/B 再问一遍，或问只能回答是/否的问题，均降低 naturalPartner。',
          '三条建议必须明确分工：recommended 是沿着正文明确倾向继续的、可修改的最佳探索或补全，不得重新比较用户原来的 A/B；alternative 是实质不同的表现方向，但也必须遵守用户明确指定或选中文字中的锁定事实；execute 也必须沿正文倾向，停止讨论后锁定当前结论或执行另一项明确动作，不能退回“先不定/暂时留白”的未决状态。recommended 与 execute 若要求同一种交付物或同一个动作，只是“先做/直接做”措辞不同，记入 minorIssues。二者沿用同一创意方向本身不算问题：recommended 优化镜头、节奏、声音等并给可修改小稿，execute 只锁定已有决定时，属于有效分工。',
          '输出严格 JSON：{"scores":{"naturalPartner":0,"concise":0,"intentAlignment":0,"suggestionDiversity":0,"nextStepUsefulness":0},"criticalIssues":[],"minorIssues":[],"summary":""}',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(turns) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 1_500,
    stream: true,
  }, { timeoutMs: 240_000 });
  assert.equal(result?.ok, true, `独立质量复核失败：${String(result?.error || result?.code || 'unknown')}`);
  const judged = parseJsonEnvelope(result.text);
  const names = ['naturalPartner', 'concise', 'intentAlignment', 'suggestionDiversity', 'nextStepUsefulness'];
  const scores = Object.fromEntries(names.map((name) => [name, Number(judged?.scores?.[name])]));
  const criticalIssues = Array.isArray(judged.criticalIssues) ? judged.criticalIssues.map(String).filter(Boolean) : [];
  const minorIssues = Array.isArray(judged.minorIssues) ? judged.minorIssues.map(String).filter(Boolean) : [];
  const issueSummary = [...criticalIssues, ...minorIssues].join('；');
  names.forEach((name) => assert.equal(scores[name], 5, `独立复核 ${name} 未达到本轮 5/5 目标${issueSummary ? `：${issueSummary}` : ''}`));
  assert.deepEqual(criticalIssues, [], `独立复核发现关键问题：${criticalIssues.join('；')}`);
  assert.deepEqual(minorIssues, [], `独立复核仍有非阻断问题：${minorIssues.join('；')}`);
  return {
    model,
    scores,
    average: Number((names.reduce((sum, name) => sum + scores[name], 0) / names.length).toFixed(2)),
    criticalIssues,
    minorIssues,
    summary: String(judged.summary || '').slice(0, 1_000),
  };
}

async function main() {
  const settings = readSettings();
  assert.ok(String(settings.zhenzhenSd2ApiKey || '').trim(), '缺少贞贞平价AI小屋 API Key');
  const runtime = createCreatorLlmRuntimeV2({ settingsProvider: () => settings, config, timeoutMs: 240_000 });
  const turns = [];
  const sourceDigest = qualitySourceDigest();
  const checkpoint = readCheckpoint(sourceDigest);

  const runTurn = async (id, input, expectation) => {
    if (checkpoint.turns[id]) {
      const inspected = inspectTurn(id, checkpoint.turns[id], expectation);
      process.stdout.write(`[creator-v2-llm-quality] ${id} resumed\n`);
      return inspected;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      process.stdout.write(`[creator-v2-llm-quality] ${id} ${attempt === 1 ? 'started' : `retry-${attempt}`}\n`);
      checkpoint.creatorProviderCalls += 1;
      writeCheckpoint(checkpoint);
      try {
        const inspected = inspectTurn(id, await runtime.respond(input), expectation);
        checkpoint.turns[id] = inspected;
        writeCheckpoint(checkpoint);
        process.stdout.write(`[creator-v2-llm-quality] ${id} passed\n`);
        return inspected;
      } catch (error) {
        const transient = /(?:UND_ERR_SOCKET|terminated|timeout|timed out|HTTP 5(?:02|03|04)|overloaded|ECONNRESET|EAI_AGAIN)/iu.test(
          String(error?.message || error),
        );
        if (!transient || attempt >= 3) throw error;
        const delayMs = attempt === 1 ? 1_500 : 4_000;
        process.stdout.write(`[creator-v2-llm-quality] ${id} transient transport retry in ${delayMs}ms\n`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`${id}: exhausted retries`);
  };

  const fullPrompt = '做一支 30 秒、9:16、无对白的护肤品牌短片，受众是 20 到 30 岁城市女性。风格克制、清晨自然光，核心画面是女主洗完脸推开窗，产品只在最后 3 秒出现。信息已经完整，请直接给出你认为最好的方案，不要反问。';
  turns.push(await runTurn('complete-brief', { prompt: fullPrompt, currentPhase: 'idea' }, {
    prompt: fullPrompt, questions: 0, phase: 'script', transition: 'advance',
  }));

  const delegatedPrompt = '我想做一支关于凌晨便利店的 20 秒情绪短片，人物和结尾你决定吧，直接按你最推荐的方向推进。';
  turns.push(await runTurn('delegated', { prompt: delegatedPrompt, currentPhase: 'idea' }, {
    prompt: delegatedPrompt, questions: 0, phase: 'script', transition: 'advance',
  }));

  const ambiguityPrompt = '做一支双人关系短片，但结尾到底让他们和解还是彻底分开我没想好，这个选择会改变整支片。';
  turns.push(await runTurn('critical-ambiguity', { prompt: ambiguityPrompt, currentPhase: 'idea' }, {
    prompt: ambiguityPrompt, questions: 1, openQuestion: true, phase: 'idea', transition: 'stay',
  }));

  const toneAmbiguityPrompt = '要做一支环保运动鞋品牌短片，但品牌气质还没定：一边想要高级克制，一边想要街头喧闹，这会改变人物、摄影和剪辑，我还没决定。';
  turns.push(await runTurn('critical-tone-ambiguity', {
    prompt: toneAmbiguityPrompt, currentPhase: 'idea',
  }, {
    prompt: toneAmbiguityPrompt, questions: 1, openQuestion: true, phase: 'idea', transition: 'stay',
  }));

  const originalBrief = {
    goal: '完成一支雨夜车站品牌短片',
    format: '30 秒 16:9 短片',
    audience: '年轻通勤者',
    style: '冷蓝电影感',
    story: '女主在雨夜站台等车，列车驶入后她上车离开。',
    assets: '女主参考图；雨夜站台参考图',
    constraints: '不要字幕；人物造型保持一致；列车灯只用暖色',
    decisions: '唯一高光是列车灯',
    openQuestion: '',
  };
  const endingPrompt = '只改结尾：列车驶过但她没有上车，远处天亮了。其他人物、风格、素材和约束全部不变。';
  const endingTurn = await runTurn('ending-only', {
    prompt: endingPrompt, workingBrief: originalBrief, currentPhase: 'script',
  }, {
    prompt: endingPrompt,
    questions: 0,
    phase: 'script',
    scopedEdit: true,
    forbiddenAlternative: /让她上车|她上车|不要天亮|没有天亮/u,
  });
  assertEndingScope(endingTurn, originalBrief);
  turns.push(endingTurn);

  const selectedTextPrompt = '按我明确选中的文字节点继续，只改结尾，其他人物、风格和约束不变。';
  const selectedTextTurn = await runTurn('selected-text-node', {
    prompt: selectedTextPrompt,
    workingBrief: originalBrief,
    currentPhase: 'script',
    selectedNodes: [{
      nodeId: 'selected-text-ending', type: 'text', label: '新结尾', assetId: null,
      content: '列车驶过，她没有上车。远处天亮，她转身离开空站台。',
    }],
  }, {
    prompt: selectedTextPrompt,
    questions: 0,
    phase: 'script',
    scopedEdit: true,
    forbiddenAlternative: /不要让她离开|不再离开|仍站在原地|继续等待|让她上车|她上车|不要天亮|没有天亮/u,
  });
  assert.match(
    `${selectedTextTurn.replyMarkdown}\n${selectedTextTurn.workingBrief.story}`,
    /没有上车/u,
    'selected-text-node: 没有采用明确选中文字节点的核心结尾',
  );
  assert.match(
    `${selectedTextTurn.replyMarkdown}\n${selectedTextTurn.workingBrief.story}`,
    /天亮|晨光/u,
    'selected-text-node: 没有采用明确选中文字节点的天亮信息',
  );
  turns.push(selectedTextTurn);

  const noGenerationPrompt = '先不要生成图片或视频，只把人物动机、镜头节奏和结尾方案改好，不要反问。';
  turns.push(await runTurn('negative-generation-boundary', {
    prompt: noGenerationPrompt, workingBrief: originalBrief, currentPhase: 'script',
  }, {
    prompt: noGenerationPrompt, questions: 0, generationProhibited: true,
  }));

  const feedbackOnlyPrompt = '只评价这一版最强和最弱的地方，不要改，也不要生成任何内容。';
  turns.push(await runTurn('feedback-only', {
    prompt: feedbackOnlyPrompt, workingBrief: originalBrief, currentPhase: 'script',
  }, {
    prompt: feedbackOnlyPrompt, questions: 0, generationProhibited: true, preserveBrief: originalBrief,
  }));

  const styleCorrectionBrief = {
    goal: '完成一支凌晨便利店人物短片',
    format: '20 秒 9:16 短片',
    audience: '城市青年',
    style: '温暖治愈；柔光；高饱和',
    story: '女主买完咖啡，独自走进清晨前的空街。',
    assets: '女主参考图；便利店门口参考图',
    constraints: '无对白；人物造型保持一致',
    decisions: '结尾停在街道远景',
    openQuestion: '',
  };
  const styleCorrectionPrompt = '不是治愈，是冷峻克制；只改风格，其他人物、故事、素材和约束都不变，不要反问。';
  const styleCorrectionTurn = await runTurn('style-only-correction', {
    prompt: styleCorrectionPrompt, workingBrief: styleCorrectionBrief, currentPhase: 'script',
  }, {
    prompt: styleCorrectionPrompt,
    questions: 0,
    scopedEdit: true,
    forbiddenAlternative: /治愈|温暖|柔和|高饱和/u,
  });
  assert.match(styleCorrectionTurn.workingBrief.style, /冷峻|克制/u, 'style-only-correction: 没有采用用户的新风格');
  for (const field of ['goal', 'format', 'audience', 'story', 'assets', 'constraints', 'decisions']) {
    assert.equal(
      styleCorrectionTurn.workingBrief[field],
      styleCorrectionBrief[field],
      `style-only-correction: ${field} 被越界修改`,
    );
  }
  turns.push(styleCorrectionTurn);

  const explicitImagePrompt = '直接生成一张 16:9 的雨夜车站电影海报：冷蓝雨幕，女主站在画面左侧，右侧列车暖灯是唯一高光。信息已经完整，不要反问。';
  turns.push(await runTurn('explicit-image-action', {
    prompt: explicitImagePrompt, currentPhase: 'shots',
  }, {
    prompt: explicitImagePrompt, questions: 0, actionType: 'image',
  }));

  const englishPrompt = 'Plan a restrained 20-second film about a woman leaving an empty station before dawn. Keep every visible reply in natural English, do not ask questions, and do not generate yet.';
  turns.push(await runTurn('english-language-following', {
    prompt: englishPrompt, currentPhase: 'idea',
  }, {
    prompt: englishPrompt, questions: 0, generationProhibited: true, replyLanguage: 'English',
  }));

  process.stdout.write('[creator-v2-llm-quality] independent-judge started\n');
  const judge = checkpoint.judge || await judgeOutputs(settings, turns);
  if (!checkpoint.judge) {
    checkpoint.judge = judge;
    writeCheckpoint(checkpoint);
  }
  process.stdout.write('[creator-v2-llm-quality] independent-judge passed\n');
  const runId = new Date().toISOString().replace(/[:.]/gu, '-');
  const runRoot = path.join(ARTIFACT_ROOT, runId);
  fs.mkdirSync(runRoot, { recursive: true });
  const report = {
    schema: 't8-creator-agent-v2-llm-quality-live-v1',
    status: 'passed',
    verifiedAt: new Date().toISOString(),
    execution: {
      serial: true,
      creatorScenarios: turns.length,
      creatorProviderCalls: checkpoint.creatorProviderCalls,
      judgeCalls: 1,
      totalProviderCalls: checkpoint.creatorProviderCalls + 1,
    },
    creatorModel: 'zhenzhen/gk-4.6',
    sourceDigest,
    judge,
    turns,
    persistedSecrets: false,
  };
  const reportFile = path.join(runRoot, 'report.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_ROOT, 'latest.json'), `${JSON.stringify({ runId, report: `${runId}/report.json` }, null, 2)}\n`, 'utf8');
  process.stdout.write(`[creator-v2-llm-quality] passed calls=${report.execution.totalProviderCalls} judge=${judge.average}/5\n`);
  process.stdout.write(`[creator-v2-llm-quality] artifact ${reportFile}\n`);
}

main().catch((error) => {
  const safe = String(error?.message || error)
    .replace(/sk-[A-Za-z0-9_-]+/giu, '[redacted-key]')
    .replace(/https?:\/\/\S+/giu, '[redacted-url]');
  process.stderr.write(`[creator-v2-llm-quality] failed: ${safe}\n`);
  process.exitCode = 1;
});
