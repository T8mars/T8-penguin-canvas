import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  formatCreatorModelFamily,
  formatCreatorModelLabel,
  formatCreatorProviderLabel,
  subscribeCreatorEventsV2,
  type CreatorCatalogItemV2,
} from '../src/services/creatorAgentV2';

const root = path.resolve(import.meta.dirname, '..');
const panelSource = readFileSync(path.join(root, 'src/components/CreatorAgentPanelV2.tsx'), 'utf8');
const entrySource = readFileSync(path.join(root, 'src/components/CreatorAgentEntry.tsx'), 'utf8');
const canvasSource = readFileSync(path.join(root, 'src/components/Canvas.tsx'), 'utf8');
const serviceSource = readFileSync(path.join(root, 'src/services/creatorAgentV2.ts'), 'utf8');
const styles = readFileSync(path.join(root, 'src/styles/index.css'), 'utf8');

function catalogItem(input: Partial<CreatorCatalogItemV2>): CreatorCatalogItemV2 {
  return {
    providerId: 'custom-provider',
    providerLabel: 'Custom Provider',
    modelId: 'unknown-model',
    label: '',
    family: 'other',
    configured: true,
    recommended: false,
    visionCapable: false,
    ...input,
  };
}

test('Creator model labels prefer catalog names and never rewrite unknown ids', () => {
  assert.equal(formatCreatorModelLabel(catalogItem({
    modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
    label: 'Omni 1.1 Flash',
  })), 'Custom Provider · Omni 1.1 Flash');
  assert.equal(formatCreatorModelLabel(catalogItem({
    modelId: 'mystery-lowprice_x',
    label: '',
  })), 'Custom Provider · mystery-lowprice_x');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerLabel: 'Custom Provider',
    label: 'Custom Provider · Studio Model',
  })), 'Custom Provider · Studio Model');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerId: 'seedance-nz',
    providerLabel: 'Zhenzhen Budget AI House',
    label: 'Official catalog label',
  })), 'Official catalog label');
  assert.equal(formatCreatorProviderLabel('seedance-nz', '贞贞的平价AI小屋', false), 'Zhenzhen Budget AI House');
  assert.equal(formatCreatorProviderLabel('zhenzhen', '贞贞的AI工坊', false), 'Zhenzhen AI Studio');
  assert.equal(formatCreatorModelFamily('qwen-image-3.0', false), 'Qwen Image 3.0');
  assert.equal(formatCreatorModelFamily('unregistered-family', false), 'unregistered-family');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerId: 'seedance-nz',
    providerLabel: '贞贞的平价AI小屋',
    modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
    label: 'zhenzhen-video-g-omni-1.1-flash-lowprice（平价 Omni 1.1）',
  }), false), 'zhenzhen-video-g-omni-1.1-flash-lowprice');
});

