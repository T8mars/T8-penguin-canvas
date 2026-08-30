'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('creator Agent panel is mounted as a themed floating UI from the primary canvas control rail', () => {
  const canvas = source('src/components/Canvas.tsx');
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  assert.match(canvas, /<CreatorAgentPanel/);
  assert.match(panel, /data-canvas-floating-ui="creator-agent-launcher"/);
  assert.match(panel, /data-theme-visual=\{props\.visualStyle\}/);
  assert.match(panel, /data-theme-mode=\{props\.themeMode\}/);
  assert.match(css, /\.t8-creator-agent-launcher/);
  assert.match(css, /\.t8-creator-agent-panel/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(panel, /CREATIVE_PHASES/);
  assert.match(panel, /aria-label="创作阶段"/);
  assert.match(css, /\.t8-creator-agent-phases/);
  assert.match(css, /\.t8-creator-agent-phase-receipt/);
  assert.match(panel, /session\?\.production\?\.currentPhase \|\| session\?\.phase/);
  assert.match(panel, /session\?\.production\?\.completedPhases/);
  assert.match(panel, /invalidatedPhaseIds\.has\(phase\.id\)/);
});


test('creator Agent explains completed, pending, and affected production scope', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  assert.match(panel, /completedPhaseLabels/);
  assert.match(panel, /pendingPhaseLabels/);
  assert.match(panel, /affectedPhaseLabels/);
  assert.match(panel, /aria-label="阶段范围回执"/);
  assert.match(panel, /<dt>已完成<\/dt>/);
  assert.match(panel, /<dt>待完成<\/dt>/);
  assert.match(panel, /<dt>影响范围<\/dt>/);
  assert.match(css, /\.t8-creator-agent-phase-scope/);
});