test('Creator panel separates the active creative run from non-blocking history and settings work', () => {
  assert.match(panelSource, /useState<CreatorOperation>\('idle'\)/);
  assert.match(panelSource, /useState<CreatorHistoryOperation>\('idle'\)/);
  assert.match(panelSource, /useState<CreatorSettingsOperation>\('idle'\)/);
  assert.match(panelSource, /const isUploading = uploadStatus !== null/);
  assert.match(panelSource, /role="dialog"/);
  assert.match(panelSource, /aria-labelledby=\{panelTitleId\}/);
  assert.match(panelSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(panelSource, /role="log"[\s\S]*aria-live="polite"[\s\S]*aria-busy=/);
  assert.match(panelSource, /aria-current=\{index === currentPhaseIndex \? 'step'/);
});

test('Creator lazy fallback remains visible and themed without a portal host', () => {
  assert.match(entrySource, /launcherHost \? createPortal\(fallbackLauncher, launcherHost\) : fallbackLauncher/);
  assert.match(entrySource, /className="t8-creator-v2-panel is-loading-shell/);
  assert.match(entrySource, /loadCreatorAgentPanelV2/);
  assert.match(entrySource, /requestIdleCallback\(preload/);
  assert.match(entrySource, /data-theme-visual=\{props\.visualStyle\}/);
  assert.match(entrySource, /data-theme-mode=\{props\.themeMode\}/);
  assert.match(entrySource, /style=\{launcherStyle\}/);
  assert.match(entrySource, /key=\{`\$\{props\.projectId\}:\$\{props\.canvasId\}`\}/);
  assert.match(entrySource, /const \[panelOpen, setPanelOpen\] = useState\(false\)/);
  assert.match(entrySource, /initialOpen=\{panelOpen\}/);
  assert.match(entrySource, /onOpenChange=\{setPanelOpen\}/);
});

test('Creator panel escapes the isolated canvas stacking context on narrow screens', () => {
  assert.match(panelSource, /open && createPortal\([\s\S]*document\.body/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*\.t8-creator-v2-panel \{ inset: 0;/);
});

test('Creator keeps reconnect, draft, upload, and localized failure paths bounded', () => {
  assert.match(serviceSource, /onCursor\?: \(sequence: number\) => void/);
  assert.match(serviceSource, /handlers\.onCursor\?\.\(sequence\)/);
  assert.match(panelSource, /onCursor: \(sequence\) =>/);
  assert.match(panelSource, /window\.setTimeout\([\s\S]*?250\)/);
  assert.match(panelSource, /Commit each successful upload immediately/);
  assert.match(panelSource, /if \(!preserveComposer\) \{[\s\S]*setAttachments\(\[\]\);[\s\S]*clearBoundSelection\(\)/);
  assert.match(panelSource, /code === 'CREATOR_LLM_INTERRUPTED'/);
  assert.match(panelSource, /const selectHistoryConversation = useCallback\(async/);
  assert.doesNotMatch(panelSource, /void loadConversation\(item\.id\);/);
  assert.match(panelSource, /\{attachments\.map\(\(item\) =>/);
  assert.match(panelSource, /useState\(''\).*activeResponseId|activeResponseId, setActiveResponseId/s);
  assert.match(panelSource, /const pending = sendCreatorMessageV2\(/);
  assert.match(panelSource, /setActiveResponseId\(responseId\);\s*const pending = sendCreatorMessageV2\(/);
  assert.match(panelSource, /message\.responseId === activeResponseRef\.current[\s\S]*message\.status === 'streaming'/);
  assert.match(panelSource, /const restoreFailedTurn = useCallback/);
  assert.match(panelSource, /assistant\.replyToMessageId[\s\S]*item\.id === assistant\.replyToMessageId/);
  assert.match(panelSource, /setAttachments\(user\.media\.slice\(0, 12\)\)/);
  assert.match(panelSource, /setBoundSelectionIds\(user\.selectedNodes\.map\(\(node\) => node\.nodeId\)\.slice\(0, 24\)\)/);
  assert.match(panelSource, /operation === 'reply' && activeResponseId/);
  assert.match(panelSource, /conversationTitle\(item\.title, isChinese\)/);
  assert.match(panelSource, /toLocaleString\(isChinese \? 'zh-CN' : 'en-US'/);
  assert.doesNotMatch(panelSource, /if \(catalog\) \{\s*setSettingsDraft\(preferences\);\s*return;/);
  assert.match(panelSource, /attachmentKind\(file, result\.mime\)/);
  assert.match(panelSource, /title=\{linkedSelectionTitle\}>\s*<span className="t8-creator-v2-attachment-label">\{linkedSelectionText\}<\/span>/);
  assert.match(panelSource, /onClick=\{clearBoundSelection\}/);
  assert.match(panelSource, /setHistoryOpen\(false\);\s*dismissSettings\(\);/);
});

test('Creator defers durable blank sessions until the first message', () => {
  const opener = panelSource.slice(panelSource.indexOf('const loadLatestConversation'), panelSource.indexOf('const ensureConversation'));
  const newConversation = panelSource.slice(panelSource.indexOf('const newConversation'), panelSource.indexOf('const openHistory'));
  assert.doesNotMatch(opener, /createCreatorConversationV2/);
  assert.doesNotMatch(newConversation, /createCreatorConversationV2/);
  assert.match(panelSource, /setFreshConversationRequested\(true\)/);
  assert.match(panelSource, /const current = await ensureConversation\(\)/);
});

test('Creator progressively reveals models and identifies linked canvas nodes', () => {
  assert.match(panelSource, /showAllModels/);
  assert.match(panelSource, /item\.recommended/);
  assert.match(panelSource, /<optgroup key=\{family\} label=\{formatCreatorModelFamily/);
  assert.match(panelSource, /ChevronDown/);
  assert.match(panelSource, /ChevronUp/);
  assert.match(panelSource, /selectedNodes\?: Array<\{ id: string; type: string; label: string \}>/);
  assert.match(panelSource, /setBoundSelectionDetails\(selectedNodeDetails\.slice\(0, 24\)\)/);
});

test('Creator closes transient popovers outside and exposes the full suggestion intent', () => {
  assert.match(panelSource, /const historyPopoverRef = useRef<HTMLElement>\(null\)/);
  assert.match(panelSource, /const settingsPopoverRef = useRef<HTMLElement>\(null\)/);
  assert.match(panelSource, /window\.addEventListener\('pointerdown', handler\)/);
  assert.match(panelSource, /ref=\{historyPopoverRef\}/);
  assert.match(panelSource, /ref=\{settingsPopoverRef\}/);
  assert.doesNotMatch(panelSource, /title=\{suggestion\.sendText\}/);
  assert.match(panelSource, /const hasDistinctDetail = suggestion\.sendText\.trim\(\) !== suggestion\.label\.trim\(\)/);
  assert.match(panelSource, /aria-label=\{hasDistinctDetail \? `\$\{suggestion\.label\}: \$\{suggestion\.sendText\}` : suggestion\.label\}/);
  assert.match(panelSource, /<strong>\{suggestion\.label\}<\/strong>\{hasDistinctDetail && <small>\{suggestion\.sendText\}<\/small>\}/);
  const suggestionCopyStyle = styles.slice(styles.indexOf('.t8-creator-v2-suggestions button small'), styles.indexOf('.t8-creator-v2-suggestions button:hover'));
  assert.match(suggestionCopyStyle, /overflow-wrap: anywhere/);
  assert.doesNotMatch(suggestionCopyStyle, /-webkit-line-clamp|overflow: hidden/);
});

test('Creator can start from media or selected canvas items without filler text', () => {
  assert.match(panelSource, /const hasTurnInput = Boolean\(draft\.trim\(\) \|\| attachments\.length \|\| boundSelectionIds\.length\)/);
  assert.match(panelSource, /const turnAttachments = options\.attachments \?\? attachments/);
  assert.match(panelSource, /const turnSelectedNodeIds = options\.selectedNodeIds \?\? boundSelectionIds/);
  assert.match(panelSource, /!requestedContent && !hasAttachments && !hasSelectedNodes/);
  assert.match(panelSource, /Please review these materials/);
  assert.match(panelSource, /Please review what I selected on the canvas/);
  assert.match(panelSource, /locale: isChinese \? 'zh-CN' : 'en'/);
  assert.match(panelSource, /disabled=\{!hasTurnInput \|\| isOperating \|\| loading \|\| creatorLlmConfigured !== true\}/);
});

test('Creator restores a conversation-scoped composer and one-click choices never erase unsent work', () => {
  const composerDraftHelpers = panelSource.slice(
    panelSource.indexOf("type CreatorComposerDraft ="),
    panelSource.indexOf('const PHASES ='),
  );
  assert.match(composerDraftHelpers, /t8-creator-agent-v2-composer-draft-v1/);
  assert.match(composerDraftHelpers, /attachments: CreatorMediaRef\[\]/);
  assert.match(composerDraftHelpers, /selectedNodeIds: string\[\]/);
  assert.match(composerDraftHelpers, /selectedNodes: CreatorSelectionSummary\[\]/);
  assert.match(composerDraftHelpers, /return \[\{[\s\S]*assetId,[\s\S]*kind:[\s\S]*title:/);
  assert.doesNotMatch(composerDraftHelpers, /previewUrl:/);
  assert.match(composerDraftHelpers, /window\.localStorage\.getItem\(key\)/);
  assert.match(composerDraftHelpers, /window\.localStorage\.setItem\(key, JSON\.stringify\(restored\)\)/);
  assert.match(composerDraftHelpers, /window\.sessionStorage\.removeItem\(key\)/);
  assert.match(composerDraftHelpers, /window\.sessionStorage\.setItem\(key, JSON\.stringify\(normalized\)\)/);
  assert.match(panelSource, /writeComposerDraft\(composerScopeKeyRef\.current, composerDraftRef\.current\)/);
  assert.match(panelSource, /conversationComposerDraftKey\(legacyDraftKey, snapshot\.conversation\.id\)/);
  assert.match(panelSource, /switchComposerDraftScope\(freshDraftKey, \{ reset: true \}\)/);
  assert.match(panelSource, /migrateFromKey: freshDraftKey/);
  assert.match(panelSource, /const restored = readComposerDraft\(legacyDraftKey\)/);
  assert.match(panelSource, /setAttachments\(restored\.attachments\)/);
  assert.match(panelSource, /setBoundSelectionIds\(restored\.selectedNodeIds\)/);
  assert.match(panelSource, /setBoundSelectionDetails\(restored\.selectedNodes\)/);
  assert.match(panelSource, /preserveComposer: true/);
  assert.match(panelSource, /selectedNodeIds: \[\], preserveComposer: true/);
  assert.match(panelSource, /if \(!preserveComposer\) \{[\s\S]*composerDraftRef\.current = \{ \.\.\.EMPTY_COMPOSER_DRAFT \};[\s\S]*setDraft\(''\);[\s\S]*setAttachments\(\[\]\);[\s\S]*clearBoundSelection\(\);[\s\S]*\}/);
  assert.match(panelSource, /setAttachments\(\(current\) => current\.length \? current : turnAttachments\)/);
  assert.match(panelSource, /setBoundSelectionIds\(\(current\) => current\.length \? current : turnSelectedNodeIds\)/);
  assert.match(panelSource, /if \(!conversation && messages\.length === 0 && !action\)/);
  assert.match(panelSource, /switchComposerDraftScope\(freshDraftKey, \{ migrateFromKey: composerScopeKeyRef\.current \}\)/);
  assert.match(panelSource, /当前已经是新对话，未发送的内容已保留/);
});

test('Creator keeps progress visible, exposes reply progress, and makes every failed turn retryable', () => {
  assert.match(styles, /\.t8-creator-v2-popover \{[\s\S]*top: 122px;/);
  assert.match(styles, /\.t8-creator-v2-operation-status \{/);
  assert.match(panelSource, /className="t8-creator-v2-operation-status" role="status"/);
  assert.match(panelSource, /restoredInComposer \? void submit\(\) : restoreFailedTurn\(message\)/);
  assert.match(panelSource, /restoredInComposer \? copy\('直接重试', 'Retry now'\)/);
  assert.doesNotMatch(panelSource, /className="sr-only" role="status"[^>]*>\{operationAnnouncement\}/);
});

test('Creator hides its programmatic file picker from the accessibility tree', () => {
  assert.match(panelSource, /ref=\{fileInputRef\} className="hidden" type="file" tabIndex=\{-1\} aria-hidden="true"/);
  assert.match(panelSource, /aria-label=\{copy\('添加附件', 'Add attachment'\)\}/);
});

test('Creator focuses transient panels and keeps generation confirmation concise but trustworthy', () => {
  assert.match(panelSource, /const historyFirstItemRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(panelSource, /const settingsFirstSelectRef = useRef<HTMLSelectElement>\(null\)/);
  assert.match(panelSource, /const historySearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(panelSource, /historySearchInputRef\.current \|\| historyFirstItemRef\.current \|\| historyPopoverRef\.current/);
  assert.match(panelSource, /tabIndex=\{-1\}[\s\S]*Conversation history/);
  assert.match(panelSource, /ref=\{settingsFirstSelectRef\}/);
  assert.match(panelSource, /settingsFirstSelectRef\.current\?\.focus\(\)/);
  assert.match(panelSource, /if \(!open \|\| minimized \|\| loading\) return undefined/);
  assert.match(panelSource, /\[loading, minimized, open\]/);
  assert.doesNotMatch(panelSource, /compactActionPrompt/);
  assert.match(panelSource, /ref=\{actionPromptRef\}[\s\S]*>\{action\.prompt\}<\/p>/);
  assert.match(panelSource, /prompt\.scrollHeight > prompt\.clientHeight \+ 1/);
  assert.match(panelSource, /new ResizeObserver\(measure\)/);
  assert.match(panelSource, /t8-creator-v2-decision__prompt/);
  assert.match(styles, /\.t8-creator-v2-decision__prompt \{[\s\S]*-webkit-line-clamp: 2;/);
});

test('Creator keeps drafting available while work runs and never overwrites the next thought', () => {
  const composer = panelSource.slice(panelSource.indexOf('<footer className="t8-creator-v2-composer">'), panelSource.indexOf('</footer>', panelSource.indexOf('<footer className="t8-creator-v2-composer">')));
  assert.doesNotMatch(composer, /<textarea[^>]*disabled=/s);
  assert.match(panelSource, /composerDraftRef\.current = \{ \.\.\.composerDraftRef\.current, draft: value \}/);
  assert.match(panelSource, /const restored = current\.length \? current : requestedContent/);
  assert.match(panelSource, /operation === 'reply' && activeResponseId/);
  assert.match(panelSource, /disabled=\{!hasTurnInput \|\| isOperating \|\| loading \|\| creatorLlmConfigured !== true\}/);
});

test('Creator makes model identity and growing history readable without hover', () => {
  assert.match(panelSource, /type="search"[\s\S]*Search conversations/);
  assert.match(panelSource, /filteredHistory\.map/);
  assert.match(panelSource, /title=\{conversationTitle\(item\.title, isChinese\)\}/);
  assert.match(styles, /\.t8-creator-v2-popover\.is-history strong \{[\s\S]*-webkit-line-clamp: 2;/);
  const autoModelStyle = styles.slice(styles.indexOf('.t8-creator-v2-auto-model'), styles.indexOf('.t8-creator-v2-popover.is-settings select'));
  assert.match(autoModelStyle, /overflow-wrap: anywhere/);
  assert.match(autoModelStyle, /white-space: normal/);
  assert.doesNotMatch(autoModelStyle, /text-overflow: ellipsis|white-space: nowrap/);
});

test('Creator orients restored conversations and removes stale canvas references before send', () => {
  assert.match(panelSource, /conversationOrientationRef\.current/);
  assert.match(panelSource, /data-creator-message-id=\{message\.id\}/);
  assert.match(panelSource, /t8-creator-v2-latest-turn/);
  assert.match(panelSource, /props\.availableNodeIds/);
  assert.match(panelSource, /画布中已不存在的引用/);
  assert.match(styles, /\.t8-creator-v2-latest-turn/);
});

test('Creator localizes default selected-node labels and gives human recovery guidance', () => {
  assert.match(panelSource, /function selectionDisplayLabel/);
  assert.match(panelSource, /selectionDescriptor\(first, isChinese\)/);
  assert.match(panelSource, /Select an image, video, or text item on the canvas first/);
  assert.match(panelSource, /function recoveryErrorText/);
  assert.match(panelSource, /The network connection was interrupted\. Your work is saved/);
  assert.match(panelSource, /The creative model is not connected yet\. Finish API setup to continue/);
  assert.match(panelSource, /aria-label=\{copy\('关闭提示', 'Dismiss message'\)\}/);
});

test('Creator explains durable failures and collapses a resolved retry without losing audit history', () => {
  assert.match(panelSource, /function failedMessageCopy/);
  assert.match(panelSource, /DOCUMENT_FORMAT_UNSUPPORTED\|DOCUMENT_READ_FAILED/);
  assert.match(panelSource, /STRUCTURE_INVALID\|SCHEMA_INVALID\|REPLY_EMPTY/);
  assert.match(panelSource, /function resolvedRetryMessages/);
  assert.match(panelSource, /completedBySignature/);
  assert.match(panelSource, /retryResolution\.hiddenUserIds\.has\(message\.id\)/);
  assert.match(panelSource, /较早一次尝试已恢复并完成/);
  assert.match(styles, /\.t8-creator-v2-message\.is-resolved-retry/);
});

test('Creator discloses the automatic model and surfaces a finished reply when the reader scrolled away', () => {
  assert.match(panelSource, /const automaticModelHint/);
  assert.match(panelSource, /eligible\.find\(\(item\) => item\.recommended\) \|\| eligible\[0\]/);
  assert.match(panelSource, /Will use: \$\{resolvedLabel\}/);
  assert.match(panelSource, /item\.visionCapable/);
  assert.match(panelSource, /const \[newReplyBelow, setNewReplyBelow\] = useState\(false\)/);
  assert.match(panelSource, /View new reply/);
  assert.match(panelSource, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(panelSource, /if \(message\.status !== 'streaming'\) surfaceConversationUpdate\(\)/);
  assert.match(panelSource, /finishOperation\('action-confirm'\);\s*surfaceConversationUpdate\(\)/);
  assert.match(styles, /\.t8-creator-v2-new-reply/);
});

test('Creator removes duplicate empty copy and gives the launcher a novice-friendly name', () => {
  const emptyState = panelSource.slice(panelSource.indexOf('t8-creator-v2-empty'), panelSource.indexOf('{messages.filter'));
  assert.doesNotMatch(emptyState, /Turn this product photo/);
  assert.match(emptyState, /我会帮你一步步推进/);
  assert.match(panelSource, /例如：把这张产品图做成 15 秒电影感广告/);
  assert.match(panelSource, /copy\('助手', 'Agent'\)/);
  assert.match(panelSource, /copy\('创作助手', 'Creator Agent'\)/);
  assert.match(entrySource, /isChinese \? '助手' : 'Agent'/);
  assert.match(entrySource, /isChinese \? '创作助手' : 'Creator Agent'/);
});

test('Creator preflights model readiness and provides direct non-duplicating recovery', () => {
  assert.match(panelSource, /const creatorLlmConfigured = useMemo/);
  assert.match(panelSource, /void refreshCreatorSettings\(false\)/);
  assert.match(panelSource, /props\.apiSettingsRevision/);
  assert.match(panelSource, /props\.onOpenApiSettings\(\)/);
  assert.match(panelSource, /dismissSettings\(\);\s*if \(props\.onOpenApiSettings\) \{\s*awaitingApiSettingsReturnRef\.current = true;\s*setMinimized\(false\)/);
  assert.match(panelSource, /if \(!open \|\| !awaitingApiSettingsReturnRef\.current\) return;[\s\S]*composerRef\.current\?\.focus\(\)/);
  assert.match(panelSource, /creatorLlmConfigured !== true[\s\S]*refreshCreatorSettings\(false\)/);
  assert.match(panelSource, /creatorLlmConfigured === false && !settingsOpen && <div className="t8-creator-v2-readiness"/);
  assert.match(panelSource, /failedMessageRecoveryKind/);
  assert.match(panelSource, /const failedTurnAlreadyRestored = useCallback/);
  assert.match(panelSource, /recoveryKind === 'api-settings'/);
  assert.match(panelSource, /recoveryKind === 'edit' && <button/);
  assert.match(panelSource, /restoredInComposer \? void submit\(\) : restoreFailedTurn\(message\)/);
  assert.match(panelSource, /服务渠道/);
  assert.match(panelSource, /对话模型/);
  assert.match(panelSource, /settingsReadinessMessage/);
  assert.match(panelSource, /settingsHasNoConfiguredModels/);
  assert.match(panelSource, /className="t8-creator-v2-recovery-action"[\s\S]*修改后重试/);
  assert.match(styles, /\.t8-creator-v2-message > \.t8-creator-v2-recovery-action \{[\s\S]*border: 1px solid/);
});

test('Creator keeps settings actions visible and shows a one-time novice launcher hint', () => {
  assert.match(styles, /\.t8-creator-v2-popover footer \{[\s\S]*position: sticky;[\s\S]*bottom: -10px;/);
  assert.match(entrySource, /CREATOR_LAUNCHER_HINT_KEY/);
  assert.match(entrySource, /window\.localStorage\.getItem\(CREATOR_LAUNCHER_HINT_KEY\) !== '1'/);
  assert.match(entrySource, /window\.localStorage\.setItem\(CREATOR_LAUNCHER_HINT_KEY, '1'\)/);
  assert.match(entrySource, /t8-creator-agent-launcher-hint/);
  assert.match(entrySource, /从这里开始创作/);
  assert.match(styles, /\.t8-creator-agent-launcher-hint \{/);
  assert.match(panelSource, /data-creator-agent-composer="true"/);
});

test('Creator auto-grows the composer and can minimize without closing', () => {
  assert.match(panelSource, /const resizeComposer = useCallback/);
  assert.match(panelSource, /Math\.min\(Math\.max\(composer\.scrollHeight, 46\), 210\)/);
  assert.match(panelSource, /is-minimized/);
  assert.match(panelSource, /Minimize2/);
  assert.match(styles, /\.t8-creator-v2-panel\.is-minimized/);
  assert.match(styles, /\.t8-creator-v2-panel\.is-minimized \{[\s\S]*top: 160px;[\s\S]*width: min\(260px,/);
  assert.match(styles, /\.t8-creator-v2-composer textarea \{[\s\S]*resize: none;/);
});

test('Creator keeps frequent desktop controls understandable and removes empty-history search noise', () => {
  assert.match(styles, /\.t8-creator-v2-header button\.has-touch-label[\s\S]*display: inline-flex/);
  assert.match(styles, /\.t8-creator-v2-header button\.has-touch-label \.t8-creator-v2-button-label[\s\S]*display: inline/);
  assert.match(panelSource, /const HISTORY_SEARCH_MIN_ITEMS = 6/);
  assert.match(panelSource, /history\.length >= HISTORY_SEARCH_MIN_ITEMS && <label className="t8-creator-v2-history-search"/);
  assert.match(panelSource, /className="has-touch-label"[\s\S]*copy\('历史', 'History'\)/);
  assert.match(panelSource, /copy\('画布', 'Canvas'\)/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*\.t8-creator-v2-composer \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('Creator keeps the full-height first screen and simplifies only the narrow header', () => {
  assert.doesNotMatch(panelSource, /!loading && messages\.length === 0 && !action \? ' is-empty' : ''/);
  assert.doesNotMatch(styles, /\.t8-creator-v2-panel\.is-empty/);
  assert.match(styles, /\.t8-creator-v2-empty \{[\s\S]*margin: clamp\(64px, 16vh, 120px\) auto 0;/);
  assert.match(styles, /@media \(max-width: 420px\) \{[\s\S]*\.t8-creator-v2-header \{[\s\S]*flex-wrap: nowrap;/);
  assert.match(styles, /@media \(max-width: 420px\) \{[\s\S]*\.t8-creator-v2-header button\.has-touch-label \.t8-creator-v2-button-label \{[\s\S]*display: none;/);
});

test('Creator retries transient startup restoration and never reduces it to a generic open error', () => {
  assert.match(panelSource, /const retryDelays = \[0, 250, 750\]/);
  assert.match(panelSource, /startupConversationErrorText\(lastError, copy\)/);
  assert.match(panelSource, /Reconnect Creator Agent/);
  assert.match(panelSource, /setStartupLoadRevision\(\(current\) => current \+ 1\); void refreshCreatorSettings\(false\)/);
  const startupEffect = panelSource.slice(
    panelSource.indexOf('const retryDelays = [0, 250, 750]'),
    panelSource.indexOf('useEffect(() => {', panelSource.indexOf('const retryDelays = [0, 250, 750]')),
  );
  assert.doesNotMatch(startupEffect, /操作没有完成，请重试/);
  assert.match(panelSource, /画布和输入都已保留/);
  const settingsRefresh = panelSource.slice(
    panelSource.indexOf('const refreshCreatorSettings'),
    panelSource.indexOf('useEffect(() => {', panelSource.indexOf('const refreshCreatorSettings')),
  );
  assert.match(settingsRefresh, /const retryDelays = \[0, 350, 900\]/);
  assert.match(settingsRefresh, /if \(focusFirstControl\) \{[\s\S]*setError\(recoveryErrorText/);
  assert.doesNotMatch(settingsRefresh, /catch \(settingsError\) \{\s*setError\(/);
});

test('Creator startup waits for authoritative canvas data and the initialized ReactFlow viewport', () => {
  assert.match(canvasSource, /const \[initializedFlowCanvasId, setInitializedFlowCanvasId\] = useState<string \| null>\(null\)/);
  assert.match(canvasSource, /const handleAuthoritativeFlowInit = useCallback/);
  assert.match(canvasSource, /!canvasRevisionsRef\.current\.has\(canvasId\)/);
  assert.match(canvasSource, /onInit=\{handleAuthoritativeFlowInit\}/);
  assert.match(canvasSource, /const creatorAgentCanvasReady = loaded[\s\S]*loadedCanvasId === renderedCanvasId[\s\S]*initializedFlowCanvasId === renderedCanvasId[\s\S]*activeCanvasRevision > 0/);
  assert.match(canvasSource, /\{creatorAgentCanvasReady && activeProjectId && \([\s\S]*<CreatorAgentPanel/);
});

test('Creator keeps the next turn preparable while the current LLM reply runs', () => {
  const uploadFiles = panelSource.slice(panelSource.indexOf('const uploadFiles'), panelSource.indexOf('const onFiles'));
  assert.match(uploadFiles, /if \(!files\.length \|\| isUploading\) return/);
  assert.doesNotMatch(uploadFiles, /isOperating/);
  assert.match(panelSource, /aria-label=\{copy\('添加附件', 'Add attachment'\)\} disabled=\{isUploading\}/);
  assert.match(panelSource, /aria-pressed=\{boundSelectionIds\.length > 0\} onClick=\{pinSelection\}/);
  assert.match(panelSource, /disabled=\{isHistoryBusy && !historyOpen\}/);
  assert.match(panelSource, /disabled=\{isSettingsBusy && !settingsOpen\}/);
});

test('Creator clears transient history filters and reorients every reopened panel to the latest reply', () => {
  const historyOpener = panelSource.slice(panelSource.indexOf('const openHistory'), panelSource.indexOf('const loadOlderMessages'));
  assert.match(historyOpener, /setHistoryQuery\(''\)/);
  assert.doesNotMatch(historyOpener, /if \(isOperating\)/);
  assert.match(panelSource, /const panelWasOpenRef = useRef\(open\)/);
  assert.match(panelSource, /const reopened = open && !panelWasOpenRef\.current/);
  assert.match(panelSource, /container\.scrollTop = Math\.max\(0, targetTop - 10\)/);
});

test('Creator uses a wider reading surface and keeps all three next steps visible outside the transcript', () => {
  assert.match(styles, /width: min\(clamp\(660px, 56vw, 760px\), calc\(100vw - 44px\)\)/);
  assert.match(styles, /\.t8-creator-v2-suggestions \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 620px\) \{[\s\S]*\.t8-creator-v2-suggestions \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  const transcriptEnd = panelSource.indexOf('</div>\n\n            {visibleSuggestions.length === 3');
  assert.ok(transcriptEnd > panelSource.indexOf('className="t8-creator-v2-transcript"'));
  assert.match(panelSource, /aria-label=\{copy\('三个下一步建议', 'Three next-step suggestions'\)\}/);
  assert.match(panelSource, /creatorLlmConfigured === true[\s\S]*latestAssistant/);
  assert.match(panelSource, /下一步只需选一个/);
  assert.match(panelSource, /也可以直接输入你的想法/);
  assert.match(styles, /\.t8-creator-v2-suggestions__heading \{[\s\S]*grid-column: 1 \/ -1;/);
  assert.doesNotMatch(panelSource, /disabled=\{isOperating \|\| creatorLlmConfigured !== true\}/);
});

test('Creator gives the compact phase rail a readable current-step summary', () => {
  assert.match(panelSource, /className="t8-creator-v2-phase-summary"/);
  assert.match(panelSource, /第 \$\{currentPhaseIndex \+ 1\}\/6 步 · \$\{currentPhase\[1\]\}/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*\.t8-creator-v2-phase-summary \{[\s\S]*display: block;/);
});

test('Creator exposes real multi-file upload progress and keeps attachment actions reachable', () => {
  assert.match(panelSource, /type CreatorUploadStatus = \{/);
  assert.match(panelSource, /onProgress: \(\{ percent \}\) => setUploadStatus/);
  assert.match(panelSource, /正在上传 \$\{uploadStatus\.current\}\/\$\{uploadStatus\.total\}/);
  assert.match(panelSource, /<progress value=\{uploadStatus\.percent \?\? undefined\} max=\{100\}/);
  assert.match(panelSource, /const controller = new AbortController\(\)/);
  assert.match(panelSource, /signal: controller\.signal/);
  assert.match(panelSource, /uploadAbortRef\.current\?\.abort\(\)/);
  assert.match(panelSource, /onClick=\{cancelUpload\}>\{copy\('取消', 'Cancel'\)\}/);
  assert.match(panelSource, /上传已取消，已经完成的附件仍然保留/);
  assert.match(panelSource, /t8-creator-v2-attachment-label/);
  assert.match(styles, /\.t8-creator-v2-attachment-label \{[\s\S]*text-overflow: ellipsis;/);
  assert.match(styles, /\.t8-creator-v2-attachments button \{[\s\S]*flex: 0 0 44px;[\s\S]*width: 44px;[\s\S]*height: 44px;/);
});

test('Creator notifies its launcher owner only after the open state commits', () => {
  assert.match(panelSource, /useEffect\(\(\) => \{\s*props\.onOpenChange\?\.\(open\);\s*\}, \[open, props\.onOpenChange\]\)/);
  assert.doesNotMatch(panelSource, /setOpen\(\(current\) => \{[\s\S]*props\.onOpenChange/);
  assert.match(panelSource, /setPanelOpen\(!open\)/);
});

test('Creator EventSource advances the durable cursor from the event envelope', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  const instances: FakeEventSource[] = [];
  class FakeEventSource {
    static readonly CLOSED = 2;
    readonly url: string;
    closed = false;
    onerror: ((event: Event) => unknown) | null = null;
    private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

    constructor(url: string | URL) {
      this.url = String(url);
      instances.push(this);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const callback = listener as unknown as (event: MessageEvent<string>) => void;
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }

    emit(type: string, data: unknown, lastEventId: string) {
      const event = { data: JSON.stringify(data), lastEventId } as MessageEvent<string>;
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }

    close() { this.closed = true; }
  }

  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
  try {
    const cursors: number[] = [];
    const messageIds: string[] = [];
    const unsubscribe = subscribeCreatorEventsV2('creator-session', 'project-local', 'canvas-local', 3, {
      onCursor: (sequence) => cursors.push(sequence),
      onMessage: (message) => messageIds.push(message.id),
      onAction: () => {},
    });
    assert.equal(instances.length, 1);
    assert.match(instances[0].url, /after=3/u);
    instances[0].emit('message', { sequence: 9, data: { id: 'message-9' } }, '9');
    assert.deepEqual(cursors, [9]);
    assert.deepEqual(messageIds, ['message-9']);
    unsubscribe();
    assert.equal(instances[0].closed, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'EventSource', original);
    else delete (globalThis as { EventSource?: unknown }).EventSource;
  }
});

test('Creator CSS includes touch, 200% reflow, and reduced-motion gates', () => {
  assert.match(styles, /@media \(pointer: coarse\), \(max-width: 520px\)/);
  assert.match(styles, /\.t8-creator-v2-header button,[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  assert.match(styles, /\.t8-control-rail-creator-slot \{[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  assert.match(styles, /\.t8-creator-v2-phases li \{[\s\S]*font-size: 12px;/);
  assert.match(styles, /\.t8-creator-v2-model-toggle \{[\s\S]*border: 1px solid var\(--creator-border\);/);
  assert.match(styles, /\.t8-creator-v2-composer button\.is-send:disabled \{[\s\S]*background: var\(--creator-surface-alt\);/);
  assert.match(styles, /@media \(max-width: 900px\), \(max-height: 620px\)/);
  assert.match(styles, /max-height: calc\(100dvh - 90px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important;/);
});