test('creator Agent records real shell and local-plan readiness receipts', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(panel, /launcherOpenedAtRef\.current = performance\.now\(\)/);
  assert.match(panel, /useLayoutEffect\(\(\) => \{/);
  assert.match(panel, /requestAnimationFrame\(\(\) => \{/);
  assert.match(panel, /shell\.dataset\.shellPaintReadyMs/);
  assert.match(panel, /CREATOR_SHELL_TARGET_MS = 300/);
  assert.match(panel, /data-creator-agent-plan-id=\{plan\.planId\}/);
  assert.match(panel, /data-local-plan-ms=\{props\.readinessReceipt\?\.localPlanMs\}/);
  assert.match(panel, /data-plan-production-file-writes/);
  assert.match(service, /t8-creator-agent-local-readiness-receipt-v1/);
  assert.match(service, /productionFileWrites: 0/);
});

test('creator Agent launcher exposes six readable production states', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  assert.match(panel, /data-status=\{launcherStatus\}/);
  assert.match(panel, /idle: '待命'/);
  assert.match(panel, /replying: '回复中'/);
  assert.match(panel, /approval: '待确认'/);
  assert.match(panel, /running: '运行中'/);
  assert.match(panel, /completed: '已完成'/);
  assert.match(panel, /warning: '需处理'/);
  assert.match(panel, /当前状态：\$\{launcherStatusLabel\}/);
  assert.match(panel, /t8-creator-agent-launcher__label" aria-hidden="true">AI</);
  assert.match(panel, /t8-creator-agent-launcher__status/);
  assert.match(css, /\.t8-creator-agent-launcher__label/);
  assert.match(css, /\.t8-creator-agent-launcher__status/);
  assert.match(css, /\[data-status="approval"\]/);
  assert.match(css, /\[data-status="warning"\]/);
});

test('creator Agent launcher pauses decorative motion while hidden or open', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  assert.match(panel, /document\.visibilityState !== 'hidden'/);
  assert.match(panel, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(panel, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(panel, /data-motion-active=\{!open && launcherPageVisible && launcherEffectsEnabled \? 'true' : 'false'\}/);
  assert.match(css, /\[data-motion-active="false"\].*t8-creator-agent-launcher__aura/);
  assert.match(css, /animation-play-state:\s*paused/);
});

test('creator Agent launcher offers a persistent low-resource effects control', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');

  assert.match(panel, /CREATOR_EFFECTS_STORAGE_KEY = 't8-creator-agent-effects-v1'/);
  assert.match(panel, /localStorage\.getItem\(CREATOR_EFFECTS_STORAGE_KEY\) !== 'off'/);
  assert.match(panel, /localStorage\.setItem\(CREATOR_EFFECTS_STORAGE_KEY, next \? 'on' : 'off'\)/);
  assert.match(panel, /data-effects-enabled=\{launcherEffectsEnabled \? 'true' : 'false'\}/);
  assert.match(panel, /关闭装饰特效（低资源模式）/);
  assert.match(panel, /aria-pressed=\{launcherEffectsEnabled\}/);
  assert.match(css, /\[data-theme-mode="light"\][\s\S]*?--creator-launcher-aura-blur:\s*5px/);
  assert.match(css, /\[data-theme-mode="dark"\][\s\S]*?--creator-launcher-aura-blur:\s*8px/);
  assert.match(css, /\[data-effects-enabled="false"\].*t8-creator-agent-launcher__aura/);
  assert.match(css, /filter:\s*none;[\s\S]*?animation:\s*none;/);
  assert.match(css, /\.t8-creator-agent-panel\[data-effects-enabled="false"\]/);
});

test('creator Agent launcher is the first compact item in the left control rail', () => {
  const canvas = source('src/components/Canvas.tsx');
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  const slotIndex = canvas.indexOf('data-canvas-floating-ui="creator-agent-launcher-slot"');
  const doctorIndex = canvas.indexOf('data-canvas-floating-ui="workflow-doctor-toggle"');

  assert.ok(slotIndex >= 0);
  assert.ok(doctorIndex > slotIndex);
  assert.match(canvas, /className="t8-control-rail-creator-slot"/);
  assert.match(panel, /querySelector<HTMLElement>\([\s\S]*creator-agent-launcher-slot/);
  assert.match(panel, /createPortal\(launcherButton, launcherHost\)/);
  assert.match(css, /\.t8-control-rail-creator-slot\s*\{/);
  assert.match(css, /\.t8-control-rail-creator-slot \.t8-creator-agent-launcher\s*\{/);
  assert.match(css, /width:\s*var\(--t8-theme-music-size, 32px\)/);
  assert.match(css, /height:\s*var\(--t8-theme-music-size, 32px\)/);
  assert.doesNotMatch(panel, /querySelector<HTMLElement>\('\.react-flow__minimap'\)/);
  assert.doesNotMatch(panel, /resolveCreatorAgentLauncherBottom/);
});

test('creator Agent launcher keeps an accessible fallback without map positioning state', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');

  assert.match(panel, /launcherHost \? createPortal\(launcherButton, launcherHost\) : launcherButton/);
  assert.match(panel, /aria-controls="t8-creator-agent-panel"/);
  assert.match(panel, /title=\{`AI 创作助手 · \$\{launcherStatusLabel\}`\}/);
  assert.doesNotMatch(panel, /launcherAnchor/);
  assert.doesNotMatch(panel, /launcherObstruction/);
  assert.doesNotMatch(panel, /data-anchor-source/);
});

test('creator Agent supports Escape close with focus restoration and explicit launcher ownership', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /launcherButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(panel, /window\.addEventListener\('keydown', handleEscape\)/);
  assert.match(panel, /event\.key !== 'Escape'/);
  assert.match(panel, /launcherButtonRef\.current\?\.focus\(\)/);
  assert.match(panel, /aria-controls="t8-creator-agent-panel"/);
  assert.match(panel, /id="t8-creator-agent-panel"/);
});

test('creator Agent exposes versioned pre-production documents without expanding the plan by default', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');
  assert.match(service, /t8-creator-production-document-v1/);
  assert.match(service, /t8-creator-production-document-confirmation-v1/);
  assert.match(service, /productionDocuments\?: CreatorAgentProductionDocument\[\]/);
  assert.match(panel, /plan\.productionDocuments/);
  assert.match(panel, /创作前期文档/);
  assert.match(panel, /可用一句话修改/);
  assert.match(panel, /尚未识别明确结构，不会把猜测写成人物、场景或镜头设定/);
  assert.match(panel, /新版本不会覆盖上一版/);
  assert.match(panel, /<details className="t8-creator-agent-production-documents">/);
  assert.doesNotMatch(panel, /<details className="t8-creator-agent-production-documents" open/);
  assert.match(panel, /confirmCreatorAgentProductionDocuments/);
  assert.match(panel, /确认此版/);
  assert.match(panel, /确认全部当前版本/);
  assert.match(panel, /较 v\{changeSummary\.baseRevision\} 改了/);
  assert.match(panel, /session\?\.latestPlan\?\.planId === currentStagePlan\.planId/);
  assert.match(panel, /confirmation\.contentDigest === document\.contentDigest/);
  assert.match(css, /\.t8-creator-agent-production-documents/);
  assert.match(css, /\.t8-creator-agent-production-document-diff/);
  assert.match(css, /\.t8-creator-agent-production-document-confirm/);
  assert.match(css, /var\(--creator-bg\)/);
  assert.doesNotMatch(css, /\.t8-creator-agent-production-document(?:-diff|-confirm)[^{]*\{[^}]*#[0-9a-f]{3,8}/i);
  assert.match(service, /t8-creator-script-analysis-v1/);
  assert.match(service, /method: 'deterministic-source-map'/);
  assert.match(panel, /t8-creator-agent-script-analysis/);
  assert.match(panel, /原文结构/);
  assert.match(panel, /模型调用 0 次，推断事实 0 项/);
  assert.match(panel, /sourceRange\.lineStart/);
  assert.match(css, /\.t8-creator-agent-script-analysis/);
  assert.match(css, /color-mix\(in srgb, var\(--creator-accent\)/);
  assert.doesNotMatch(css, /\.t8-creator-agent-script-analysis[^{]*\{[^}]*#[0-9a-f]{3,8}/i);
  assert.match(service, /t8-creator-source-derivation-v1/);
  assert.match(service, /'character-bible'/);
  assert.match(service, /'asset-needs'/);
  assert.match(service, /'shot-list'/);
  assert.match(service, /'audio-plan'/);
  assert.match(service, /'storyboard'/);
  assert.match(service, /'prompt-pack'/);
  assert.match(service, /'candidate-review'/);
  assert.match(service, /'edit-decision-list'/);
  assert.match(service, /'qc-report'/);
  assert.match(panel, /productionDocumentSourceReady/);
  assert.match(panel, /角色来源/);
  assert.match(panel, /资产缺口/);
  assert.match(panel, /镜头表/);
  assert.match(panel, /AudioPlan/);
  assert.match(panel, /明确声音标签/);
  assert.match(panel, /分镜板/);
  assert.match(panel, /PromptPack/);
  assert.match(panel, /真实候选证据/);
  assert.match(panel, /实际媒体已审/);
  assert.match(panel, /旧采用记录待复核/);
  assert.match(panel, /已采用/);
  assert.match(panel, /缺失/);
  assert.match(service, /t8-creator-edl-v1/);
  assert.match(service, /verified-adopted-video-sequence/);
  assert.match(panel, /EDL 剪辑顺序/);
  assert.match(panel, /请求时长仅作提示，不会冒充真实成片时长/);
  assert.match(panel, /实际视频已审、硬门通过且采用回执有效/);
  assert.match(panel, /候选画面仍需创作者显式采用和锁定/);
  assert.match(service, /persisted-artifact-qc-evidence/);
  assert.match(service, /persisted-receipts-only/);
  assert.match(panel, /QC 质量检查/);
  assert.match(panel, /缺证据保持未知/);
  assert.match(panel, /文件扫描 0 次/);
  assert.match(panel, /不会扫描文件、重新验证、下载、生成、渲染或交付/);
  assert.match(panel, /EDL 来源版本已确认/);
  assert.match(service, /'delivery-manifest'/);
  assert.match(service, /verified-local-delivery-package-evidence/);
  assert.match(service, /completed-verified-package-receipts-only/);
  assert.match(panel, /DeliveryManifest 交付证据/);
  assert.match(panel, /已包含并复核/);
  assert.match(panel, /被 QC 阻断/);
  assert.match(panel, /等待当前版本交付包/);
  assert.match(panel, /交付文件写入 0 次/);
  assert.match(panel, /不会创建或覆盖文件、重新打包、下载、调用 Provider、渲染或写画布/);
  assert.match(panel, /QCReport 来源版本已确认/);
  assert.match(panel, /时长、景别、运镜、声音与关联资产待补/);
  assert.match(panel, /素材生成 0 次/);
  assert.match(panel, /画布写入 0 次/);
  assert.match(panel, /先确认来源/);
  assert.match(panel, /确认不会上传、生成、采用、锁定或覆盖素材/);
  assert.match(panel, /来源版本已确认/);
  assert.match(panel, /确认只接受此版 AudioPlan 文本与分轨结构/);
  assert.match(panel, /不会调用模型、生成音频、上传素材或提交任务/);
  assert.match(panel, /确认只接受此版 PromptPack 文本与结构/);
  assert.match(panel, /不会创建剪辑节点、修改时间线或渲染成片/);
  assert.match(panel, /不会自动采用、锁定、运行或生成素材/);
  assert.match(css, /\.t8-creator-agent-source-proposals/);
  assert.doesNotMatch(css, /\.t8-creator-agent-source-proposals[^{]*\{[^}]*#[0-9a-f]{3,8}/i);
}
);

test('creator Agent shows source-bound reference breakdown results and recovery states without implying another Provider run', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(service, /t8-reference-video-breakdown-evidence-v1/);
  assert.match(service, /'awaiting-run-evidence' \| 'pending' \| 'verified' \| 'failed' \| 'invalid-run-evidence'/);
  assert.match(service, /runEvidenceReason: string/);
  assert.match(service, /startTimecode\?: string/);
  assert.match(service, /endTimecode\?: string/);
  assert.match(service, /editablePrompt\?: string/);
  assert.match(service, /transcriptAttribution\?: 'provider-segments' \| 'untimed' \| ''/);
  assert.match(panel, /content\.status === 'analysis-result-ready'/);
  assert.match(panel, /已安全回收 \$\{shots\.length\} 个镜头/);
  assert.match(panel, /拉片节点正在运行/);
  assert.match(panel, /拉片结果未通过来源与结构校验/);
  assert.match(panel, /已有来源匹配的拉片节点/);
  assert.match(panel, /shot\.startTimecode \|\| '未知'/);
  assert.match(panel, /shot\.endTimecode \|\| '未知'/);
  assert.match(panel, /shot\.action \|\| shot\.description/);
  assert.match(panel, /输出摘要 \$\{evidence\.outputDigest\.slice\(0, 12\)\}/);
  assert.match(panel, /确认只冻结此作品文档版本，不会重复运行 Provider/);
  assert.match(panel, /运行证据已核验：Run \$\{evidence\.runId\} · NodeRun \$\{evidence\.nodeRunId\} · Attempt \$\{evidence\.attemptId\}/);
  assert.match(panel, /evidence\?\.runEvidenceReason/);
  assert.match(panel, /结果证据已核验/);
  assert.match(panel, /plan\.action === 'review\.reference-breakdown'/);
  assert.match(panel, /plan\.action === 'recover\.reference-breakdown'/);
  assert.match(panel, /const hasCanvasPatch = Boolean\(plan\.patchId\)/);
  assert.match(panel, /拉片结果与运行证据已核验/);
  assert.match(panel, /拉片结果已回收，运行证据待核对/);
  assert.match(panel, /请处理来源拉片节点后继续/);
  assert.match(panel, /hasCanvasPatch && !isReferenceBreakdownReview && !isReferenceBreakdownRecovery/);
  assert.doesNotMatch(panel, /plan\.ready && \(\s*<button[\s\S]{0,300}预览并发送到画布/);
});

test('creator Agent preview uses the Canvas baseline callback and never directly applies a plan', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const canvas = source('src/components/Canvas.tsx');
  assert.match(panel, /props\.onPreviewPatch\(prepared\.patch\)/);
  assert.match(panel, /const toolProposalBinding = proposal\.binding\.workId/);
  assert.match(panel, /session\.creatorWork\?\.workDigest !== proposalBinding\.workDigest/);
  assert.match(panel, /作品版本已变化，这条操作预览已失效/);
  assert.match(panel, /session\.creatorWork\.invalidatedKinds\.join\('、'\)/);
  assert.match(panel, /event\.type === 'user\.suggestion'/);
  assert.match(panel, /已选择：/);
  assert.doesNotMatch(panel, /: suggestion\.label,\s*!isPristineSession/);
  assert.match(panel, /function creatorPatchPreviewItem\(/);
  assert.match(panel, /patchPreview\?\.preview\.changes\.map\(\(change\) => creatorPatchPreviewItem\(change, patchPreview\.patch\)\)/);
  assert.match(panel, /patchPreview\.preview\.affectedNodeIds\.length/);
  assert.match(panel, /patchPreview\.preview\.affectedEdgeIds\.length/);
  assert.match(panel, /aria-label="将写入画布的节点和连线"/);
  assert.match(panel, /change\.type === 'node\.add'/);
  assert.match(panel, /creatorPatchPositionLabel\(node\.position\)/);
  assert.match(panel, /change\.type === 'edge\.add'/);
  assert.match(panel, /creatorPatchEndpoint\(edge\.source, edge\.sourceHandle\)/);
  assert.match(panel, /creatorPatchEndpoint\(edge\.target, edge\.targetHandle\)/);
  assert.match(panel, /patchPreview\.plan\.assetPlacement\.lineage\.assetId/);
  assert.match(panel, /patchPreview\.plan\.assetPlacement\.lineage\.contentRevision/);
  assert.match(panel, /patchPreview\.plan\.assetPlacement\.lineage\.contentHash\.slice\(0, 12\)/);
  assert.doesNotMatch(panel, /JSON\.stringify\(patchPreview/);
  assert.doesNotMatch(panel, /\{canvasPatchDiffText\(change\.before\)\}/);
  const css = source('src/styles/index.css');
  assert.match(css, /\.t8-creator-agent-confirm__changes/);
  assert.match(css, /\.t8-creator-agent-confirm__lineage/);
  assert.match(css, /max-height:\s*min\(240px,\s*30vh\)/);
  assert.match(css, /var\(--creator-secondary\)/);
  assert.doesNotMatch(css, /\.t8-creator-agent-confirm__(?:changes|lineage)[^{]*\{[^}]*#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(panel, /api\.previewCanvasPatch\(props\.canvasId,\s*prepared\.patch\)/);
  assert.match(panel, /确认添加到画布/);
  assert.match(panel, /props\.onApplyPatch\(patchPreview\.patch,\s*patchPreview\.preview\)/);
  assert.match(panel, /没有你的确认，不会写画布或调用模型/);
  assert.match(panel, /const applyResult = await props\.onApplyPatch/);
  assert.match(panel, /appliedRevision: applyResult\.revision/);
  assert.doesNotMatch(panel, /appliedRevision:\s*patchPreview\.preview\.baseRevision \+ 1/);
  assert.match(panel, /props\.onRevertPatch\(state\.patchId,\s*state\.appliedRevision\)/);
  assert.match(panel, /type: 'plan\.reverted'/);
  assert.match(panel, /撤回这次画布变更/);
  assert.match(canvas, /return enqueueCanvasMutation\(canvasId,\s*async \(\) => \{/);
  assert.match(canvas, /onRevertPatch=\{handleRevertCanvasPatch\}/);
  const route = source('backend/src/routes/creatorAgent.js');
  assert.match(route, /canonicalCreatorCanvasLifecycle/);
  const evidence = source('backend/src/services/creatorAgentProductionEvidence.js');
  assert.match(evidence, /database\.listCanvasPatches/);
  assert.match(evidence, /CREATOR_PATCH_REVISION_MISMATCH/);
});

test('creator Agent empty state presents exactly three stable rotatable local ideas', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const ideas = source('src/utils/creatorAgentStarterIdeas.ts');
  const catalog = JSON.parse(source('backend/src/shared/creatorAgentStarterCatalog.json'));
  assert.equal(catalog.schema, 't8-creator-agent-starter-catalog-v2');
  assert.equal(catalog.modes['blank-new'].length, 12);
  assert.equal(catalog.modes['attachment-ready'].length, 3);
  assert.equal(catalog.modes['selection-ready'].length, 3);
  assert.equal(catalog.modes['resumed-session'].length, 0);
  assert.equal(
    catalog.modes['blank-new'].some((item) => (
      /当前|现有|这组|这个|这些|它|继续|接着|沿用|完善|补齐|只重做|恢复|检查当前/.test(item.label)
    )),
    false,
  );
  assert.match(ideas, /CREATOR_AGENT_STARTER_IDEA_BATCH_COUNT/);
  assert.match(ideas, /creatorAgentStarterMode/);
  assert.match(ideas, /allowCanvasContext/);
  assert.match(ideas, /allowFailureContext/);
  assert.match(ideas, /creatorAgentStarterIdeaContextKey/);
  assert.match(ideas, /creatorAgentStarterIdeaBatch/);
  assert.match(panel, /isPristineSession = allVisibleEvents\.length === 0/);
  assert.match(panel, /attachmentKinds: messageAttachments\.map/);
  assert.match(panel, /mode: starterIdeaMode/);
  assert.match(panel, /creatorPrompt: idea\.starterPrompt/);
  assert.match(panel, /requiredCapabilityIds: \[\.\.\.idea\.requiredCapabilityIds\]/);
  assert.match(panel, /starterIdeaRotationStorageKey/);
  assert.match(panel, /localStorage\.setItem\(starterIdeaRotationStorageKey/);
  assert.match(panel, /aria-label="换一批创作想法"/);
  assert.match(panel, /只更换本地创作想法，不调用模型/);
  assert.match(panel, /isPristineSession[\s\S]*?\? starterIdeaSuggestions/);
  assert.match(panel, /!isPristineSession && session\?\.suggestionSet\?\.setDigest/);
  assert.match(panel, /session\?\.suggestionSet\?\.items\?\.length === 3/);
  assert.match(panel, /suggestions\.length === 3/);
  assert.match(panel, /suggestion\.expectedEffect/);
  assert.match(panel, /suggestionReceiptReady/);
  assert.match(panel, /setDigest:\s*session\.suggestionSet\.setDigest/);
  assert.match(panel, /这 3 条建议来自旧会话版本，请先发送一句新要求刷新建议/);
  assert.match(panel, /suggestion\.requiredCapabilityIds[\s\S]*?\.find/);
  assert.match(panel, /!suggestion\.executable/);
  assert.match(panel, /blockedReason/);
  assert.match(panel, /suggestionContractBroken/);
  assert.match(panel, /无法提供完整的 3 条建议/);
  assert.match(panel, /const latestCompletedResponseEvent =/);
  assert.match(panel, /const latestCompletedSuggestionSet = latestCompletedResponseEvent\?\.payload\.suggestionSet as/);
  assert.match(panel, /const recommendationChoicesReady = !thinkingActive/);
  assert.match(panel, /latestCompletedSuggestionSetDigest === session\?\.suggestionSet\?\.setDigest/);
  assert.match(panel, /recommendationChoicesReady && suggestions\.length === 3/);
});

test('creator Agent keeps suggestion contracts but hides technical receipts from the chat-first choices', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(panel, /function creatorSuggestionReceipt/);
  assert.match(panel, /providerCalls === 0/);
  assert.match(panel, /模型调用 0 次/);
  assert.match(panel, /L0 · 本步只读/);
  assert.match(panel, /后续写画布或生成仍按各自合同确认/);
  assert.doesNotMatch(panel, /t8-creator-agent-suggestions__effect/);
  assert.doesNotMatch(panel, /t8-creator-agent-suggestions__receipts/);
  assert.doesNotMatch(panel, /data-kind="cost"/);
  assert.doesNotMatch(panel, /data-kind="risk"/);
  assert.match(panel, /aria-label=\{accessibleLabel\}/);
  assert.match(panel, /suggestion\.description/);
  assert.match(panel, /✎ 我有其他想法/);
  assert.match(panel, /setCustomIdeaDraft/);
  assert.match(panel, /void submit\(value\)/);
  assert.match(panel, /event\.type === 'user\.suggestion'/);
  assert.match(panel, /t8-creator-agent-suggestion-selection/);
  assert.match(service, /providerCalls: 0/);
  assert.match(service, /riskLevel: 'L0'/);
  assert.match(service, /approvalRequired: false/);
});

test('creator Agent keeps new conversation explicit without a persistent task-details footer', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');

  assert.match(panel, /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/);
  assert.match(panel, /className="t8-creator-agent-new-session"/);
  assert.match(panel, /aria-label="新对话"/);
  assert.match(panel, /startNewConversation/);
  assert.match(panel, /ensureSession\(true\)/);
  assert.match(panel, /phase:\s*'idea'/);
  assert.match(panel, /recentActions:\s*\[\]/);
  assert.match(service, /sessionId:\s*input\.sessionId\s*\|\|\s*crypto\.randomUUID\(\)/);
  assert.match(service, /status\s*<\s*500/);
  assert.match(service, /setTimeout\(resolve,\s*220\)/);
  assert.match(service, /getCreatorAgentSession\(/);
  assert.doesNotMatch(panel, /className="t8-creator-agent-details-entry"/);
  assert.doesNotMatch(panel, />任务与详情</);
  assert.doesNotMatch(panel, /aria-controls="t8-creator-agent-details-content"/);
  assert.match(panel, /\{false && detailsOpen && \(\s*<section[\s\S]*?className="t8-creator-agent-details"/);
  assert.doesNotMatch(panel, /className="t8-creator-agent-plan-summary"/);
  assert.doesNotMatch(panel, /<PlanCard[\s\S]*?plan=\{plan\}/);
  assert.doesNotMatch(panel, /<LifecycleActivity event=\{event\}/);
  assert.doesNotMatch(panel, /<span>Standard<\/span>/);
  assert.doesNotMatch(panel, /<span>手动确认<\/span>/);
  assert.match(css, /\.t8-creator-agent-message__body > p\s*\{[\s\S]*?font-size:\s*14\.5px/);
  assert.match(css, /\.t8-creator-agent-composer textarea\s*\{[\s\S]*?font-size:\s*14px/);
  assert.match(css, /\.t8-creator-agent-suggestions button\s*\{[\s\S]*?min-height:\s*76px/);
  assert.match(css, /\.t8-creator-agent-suggestions__content > small/);
  assert.match(css, /\.t8-creator-agent-custom-idea/);
});

test('creator Agent confirms a completed stage, retains it on Canvas, then continues automatically', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /interface PendingStageContinuation/);
  assert.match(panel, /const \[pendingStageContinuation, setPendingStageContinuation\]/);
  assert.match(panel, /session\?\.latestPlan\?\.planId === currentStagePlan\.planId/);
  assert.match(panel, /'confirmCurrentStage' in suggestion\.arguments/);
  assert.match(panel, /continueFromStageSuggestion/);
  assert.match(panel, /const phaseTransitionReady = Boolean/);
  assert.match(panel, /result\.phaseTransition\.nextPhase === targetPhase/);
  assert.match(panel, /result\.phaseTransition\.completed === true/);
  assert.match(panel, /readyAfterApply: !result\.canvasRetention/);
  assert.match(panel, /if \(productionFinished\) \{\s*setPendingStageContinuation\(null\);\s*return;/);
  assert.match(panel, /setPendingStageContinuation\(\(current\) => \(\s*current \? \{ \.\.\.current, readyAfterApply: true \}/);
  assert.match(panel, /void submit\(prompt, undefined, \{ stageContinuation: true \}\)/);
  assert.match(panel, /Agent 会自动进入/);
  assert.match(panel, /确认添加到画布/);
  assert.match(panel, /正在构思并整理本阶段方案/);
  assert.match(panel, /\{'（已 '\}\{thinkingSeconds\} 秒）/);
});

test('creator Agent keeps model tool proposals approval-gated and opens the existing preview flow', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');

  assert.match(service, /export interface CreatorAgentToolProposal/);
  assert.match(service, /dispatchAllowed: false/);
  assert.match(service, /status: 'not-started'/);
  assert.match(service, /toolProposals\?: CreatorAgentToolProposal\[\]/);
  assert.match(service, /toolProposalReceipts\?: CreatorAgentToolProposalReceipt\[\]/);
  assert.match(service, /export function prepareCreatorAgentToolProposal/);
  assert.match(service, /tool-proposals\/\$\{encodeURIComponent\(proposalId\)\}\/prepare/);
  assert.match(panel, /latestCompletedResponseId/);
  assert.match(panel, /proposal\.binding\.responseId === latestCompletedResponseId/);
  assert.match(panel, /prepareCreatorAgentToolProposal\(/);
  assert.match(panel, /await props\.onPreviewPatch\(prepared\.patch\)/);
  assert.match(panel, /type: 'plan\.previewed'/);
  assert.match(panel, /onClick=\{\(\) => void prepareToolProposal\(proposal\)\}/);
  assert.match(panel, /预览并确认/);
  assert.match(panel, /Agent 不会自动生成内容、改动画布或写入文件/);
  assert.doesNotMatch(panel, /proposal\.tool[^\n]*\.(dispatch|invoke|apply|run)\(/);
  assert.ok(
    panel.indexOf('t8-creator-agent-tool-proposals')
      > panel.indexOf('id="t8-creator-agent-details-content"'),
    'the first proposal surface remains inside the separate details panel',
  );
  assert.match(css, /\.t8-creator-agent-tool-proposals\s*\{/);
  assert.match(css, /\.t8-creator-agent-tool-proposals strong\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(css, /\.t8-creator-agent-tool-proposals article > button/);
});
test('creator Agent fails closed until the shared capability contract is verified', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(panel, /getCreatorAgentCapabilities\(\)/);
  assert.match(panel, /value\.principles\.directCanvasMutation === false/);
  assert.match(panel, /value\.principles\.previewBeforeApply === true/);
  assert.match(panel, /value\.principles\.explicitApprovalForWrites === true/);
  assert.match(panel, /value\.capabilityGraph\?\.schema === 't8-creative-capability-graph-v1'/);
  assert.match(panel, /value\.capabilityGraph\.counts\.unknownNodeReferences === 0/);
  assert.match(panel, /value\.capabilityGraph\.counts\.handlers === value\.capabilityGraph\.counts\.capabilities/);
  assert.match(panel, /value\.capabilityGraph\.counts\.missingOperationRisk === 0/);
  assert.match(service, /capabilityGraph: \{/);
  assert.match(panel, /disabled=\{\(!draft\.trim\(\) && messageAttachments\.length === 0\) \|\| busy \|\| uploading \|\| !capabilityReady\}/);
  assert.match(service, /t8-creative-capability-manifest-v1/);
  assert.match(service, /creator-agent-capability-surfaces\.json/);
  assert.match(service, /t8-creative-capability-surfaces-v1/);
  assert.match(service, /capabilityManifestVersion: string/);
  assert.match(service, /data\.version !== contract\.capabilityManifestVersion/);
  assert.match(service, /data\.digest !== contract\.sourceDigest/);
  assert.match(service, /data\.capabilityGraph\.aggregateDigest !== contract\.capabilityGraphDigest/);
  assert.match(service, /surface\.agentTool\.version !== contract\.capabilityManifestVersion/);
  assert.match(service, /surface\.agentTool\.protocol !== 't8-versioned-creative-tool-v1'/);
  assert.match(service, /surface\.agentTool\.requestSchema !== 't8-versioned-creative-tool-request-v1'/);
  assert.match(service, /surface\.agentTool\.resultSchema !== 't8-versioned-creative-tool-result-v1'/);
  assert.match(service, /surface\.agentTool\.directOperations\.includes\(surface\.agentTool\.defaultOperation\)/);
  assert.match(service, /actual\.handler !== surface\.agentTool\.handler/);
  assert.match(service, /actual\.cli\?\.command !== surface\.cli\.command/);
  assert.match(service, /actual\.uiAction !== surface\.ui\.action/);
  assert.match(service, /JSON\.stringify\(actual\.operations\) !== JSON\.stringify\(surface\.ui\.operations\)/);
  assert.match(service, /CREATOR_CAPABILITY_SURFACE_DRIFT/);
  assert.match(service, /creatorRequest<CreatorAgentCapabilities>\('\/capabilities'\)/);
});

test('creator Agent model picker keeps known models visible and blocks unready runtime choices', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  const controlRoute = source('backend/src/routes/agentControl.js');
  const decision = source('backend/src/services/creatorAgentModelDecision.js');
  assert.match(service, /interface CreatorAgentRuntimeReadiness/);
  assert.match(panel, /disabled=\{!creatorRuntimeModelExecutable\(item\)\}/);
  assert.match(panel, /creatorRuntimeModelStatus\(item\)/);
  assert.doesNotMatch(panel, /delete next\[kind\]/);
  assert.match(panel, /currentPreference && !currentModel/);
  assert.match(panel, /已固定：\{currentPreference\.provider\}/);
  assert.match(panel, /modelDecisionReceipt/);
  assert.match(panel, /没有自动切换平台或模型|fallbackPolicy\.message/);
  assert.match(panel, /decision\.reasons\.length/);
  assert.match(panel, /输入兼容：/);
  assert.match(panel, /decision\.estimates\.cost\.message/);
  assert.match(panel, /decision\.estimates\.latency\.message/);
  assert.match(panel, /alternative\.platformLabel/);
  assert.match(panel, /alternative\.compatibility\.reasons/);
  assert.match(panel, /approvalBoundary\.privacyBoundary\.message/);
  assert.match(route, /createCreatorModelDecision/);
  assert.match(controlRoute, /\.\.\.approvalBoundary/);
  assert.match(decision, /CREATOR_MODEL_RUNTIME_NOT_READY/);
  assert.match(decision, /assertCreatorModelDecisionReceipt/);
});
test('creator Agent resumes append-only session events over an EventSource cursor', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(service, /new EventSource/);
  assert.match(service, /after: String\(Math\.max\(0, Math\.trunc\(input\.after \|\| 0\)\)\)/);
  assert.match(service, /addEventListener\('creator\.event'/);
  assert.match(service, /addEventListener\('stream\.error'/);
  assert.match(panel, /subscribeCreatorAgentEvents/);
  assert.match(panel, /getCreatorAgentSession\(session\.id, props\.projectId, props\.canvasId\)/);
  assert.match(panel, /CREATOR_ACTIVITY_EVENT_TYPES/);
  assert.match(panel, /LifecycleActivity/);
});

test('creator Agent closes without cancelling work and refreshes the same durable session on reopen', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const route = source('backend/src/routes/creatorAgent.js');
  const closeHandler = panel.match(
    /const closeAndRestoreLauncherFocus = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  );
  const resumeEffect = panel.match(
    /useEffect\(\(\) => \{\r?\n    if \(!open \|\| !session\?\.id\) return undefined;[\s\S]*?const refresh = async \(\) => \{([\s\S]*?)\r?\n    \};\r?\n    void refresh\(\);\r?\n    const close = subscribeCreatorAgentEvents\(/,
  );
  assert.ok(closeHandler, 'close handler must remain explicit and auditable');
  assert.match(closeHandler[1], /setOpen\(false\)/);
  assert.doesNotMatch(closeHandler[1], /stopCreatorAgentResponse|cancel|runBus/);
  assert.ok(resumeEffect, 'reopen must fetch the authoritative session before relying on live replay');
  assert.match(resumeEffect[1], /getCreatorAgentSession\(session\.id, props\.projectId, props\.canvasId\)/);
  assert.match(resumeEffect[1], /latest\.id === session\.id/);
  assert.match(resumeEffect[1], /current\?\.id === latest\.id[\s\S]*latest\.lastSequence[\s\S]*current\.lastSequence/);
  assert.match(panel, /after: cursor/);
  assert.match(panel, /重新打开面板会从最后一条已确认事件继续。/);
  assert.match(route, /sessions\.eventsAfter\(session\.id, cursor, 200\)/);
  assert.match(route, /writeEvent\('cursor\.reset'/);
  assert.match(route, /syncCreatorRunEvents\(session\.id\)/);
});

test('creator Agent renders durable response deltas as one resumable message', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  const sessions = source('backend/src/services/creatorAgentSessions.js');
  const css = source('src/styles/index.css');
  assert.match(service, /stream: input\.stream !== false/);
  assert.match(panel, /mergeCreatorAgentSessionEvent/);
  assert.match(panel, /creatorDisplayEvents/);
  assert.match(panel, /assistant\.response\.delta/);
  assert.match(panel, /data-creator-agent-live-status="true"/);
  assert.match(panel, /贞贞创作 Agent 回复完成/);
  assert.match(panel, /aria-live="off"/);
  assert.match(panel, /aria-busy=\{hasStreamingResponse\}/);
  assert.match(panel, /t8-creator-agent-stream-status" aria-hidden="true"/);
  assert.match(panel, /aria-relevant="additions text"/);
  assert.match(route, /activeMessageStreams/);
  assert.match(route, /setInterval\(pump, 200\)/);
  assert.match(sessions, /CREATOR_RESPONSE_DELTA_OUT_OF_ORDER/);
  assert.match(sessions, /assistant\.response\.completed/);
  assert.match(css, /\.t8-creator-agent-stream-status/);
  assert.match(css, /t8-creator-agent-stream-pulse/);
});

test('creator Agent stops only the local reply and distinguishes remote task cancellation', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  const sessions = source('backend/src/services/creatorAgentSessions.js');
  const css = source('src/styles/index.css');
  assert.match(service, /stopCreatorAgentResponse/);
  assert.match(service, /t8-creator-response-stop-v1/);
  assert.match(route, new RegExp('responses/:responseId/stop'));
  assert.match(route, /remoteTasksAffected:\s*0/);
  assert.match(route, /active\.stopRequested = true/);
  assert.match(sessions, /stopStreamingTurn/);
  assert.match(sessions, /assistant\.response\.stopped/);
  assert.match(sessions, /remoteTasksAffected:\s*0/);
  assert.match(panel, /停止回复只结束本轮文字输出/);
  assert.match(panel, /取消远端任务需在对应任务卡单独操作/);
  assert.match(panel, /停止本轮回复，不取消远端生成任务/);
  assert.match(panel, /event\.type === 'assistant\.response\.stopped'/);
  assert.match(panel, /streamStatus:\s*'stopped'/);
  assert.match(css, /button\.is-stop-response/);
});

test('creator Agent composer is IME safe and receives focus after opening', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /CREATOR_IME_COMMIT_GUARD_MS = 140/);
  assert.match(panel, /composerRef = useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(panel, /composerFocusPendingRef = useRef\(false\)/);
  assert.match(panel, /composerComposingRef = useRef\(false\)/);
  assert.match(panel, /compositionEndedAtRef = useRef\(0\)/);
  assert.match(panel, /nativeEvent\.isComposing/);
  assert.match(panel, /nativeEvent\.keyCode === 229/);
  assert.match(panel, /Date\.now\(\) - compositionEndedAtRef\.current < CREATOR_IME_COMMIT_GUARD_MS/);
  assert.match(panel, /onCompositionStart=\{\(\) => \{/);
  assert.match(panel, /onCompositionEnd=\{\(\) => \{/);
  assert.match(panel, /data-creator-agent-composer="true"/);
  assert.match(panel, /composer\.focus\(\)/);
  assert.match(panel, /!session\?\.id/);
  assert.match(panel, /!capabilityContractReady\(capabilities\)/);
  assert.match(panel, /aria-labelledby="t8-creator-agent-title"/);
});

test('creator Agent context includes bounded canvas, viewport, output and failed Run summaries', () => {
  const canvas = source('src/components/Canvas.tsx');
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const backend = source('backend/src/services/creatorAgentSessions.js');
  assert.match(canvas, /nodeTypeCounts=\{nodes\.reduce/);
  assert.match(canvas, /viewport=\{getViewport\(\)\}/);
  assert.match(panel, /failedRunCount: runDetails\.filter/);
  assert.match(panel, /outputAssetCount: runDetails\.reduce/);
  assert.match(panel, /recentRuns: runDetails\.slice\(0, 5\)/);
  assert.match(backend, /recentRuns: \(Array\.isArray\(input\.recentRuns\)/);
  assert.match(backend, /normalized\.failedRunCount > 0/);
  assert.match(backend, /recovery-explain/);
  assert.match(backend, /recovery-retry-scope/);
  assert.match(backend, /recovery-continue/);
});

test('creator Agent supports lightweight explicit node references with persisted asset grounding', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const backend = source('backend/src/services/creatorAgentSessions.js');
  const css = source('src/styles/index.css');
  assert.equal(service.includes('referencedNodeIds?: string[]'), true);
  assert.equal(service.includes('referencedNodeTypes?: string[]'), true);
  assert.match(panel, /const CREATOR_REFERENCE_LIMIT = 8/);
  assert.equal(panel.includes('const [referencedNodes, setReferencedNodes]'), true);
  assert.match(panel, /aria-label="引用当前选区"/);
  assert.match(panel, /把当前选区固定为本轮引用；已持久化素材会一并发送/);
  assert.equal(panel.includes('creatorProjectAssetMediaRef(asset.id)'), true);
  assert.equal(panel.includes('/api/project-assets/${encodeURIComponent(assetId)}/media'), true);
  assert.match(panel, /attachments: messageAttachments/);
  assert.equal(panel.includes('setReferencedNodes([])'), true);
  assert.match(panel, /只移除本轮引用，不删除画布节点或素材/);
  assert.equal(backend.includes('referencedNodeIds: Array.isArray(input.referencedNodeIds)'), true);
  assert.equal(backend.includes('const referencedObject = normalized.referencedNodeIds'), true);
  assert.equal(backend.includes('referencedNodeIds: [...normalized.referencedNodeIds].sort()'), true);
  assert.equal(css.includes('.t8-creator-agent-references'), true);
  assert.equal(/asset\.sourceUrl[^\n]*ref:/.test(panel), false);
  assert.match(backend, /function creatorContextFocus\(normalized\)/);
  assert.match(backend, /const viewportObject = normalized\.canvasObjects\.find\(\(item\) => item\.inViewport\)/);
  assert.match(panel, /当前视口聚焦/);
});

test('creator Agent keeps 500-message sessions lightweight with an 80-item accessible history window', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /CREATOR_MESSAGE_WINDOW_SIZE = 80/);
  assert.match(panel, /allVisibleEvents\.slice\(historyWindowStart, historyWindowEnd\)/);
  assert.match(panel, /role="log"/);
  assert.match(panel, /aria-live="off"/);
  assert.match(panel, /长会话消息翻页/);
  assert.match(panel, /更早消息/);
  assert.match(panel, /较新消息/);
});

test('creator Agent panel width is persistently adjustable from 420 to 560 pixels', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const css = source('src/styles/index.css');
  assert.match(panel, /CREATOR_PANEL_MIN_WIDTH = 420/);
  assert.match(panel, /CREATOR_PANEL_MAX_WIDTH = 560/);
  assert.match(panel, /onPointerDown=\{beginPanelResize\}/);
  assert.match(panel, /onKeyDown=\{resizePanelWithKeyboard\}/);
  assert.match(css, /--creator-panel-width/);
  assert.match(css, /\.t8-creator-agent-resize-handle/);
});

test('creator Agent shows only persisted Run, NodeRun, Attempt and artifact references as task status', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /api\.listProjectRuns/);
  assert.match(panel, /api\.getProjectRun/);
  assert.match(panel, /Run \/ NodeRun \/ Attempt/);
  assert.match(panel, /nodeRun\.attempts/);
  assert.match(panel, /nodeRun\.outputRefs/);
  assert.doesNotMatch(panel, /Math\.random\(\).*progress/s);
});

test('creator Agent history restores a durable Creator Session instead of cloning production state', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  assert.match(service, /export function listCreatorAgentSessions/);
  assert.match(panel, /listCreatorAgentSessions\(props\.projectId, props\.canvasId, 20\)/);
  assert.match(panel, /localStorage\.setItem\(storageKey\(props\.projectId, props\.canvasId\), next\.id\)/);
  assert.match(panel, /setSession\(next\)/);
});

test('creator Agent resolves a bounded set of persisted outputRefs through the existing asset catalog', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(panel, /\.slice\(0, 12\)/);
  assert.match(panel, /api\.getProjectAsset\(assetId\)/);
  assert.match(panel, /asset\.filename/);
  assert.match(panel, /asset\.availability/);
  assert.match(panel, /已持久化资产索引/);
});

test('creator Agent can locate the authoritative source node for a persisted NodeRun', () => {
  const canvas = source('src/components/Canvas.tsx');
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(canvas, /onFocusNode=\{focusGenerationHistoryNode\}/);
  assert.match(panel, /nodeRun\.originalNodeId \|\| nodeRun\.nodeId/);
  assert.match(panel, /props\.onFocusNode\(focusNodeId\)/);
  assert.match(panel, /定位节点/);
});

test('creator Agent sends a verified artifact to Canvas through preview, confirmation and evidence sync', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  assert.match(client, /createCreatorAgentAssetPlacePlan/);
  assert.match(client, /assets\/\$\{encodeURIComponent\(assetId\)\}\/place-plan/);
  assert.match(panel, /prepareAssetPlacement/);
  assert.match(panel, /createCreatorAgentAssetPlacePlan/);
  assert.match(panel, /props\.onPreviewPatch/);
  assert.match(panel, /plan\.previewed/);
  assert.match(panel, /props\.onApplyPatch/);
  assert.match(panel, /artifact\.sent-to-canvas/);
  assert.match(panel, /先预览确定性画布变更，确认后再放入画布；不会调用模型/);
  assert.match(panel, /availableCapabilityIds\.has\('asset\.place'\)/);
  assert.match(route, /sessions\/:sessionId\/assets\/:assetId\/place-plan/);
  assert.match(route, /assets\(\)\.inspectPlace/);
  assert.match(route, /createAssetPlaceReadyPlan/);
  assert.match(route, /CREATOR_ASSET_PLACE_EVIDENCE_INVALID/);
  assert.match(route, /state\?\.status !== 'applied'/);
  assert.match(route, /resolveAppliedAssetPlacement/);
  assert.match(route, /alreadyApplied: recovery\.status === 'applied'/);
  assert.match(panel, /if \(prepared\.alreadyApplied\)/);
  assert.match(panel, /patchId: prepared\.alreadyApplied\.patchId/);
  assert.match(panel, /appliedRevision: prepared\.alreadyApplied\.appliedRevision/);
  assert.match(panel, /duplicate: true/);
});

test('creator Agent keeps uploaded attachments bound to their persisted project asset', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  assert.match(client, /assetId\?: string/);
  assert.match(panel, /assetId: result\.assetId \|\| undefined/);
  assert.doesNotMatch(panel, /assetId: file\./);
});

test('creator Agent uploads attachments with real progress, bounded concurrency, cancellation, and failed-item retry', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const api = source('src/services/api.ts');
  assert.match(api, /new XMLHttpRequest\(\)/);
  assert.match(api, /xhr\.upload\.onprogress/);
  assert.match(api, /signal: options\.signal/);
  assert.match(panel, /CREATOR_UPLOAD_MAX_CONCURRENCY = 3/);
  assert.match(panel, /Math\.min\(CREATOR_UPLOAD_MAX_CONCURRENCY, records\.length\)/);
  assert.match(panel, /uploadControllersRef\.current\.get\(taskId\)\?\.abort\(\)/);
  assert.match(panel, /aria-label="附件上传进度"/);
  assert.match(panel, /取消这一个附件/);
  assert.match(panel, /uploadFilesRef\.current\.set\(id, file\)/);
  assert.match(panel, /const retryUpload = useCallback/);
  assert.match(panel, /void uploadFiles\(\[file\]\)/);
  assert.match(panel, /aria-label=\{`重试上传 \$\{task\.name\}`\}/);
  assert.match(panel, /原文件已不在当前会话中，请重新选择后上传/);
  assert.match(panel, /uploadGenerationRef\.current \+= 1/);
  assert.match(panel, /generation !== uploadGenerationRef\.current/);
  assert.doesNotMatch(panel, /Promise\.all\(accepted\.map/);
  assert.doesNotMatch(panel, /data:.*base64/is);
});

test('creator Agent can start with one persisted attachment and no typed text', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const route = source('backend/src/routes/creatorAgent.js');
  const sessions = source('backend/src/services/creatorAgentSessions.js');
  assert.match(panel, /if \(\(!text && messageAttachments\.length === 0 && !suggestion\) \|\| busy \|\| uploading\) return/);
  assert.match(panel, /可直接发送引用素材，或补一句你想怎么处理/);
  assert.match(panel, /aria-label=\{draft\.trim\(\) \? '发送' : '发送引用素材并分析'\}/);
  assert.match(route, /creatorAttachmentOnlyPrompt\(attachments\)/);
  assert.match(sessions, /不要自动生成或修改画布/);
  assert.match(sessions, /请先输入创作要求，或添加一个已上传附件/);
  assert.match(sessions, /inputMode: 'attachments-only'/);
  assert.match(sessions, /`分析\$\{creatorAttachmentSummary\(attachments\)\}`/);
  assert.match(panel, /originalRequest\?\.payload\.inputMode === 'attachments-only'/);
});

test('creator Agent only labels a Run after backend-verified session reconciliation', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  assert.match(client, /run-links\/reconcile/);
  assert.match(panel, /reconcileCreatorAgentRunLinks/);
  assert.match(panel, /current\?\.id === reconciled\.session\.id/);
  assert.match(panel, /当前创作会话已验证/);
  assert.doesNotMatch(panel, /Math\.random\\(\\).*run\.linked/);
});

test('creator Agent physically verifies completed artifacts only after an explicit lightweight action', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  assert.match(client, /verify-artifacts/);
  assert.match(client, /verifyCreatorAgentRunArtifacts/);
  assert.match(panel, /核验产物/);
  assert.match(panel, /重新核验/);
  assert.match(panel, /文件存在、SHA-256、格式魔数与运行关联均已核对/);
  assert.match(panel, /onClick=\{\(\) => props\.onVerify\(run\.id\)\}/);
  assert.match(route, /verifyCompletionEvidence\(db,/);
  assert.match(route, /任务完成后才能核验本地产物；当前不会读取文件或调用模型/);
});

test('creator Agent compares actual candidate media and keeps review, accept and branching behind preview', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  const creative = source('backend/src/services/agentControlCreative.js');
  assert.match(panel, /getCreatorAgentCandidateComparison/);
  assert.match(panel, /<CandidateMedia candidate=\{candidate\}/);
  assert.match(panel, /candidate\.resultKind === 'text' && candidate\.resultText/);
  assert.match(panel, /实际图像候选/);
  assert.match(panel, /实际视频候选/);
  assert.match(panel, /实际音频候选/);
  assert.match(panel, /实际文本候选/);
  assert.match(panel, /candidate\.reviewEvidence\.contentHash/);
  assert.match(panel, /这里不会自动替你打“通过”/);
  assert.match(panel, /candidate\.qa\.creativeReady/);
  assert.match(panel, /createCreatorAgentIteratePlan/);
  assert.match(panel, /生成检查预览/);
  assert.match(client, /sessions\/\$\{encodeURIComponent\(sessionId\)\}\/comparison/);
  assert.match(client, /sessions\/\$\{encodeURIComponent\(sessionId\)\}\/iterate/);
  assert.match(route, /sessions\/:sessionId\/comparison/);
  assert.match(route, /sessions\/:sessionId\/iterate/);
  assert.match(route, /已形成受控候选操作计划；当前没有修改画布，也没有调用 Provider/);
  assert.match(creative, /CREATIVE_CANDIDATE_REVIEW_REQUIRED/);
  assert.match(creative, /CREATIVE_CANDIDATE_REVIEW_FAILED/);
  assert.match(creative, /不能只根据 Prompt、模型名或缩略图猜质量/);
  assert.match(creative, /digest\(\{ kind: 'text', content: outputText \}\)/);
});

test('creator Agent starts an applied plan through the existing Canvas preflight run pipeline', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const request = source('src/utils/canvasRunRequest.ts');
  const canvas = source('src/components/Canvas.tsx');
  assert.match(panel, /requestCanvasNodeRun/);
  assert.match(panel, /createCanvasNodeRunRequestId\(nodeId,\s*'creator-agent'\)/);
  assert.match(panel, /开始运行（进入体检）/);
  assert.match(panel, /已关联真实任务，请在下方查看/);
  assert.match(panel, /const runLinkedPlanIds = new Set\(\(session\?\.runLinks \|\| \[\]\)/);
  assert.match(request, /CANVAS_NODE_RUN_REQUEST_EVENT/);
  assert.match(request, /onSettled/);
  assert.match(canvas, /CANVAS_NODE_RUN_REQUEST_EVENT/);
});

test('creator Agent delivery uses the desktop folder picker, shared L2 approval and pinned post verification', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  const route = source('backend/src/routes/creatorAgent.js');
  const delivery = source('backend/src/services/agentControlDelivery.js');
  const main = source('electron/main.cjs');
  const preload = source('electron/preload.cjs');
  const env = source('src/vite-env.d.ts');
  const picker = main.match(/async function pickDirectory\(options = \{\}\) \{([\s\S]*?)\n\}/);

  assert.match(panel, /把当前画布已验证素材打包交付/);
  assert.match(panel, /选择交付位置/);
  assert.match(panel, /核对并创建交付包/);
  assert.match(panel, /等待桌面确认/);
  assert.match(panel, /已创建并完成 SHA-256 复核/);
  assert.match(panel, /requestCreatorAgentDeliveryApproval/);
  assert.match(panel, /completeCreatorAgentDeliveryApproval/);
  assert.match(panel, /delivery\.approval-requested/);
  assert.match(panel, /delivery\.completed/);
  assert.match(panel, /terminalApprovalIds/);
  assert.match(client, /\/delivery\/plan/);
  assert.match(client, /\/delivery\/\$\{encodeURIComponent\(planId\)\}\/request-approval/);
  assert.match(client, /\/delivery\/approvals\/\$\{encodeURIComponent\(approvalRequestId\)\}\/complete/);
  assert.match(route, /action: 'delivery\.package'/);
  assert.match(route, /approvals\.beginCompletion/);
  assert.match(route, /delivery\(\)\.packageDelivery/);
  assert.match(route, /expectedPackageDigest: result\.packageDigest/);
  assert.match(route, /delivery\(\)\.verifyPackage/);
  assert.match(delivery, /operationCount: collection\.items\.length/);
  assert.match(main, /ipcMain\.handle\('t8pc:pick-directory'/);
  assert.match(preload, /pickDirectory: \(options\) => ipcRenderer\.invoke\('t8pc:pick-directory'/);
  assert.match(env, /pickDirectory\?:/);
  assert.ok(picker);
  assert.match(picker[1], /properties: \['openDirectory', 'createDirectory'\]/);
  assert.doesNotMatch(picker[1], /collectPickedDirectoryFiles|readdir|walk/i);
});

test('creator Agent Codex connection summary stays behind trusted Electron IPC and exposes no token', () => {
  const auth = source('backend/src/services/agentControlAuth.js');
  const main = source('electron/main.cjs');
  const preload = source('electron/preload.cjs');
  const env = source('src/vite-env.d.ts');

  assert.match(auth, /schema: 't8-agent-control-connection-summary-v1'/);
  assert.match(auth, /codexSessionCount/);
  assert.match(auth, /pendingPairingCount/);
  assert.doesNotMatch(
    auth.match(/function connectionSummary\(\) \{([\s\S]*?)\n  \}/)?.[1] || '',
    /accessToken|pollSecret|sessionId|userCode|pairingId/,
  );
  assert.match(main, /assertTrustedMainRenderer\(event\)/);
  assert.match(main, /t8pc:agent-control:connection-summary/);
  assert.match(preload, /getConnectionSummary: \(\) => ipcRenderer\.invoke\('t8pc:agent-control:connection-summary'\)/);
  assert.match(env, /interface T8AgentControlConnectionSummary/);
  assert.match(env, /getConnectionSummary: \(\) => Promise<T8AgentControlIpcResult<T8AgentControlConnectionSummary>>/);
});

test('creator Agent offers one-sentence Codex onboarding without turning it into authority', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const pairing = source('src/components/AgentControlPairingModal.tsx');

  assert.match(panel, /Codex \/ 本地 Agent/);
  assert.match(panel, /把这一句话发给 Codex/);
  assert.match(panel, /请安装或更新贞贞无限画布 Skill/);
  assert.match(panel, /先给可编辑方案，不自动生成/);
  assert.match(panel, /getConnectionSummary/);
  assert.match(panel, /5_000/);
  assert.match(panel, /if \(!open \|\| !codexOpen\) return undefined/);
  assert.match(panel, /navigator\.clipboard\.writeText\(CODEX_CONNECT_PROMPT\)/);
  assert.match(panel, /API Key、token、Cookie、路径和画布私有内容不会进入剪贴板/);
  assert.match(panel, /当前浏览器环境不能读取桌面配对状态/);
  assert.match(panel, /当前权限：/);
  assert.match(pairing, /核对验证码/);
  assert.match(pairing, /approvedScopes/);
  assert.match(pairing, /API Key、Cookie 和密码不会提供给 Agent/);
  assert.doesNotMatch(panel, /approvePairing\(/);
  assert.doesNotMatch(panel, /accessToken|pollSecret/);
});

test('creator Agent persists Run progress by cursor and shows one live activity per Run or NodeRun', () => {
  const sessionStore = source('backend/src/services/creatorAgentSessions.js');
  const route = source('backend/src/routes/creatorAgent.js');
  const client = source('src/services/creatorAgent.ts');
  const panel = source('src/components/CreatorAgentPanel.tsx');
  assert.match(sessionStore, /runEventCursors/);
  assert.match(sessionStore, /appendRunEvents/);
  assert.match(sessionStore, /sourceEventId/);
  assert.match(sessionStore, /progressBucket/);
  assert.match(route, /db\.getRunEvents\(runId, afterId\)/);
  assert.match(route, /events\.slice\(0, 200\)/);
  assert.match(route, /run\.sync\.error/);
  assert.match(client, /onRunSyncError/);
  assert.match(panel, /runActivityIndexes/);
  assert.match(panel, /event\.type === 'run\.event'/);
  assert.match(panel, /进度已经持久化，断线后会从当前位置继续显示/);
});

test('creator Agent recovers one pending message across fetch loss and SSE reconnects', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');
  assert.match(panel, /t8-creator-agent-pending-message-v1/);
  assert.match(panel, /clientRequestId:\s*pendingRequest\.requestId/);
  assert.match(panel, /recoverCreatorAgentMessageRequest/);
  assert.match(panel, /clearPendingCreatorMessage/);
  assert.match(panel, /terminalMessageRequestsRef/);
  assert.match(panel, /window\.addEventListener\('offline'/);
  assert.match(panel, /window\.addEventListener\('online'/);
  assert.match(panel, /setConnectionState\('open'\)/);
  assert.match(panel, /网络恢复后再次发送会沿用原请求，不会重复创建计划/);
  assert.match(service, /clientRequestId\?:\s*string/);
  assert.match(service, /messages\/\$\{encodeURIComponent\(clientRequestId\)\}/);
  assert.match(service, /stream\.addEventListener\('open'/);
  assert.match(service, /stream\.addEventListener\('error'/);
  assert.match(service, /EventSource\.CLOSED/);
  assert.match(service, /'stopped'\s*:\s*'reconnecting'/);
  assert.match(css, /\.t8-creator-agent-connection/);
  assert.match(panel, /已保存的回复和任务不会丢失，也不会重复提交/);
});

test('creator Agent keeps versioned creative artifacts out of the main conversation clutter', () => {
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const client = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');
  const sessions = source('backend/src/services/creatorAgentSessions.js');

  assert.match(client, /t8-creator-artifact-version-v1/);
  assert.match(client, /creativeArtifactVersions\?: CreatorAgentCreativeArtifactVersion\[\]/);
  assert.match(client, /creativeArtifacts\?: CreatorAgentCreativeArtifactSummary\[\]/);
  assert.match(panel, /eventArtifactVersion\(event\)/);
  assert.match(panel, /creativeArtifactVersions/);
  assert.match(panel, /className="t8-creator-agent-artifact-chip"/);
  assert.match(panel, /可编辑产物/);
  assert.match(panel, /每轮正文保存为独立版本；后续修改不会覆盖上一版/);
  assert.match(panel, /artifact\.status === 'model-draft' \? '模型草案' : '离线结构草案'/);
  assert.match(panel, /artifact\.revision === 1 \? '首版' : `\$\{changeCount\} 项版本差异`/);
  assert.match(css, /\.t8-creator-agent-artifact-chip/);
  assert.match(css, /\.t8-creator-agent-artifacts/);
  assert.match(sessions, /creativeArtifactVersions/);
  assert.match(sessions, /creativeArtifacts/);
  assert.doesNotMatch(panel, /artifactVersion\.content\.bodyMarkdown/);
});
