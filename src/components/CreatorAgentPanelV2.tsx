import {
  AtSign,
  Check,
  Clapperboard,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  History,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import LocalizedVisibleTree from '../i18n/LocalizedVisibleTree';
import { CREATOR_AGENT_VISIBLE_CATALOG } from '../i18n/workbenchVisibleCatalog';
import * as api from '../services/api';
import {
  confirmCreatorActionV2,
  confirmCreatorCurrentSceneV2,
  cancelCreatorActionV2,
  createCreatorConversationV2,
  formatCreatorModelFamily,
  formatCreatorModelLabel,
  formatCreatorProviderLabel,
  getCreatorCatalogV2,
  getCreatorConversationV2,
  getCreatorLongScriptScenesV2,
  getCreatorSettingsV2,
  listCreatorConversationsV2,
  markCreatorAssetReviewedV2,
  retryCreatorActionV2,
  saveCreatorSettingsV2,
  setCreatorCurrentSceneV2,
  sendCreatorAssetToCanvasV2,
  sendCreatorMessageV2,
  stopCreatorResponseV2,
  subscribeCreatorEventsV2,
  type CreatorActionV2,
  type CreatorCatalogV2,
  type CreatorConversationV2,
  type CreatorLongScriptNavigationV2,
  type CreatorMediaRef,
  type CreatorMessageV2,
  type CreatorPreferencesV2,
} from '../services/creatorAgentV2';
import type { ThemeTokens } from '../theme/types';

export interface CreatorAgentPanelV2Props {
  projectId: string;
  canvasId: string;
  selectedNodeIds: string[];
  selectedNodes?: Array<{ id: string; type: string; label: string }>;
  availableNodeIds?: string[];
  visualStyle: string;
  themeMode: 'light' | 'dark';
  themeTokens: ThemeTokens;
  onFocusNode: (nodeId: string) => void;
  apiSettingsRevision?: number;
  onOpenApiSettings?: () => void;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelSafeTop?: number;
  initialShellOpenedAt?: number;
}

type CreatorSelectionSummary = { id: string; type: string; label: string };

type CreatorComposerDraft = {
  schema: 't8-creator-agent-v2-composer-draft-v1';
  draft: string;
  attachments: CreatorMediaRef[];
  selectedNodeIds: string[];
  selectedNodes: CreatorSelectionSummary[];
  creationMode: 'auto' | 'scene';
};

type CreatorSubmitOptions = {
  attachments?: CreatorMediaRef[];
  selectedNodeIds?: string[];
  preserveComposer?: boolean;
};

const EMPTY_COMPOSER_DRAFT: CreatorComposerDraft = {
  schema: 't8-creator-agent-v2-composer-draft-v1',
  draft: '',
  attachments: [],
  selectedNodeIds: [],
  selectedNodes: [],
  creationMode: 'auto',
};

function boundedComposerText(value: unknown, limit: number) {
  return String(value || '').slice(0, limit);
}

function normalizeComposerDraft(value: unknown): CreatorComposerDraft {
  if (!value || typeof value !== 'object') return { ...EMPTY_COMPOSER_DRAFT };
  const source = value as Partial<CreatorComposerDraft>;
  const attachments = (Array.isArray(source.attachments) ? source.attachments : []).flatMap((item) => {
    const assetId = boundedComposerText(item?.assetId, 500).trim();
    const kind = String(item?.kind || '').toLowerCase();
    if (!assetId || !['image', 'video', 'audio', 'file'].includes(kind)) return [];
    return [{
      assetId,
      kind: kind as CreatorMediaRef['kind'],
      title: boundedComposerText(item?.title, 500) || null,
    }];
  }).slice(0, 12);
  const selectedNodeIds = [...new Set((Array.isArray(source.selectedNodeIds) ? source.selectedNodeIds : [])
    .map((id) => boundedComposerText(id, 500).trim())
    .filter(Boolean))].slice(0, 24);
  const selectedIds = new Set(selectedNodeIds);
  const selectedNodes = (Array.isArray(source.selectedNodes) ? source.selectedNodes : []).flatMap((item) => {
    const id = boundedComposerText(item?.id, 500).trim();
    if (!id || !selectedIds.has(id)) return [];
    return [{
      id,
      type: boundedComposerText(item?.type, 120).trim() || 'node',
      label: boundedComposerText(item?.label, 500).trim(),
    }];
  }).slice(0, 24);
  return {
    schema: 't8-creator-agent-v2-composer-draft-v1',
    draft: boundedComposerText(source.draft, 30_000),
    attachments,
    selectedNodeIds,
    selectedNodes,
    creationMode: source.creationMode === 'scene' ? 'scene' : 'auto',
  };
}

function parseComposerDraftValue(raw: string): CreatorComposerDraft {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object'
      && (parsed as { schema?: unknown }).schema === 't8-creator-agent-v2-composer-draft-v1') {
      return normalizeComposerDraft(parsed);
    }
  } catch { /* A plain string is the legacy text-only draft. */ }
  return { ...EMPTY_COMPOSER_DRAFT, draft: raw.slice(0, 30_000) };
}

function readComposerDraft(key: string): CreatorComposerDraft {
  if (typeof window === 'undefined') return { ...EMPTY_COMPOSER_DRAFT };
  let durableRaw: string | null = null;
  try {
    durableRaw = window.localStorage.getItem(key);
  } catch { /* Continue with the session fallback. */ }
  if (durableRaw !== null) return parseComposerDraftValue(durableRaw);
  try {
    const sessionRaw = window.sessionStorage.getItem(key);
    if (sessionRaw === null) return { ...EMPTY_COMPOSER_DRAFT };
    const restored = parseComposerDraftValue(sessionRaw);
    try {
      window.localStorage.setItem(key, JSON.stringify(restored));
      window.sessionStorage.removeItem(key);
    } catch { /* Keep the session copy when durable storage is unavailable. */ }
    return restored;
  } catch {
    return { ...EMPTY_COMPOSER_DRAFT };
  }
}

function writeComposerDraft(key: string, value: CreatorComposerDraft) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeComposerDraft(value);
  if (!normalized.draft && !normalized.attachments.length && !normalized.selectedNodeIds.length
    && normalized.creationMode === 'auto') {
    try { window.localStorage.removeItem(key); } catch { /* Best effort. */ }
    try { window.sessionStorage.removeItem(key); } catch { /* Best effort. */ }
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(normalized));
    try { window.sessionStorage.removeItem(key); } catch { /* The durable copy is already safe. */ }
    return;
  } catch {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(normalized));
    } catch { /* Draft recovery is best effort when browser storage is unavailable. */ }
  }
}

function composerDraftHasContent(value: CreatorComposerDraft) {
  return Boolean(value.draft || value.attachments.length || value.selectedNodeIds.length
    || value.creationMode === 'scene');
}

function conversationComposerDraftKey(baseKey: string, conversationId: string) {
  return `${baseKey}.conversation.${encodeURIComponent(conversationId)}`;
}

const PHASES = [
  ['idea', '想法', 'Idea'],
  ['script', '方案', 'Plan'],
  ['assets', '素材', 'Assets'],
  ['shots', '制作', 'Create'],
  ['candidates', '挑选', 'Choose'],
  ['delivery', '完成', 'Done'],
] as const;

const HISTORY_SEARCH_MIN_ITEMS = 6;
const CREATOR_SHELL_READINESS_SCHEMA = 't8-creator-agent-shell-readiness-receipt-v1';
const CREATOR_SHELL_TARGET_MS = 300;
const CREATOR_IME_COMMIT_GUARD_MS = 140;

const DEFAULT_PREFERENCES: CreatorPreferencesV2 = {
  providerId: 'auto',
  llm: null,
  image: null,
  video: null,
  catalogDigest: null,
};

type CreatorOperation =
  | 'idle'
  | 'reply'
  | 'action-confirm'
  | 'action-revise'
  | 'canvas-send'
  | 'scene-switch'
  | 'scene-confirm';

type CreatorHistoryOperation = 'idle' | 'load' | 'more';
type CreatorSettingsOperation = 'idle' | 'load' | 'save';

type CreatorUploadStatus = {
  current: number;
  total: number;
  name: string;
  percent: number | null;
};

function errorText(error: unknown, fallback = '操作没有完成，请重试') {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (/(?:\bHTTP\s*\d{3}\b|\bECONN\w*\b|\bENOTFOUND\b|\bETIMEDOUT\b|\bERR_[A-Z_]+\b|\bCREATOR_[A-Z_]+\b|TypeError|stack trace)/iu.test(error.message)) return fallback;
  // Backend diagnostic messages are intentionally stable Chinese strings.
  // They are not user/model content, so an English workspace should receive
  // the local fallback instead of leaking untranslated system copy.
  if (/\p{Script=Han}/u.test(fallback) !== /\p{Script=Han}/u.test(error.message)) return fallback;
  return error.message;
}

type CreatorCopy = (zh: string, en: string) => string;

function recoveryErrorText(error: unknown, fallback: string, copy: CreatorCopy) {
  const raw = error instanceof Error ? error.message : '';
  if (/(?:VISION_REQUIRED|不能读取图片|不能读取视频|vision(?:-capable)? model|read (?:images|videos))/iu.test(raw)) {
    return copy('当前 LLM 不能读取这些图片或视频。请打开右上角生成设置，改用智能选择或支持视觉的模型。', 'The current LLM cannot read these images or videos. Open generation settings and use Automatic or a vision-capable model.');
  }
  if (/(?:CREDENTIAL|API[_ -]?KEY|NOT_CONFIGURED|MODEL_(?:NOT_FOUND|UNAVAILABLE)|未配置|配置.*(?:渠道|模型))/iu.test(raw)) {
    return copy('创作模型还没连接好。完成 API 设置后即可继续，当前内容不会丢失。', 'The creative model is not connected yet. Finish API setup to continue; your work is safe.');
  }
  if (/(?:ECONN\w*|ENOTFOUND|ETIMEDOUT|NETWORK|fetch failed|Failed to fetch|网络|超时)/iu.test(raw)) {
    return copy('网络连接中断，当前内容已保留，请检查网络后重试。', 'The network connection was interrupted. Your work is saved; check the connection and try again.');
  }
  if (/(?:AMBIGUOUS|IN_PROGRESS|ALREADY_RUNNING|仍在运行|正在处理)/iu.test(raw)) {
    return copy('原任务可能仍在进行，正在重新接管，请不要重复提交。', 'The original task may still be running. Reconnecting now; do not submit it again.');
  }
  return errorText(error, fallback);
}

function startupConversationErrorText(error: unknown, copy: CreatorCopy) {
  const raw = error instanceof Error ? error.message : '';
  if (/(?:CREATOR_SCOPE_NOT_FOUND|项目或画布不存在)/iu.test(raw)) {
    return copy(
      '画布刚刚载入完成，但创作助手还没有同步好。画布和输入都没有受影响，请重试。',
      'The canvas is ready, but Creator Agent has not finished syncing. Your canvas and draft are safe; try again.',
    );
  }
  if (/(?:\bHTTP\s*(?:429|5\d\d)\b|ECONN\w*|ENOTFOUND|ETIMEDOUT|NETWORK|fetch failed|Failed to fetch|网络|超时)/iu.test(raw)) {
    return copy(
      '创作助手暂时没有连上后端。画布和输入都已保留，请确认后端已连接后重试。',
      'Creator Agent could not reach the backend. Your canvas and draft are safe; check the connection and try again.',
    );
  }
  return recoveryErrorText(
    error,
    copy(
      '上次对话暂时没有读取成功。画布和输入都没有受影响，请重试。',
      'The previous conversation could not be restored. Your canvas and draft are safe; try again.',
    ),
    copy,
  );
}

function mergeMessage(messages: CreatorMessageV2[], next: CreatorMessageV2) {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next].sort((left, right) => left.sequence - right.sequence);
  const copy = [...messages];
  copy[index] = next;
  return copy;
}

function attachmentKind(file: File, serverMime = ''): CreatorMediaRef['kind'] {
  const mime = `${serverMime || file.type}`.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] || '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'].includes(extension)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(extension)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(extension)) return 'audio';
  return 'file';
}

function conversationTitle(title: string, isChinese: boolean) {
  const normalized = String(title || '').trim();
  if (!normalized || normalized === '未命名创作' || normalized === 'Untitled creation') {
    return isChinese ? '未开始的创作' : 'New creation';
  }
  return normalized;
}

function selectionTypeLabel(type: string, isChinese: boolean) {
  const normalized = String(type || '').trim().toLowerCase();
  const known: Record<string, readonly [string, string]> = {
    upload: ['上传素材', 'Upload'],
    image: ['图像', 'Image'],
    video: ['视频', 'Video'],
    audio: ['音频', 'Audio'],
    text: ['文本', 'Text'],
    'material-set': ['素材集', 'Material set'],
    story: ['Story', 'Story'],
  };
  const localized = known[normalized];
  return localized ? localized[isChinese ? 0 : 1] : (type || (isChinese ? '节点' : 'Node'));
}

function selectionDisplayLabel(detail: CreatorSelectionSummary | undefined, isChinese: boolean) {
  const label = String(detail?.label || '').trim();
  const type = String(detail?.type || 'node').trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    upload: ['上传素材', 'upload', 'upload material'],
    image: ['图像', '图片', 'image'],
    video: ['视频', 'video'],
    audio: ['音频', 'audio'],
    text: ['文本', 'text'],
    'material-set': ['素材集', 'material set'],
    story: ['story'],
  };
  const typeLabel = selectionTypeLabel(type, isChinese);
  if (!label || (aliases[type] || []).includes(label.toLowerCase())) return typeLabel;
  return label;
}

function selectionDescriptor(detail: CreatorSelectionSummary | undefined, isChinese: boolean) {
  const label = selectionDisplayLabel(detail, isChinese);
  const typeLabel = selectionTypeLabel(detail?.type || 'node', isChinese);
  return label.toLocaleLowerCase() === typeLabel.toLocaleLowerCase() ? label : `${label} (${typeLabel})`;
}

function failedMessageCopy(errorCode: string | null, copy: CreatorCopy) {
  const code = String(errorCode || '').trim().toUpperCase();
  if (code === 'CREATOR_LLM_INTERRUPTED') {
    return copy('上次回复被应用关闭中断，请重新发送。', 'The previous reply was interrupted when the app closed. Send it again.');
  }
  if (/(?:CREDENTIAL_REQUIRED|CREDENTIAL_INVALID)/u.test(code)) {
    return copy('创作模型的 API Key 尚未设置或无法通过验证。检查 API 设置后即可继续，当前内容已经保留。', 'The creative model API key is missing or could not be verified. Check API settings to continue; your work is saved.');
  }
  if (code.includes('MODEL_UNAVAILABLE')) {
    return copy('当前选择的对话模型不可用。换回智能选择或选择另一个已就绪模型即可继续。', 'The selected chat model is unavailable. Use Automatic or choose another ready model to continue.');
  }
  if (code === 'CREATOR_LLM_VISION_REQUIRED') {
    return copy('当前 LLM 不能读取这些图片或视频。请在右上角设置中改用智能选择或支持视觉的模型。', 'The current LLM cannot read these images or videos. Use Automatic or a vision-capable model in settings.');
  }
  if (/(?:DOCUMENT_FORMAT_UNSUPPORTED|DOCUMENT_READ_FAILED)/u.test(code)) {
    return copy('这个文档没有读取成功。请重新添加 TXT、Markdown 或可复制文字的 PDF。', 'This document could not be read. Reattach a TXT, Markdown, or text-based PDF file.');
  }
  if (/(?:AUDIO_TRANSCRIBER_CREDENTIAL_REQUIRED|AUDIO_OBSERVER_UNAVAILABLE|AUDIO_EVIDENCE_REQUIRED|AUDIO_OBSERVATION_INVALID)/u.test(code)) {
    return copy('音频没有分析完成。请检查平价AI小屋配置，或重新添加音频后再试。', 'The audio analysis did not finish. Check the Budget AI House setup or reattach the audio, then try again.');
  }
  if (/(?:INPUT_ASSET_NOT_FOUND|SELECTED_NODE_STALE|ACTION_ASSET_MISMATCH)/u.test(code)) {
    return copy('引用的素材或画布节点已经变化。请重新添加素材或重新选择节点。', 'A linked asset or canvas node has changed. Reattach it or select the node again.');
  }
  if (/(?:STRUCTURE_INVALID|SCHEMA_INVALID|REPLY_EMPTY|QUESTION_CONTRACT_INVALID|TONE_INVALID|SUGGESTIONS_INVALID|SUGGESTIONS_POLICY_INVALID|PHASE_INVALID|ACTION_INVALID|ACTION_PROHIBITED|ACTION_TYPE_MISMATCH|FORBIDDEN_COST_TEXT)/u.test(code)) {
    return copy('模型回复不完整，未应用到作品；原输入和素材已保留，可以直接重试。', 'The model reply was incomplete and was not applied. Your text and materials are saved; try again.');
  }
  if (/(?:LLM_FAILED|NETWORK|TIMEOUT|REQUEST_FAILED)/u.test(code)) {
    return copy('模型或网络暂时没有完成回复。原输入和素材已保留，可以直接重试。', 'The model or network did not finish the reply. Your text and materials are saved; try again.');
  }
  return copy('这次回复没有完成，原输入和素材已保留。', 'This reply did not finish. Your original text and materials are saved.');
}

function failedMessageRecoveryKind(errorCode: string | null): 'api-settings' | 'generation-settings' | 'edit' {
  const code = String(errorCode || '').trim().toUpperCase();
  if (/(?:CREDENTIAL_REQUIRED|CREDENTIAL_INVALID)/u.test(code)) return 'api-settings';
  if (code.includes('MODEL_UNAVAILABLE') || code === 'CREATOR_LLM_VISION_REQUIRED') return 'generation-settings';
  return 'edit';
}

function messageTurnSignature(message: CreatorMessageV2) {
  if (message.role !== 'user') return '';
  return JSON.stringify({
    body: String(message.body || '').replace(/\s+/gu, ' ').trim(),
    media: message.media.map((asset) => asset.assetId).filter(Boolean),
    selectedNodes: message.selectedNodes.map((node) => node.nodeId).filter(Boolean),
  });
}

function resolvedRetryMessages(messages: CreatorMessageV2[]) {
  const users = new Map(messages.filter((message) => message.role === 'user').map((message) => [message.id, message]));
  const completedBySignature = new Map<string, number[]>();
  messages.forEach((message) => {
    if (message.role !== 'assistant' || message.status !== 'completed' || !message.replyToMessageId) return;
    const user = users.get(message.replyToMessageId);
    const signature = user ? messageTurnSignature(user) : '';
    if (!signature) return;
    completedBySignature.set(signature, [...(completedBySignature.get(signature) || []), message.sequence]);
  });
  const hiddenUserIds = new Set<string>();
  const resolvedAssistantIds = new Set<string>();
  messages.forEach((message) => {
    if (message.role !== 'assistant' || message.status !== 'failed' || !message.replyToMessageId) return;
    const user = users.get(message.replyToMessageId);
    const signature = user ? messageTurnSignature(user) : '';
    if (!signature || !(completedBySignature.get(signature) || []).some((sequence) => sequence > message.sequence)) return;
    hiddenUserIds.add(message.replyToMessageId);
    resolvedAssistantIds.add(message.id);
  });
  return { hiddenUserIds, resolvedAssistantIds };
}

export default function CreatorAgentPanelV2(props: CreatorAgentPanelV2Props) {
  const { i18n } = useTranslation();
  const isChinese = i18n.language.toLowerCase().startsWith('zh');
  const copy = useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const [replyWaitStage, setReplyWaitStage] = useState(0);
  const visibleMessageBody = useCallback((message: CreatorMessageV2) => {
    if (message.status === 'stopped') return copy('已停止，原需求已放回输入框，可以修改后重试。', 'Stopped. Your request is back in the input box, ready to edit or retry.');
    if (message.status === 'failed') return failedMessageCopy(message.errorCode, copy);
    if (message.body) return message.body;
    if (message.status !== 'streaming') return '';
    if (replyWaitStage >= 2) return copy('我还在认真整理，完整回复有时需要一两分钟。内容都已保存，也可以随时停止。', 'I’m still working this through. A complete creative reply can take a minute or two. Everything is saved, and you can stop at any time.');
    if (replyWaitStage >= 1) return copy('我在把这个想法整理成能直接用的方案…', 'I’m shaping this into a direction you can use…');
    return copy('我在想怎么把这个方向做得更好…', 'I’m working out the strongest direction…');
  }, [copy, replyWaitStage]);
  const legacyDraftKey = `t8.creator-agent.v2.draft.${props.projectId}.${props.canvasId}`;
  const freshDraftKey = `${legacyDraftKey}.new`;
  const initialComposerDraftRef = useRef<CreatorComposerDraft | null>(null);
  if (!initialComposerDraftRef.current) initialComposerDraftRef.current = readComposerDraft(legacyDraftKey);
  const initialComposerDraft = initialComposerDraftRef.current;
  const [open, setOpen] = useState(props.initialOpen === true);
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<CreatorOperation>('idle');
  const [conversation, setConversation] = useState<CreatorConversationV2 | null>(null);
  const [sceneNavigation, setSceneNavigation] = useState<CreatorLongScriptNavigationV2 | null>(null);
  const [sceneQuery, setSceneQuery] = useState('');
  const [messages, setMessages] = useState<CreatorMessageV2[]>([]);
  const [action, setAction] = useState<CreatorActionV2 | null>(null);
  const [draft, setDraft] = useState(initialComposerDraft.draft);
  const [creationMode, setCreationMode] = useState<'auto' | 'scene'>(initialComposerDraft.creationMode);
  const [attachments, setAttachments] = useState<CreatorMediaRef[]>(initialComposerDraft.attachments);
  const [uploadStatus, setUploadStatus] = useState<CreatorUploadStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedActionPromptId, setExpandedActionPromptId] = useState('');
  const [clippedActionPromptId, setClippedActionPromptId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreatorConversationV2[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyOperation, setHistoryOperation] = useState<CreatorHistoryOperation>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsOperation, setSettingsOperation] = useState<CreatorSettingsOperation>('idle');
  const [catalog, setCatalog] = useState<CreatorCatalogV2 | null>(null);
  const [settingsReadError, setSettingsReadError] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);
  const [preferences, setPreferences] = useState<CreatorPreferencesV2>(DEFAULT_PREFERENCES);
  const [settingsDraft, setSettingsDraft] = useState<CreatorPreferencesV2>(DEFAULT_PREFERENCES);
  const [sentNodes, setSentNodes] = useState<Record<string, string>>({});
  const [boundSelectionIds, setBoundSelectionIds] = useState<string[]>(initialComposerDraft.selectedNodeIds);
  const [boundSelectionDetails, setBoundSelectionDetails] = useState<CreatorSelectionSummary[]>(initialComposerDraft.selectedNodes);
  const [freshConversationRequested, setFreshConversationRequested] = useState(false);
  const [activeResponseId, setActiveResponseId] = useState('');
  const [newReplyBelow, setNewReplyBelow] = useState(false);
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const [startupError, setStartupError] = useState('');
  const [startupLoadRevision, setStartupLoadRevision] = useState(0);
  const [composerScopeKey, setComposerScopeKey] = useState(legacyDraftKey);
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelShellRef = useRef<HTMLElement>(null);
  const launcherOpenedAtRef = useRef<number | null>(props.initialShellOpenedAt ?? null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const historyPopoverRef = useRef<HTMLElement>(null);
  const settingsPopoverRef = useRef<HTMLElement>(null);
  const sceneSwitcherRef = useRef<HTMLDetailsElement>(null);
  const settingsLoadRef = useRef<Promise<void> | null>(null);
  const historyFirstItemRef = useRef<HTMLButtonElement>(null);
  const historySearchInputRef = useRef<HTMLInputElement>(null);
  const settingsFirstSelectRef = useRef<HTMLSelectElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionPromptRef = useRef<HTMLParagraphElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const stickToBottomRef = useRef(true);
  const activeResponseRef = useRef('');
  const activeTurnRef = useRef<CreatorComposerDraft | null>(null);
  const sequenceRef = useRef(0);
  const composerScopeKeyRef = useRef(legacyDraftKey);
  const composerBaseKeyRef = useRef(legacyDraftKey);
  const composerDraftRef = useRef(initialComposerDraft);
  const conversationOrientationRef = useRef('');
  const panelWasOpenRef = useRef(open);
  const awaitingApiSettingsReturnRef = useRef(false);
  const mediaReviewInFlightRef = useRef(new Set<string>());
  const panelId = useId();
  const panelTitleId = useId();
  const historyPopoverId = useId();
  const settingsPopoverId = useId();
  const isOperating = operation !== 'idle';
  const isUploading = uploadStatus !== null;
  const isSettingsBusy = settingsOperation !== 'idle';
  const isHistoryBusy = historyOperation !== 'idle';
  const creatorLlmConfigured = useMemo(() => {
    if (!catalog) return null;
    const providerAllowed = (providerId: string) => preferences.providerId === 'auto'
      || providerId === preferences.providerId;
    if (preferences.llm) {
      return catalog.llm.some((item) => item.configured
        && item.providerId === preferences.llm?.providerId
        && item.modelId === preferences.llm?.modelId
        && providerAllowed(item.providerId));
    }
    return catalog.llm.some((item) => item.configured && providerAllowed(item.providerId));
  }, [catalog, preferences]);
  const finishOperation = useCallback((expected: CreatorOperation) => {
    setOperation((current) => current === expected ? 'idle' : current);
  }, []);
  const settleMessageScroll = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container || !stickToBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
      setNewReplyBelow(false);
    }));
  }, []);
  const scrollToLatestReply = useCallback(() => {
    stickToBottomRef.current = true;
    setNewReplyBelow(false);
    settleMessageScroll();
  }, [settleMessageScroll]);
  const surfaceConversationUpdate = useCallback(() => {
    if (stickToBottomRef.current) settleMessageScroll();
    else setNewReplyBelow(true);
  }, [settleMessageScroll]);
  const setPanelOpen = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setOpen(value);
  }, []);
  useEffect(() => {
    props.onOpenChange?.(open);
  }, [open, props.onOpenChange]);
  const dismissSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsDraft(preferences);
  }, [preferences]);
  const openApiSettings = useCallback(() => {
    setHistoryOpen(false);
    dismissSettings();
    if (props.onOpenApiSettings) {
      awaitingApiSettingsReturnRef.current = true;
      setMinimized(false);
      props.onOpenApiSettings();
      return;
    }
    setError(copy('API 设置暂时无法打开，请稍后重试。', 'API settings could not be opened. Please try again.'));
  }, [copy, dismissSettings, props.onOpenApiSettings]);
  const clearBoundSelection = useCallback(() => {
    setBoundSelectionIds([]);
    setBoundSelectionDetails([]);
  }, []);
  const applyComposerDraft = useCallback((restored: CreatorComposerDraft) => {
    composerDraftRef.current = restored;
    setDraft(restored.draft);
    setAttachments(restored.attachments);
    setBoundSelectionIds(restored.selectedNodeIds);
    setBoundSelectionDetails(restored.selectedNodes);
    setCreationMode(restored.creationMode);
  }, []);
  const switchComposerDraftScope = useCallback((nextKey: string, options: {
    reset?: boolean;
    migrateFromKey?: string;
  } = {}) => {
    const previousKey = composerScopeKeyRef.current;
    writeComposerDraft(previousKey, composerDraftRef.current);
    let restored = options.reset ? { ...EMPTY_COMPOSER_DRAFT } : readComposerDraft(nextKey);
    if (!options.reset && options.migrateFromKey) {
      const migrated = readComposerDraft(options.migrateFromKey);
      if (!composerDraftHasContent(restored) && composerDraftHasContent(migrated)) restored = migrated;
      if (options.migrateFromKey !== nextKey) writeComposerDraft(options.migrateFromKey, EMPTY_COMPOSER_DRAFT);
    }
    composerScopeKeyRef.current = nextKey;
    setComposerScopeKey(nextKey);
    applyComposerDraft(restored);
  }, [applyComposerDraft]);
  const lastSequence = useMemo(() => Math.max(
    conversation?.sequence || 0,
    ...messages.map((message) => message.sequence),
    action?.sequence || 0,
  ), [action?.sequence, conversation?.sequence, messages]);
  const latestAssistant = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant'), [messages]);
  const retryResolution = useMemo(() => resolvedRetryMessages(messages), [messages]);
  const knownMedia = useMemo(() => new Map([
    ...messages.flatMap((message) => message.media),
    ...(action?.resultAssets || []),
  ].map((asset) => [asset.assetId, asset])), [action?.resultAssets, messages]);
  const selectedNodeDetails = useMemo(() => {
    const byId = new Map((props.selectedNodes || []).map((node) => [node.id, node]));
    return props.selectedNodeIds.map((id) => byId.get(id) || {
      id,
      type: 'node',
      label: isChinese ? '画布节点' : 'Canvas node',
    });
  }, [isChinese, props.selectedNodeIds, props.selectedNodes]);
  const availableNodeIdSet = useMemo(
    () => new Set(props.availableNodeIds || []),
    [props.availableNodeIds],
  );
  useEffect(() => {
    if (!props.availableNodeIds || !boundSelectionIds.length) return;
    const validIds = boundSelectionIds.filter((id) => availableNodeIdSet.has(id));
    const removedCount = boundSelectionIds.length - validIds.length;
    if (!removedCount) return;
    const validSet = new Set(validIds);
    setBoundSelectionIds(validIds);
    setBoundSelectionDetails((current) => current.filter((item) => validSet.has(item.id)));
    setNotice(copy(
      `已移除 ${removedCount} 个画布中已不存在的引用。`,
      `${removedCount} canvas reference${removedCount === 1 ? ' was' : 's were'} removed because ${removedCount === 1 ? 'it no longer exists' : 'they no longer exist'}.`,
    ));
  }, [availableNodeIdSet, boundSelectionIds, copy, props.availableNodeIds]);
  const linkedSelectionText = useMemo(() => {
    if (!boundSelectionIds.length) return '';
    const first = boundSelectionDetails.find((node) => node.id === boundSelectionIds[0]);
    const firstLabel = selectionDescriptor(first, isChinese);
    const remaining = boundSelectionIds.length - 1;
    return remaining > 0
      ? copy(`已引用 ${firstLabel} 等 ${boundSelectionIds.length} 个节点`, `${firstLabel} +${remaining} linked`)
      : copy(`已引用 ${firstLabel}`, `${firstLabel} linked`);
  }, [boundSelectionDetails, boundSelectionIds, copy, isChinese]);
  const linkedSelectionTitle = useMemo(() => boundSelectionIds.map((id) => {
    const detail = boundSelectionDetails.find((node) => node.id === id);
    return detail ? selectionDescriptor(detail, isChinese) : id;
  }).join('\n'), [boundSelectionDetails, boundSelectionIds, isChinese]);
  const style = useMemo(() => ({
    '--creator-bg': props.themeTokens.panelBg,
    '--creator-surface': props.themeTokens.panelBgElevated,
    '--creator-surface-alt': props.themeTokens.panelBgMuted,
    '--creator-border': props.themeTokens.border,
    '--creator-text': props.themeTokens.textMain,
    '--creator-muted': props.themeTokens.textMuted,
    '--creator-accent': props.themeTokens.accent,
    '--creator-accent-text': props.themeTokens.accentText,
    '--creator-danger': props.themeTokens.danger,
    '--creator-success': props.themeTokens.success,
    '--creator-font': props.themeTokens.fontFamily,
    '--creator-panel-safe-top': `${Math.max(86, Number(props.panelSafeTop) || 86)}px`,
  }) as CSSProperties, [props.panelSafeTop, props.themeTokens]);

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-canvas-floating-ui="creator-agent-launcher-slot"]');
    setLauncherHost(host);
    return () => setLauncherHost(null);
  }, [props.canvasId]);

  useLayoutEffect(() => {
    const shell = panelShellRef.current;
    if (!open || !shell) return undefined;
    const startedAt = launcherOpenedAtRef.current ?? performance.now();
    const commitMs = Math.max(0, performance.now() - startedAt);
    shell.dataset.shellReadinessSchema = CREATOR_SHELL_READINESS_SCHEMA;
    shell.dataset.shellCommitMs = commitMs.toFixed(3);
    shell.dataset.shellTargetMs = String(CREATOR_SHELL_TARGET_MS);
    shell.dataset.shellReadinessStatus = 'pending-paint';
    const frame = window.requestAnimationFrame(() => {
      const paintReadyMs = Math.max(0, performance.now() - startedAt);
      shell.dataset.shellPaintReadyMs = paintReadyMs.toFixed(3);
      shell.dataset.shellReadinessStatus = paintReadyMs <= CREATOR_SHELL_TARGET_MS
        ? 'within-target'
        : 'over-target';
      launcherOpenedAtRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useLayoutEffect(() => {
    if (composerBaseKeyRef.current === legacyDraftKey) return;
    writeComposerDraft(composerScopeKeyRef.current, composerDraftRef.current);
    const restored = readComposerDraft(legacyDraftKey);
    composerBaseKeyRef.current = legacyDraftKey;
    composerScopeKeyRef.current = legacyDraftKey;
    setComposerScopeKey(legacyDraftKey);
    applyComposerDraft(restored);
  }, [applyComposerDraft, legacyDraftKey]);

  useEffect(() => {
    const persisted = normalizeComposerDraft({
      schema: 't8-creator-agent-v2-composer-draft-v1',
      draft,
      attachments,
      selectedNodeIds: boundSelectionIds,
      selectedNodes: boundSelectionDetails,
      creationMode,
    });
    composerDraftRef.current = persisted;
    if (composerScopeKeyRef.current !== composerScopeKey) return undefined;
    const timeout = window.setTimeout(() => writeComposerDraft(composerScopeKey, persisted), 250);
    return () => window.clearTimeout(timeout);
  }, [attachments, boundSelectionDetails, boundSelectionIds, composerScopeKey, creationMode, draft]);

  useEffect(() => () => {
    writeComposerDraft(composerScopeKeyRef.current, composerDraftRef.current);
  }, []);

  const resizeComposer = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = 'auto';
    const nextHeight = Math.min(Math.max(composer.scrollHeight, 46), 210);
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = composer.scrollHeight > 210 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    if (!open || minimized) return;
    resizeComposer();
  }, [draft, minimized, open, resizeComposer]);

  const loadConversation = useCallback(async (sessionId: string) => {
    const [snapshot, navigation] = await Promise.all([
      getCreatorConversationV2(sessionId, props.projectId, props.canvasId),
      getCreatorLongScriptScenesV2(sessionId, props.projectId, props.canvasId),
    ]);
    const nextDraftKey = conversationComposerDraftKey(legacyDraftKey, snapshot.conversation.id);
    switchComposerDraftScope(nextDraftKey, {
      migrateFromKey: composerScopeKeyRef.current === legacyDraftKey ? legacyDraftKey : undefined,
    });
    conversationOrientationRef.current = [...snapshot.messages].reverse()
      .find((message) => message.role === 'assistant')?.id || '';
    setConversation(snapshot.conversation);
    setSceneNavigation(navigation.total ? navigation : null);
    setMessages(snapshot.messages);
    setAction(snapshot.pendingAction);
    setNextBeforeSequence(snapshot.nextBeforeSequence);
    sequenceRef.current = Math.max(
      snapshot.conversation.sequence || 0,
      ...snapshot.messages.map((message) => message.sequence),
      snapshot.pendingAction?.sequence || 0,
    );
    setSentNodes({});
    setNewReplyBelow(false);
    stickToBottomRef.current = true;
    setFreshConversationRequested(false);
    return snapshot.conversation;
  }, [legacyDraftKey, props.canvasId, props.projectId, switchComposerDraftScope]);

  const loadLatestConversation = useCallback(async () => {
    if (conversation || freshConversationRequested) return conversation;
    const listed = await listCreatorConversationsV2(props.projectId, props.canvasId);
    const current = listed.items[0];
    if (current) return loadConversation(current.id);
    setMessages([]);
    setAction(null);
    setSceneNavigation(null);
    setNextBeforeSequence(null);
    return null;
  }, [conversation, freshConversationRequested, loadConversation, props.canvasId, props.projectId]);

  const ensureConversation = useCallback(async () => {
    if (conversation) return conversation;
    if (!freshConversationRequested) {
      const listed = await listCreatorConversationsV2(props.projectId, props.canvasId);
      const current = listed.items[0];
      if (current) return loadConversation(current.id);
    }
    const created = await createCreatorConversationV2(props.projectId, props.canvasId);
    switchComposerDraftScope(conversationComposerDraftKey(legacyDraftKey, created.conversation.id), {
      migrateFromKey: composerScopeKeyRef.current,
    });
    setConversation(created.conversation);
    setMessages([]);
    setAction(null);
    setSceneNavigation(null);
    setNextBeforeSequence(null);
    setFreshConversationRequested(false);
    return created.conversation;
  }, [conversation, freshConversationRequested, legacyDraftKey, loadConversation, props.canvasId, props.projectId, switchComposerDraftScope]);

  useEffect(() => {
    if (!open || conversation || freshConversationRequested) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setStartupError('');
    void (async () => {
      const retryDelays = [0, 250, 750];
      let lastError: unknown = null;
      for (const delay of retryDelays) {
        if (cancelled) return;
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (cancelled) return;
        try {
          await loadLatestConversation();
          if (!cancelled) setStartupError('');
          return;
        } catch (loadError) {
          lastError = loadError;
        }
      }
      if (!cancelled) setStartupError(startupConversationErrorText(lastError, copy));
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversation, copy, freshConversationRequested, loadLatestConversation, open, startupLoadRevision]);

  useEffect(() => {
    sequenceRef.current = Math.max(sequenceRef.current, lastSequence);
  }, [lastSequence]);

  useEffect(() => {
    if (operation !== 'reply') {
      setReplyWaitStage(0);
      return undefined;
    }
    setReplyWaitStage(0);
    const explainTimer = window.setTimeout(() => setReplyWaitStage(1), 12_000);
    const reassureTimer = window.setTimeout(() => setReplyWaitStage(2), 35_000);
    return () => {
      window.clearTimeout(explainTimer);
      window.clearTimeout(reassureTimer);
    };
  }, [operation]);

  useEffect(() => {
    if (!open || !conversation) return undefined;
    return subscribeCreatorEventsV2(conversation.id, props.projectId, props.canvasId, sequenceRef.current, {
      onCursor: (sequence) => {
        sequenceRef.current = Math.max(sequenceRef.current, sequence);
      },
      onMessage: (message) => {
        sequenceRef.current = Math.max(sequenceRef.current, message.sequence);
        setMessages((current) => mergeMessage(current, message));
        if (message.role !== 'assistant') return;
        if (message.responseId === activeResponseRef.current) {
          setActiveResponseId(message.status === 'streaming' ? message.responseId : '');
          if (message.status === 'stopped' && activeTurnRef.current) {
            const stoppedTurn = activeTurnRef.current;
            setDraft((current) => {
              const restored = current.length ? current : stoppedTurn.draft;
              composerDraftRef.current = { ...composerDraftRef.current, draft: restored };
              return restored;
            });
            setAttachments((current) => current.length ? current : stoppedTurn.attachments);
            setBoundSelectionIds((current) => current.length ? current : stoppedTurn.selectedNodeIds);
            setBoundSelectionDetails((current) => current.length ? current : stoppedTurn.selectedNodes);
          }
        }
        if (message.status !== 'streaming') surfaceConversationUpdate();
      },
      onAction: (next) => {
        sequenceRef.current = Math.max(sequenceRef.current, next.sequence);
        setAction(next.status === 'cancelled' ? null : next);
        if (next.resultAssets.length) {
          setMessages((current) => current.map((message) => message.actionId === next.id
            ? { ...message, media: next.resultAssets }
            : message));
        }
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'ambiguous') {
          finishOperation('action-confirm');
          surfaceConversationUpdate();
        }
      },
      onConversation: (next) => {
        sequenceRef.current = Math.max(sequenceRef.current, next.sequence);
        setConversation(next);
      },
      onWork: () => {
        void getCreatorLongScriptScenesV2(conversation.id, props.projectId, props.canvasId)
          .then((navigation) => setSceneNavigation(navigation.total ? navigation : null))
          .catch(() => {});
      },
    });
  }, [conversation?.id, finishOperation, open, props.canvasId, props.projectId, surfaceConversationUpdate]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const orientationId = conversationOrientationRef.current;
    if (orientationId) {
      conversationOrientationRef.current = '';
      const target = Array.from(container.querySelectorAll<HTMLElement>('[data-creator-message-id]'))
        .find((element) => element.dataset.creatorMessageId === orientationId);
      const needsActionAtBottom = action?.status === 'pending' || action?.status === 'running' || action?.status === 'ambiguous';
      if (target && !needsActionAtBottom) {
        const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTop = Math.max(0, targetTop - 10);
        stickToBottomRef.current = false;
        setNewReplyBelow(false);
        return;
      }
    }
    if (!stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
    setNewReplyBelow(false);
  }, [action, messages]);

  useLayoutEffect(() => {
    const reopened = open && !panelWasOpenRef.current;
    panelWasOpenRef.current = open;
    if (!reopened || minimized || loading) return;
    const container = messagesRef.current;
    if (!container) return;
    const latestId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
    const target = latestId
      ? Array.from(container.querySelectorAll<HTMLElement>('[data-creator-message-id]'))
        .find((element) => element.dataset.creatorMessageId === latestId)
      : null;
    if (target && action?.status !== 'pending' && action?.status !== 'running' && action?.status !== 'ambiguous') {
      const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTop = Math.max(0, targetTop - 10);
      stickToBottomRef.current = false;
    } else {
      container.scrollTop = container.scrollHeight;
      stickToBottomRef.current = true;
    }
    setNewReplyBelow(false);
  }, [action?.status, loading, messages, minimized, open]);

  useLayoutEffect(() => {
    if (!action || action.status !== 'pending') {
      setClippedActionPromptId('');
      return undefined;
    }
    if (expandedActionPromptId === action.id) return undefined;
    const prompt = actionPromptRef.current;
    if (!prompt) return undefined;
    const measure = () => {
      setClippedActionPromptId(prompt.scrollHeight > prompt.clientHeight + 1 ? action.id : '');
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(prompt);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [action?.id, action?.prompt, action?.status, expandedActionPromptId]);

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!open || minimized || loading) return undefined;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [loading, minimized, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (settingsOpen) {
        dismissSettings();
        requestAnimationFrame(() => settingsButtonRef.current?.focus());
      } else if (historyOpen) {
        setHistoryOpen(false);
        requestAnimationFrame(() => historyButtonRef.current?.focus());
      }
      else {
        setPanelOpen(false);
        requestAnimationFrame(() => launcherRef.current?.focus());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dismissSettings, historyOpen, open, setPanelOpen, settingsOpen]);

  useEffect(() => {
    if (!open || (!historyOpen && !settingsOpen)) return undefined;
    const handler = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyOpen
        && !historyPopoverRef.current?.contains(target)
        && !historyButtonRef.current?.contains(target)) {
        setHistoryOpen(false);
      }
      if (settingsOpen
        && !settingsPopoverRef.current?.contains(target)
        && !settingsButtonRef.current?.contains(target)) {
        dismissSettings();
      }
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [dismissSettings, historyOpen, open, settingsOpen]);

  const newConversation = useCallback(() => {
    if (isOperating || loading) return;
    if (!conversation && messages.length === 0 && !action) {
      if (composerScopeKeyRef.current !== freshDraftKey) {
        switchComposerDraftScope(freshDraftKey, { migrateFromKey: composerScopeKeyRef.current });
      }
      setError('');
      if (composerDraftHasContent(composerDraftRef.current)) {
        setNotice(copy('当前已经是新对话，未发送的内容已保留。', 'This is already a new conversation. Your unsent work is still here.'));
      }
      setHistoryOpen(false);
      setHistoryQuery('');
      dismissSettings();
      setFreshConversationRequested(true);
      setMinimized(false);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    switchComposerDraftScope(freshDraftKey, { reset: true });
    setError('');
    setNotice('');
    setConversation(null);
    setSceneNavigation(null);
    setMessages([]);
    setAction(null);
    setHistoryOpen(false);
    setHistoryQuery('');
    dismissSettings();
    setSentNodes({});
    setActiveResponseId('');
    setNewReplyBelow(false);
    stickToBottomRef.current = true;
    activeResponseRef.current = '';
    sequenceRef.current = 0;
    setNextBeforeSequence(null);
    setFreshConversationRequested(true);
    setMinimized(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [action, conversation, copy, dismissSettings, freshDraftKey, isOperating, loading, messages.length, switchComposerDraftScope]);

  const focusHistoryTarget = useCallback(() => {
    (historySearchInputRef.current || historyFirstItemRef.current || historyPopoverRef.current)?.focus();
  }, []);

  const openHistory = useCallback(async () => {
    const nextOpen = !historyOpen;
    if (nextOpen) setMinimized(false);
    setHistoryOpen(nextOpen);
    setHistoryQuery('');
    dismissSettings();
    if (!nextOpen) return;
    requestAnimationFrame(() => requestAnimationFrame(focusHistoryTarget));
    setHistoryOperation('load');
    try {
      const listed = await listCreatorConversationsV2(props.projectId, props.canvasId);
      setHistory(listed.items);
      setHistoryBefore(listed.nextBefore);
      requestAnimationFrame(() => requestAnimationFrame(focusHistoryTarget));
    } catch (historyError) { setError(recoveryErrorText(historyError, copy('历史记录没有读取成功，请检查连接后重试。', 'Conversation history did not load. Check the connection and try again.'), copy)); } finally { setHistoryOperation('idle'); }
  }, [copy, dismissSettings, focusHistoryTarget, historyOpen, props.canvasId, props.projectId]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversation || !nextBeforeSequence || loadingOlder) return;
    const container = messagesRef.current;
    const previousHeight = container?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const older = await getCreatorConversationV2(conversation.id, props.projectId, props.canvasId, nextBeforeSequence);
      setMessages((current) => {
        const byId = new Map([...older.messages, ...current].map((message) => [message.id, message]));
        return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
      });
      setNextBeforeSequence(older.nextBeforeSequence);
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - previousHeight;
      });
    } catch (loadError) {
      setError(errorText(loadError, copy('更早的对话没有加载成功', 'Could not load earlier messages.')));
    } finally { setLoadingOlder(false); }
  }, [conversation, copy, loadingOlder, nextBeforeSequence, props.canvasId, props.projectId]);

  const loadMoreHistory = useCallback(async () => {
    if (!historyBefore || isHistoryBusy) return;
    setHistoryOperation('more');
    try {
      const listed = await listCreatorConversationsV2(props.projectId, props.canvasId, historyBefore);
      setHistory((current) => [...new Map([...current, ...listed.items].map((item) => [item.id, item])).values()]);
      setHistoryBefore(listed.nextBefore);
    } catch (loadError) {
      setError(errorText(loadError, copy('更早的历史没有加载成功', 'Could not load more history.')));
    } finally { setHistoryOperation('idle'); }
  }, [copy, historyBefore, isHistoryBusy, props.canvasId, props.projectId]);

  const selectHistoryConversation = useCallback(async (sessionId: string) => {
    if (isOperating || sessionId === conversation?.id) {
      setHistoryOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    setHistoryOperation('load');
    setError('');
    setHistoryOpen(false);
    setMinimized(false);
    try {
      await loadConversation(sessionId);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (loadError) {
      setError(errorText(loadError, copy('这段历史没有打开成功', 'Could not open this conversation.')));
      requestAnimationFrame(() => historyButtonRef.current?.focus());
    } finally {
      setHistoryOperation('idle');
    }
  }, [conversation?.id, copy, isOperating, loadConversation]);

  const refreshCreatorSettings = useCallback(async (focusFirstControl = false) => {
    if (settingsLoadRef.current) {
      try {
        await settingsLoadRef.current;
      } catch (settingsError) {
        setSettingsReadError(recoveryErrorText(settingsError, copy('创作模型状态没有读取成功，请检查连接后重试。', 'Creative model status did not load. Check the connection and try again.'), copy));
      }
      if (focusFirstControl) requestAnimationFrame(() => settingsFirstSelectRef.current?.focus());
      return;
    }
    setSettingsOperation('load');
    setSettingsReadError('');
    const task = (async () => {
      const retryDelays = [0, 350, 900];
      let lastError: unknown = null;
      for (const delay of retryDelays) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        try {
          const [settingsResult, catalogResult] = await Promise.all([
            getCreatorSettingsV2(props.projectId, props.canvasId),
            getCreatorCatalogV2(props.projectId, props.canvasId),
          ]);
          setPreferences(settingsResult.preferences);
          setSettingsDraft(settingsResult.preferences);
          setCatalog(catalogResult);
          setSettingsReadError('');
          return;
        } catch (settingsError) {
          lastError = settingsError;
        }
      }
      throw lastError;
    })();
    settingsLoadRef.current = task;
    try {
      await task;
      if (focusFirstControl) requestAnimationFrame(() => requestAnimationFrame(() => settingsFirstSelectRef.current?.focus()));
    } catch (settingsError) {
      const settingsMessage = recoveryErrorText(settingsError, copy('创作模型状态没有读取成功，请检查连接后重试。', 'Creative model status did not load. Check the connection and try again.'), copy);
      setSettingsReadError(settingsMessage);
    } finally {
      if (settingsLoadRef.current === task) settingsLoadRef.current = null;
      setSettingsOperation('idle');
    }
  }, [copy, props.canvasId, props.projectId]);

  useEffect(() => {
    if (!open) return;
    void refreshCreatorSettings(false);
  }, [open, props.apiSettingsRevision, refreshCreatorSettings]);

  useEffect(() => {
    if (!open || !awaitingApiSettingsReturnRef.current) return;
    awaitingApiSettingsReturnRef.current = false;
    setMinimized(false);
    requestAnimationFrame(() => requestAnimationFrame(() => composerRef.current?.focus()));
  }, [open, props.apiSettingsRevision]);

  const openSettings = useCallback(async (forceOpen = false) => {
    const nextOpen = forceOpen || !settingsOpen;
    if (nextOpen) {
      setMinimized(false);
      setShowAllModels(false);
    }
    setSettingsOpen(nextOpen);
    setHistoryOpen(false);
    if (!nextOpen) {
      setSettingsDraft(preferences);
      requestAnimationFrame(() => settingsButtonRef.current?.focus());
      return;
    }
    requestAnimationFrame(() => settingsPopoverRef.current?.focus());
    await refreshCreatorSettings(true);
  }, [preferences, refreshCreatorSettings, settingsOpen]);

  const saveSettings = useCallback(async () => {
    if (!catalog || isSettingsBusy) return;
    setSettingsOperation('save');
    setError('');
    try {
      const saved = await saveCreatorSettingsV2(props.projectId, props.canvasId, {
        ...settingsDraft,
        catalogDigest: catalog.catalogDigest,
      });
      setPreferences(saved.preferences);
      setSettingsDraft(saved.preferences);
      setSettingsOpen(false);
      requestAnimationFrame(() => settingsButtonRef.current?.focus());
    } catch (settingsError) { setError(recoveryErrorText(settingsError, copy('设置没有保存，请检查连接后重试。', 'Settings were not saved. Check the connection and try again.'), copy)); } finally { setSettingsOperation('idle'); }
  }, [catalog, copy, isSettingsBusy, props.canvasId, props.projectId, settingsDraft]);

  const switchScene = useCallback(async (sceneId: string) => {
    if (!conversation || !sceneNavigation || sceneId === sceneNavigation.currentSceneId || isOperating) return;
    setOperation('scene-switch');
    setError('');
    try {
      const changed = await setCreatorCurrentSceneV2(
        conversation.id,
        sceneId,
        props.projectId,
        props.canvasId,
      );
      setSceneNavigation(changed.navigation);
      setConversation((current) => current ? { ...current, currentSceneId: sceneId } : current);
      setSceneQuery('');
      if (sceneSwitcherRef.current) sceneSwitcherRef.current.open = false;
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (sceneError) {
      setError(recoveryErrorText(
        sceneError,
        copy('这个场次没有切换成功，当前内容没有变化，请重试。', 'This scene did not open. Your current work is unchanged; try again.'),
        copy,
      ));
    } finally {
      finishOperation('scene-switch');
    }
  }, [conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId, sceneNavigation]);

  const confirmCurrentScene = useCallback(async () => {
    if (!conversation || !sceneNavigation?.currentSceneId || isOperating) return;
    setOperation('scene-confirm');
    setError('');
    try {
      const confirmed = await confirmCreatorCurrentSceneV2(
        conversation.id,
        sceneNavigation.currentSceneId,
        props.projectId,
        props.canvasId,
        crypto.randomUUID(),
        sceneNavigation.currentScene?.sourcePartId,
      );
      setSceneNavigation(confirmed.navigation);
      setConversation((current) => current
        ? { ...current, currentSceneId: confirmed.navigation.currentSceneId }
        : current);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (sceneError) {
      setError(recoveryErrorText(
        sceneError,
        copy('这一场没有定下来，当前内容仍然保留，请重试。', 'This scene was not confirmed. Your work is still here; try again.'),
        copy,
      ));
    } finally {
      finishOperation('scene-confirm');
    }
  }, [conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId, sceneNavigation]);

  const submit = useCallback(async (text = draft, options: CreatorSubmitOptions = {}) => {
    const requestedContent = text.trim();
    const turnAttachments = options.attachments ?? attachments;
    const turnSelectedNodeIds = options.selectedNodeIds ?? boundSelectionIds;
    const preserveComposer = options.preserveComposer === true;
    const turnCreationMode = sceneNavigation?.total || creationMode === 'scene' ? 'scene' : 'auto';
    const hasAttachments = turnAttachments.length > 0;
    const hasSelectedNodes = turnSelectedNodeIds.length > 0;
    const turnSelectedNodes = boundSelectionDetails.filter((item) => turnSelectedNodeIds.includes(item.id));
    if ((!requestedContent && !hasAttachments && !hasSelectedNodes) || isOperating) return;
    if (creatorLlmConfigured !== true) {
      if (creatorLlmConfigured === false) openApiSettings();
      else void refreshCreatorSettings(false);
      return;
    }
    const content = requestedContent || (hasAttachments && hasSelectedNodes
      ? copy('请先看看这些素材和我在画布上选中的内容，帮我判断最合适的创作方向。', 'Please review these materials and what I selected on the canvas, then suggest the strongest creative direction.')
      : hasAttachments
        ? copy('请先看看这些素材，帮我判断最合适的创作方向。', 'Please review these materials, then suggest the strongest creative direction.')
        : copy('请先看看我在画布上选中的内容，帮我判断最合适的创作方向。', 'Please review what I selected on the canvas, then suggest the strongest creative direction.'));
    let sessionId = conversation?.id || '';
    let responseId = '';
    activeTurnRef.current = normalizeComposerDraft({
      schema: 't8-creator-agent-v2-composer-draft-v1',
      draft: requestedContent,
      attachments: turnAttachments,
      selectedNodeIds: turnSelectedNodeIds,
      selectedNodes: turnSelectedNodes,
      creationMode: turnCreationMode,
    });
    setOperation('reply');
    setError('');
    setNotice('');
    if (!preserveComposer) {
      composerDraftRef.current = { ...EMPTY_COMPOSER_DRAFT, creationMode: turnCreationMode };
      setDraft('');
      setAttachments([]);
      clearBoundSelection();
    }
    setNewReplyBelow(false);
    stickToBottomRef.current = true;
    setHistoryOpen(false);
    dismissSettings();
    try {
      const current = await ensureConversation();
      sessionId = current.id;
      const clientRequestId = crypto.randomUUID();
      responseId = `response-${clientRequestId}`;
      activeResponseRef.current = responseId;
      setActiveResponseId(responseId);
      const pending = sendCreatorMessageV2(current.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        text: content,
        locale: isChinese ? 'zh-CN' : 'en',
        clientRequestId,
        attachments: turnAttachments,
        selectedNodeIds: turnSelectedNodeIds,
        currentSceneId: sceneNavigation?.currentSceneId || null,
        creationMode: turnCreationMode,
      });
      const snapshot = await pending;
      setConversation(snapshot.conversation);
      setMessages(snapshot.messages);
      setAction(snapshot.pendingAction);
      if (snapshot.conversation.currentSceneId || snapshot.work?.snapshot) {
        try {
          const navigation = await getCreatorLongScriptScenesV2(current.id, props.projectId, props.canvasId);
          setSceneNavigation(navigation.total ? navigation : null);
        } catch { /* The committed reply remains visible; SSE or reopen will restore navigation. */ }
      }
      if (stickToBottomRef.current) settleMessageScroll();
      else setNewReplyBelow(true);
    } catch (sendError) {
      let durableStatus: CreatorMessageV2['status'] | '' = '';
      if (sessionId && responseId) {
        try {
          const recovered = await getCreatorConversationV2(sessionId, props.projectId, props.canvasId);
          const durable = recovered.messages.find((message) => message.responseId === responseId);
          durableStatus = durable?.status || '';
          if (durable) {
            setConversation(recovered.conversation);
            setMessages(recovered.messages);
            setAction(recovered.pendingAction);
            setNextBeforeSequence(recovered.nextBeforeSequence);
          }
        } catch { /* The original localized error remains authoritative. */ }
      }
      if (!durableStatus || durableStatus === 'failed' || durableStatus === 'stopped') {
        if (!preserveComposer) {
          setDraft((current) => {
            const restored = current.length ? current : requestedContent;
            composerDraftRef.current = { ...composerDraftRef.current, draft: restored };
            return restored;
          });
          setAttachments((current) => current.length ? current : turnAttachments);
          setBoundSelectionIds((current) => current.length ? current : turnSelectedNodeIds);
          setBoundSelectionDetails((current) => current.length
            ? current
            : turnSelectedNodes);
        }
      }
      if (!durableStatus) {
        setError(recoveryErrorText(sendError, copy('这次回复没有完成，原输入和素材已保留，请重试。', 'The reply did not finish. Your text and materials are still here; try again.'), copy));
      }
    } finally {
      if (activeResponseRef.current === responseId) {
        activeResponseRef.current = '';
        setActiveResponseId('');
      }
      activeTurnRef.current = null;
      finishOperation('reply');
    }
  }, [attachments, boundSelectionDetails, boundSelectionIds, clearBoundSelection, conversation?.id, copy, creationMode, creatorLlmConfigured, dismissSettings, draft, ensureConversation, finishOperation, isChinese, isOperating, openApiSettings, props.canvasId, props.projectId, refreshCreatorSettings, sceneNavigation?.currentSceneId, sceneNavigation?.total, settleMessageScroll]);

  const stop = useCallback(async () => {
    if (!conversation || !activeResponseRef.current) return;
    try {
      await stopCreatorResponseV2(conversation.id, activeResponseRef.current, props.projectId, props.canvasId);
    } catch (stopError) { setError(errorText(stopError, copy('没有停止成功', 'Could not stop the reply.'))); }
  }, [conversation, copy, props.canvasId, props.projectId]);

  const confirmAction = useCallback(async () => {
    if (!conversation || !action || isOperating) return;
    setOperation('action-confirm');
    setError('');
    try {
      const confirmed = await confirmCreatorActionV2(conversation.id, action.id, props.projectId, props.canvasId);
      setAction(confirmed.action);
    } catch (confirmError) {
      finishOperation('action-confirm');
      setError(recoveryErrorText(confirmError, copy('没有开始生成，请检查右上角生成设置后重试。', 'Generation did not start. Check generation settings in the top right, then try again.'), copy));
    }
  }, [action, conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId]);

  const redoAction = useCallback(async () => {
    if (!conversation || !action || action.status !== 'failed' || isOperating) return;
    setOperation('action-confirm');
    setError('');
    try {
      const retried = await retryCreatorActionV2(
        conversation.id, action.id, props.projectId, props.canvasId,
      );
      setAction(retried.action);
    } catch (retryError) {
      finishOperation('action-confirm');
      setError(recoveryErrorText(
        retryError,
        copy('这一条没有重新开始，其他已完成结果没有受影响。', 'This item did not restart. Other completed results were not affected.'),
        copy,
      ));
    }
  }, [action, conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId]);

  const restoreFailedTurn = useCallback((assistant: CreatorMessageV2) => {
    const user = assistant.replyToMessageId
      ? messages.find((item) => item.id === assistant.replyToMessageId && item.role === 'user')
      : [...messages].reverse().find((item) => item.role === 'user' && item.sequence < assistant.sequence);
    if (!user) return;
    setDraft(user.body);
    setAttachments(user.media.slice(0, 12));
    setBoundSelectionIds(user.selectedNodes.map((node) => node.nodeId).slice(0, 24));
    setBoundSelectionDetails(user.selectedNodes.map((node) => ({
      id: node.nodeId,
      type: node.type,
      label: node.label,
    })).slice(0, 24));
    setError('');
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [messages]);

  const failedTurnAlreadyRestored = useCallback((assistant: CreatorMessageV2) => {
    const user = assistant.replyToMessageId
      ? messages.find((item) => item.id === assistant.replyToMessageId && item.role === 'user')
      : [...messages].reverse().find((item) => item.role === 'user' && item.sequence < assistant.sequence);
    if (!user || user.body !== draft) return false;
    const mediaIds = user.media.slice(0, 12).map((item) => item.assetId);
    const selectedIds = user.selectedNodes.slice(0, 24).map((item) => item.nodeId);
    return mediaIds.length === attachments.length
      && mediaIds.every((id, index) => attachments[index]?.assetId === id)
      && selectedIds.length === boundSelectionIds.length
      && selectedIds.every((id, index) => boundSelectionIds[index] === id);
  }, [attachments, boundSelectionIds, draft, messages]);

  const revisePendingAction = useCallback(async () => {
    if (!conversation || !action || action.status !== 'pending' || isOperating) return;
    setOperation('action-revise');
    setError('');
    try {
      await cancelCreatorActionV2(conversation.id, action.id, props.projectId, props.canvasId);
      setAction(null);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (cancelError) {
      setError(errorText(cancelError, copy('没有取消成功', 'Could not revise this generation.')));
    } finally {
      finishOperation('action-revise');
    }
  }, [action, conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId]);

  const sendToCanvas = useCallback(async (asset: CreatorMediaRef, sourceActionId?: string | null) => {
    if (!conversation || !sourceActionId || isOperating) return;
    setOperation('canvas-send');
    setError('');
    try {
      const sent = await sendCreatorAssetToCanvasV2(conversation.id, sourceActionId, asset.assetId, props.projectId, props.canvasId);
      setSentNodes((current) => ({ ...current, [asset.assetId]: sent.nodeId }));
      props.onFocusNode(sent.nodeId);
    } catch (sendError) { setError(recoveryErrorText(sendError, copy('结果没有发送到画布，素材仍在对话中，请重试。', 'The result was not sent to the canvas. It is still in the conversation; try again.'), copy)); } finally { finishOperation('canvas-send'); }
  }, [conversation, copy, finishOperation, isOperating, props]);

  const markMediaVisible = useCallback((asset: CreatorMediaRef, sourceActionId?: string | null) => {
    settleMessageScroll();
    if (!conversation || !sourceActionId || !['image', 'video'].includes(asset.kind)
      || asset.reviewStatus === 'reviewed') return;
    const key = `${sourceActionId}:${asset.assetId}`;
    if (mediaReviewInFlightRef.current.has(key)) return;
    mediaReviewInFlightRef.current.add(key);
    void markCreatorAssetReviewedV2(
      conversation.id,
      sourceActionId,
      asset.assetId,
      asset.kind as 'image' | 'video',
      props.projectId,
      props.canvasId,
    ).then(({ action: reviewedAction }) => {
      setAction((current) => current?.id === reviewedAction.id ? reviewedAction : current);
      const byId = new Map(reviewedAction.resultAssets.map((item) => [item.assetId, item]));
      setMessages((current) => current.map((message) => message.actionId === reviewedAction.id
        ? { ...message, media: message.media.map((item) => byId.get(item.assetId) || item) }
        : message));
    }).catch(() => {
      // A loaded result remains visible. Adoption will surface a precise retry
      // message if this small evidence write did not reach the local backend.
    }).finally(() => mediaReviewInFlightRef.current.delete(key));
  }, [conversation, props.canvasId, props.projectId, settleMessageScroll]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length || isUploading) return;
    const accepted = files.slice(0, Math.max(0, 12 - attachments.length));
    const skipped = Math.max(0, files.length - accepted.length);
    if (!accepted.length) {
      setError(copy('最多可以引用 12 个附件。', 'You can attach up to 12 files.'));
      return;
    }
    setError('');
    setNotice('');
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let currentFileName = '';
    try {
      for (let index = 0; index < accepted.length; index += 1) {
        const file = accepted[index];
        currentFileName = file.name;
        setUploadStatus({ current: index + 1, total: accepted.length, name: file.name, percent: 0 });
        const result = await api.uploadResourceLocalFile(file, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          sourceNodeType: 'creator-agent-v2',
        }, {
          signal: controller.signal,
          onProgress: ({ percent }) => setUploadStatus((current) => (
            current && current.current === index + 1
              ? { ...current, percent }
              : current
          )),
        });
        if (!result.assetId) throw new Error(copy(`${file.name} 没有形成可引用素材`, `${file.name} could not be added as a reusable asset.`));
        const uploaded: CreatorMediaRef = {
          assetId: result.assetId,
          kind: attachmentKind(file, result.mime),
          previewUrl: result.url,
          title: file.name,
        };
        // Commit each successful upload immediately. If a later file fails,
        // the user must not lose access to assets that already finished.
        setAttachments((current) => [
          ...current.filter((item) => item.assetId !== uploaded.assetId),
          uploaded,
        ].slice(0, 12));
      }
      if (skipped > 0) {
        setNotice(copy(
          `已添加 ${accepted.length} 个附件，另外 ${skipped} 个未添加（单次最多保留 12 个）。`,
          `Added ${accepted.length} file${accepted.length === 1 ? '' : 's'}; ${skipped} more ${skipped === 1 ? 'was' : 'were'} not added because the limit is 12.`,
        ));
      }
    } catch (uploadError) {
      if (controller.signal.aborted || (uploadError instanceof DOMException && uploadError.name === 'AbortError')) {
        setNotice(copy('上传已取消，已经完成的附件仍然保留。', 'Upload cancelled. Completed attachments are still available.'));
      } else {
        setError(recoveryErrorText(uploadError, currentFileName
          ? copy(`${currentFileName} 没有上传，已完成的附件仍然保留。`, `${currentFileName} was not uploaded. Completed attachments are still available.`)
          : copy('附件没有上传，原文件未受影响，请检查网络后重试。', 'The attachment was not uploaded. The original file is unchanged; check the connection and try again.'), copy));
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      setUploadStatus(null);
    }
  }, [attachments.length, copy, isUploading, props.canvasId, props.projectId]);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    void uploadFiles(files);
  };

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const nativeEvent = event.nativeEvent;
    if (
      composerComposingRef.current
      || nativeEvent.isComposing
      || nativeEvent.keyCode === 229
    ) return;
    if (Date.now() - compositionEndedAtRef.current < CREATOR_IME_COMMIT_GUARD_MS) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void submit();
  };

  const pinSelection = () => {
    if (boundSelectionIds.length) {
      clearBoundSelection();
      return;
    }
    if (!props.selectedNodeIds.length) {
      setError(copy('请先在画布上选中图片、视频或文字。', 'Select an image, video, or text item on the canvas first.'));
      return;
    }
    const selectedIds = props.selectedNodeIds.slice(0, 24);
    setError(props.selectedNodeIds.length > selectedIds.length
      ? copy('一次最多引用 24 个节点，已引用当前选区中的前 24 个。', 'Up to 24 nodes can be linked at once. The first 24 selected nodes are linked.')
      : '');
    setBoundSelectionIds(selectedIds);
    setBoundSelectionDetails(selectedNodeDetails.slice(0, 24));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const setModel = (kind: 'llm' | 'image' | 'video', value: string) => {
    const choice = value ? JSON.parse(value) as [string, string] : null;
    setSettingsDraft((current) => ({
      ...current,
      [kind]: choice ? { providerId: choice[0], modelId: choice[1] } : null,
    }));
  };

  const modelOptions = (kind: 'llm' | 'image' | 'video') => (catalog?.[kind] || [])
    .filter((item) => settingsDraft.providerId === 'auto' || item.providerId === settingsDraft.providerId);

  const modelGroups = (kind: 'llm' | 'image' | 'video') => {
    const selected = settingsDraft[kind];
    const visible = modelOptions(kind).filter((item) => showAllModels
      || item.recommended
      || (selected?.providerId === item.providerId && selected.modelId === item.modelId));
    const groups = new Map<string, typeof visible>();
    for (const item of visible) groups.set(item.family, [...(groups.get(item.family) || []), item]);
    return [...groups.entries()];
  };

  const settingsMissingKinds = catalog ? (['llm', 'image', 'video'] as const)
    .filter((kind) => !modelOptions(kind).some((item) => item.configured)) : [];
  const settingsHasNoConfiguredModels = Boolean(catalog && settingsMissingKinds.length === 3);
  const settingsReadinessMessage = settingsMissingKinds.length
    ? copy(
      `当前服务还没有可用的${settingsMissingKinds.map((kind) => ({ llm: '对话', image: '图像', video: '视频' })[kind]).join('、')}模型。`,
      `The current service has no ready ${settingsMissingKinds.map((kind) => ({ llm: 'chat', image: 'image', video: 'video' })[kind]).join(', ')} model${settingsMissingKinds.length === 1 ? '' : 's'}.`,
    )
    : '';

  const customized = preferences.providerId !== 'auto' || preferences.llm || preferences.image || preferences.video;
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    if (!query) return history;
    return history.filter((item) => conversationTitle(item.title, isChinese).toLocaleLowerCase().includes(query));
  }, [history, historyQuery, isChinese]);
  const currentPhaseIndex = Math.max(0, PHASES.findIndex(([phase]) => phase === (conversation?.phase || 'idea')));
  const currentPhase = PHASES[currentPhaseIndex];
  const currentSceneIndex = sceneNavigation
    ? sceneNavigation.scenes.findIndex((scene) => scene.sceneId === sceneNavigation.currentSceneId)
    : -1;
  const visibleSceneChoices = useMemo(() => {
    if (!sceneNavigation) return [];
    const query = sceneQuery.trim().toLocaleLowerCase();
    if (!query) {
      const start = Math.max(0, currentSceneIndex - 2);
      return sceneNavigation.scenes.slice(start, Math.min(sceneNavigation.total, start + 5));
    }
    return sceneNavigation.scenes.filter((scene) => {
      const label = `${scene.number} ${scene.title}`.toLocaleLowerCase();
      return label.includes(query);
    }).slice(0, 12);
  }, [currentSceneIndex, sceneNavigation, sceneQuery]);
  const visibleSuggestions = creatorLlmConfigured === true
    && latestAssistant
    && latestAssistant.status === 'completed'
    && !action
    && latestAssistant.suggestions.length === 3
    ? latestAssistant.suggestions
    : [];
  const hasTurnInput = Boolean(draft.trim() || attachments.length || boundSelectionIds.length);
  const compactFirstScreen = messages.length === 0 && !action && !historyOpen && !settingsOpen;
  const requiresVisionInput = attachments.some((item) => item.kind === 'image' || item.kind === 'video')
    || boundSelectionDetails.some((item) => ['image', 'video', 'upload'].includes(String(item.type || '').toLowerCase()));
  const automaticModelHint = (kind: 'llm' | 'image' | 'video') => {
    if (settingsDraft[kind]) return '';
    const eligible = modelOptions(kind).filter((item) => item.configured
      && (kind !== 'llm' || !requiresVisionInput || item.visionCapable));
    const selected = eligible.find((item) => item.recommended) || eligible[0];
    if (!selected) return '';
    const providerLabel = formatCreatorProviderLabel(selected.providerId, selected.providerLabel, isChinese);
    const modelLabel = formatCreatorModelLabel(selected, isChinese);
    const resolvedLabel = modelLabel.toLocaleLowerCase().startsWith(providerLabel.toLocaleLowerCase())
      ? modelLabel
      : `${providerLabel} · ${modelLabel}`;
    return copy(`将使用：${resolvedLabel}`, `Will use: ${resolvedLabel}`);
  };
  const actionPromptExpanded = Boolean(action && expandedActionPromptId === action.id);
  const actionPromptIsLong = Boolean(action && (clippedActionPromptId === action.id || actionPromptExpanded));
  const submissionStatusUnknown = action?.status === 'ambiguous'
    && action.errorCode === 'CREATOR_SUBMISSION_STATUS_UNKNOWN';
  const staleSceneAction = action?.status === 'failed'
    && action.errorCode === 'CREATOR_ACTION_SCENE_STALE';
  const launcherStatus = error || submissionStatusUnknown ? 'warning' : isOperating || isUploading || action?.status === 'running' || action?.status === 'ambiguous' ? 'running' : action?.status === 'pending' ? 'approval' : action?.status === 'completed' ? 'completed' : 'idle';
  const operationAnnouncement = isUploading
    ? copy('正在添加附件，可以继续整理下一条想法', 'Adding attachments. You can keep preparing your next message')
    : loading
      ? copy('正在打开创作', 'Opening your workspace')
      : operation === 'reply'
        ? replyWaitStage >= 2
          ? copy('仍在整理完整回复，可以随时停止', 'Still preparing the complete reply; you can stop at any time')
          : replyWaitStage >= 1
            ? copy('正在整理可直接使用的方案', 'Shaping this into a usable direction')
            : copy('正在推敲最合适的创作方向', 'Working out the strongest direction')
        : operation === 'action-confirm'
          ? copy('正在生成', 'Generating')
          : operation === 'scene-switch'
            ? copy('正在打开场次', 'Opening scene')
          : operation === 'scene-confirm'
            ? copy('正在保存这一场', 'Saving scene')
          : operation === 'canvas-send'
            ? copy('正在发送到画布', 'Sending to canvas')
            : isOperating
              ? copy('正在处理', 'Working')
              : '';
  const launcher = (
    <button
      ref={launcherRef}
      type="button"
      className={`t8-creator-agent-launcher nodrag nopan${open ? ' is-open' : ''}`}
      data-canvas-floating-ui="creator-agent-launcher"
      data-theme-visual={props.visualStyle}
      data-theme-mode={props.themeMode}
      data-status={launcherStatus}
      data-motion-active="false"
      data-effects-enabled="false"
      style={style}
      title={open ? copy('关闭创作助手', 'Close Creator Agent') : copy('打开创作助手', 'Open Creator Agent')}
      aria-label={open ? copy('关闭创作助手', 'Close Creator Agent') : copy('打开创作助手', 'Open Creator Agent')}
      aria-controls={panelId}
      aria-expanded={open}
      onClick={() => {
        if (open) {
          setHistoryOpen(false);
          dismissSettings();
        } else {
          launcherOpenedAtRef.current = performance.now();
          setMinimized(false);
        }
        setPanelOpen(!open);
      }}
    >
      <span className="t8-creator-agent-launcher__label" aria-hidden="true">{copy('助手', 'Agent')}</span>
      <span className="t8-creator-agent-launcher__glyph" aria-hidden="true">{open ? <X size={17} /> : <Sparkles size={17} />}</span>
      <span className="t8-creator-agent-launcher__status" aria-hidden="true" />
    </button>
  );

  return (
    <LocalizedVisibleTree area="creatorAgent" catalog={CREATOR_AGENT_VISIBLE_CATALOG}>
      <>
        {launcherHost ? createPortal(launcher, launcherHost) : launcher}
        {open && createPortal(
          <aside
            ref={panelShellRef}
            id={panelId}
            className={`t8-creator-v2-panel nodrag nopan nowheel${minimized ? ' is-minimized' : ''}${compactFirstScreen ? ' is-first-screen' : ''}`}
            data-canvas-floating-ui="creator-agent-panel"
            data-theme-mode={props.themeMode}
            data-theme-visual={props.visualStyle}
            style={style}
            role="dialog"
            aria-modal="false"
            aria-labelledby={panelTitleId}
          >
            <header className="t8-creator-v2-header">
              <div><Sparkles size={17} aria-hidden="true" /><strong id={panelTitleId}>{copy('创作助手', 'Creator Agent')}</strong></div>
              <nav aria-label={copy('创作助手操作', 'Creator Agent actions')}>
                <button ref={historyButtonRef} type="button" className="has-touch-label" title={copy('历史', 'History')} aria-label={copy('历史', 'History')} aria-controls={historyPopoverId} aria-expanded={historyOpen} disabled={isHistoryBusy && !historyOpen} onClick={() => void openHistory()}><History size={16} /><span className="t8-creator-v2-button-label">{copy('历史', 'History')}</span></button>
                <button type="button" className="has-touch-label" title={copy('新对话', 'New conversation')} aria-label={copy('新对话', 'New conversation')} disabled={isOperating || loading} onClick={newConversation}><Plus size={16} /><span className="t8-creator-v2-button-label">{copy('新对话', 'New')}</span></button>
                <button ref={settingsButtonRef} type="button" className={`has-touch-label${customized ? ' is-customized' : ''}`} title={copy('生成设置', 'Generation settings')} aria-label={copy('生成设置', 'Generation settings')} aria-controls={settingsPopoverId} aria-expanded={settingsOpen} disabled={isSettingsBusy && !settingsOpen} onClick={() => void openSettings()}><Settings size={16} /><span className="t8-creator-v2-button-label">{copy('设置', 'Settings')}</span></button>
                <button type="button" className="t8-creator-v2-minimize" title={minimized ? copy('展开创作助手', 'Restore Creator Agent') : copy('收起创作助手，继续查看画布', 'Minimize Creator Agent and keep viewing the canvas')} aria-label={minimized ? copy('展开创作助手', 'Restore Creator Agent') : copy('收起创作助手，继续查看画布', 'Minimize Creator Agent and keep viewing the canvas')} aria-pressed={minimized} onClick={() => { setHistoryOpen(false); dismissSettings(); setMinimized((current) => !current); }}>{minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</button>
                <button type="button" className="t8-creator-v2-close" title={copy('关闭', 'Close')} aria-label={copy('关闭', 'Close')} onClick={() => { setHistoryOpen(false); setHistoryQuery(''); dismissSettings(); setPanelOpen(false); requestAnimationFrame(() => launcherRef.current?.focus()); }}><X size={17} /></button>
              </nav>
            </header>

            <div className="t8-creator-v2-progress">
              <ol className="t8-creator-v2-phases" aria-label={copy('创作进度', 'Creation progress')}>
                {PHASES.map(([id, zhLabel, enLabel], index) => {
                  return <li key={id} aria-current={index === currentPhaseIndex ? 'step' : undefined} aria-label={`${copy(zhLabel, enLabel)}${index === currentPhaseIndex ? copy('，当前步骤', ', current step') : index < currentPhaseIndex ? copy('，已完成', ', complete') : ''}`} className={index < currentPhaseIndex ? 'is-done' : index === currentPhaseIndex ? 'is-current' : ''}><i aria-hidden="true">{index < currentPhaseIndex ? <Check size={10} /> : index + 1}</i><span aria-hidden="true">{copy(zhLabel, enLabel)}</span></li>;
                })}
              </ol>
              <p className="t8-creator-v2-phase-summary" aria-hidden="true">{copy(`第 ${currentPhaseIndex + 1}/6 步 · ${currentPhase[1]}`, `Step ${currentPhaseIndex + 1} of 6 · ${currentPhase[2]}`)}</p>
            </div>

            {sceneNavigation && sceneNavigation.total > 0 && (
              <section className="t8-creator-v2-scene-nav" aria-label={copy('当前剧本场次', 'Current script scene')}>
                <div className="t8-creator-v2-scene-current">
                  <strong data-i18n-skip="true">{sceneNavigation.scenes[currentSceneIndex]
                    ? `${copy(
                        `第 ${sceneNavigation.scenes[currentSceneIndex].number} / ${sceneNavigation.total} 场 · ${sceneNavigation.scenes[currentSceneIndex].title}`,
                        `Scene ${sceneNavigation.scenes[currentSceneIndex].number} of ${sceneNavigation.total} · ${sceneNavigation.scenes[currentSceneIndex].title}`,
                      )}${(sceneNavigation.currentScene?.sourcePartCount || 1) > 1
                        ? copy(
                            ` · 本场 ${sceneNavigation.currentScene!.sourcePartIndex + 1}/${sceneNavigation.currentScene!.sourcePartCount} 段`,
                            ` · Part ${sceneNavigation.currentScene!.sourcePartIndex + 1} of ${sceneNavigation.currentScene!.sourcePartCount}`,
                          ) : ''}`
                    : copy('当前场', 'Current scene')}</strong>
                  <details ref={sceneSwitcherRef} className="t8-creator-v2-scene-switcher">
                    <summary title={copy('切换或搜索场次', 'Switch or search scenes')}>
                      <Search size={14} aria-hidden="true" />
                      <span>{copy('切换', 'Switch')}</span>
                    </summary>
                    <div className="t8-creator-v2-scene-menu">
                      <label className="t8-creator-v2-scene-search">
                        <Search size={14} aria-hidden="true" />
                        <input
                          type="search"
                          value={sceneQuery}
                          aria-label={copy('按场次编号或名称搜索', 'Search by scene number or title')}
                          placeholder={copy('搜场次编号或名称', 'Search scenes')}
                          onChange={(event) => setSceneQuery(event.currentTarget.value)}
                        />
                      </label>
                      <div className="t8-creator-v2-scene-step">
                        <button
                          type="button"
                          disabled={isOperating || currentSceneIndex <= 0}
                          onClick={() => void switchScene(sceneNavigation.scenes[currentSceneIndex - 1]?.sceneId)}
                        ><ChevronLeft size={14} />{copy('上一场', 'Previous scene')}</button>
                        <button
                          type="button"
                          disabled={isOperating || currentSceneIndex < 0 || currentSceneIndex >= sceneNavigation.total - 1}
                          onClick={() => void switchScene(sceneNavigation.scenes[currentSceneIndex + 1]?.sceneId)}
                        >{copy('下一场', 'Next scene')}<ChevronRight size={14} /></button>
                      </div>
                      <div className="t8-creator-v2-scene-results" role="listbox" aria-label={copy('场次结果', 'Scene results')}>
                        {visibleSceneChoices.length ? visibleSceneChoices.map((scene) => (
                          <button
                            key={scene.sceneId}
                            type="button"
                            role="option"
                            aria-selected={scene.sceneId === sceneNavigation.currentSceneId}
                            disabled={isOperating || scene.sceneId === sceneNavigation.currentSceneId}
                            onClick={() => void switchScene(scene.sceneId)}
                          >{copy(`第 ${scene.number} 场 · ${scene.title}`, `Scene ${scene.number} · ${scene.title}`)}</button>
                        )) : <p>{copy('没有找到这个场次', 'No matching scene')}</p>}
                      </div>
                      {sceneNavigation.currentScene?.sourceText && (
                        <details className="t8-creator-v2-scene-source">
                          <summary>{(sceneNavigation.currentScene?.sourcePartCount || 1) > 1
                            ? copy('查看本段原文', 'View this part')
                            : copy('查看本场原文', 'View scene text')}</summary>
                          <p data-i18n-skip="true">{sceneNavigation.currentScene.sourceText}</p>
                        </details>
                      )}
                    </div>
                  </details>
                </div>
                <button
                  type="button"
                  className="is-primary t8-creator-v2-scene-confirm"
                  disabled={isOperating || (sceneNavigation.currentScene?.status === 'confirmed'
                    && currentSceneIndex >= sceneNavigation.total - 1)
                    || sceneNavigation.currentScene?.sourceIntegrity === false}
                  onClick={() => void confirmCurrentScene()}
                >{sceneNavigation.currentScene?.status === 'confirmed'
                    ? copy('下一场', 'Next scene')
                    : (sceneNavigation.currentScene?.sourcePartCount || 1) > 1
                      && sceneNavigation.currentScene!.sourcePartIndex < sceneNavigation.currentScene!.sourcePartCount - 1
                      ? sceneNavigation.currentScene?.sourcePartHasDraft
                        ? copy('定这段，继续本场', 'Confirm part and continue')
                        : copy('采用原文，继续本场', 'Use source and continue')
                    : currentSceneIndex >= sceneNavigation.total - 1
                      ? sceneNavigation.currentScene?.sourcePartHasDraft
                        ? copy('定这场', 'Confirm scene')
                        : copy('采用原文', 'Use source')
                      : sceneNavigation.currentScene?.sourcePartHasDraft
                        ? copy('定这场，下一场', 'Confirm and continue')
                        : copy('采用原文，下一场', 'Use source and continue')}</button>
              </section>
            )}

            {historyOpen && (
              <section ref={historyPopoverRef} id={historyPopoverId} className="t8-creator-v2-popover is-history" role="region" tabIndex={-1} aria-label={copy('历史对话', 'Conversation history')} aria-busy={isHistoryBusy}>
                {history.length >= HISTORY_SEARCH_MIN_ITEMS && <label className="t8-creator-v2-history-search"><Search size={14} aria-hidden="true" /><input ref={historySearchInputRef} type="search" value={historyQuery} aria-label={copy('搜索历史对话', 'Search conversations')} placeholder={copy('搜索对话', 'Search conversations')} onChange={(event) => setHistoryQuery(event.currentTarget.value)} /></label>}
                {filteredHistory.length ? filteredHistory.map((item, index) => (
                  <button ref={index === 0 ? historyFirstItemRef : undefined} key={item.id} type="button" className={item.id === conversation?.id ? 'is-current' : ''} aria-current={item.id === conversation?.id ? 'true' : undefined} disabled={isOperating || isHistoryBusy} onClick={() => void selectHistoryConversation(item.id)}>
                    <strong title={conversationTitle(item.title, isChinese)}>{conversationTitle(item.title, isChinese)}</strong><small>{`${copy(PHASES.find(([phase]) => phase === item.phase)?.[1] || '想法', PHASES.find(([phase]) => phase === item.phase)?.[2] || 'Idea')} · ${new Date(item.updatedAt).toLocaleString(isChinese ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}</small>
                  </button>
                )) : <p>{history.length ? copy('没有匹配的对话', 'No matching conversations') : copy('还没有历史对话', 'No earlier conversations')}</p>}
                {historyBefore && <button type="button" disabled={isHistoryBusy} onClick={() => void loadMoreHistory()}>{isHistoryBusy ? copy('正在加载…', 'Loading…') : copy('更早的对话', 'Earlier conversations')}</button>}
              </section>
            )}

            {settingsOpen && (
              <section ref={settingsPopoverRef} id={settingsPopoverId} className="t8-creator-v2-popover is-settings" role="region" tabIndex={-1} aria-label={copy('生成设置', 'Generation settings')} aria-busy={isSettingsBusy}>
                {isSettingsBusy && !catalog ? <p><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{copy('正在读取设置…', 'Loading settings…')}</p> : settingsReadError && !catalog ? (
                  <div className="t8-creator-v2-settings-readiness is-empty" role="alert"><span>{settingsReadError}</span><button type="button" className="is-primary" disabled={isSettingsBusy} onClick={() => void refreshCreatorSettings(true)}>{copy('重新读取', 'Try again')}</button></div>
                ) : (
                  settingsHasNoConfiguredModels ? (
                    <div className="t8-creator-v2-settings-readiness is-empty" role="note"><span>{settingsReadinessMessage}</span><button type="button" className="is-primary" onClick={openApiSettings}>{copy('配置 API', 'Set up API')}</button></div>
                  ) : <>
                    {settingsReadinessMessage && <div className="t8-creator-v2-settings-readiness" role="note"><span>{settingsReadinessMessage}</span><button type="button" onClick={openApiSettings}>{copy('配置 API', 'Set up API')}</button></div>}
                    <label><span>{copy('服务渠道', 'Service provider')}</span><select ref={settingsFirstSelectRef} value={settingsDraft.providerId} disabled={isSettingsBusy} onChange={(event) => setSettingsDraft((current) => ({ ...current, providerId: event.currentTarget.value, llm: null, image: null, video: null }))}>
                      <option value="auto">{copy('智能选择（推荐）', 'Automatic (recommended)')}</option>
                      {catalog?.providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.configured}>{formatCreatorProviderLabel(provider.id, provider.label, isChinese)}{provider.configured ? '' : copy('（未配置）', ' (not configured)')}</option>)}
                    </select></label>
                    {(['llm', 'image', 'video'] as const).map((kind) => (
                      <label key={kind}>
                        <span>{isChinese ? { llm: '对话模型', image: '图像模型', video: '视频模型' }[kind] : { llm: 'Chat model', image: 'Image model', video: 'Video model' }[kind]}</span>
                        <select value={settingsDraft[kind] ? JSON.stringify([settingsDraft[kind]?.providerId, settingsDraft[kind]?.modelId]) : ''} disabled={isSettingsBusy} onChange={(event) => setModel(kind, event.currentTarget.value)}>
                          <option value="">{copy('智能选择（推荐）', 'Automatic (recommended)')}</option>
                          {modelGroups(kind).map(([family, items]) => <optgroup key={family} label={formatCreatorModelFamily(family, isChinese)}>{items.map((item) => {
                            const visionBlocked = kind === 'llm' && requiresVisionInput && item.visionCapable === false;
                            return <option key={`${item.providerId}:${item.modelId}`} value={JSON.stringify([item.providerId, item.modelId])} disabled={!item.configured || visionBlocked}>{formatCreatorModelLabel(item, isChinese)}{item.recommended ? copy('（推荐）', ' (recommended)') : ''}{visionBlocked ? copy('（仅文本）', ' (text only)') : ''}</option>;
                          })}</optgroup>)}
                        </select>
                        {!settingsDraft[kind] && automaticModelHint(kind) && <small className="t8-creator-v2-auto-model" data-i18n-skip="true">{automaticModelHint(kind)}</small>}
                      </label>
                    ))}
                    <button type="button" className="t8-creator-v2-model-toggle" aria-expanded={showAllModels} disabled={isSettingsBusy} onClick={() => setShowAllModels((current) => !current)}>{showAllModels ? copy('收起模型列表', 'Show fewer models') : copy('显示全部模型', 'Show all models')}{showAllModels ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}</button>
                    <footer><button type="button" disabled={isSettingsBusy} onClick={() => setSettingsDraft({ ...DEFAULT_PREFERENCES, catalogDigest: catalog?.catalogDigest || null })}>{copy('恢复智能选择', 'Use automatic settings')}</button><button type="button" className="is-primary" disabled={isSettingsBusy} onClick={() => void saveSettings()}>{copy('保存', 'Save')}</button></footer>
                  </>
                )}
              </section>
            )}

            <div className="t8-creator-v2-transcript">
              <div
                ref={messagesRef}
                className="t8-creator-v2-messages"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={loading || operation === 'reply' || operation === 'action-confirm'}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
                  stickToBottomRef.current = atBottom;
                  if (atBottom) setNewReplyBelow(false);
                }}
              >
              {loading && <p className="t8-creator-v2-state"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{copy('正在打开创作…', 'Opening your workspace…')}</p>}
              {!loading && nextBeforeSequence && <button type="button" className="t8-creator-v2-load-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? copy('正在加载…', 'Loading…') : copy('查看更早消息', 'Earlier messages')}</button>}
              {!loading && messages.length === 0 && <div className="t8-creator-v2-empty"><strong>{copy('告诉我你想做什么，我会帮你一步步推进；也可以上传素材，或先在画布上选中内容。', 'Tell me what you want to make and I’ll help move it forward step by step. You can also attach media or select something on the canvas first.')}</strong></div>}
              {messages.filter((message) => !retryResolution.hiddenUserIds.has(message.id)).map((message) => {
                const resolvedRetry = retryResolution.resolvedAssistantIds.has(message.id);
                const recoveryKind = message.status === 'failed' ? failedMessageRecoveryKind(message.errorCode) : null;
                const restoredInComposer = message.status === 'failed' && failedTurnAlreadyRestored(message);
                return (
                <article key={message.id} className={`t8-creator-v2-message is-${message.role}${resolvedRetry ? ' is-resolved-retry' : ''}`} data-status={resolvedRetry ? 'resolved' : message.status} data-creator-message-id={message.id}>
                  {message.id === latestAssistant?.id && !resolvedRetry && (
                    <small className="t8-creator-v2-latest-turn">
                      {message.status === 'failed' ? copy('需要处理', 'Needs attention') : copy('最新回复', 'Latest reply')}
                    </small>
                  )}
                  <div data-i18n-skip="true">{resolvedRetry
                    ? copy('较早一次尝试已恢复并完成。', 'An earlier attempt was restored and completed.')
                    : visibleMessageBody(message)}</div>
                  {message.media.length > 0 && (
                    <div className="t8-creator-v2-message-media">
                      {message.media.map((asset) => {
                        const currentAsset = knownMedia.get(asset.assetId) || asset;
                        const isReviewed = currentAsset.reviewStatus === 'reviewed';
                        const sentNodeId = currentAsset.canvasNodeId || sentNodes[asset.assetId];
                        return (
                          <section key={asset.assetId} className="t8-creator-v2-result" aria-label={asset.title || copy('生成结果', 'Generated result')}>
                            {asset.kind === 'image' && asset.previewUrl && <img src={asset.previewUrl} alt={asset.title || copy('生成图片', 'Generated image')} loading="lazy" onLoad={() => markMediaVisible(currentAsset, message.actionId)} />}
                            {asset.kind === 'video' && asset.previewUrl && <video src={asset.previewUrl} aria-label={asset.title || copy('生成视频', 'Generated video')} controls preload="metadata" onLoadedData={() => markMediaVisible(currentAsset, message.actionId)} />}
                            {message.role === 'assistant' && message.actionId && <footer><button type="button" disabled={isOperating} onClick={() => { setAttachments([currentAsset]); requestAnimationFrame(() => composerRef.current?.focus()); }}>{copy('继续调整', 'Adjust')}</button><button type="button" className="is-primary" disabled={isOperating || (!sentNodeId && !isReviewed)} onClick={() => sentNodeId ? props.onFocusNode(sentNodeId) : void sendToCanvas(currentAsset, message.actionId)}>{sentNodeId ? copy('已发送 · 查看', 'Sent · View') : isReviewed ? copy('采用并发送', 'Use and send') : copy('正在准备…', 'Preparing…')}</button></footer>}
                          </section>
                        );
                      })}
                    </div>
                  )}
                  {message.actionId === action?.id && action?.status === 'pending' && (
                    <section className="t8-creator-v2-decision">
                      <p ref={actionPromptRef} className={`t8-creator-v2-decision__prompt${actionPromptExpanded ? ' is-expanded' : ''}`} data-i18n-skip="true" title={action.prompt}>{action.prompt}</p>
                      {actionPromptIsLong && <button type="button" className="t8-creator-v2-prompt-toggle" aria-expanded={actionPromptExpanded} onClick={() => setExpandedActionPromptId(actionPromptExpanded ? '' : action.id)}>{actionPromptExpanded ? copy('收起提示词', 'Collapse prompt') : copy('查看完整提示词', 'View full prompt')}</button>}
                      <small>{action.type === 'image'
                        ? copy(`生成 ${action.parameters.count || 1} 张 ${action.parameters.ratio || ''} 图片`, `Generate ${action.parameters.count || 1} ${action.parameters.ratio || ''} image${Number(action.parameters.count || 1) === 1 ? '' : 's'}`)
                        : copy(`生成 ${action.parameters.duration || 6} 秒 ${action.parameters.ratio || ''} 视频`, `Generate a ${action.parameters.duration || 6}s ${action.parameters.ratio || ''} video`)}</small>
                      <footer><button type="button" disabled={isOperating} onClick={() => void revisePendingAction()}>{copy('再改改', 'Revise')}</button><button type="button" className="is-primary" disabled={isOperating} onClick={() => void confirmAction()}>{copy('开始生成', 'Generate')}</button></footer>
                    </section>
                  )}
                  {message.actionId === action?.id && submissionStatusUnknown && <section className="t8-creator-v2-decision is-error" role="alert"><p>{copy('远端可能已经收到这次生成，但本地没有拿到任务号。为避免重复生成，已停止自动重试；请先到渠道后台确认。', 'The provider may have received this generation, but the task ID was not saved locally. Automatic retry has stopped to prevent duplicate generation; please check the provider dashboard first.')}</p></section>}
                  {message.actionId === action?.id && !submissionStatusUnknown && (action?.status === 'running' || action?.status === 'ambiguous') && <p className="t8-creator-v2-state"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{action.status === 'ambiguous' ? copy('仍在生成，已接管原任务…', 'Still generating. Reconnecting to the original task…') : copy('正在生成…', 'Generating…')}</p>}
                  {message.actionId === action?.id && action?.status === 'failed' && <section className="t8-creator-v2-decision is-error"><p>{staleSceneAction ? copy('这条生成对应的场次已经变化，旧提示词不会继续使用。', 'This scene changed after the generation was prepared, so the old prompt will not be used.') : recoveryErrorText(action.errorMessage ? new Error(action.errorMessage) : null, copy('这一条没有生成出来，其他已完成结果都已保留。', 'This item did not finish. Other completed results are preserved.'), copy)}</p><button type="button" disabled={isOperating} onClick={() => staleSceneAction ? void submit(copy('请根据当前场的最新内容重新生成。', 'Regenerate using the latest version of this scene.'), { attachments: [], selectedNodeIds: [], preserveComposer: true }) : void redoAction()}><RefreshCw size={13} />{staleSceneAction ? copy('按当前场重新生成', 'Regenerate current scene') : action.shots.filter((shot) => shot.status === 'failed').length > 0 ? copy(`只重试失败的 ${action.shots.filter((shot) => shot.status === 'failed').length} 镜`, `Retry ${action.shots.filter((shot) => shot.status === 'failed').length} failed shot${action.shots.filter((shot) => shot.status === 'failed').length === 1 ? '' : 's'}`) : copy('只重试这一条', 'Retry this item')}</button></section>}
                  {!resolvedRetry && message.status === 'failed' && recoveryKind === 'api-settings' && <button type="button" className="is-primary" disabled={isOperating} onClick={openApiSettings}>{copy('打开 API 设置', 'Open API settings')}</button>}
                  {!resolvedRetry && message.status === 'failed' && recoveryKind === 'generation-settings' && <button type="button" className="is-primary" disabled={isOperating} onClick={() => void openSettings(true)}>{copy('检查生成设置', 'Check generation settings')}</button>}
                  {!resolvedRetry && message.status === 'failed' && recoveryKind === 'edit' && <button type="button" className="t8-creator-v2-recovery-action" disabled={isOperating || (restoredInComposer && !hasTurnInput)} onClick={() => restoredInComposer ? void submit() : restoreFailedTurn(message)}>{restoredInComposer ? copy('直接重试', 'Retry now') : copy('修改后重试', 'Edit and retry')}</button>}
                </article>
                );
              })}
              {operationAnnouncement && !loading && !isUploading && <p className="t8-creator-v2-operation-status" role="status" aria-live="polite" aria-atomic="true"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /><span>{operationAnnouncement}</span></p>}
              </div>
              {newReplyBelow && <button type="button" className="t8-creator-v2-new-reply" onClick={scrollToLatestReply}>{copy('查看新回复', 'View new reply')}<ChevronDown size={14} aria-hidden="true" /></button>}
            </div>

            {visibleSuggestions.length === 3 && (
              <section className="t8-creator-v2-suggestions" aria-label={copy('三个下一步建议', 'Three next-step suggestions')}>
                <p className="t8-creator-v2-suggestions__heading"><strong>{copy('下一步只需选一个', 'Choose one next step')}</strong><small>{copy('也可以直接输入你的想法', 'Or type your own direction')}</small></p>
                {visibleSuggestions.map((suggestion) => {
                  const hasDistinctDetail = suggestion.sendText.trim() !== suggestion.label.trim();
                  return <button key={suggestion.intentKind} type="button" data-role={suggestion.role} data-i18n-skip="true" aria-label={hasDistinctDetail ? `${suggestion.label}: ${suggestion.sendText}` : suggestion.label} disabled={isOperating} onClick={() => void submit(suggestion.sendText, { attachments: suggestion.inputAssetIds.length ? suggestion.inputAssetIds.map((assetId) => knownMedia.get(assetId)).filter((asset): asset is CreatorMediaRef => Boolean(asset)) : [], selectedNodeIds: [], preserveComposer: true })}><strong>{suggestion.label}</strong>{hasDistinctDetail && <small>{suggestion.sendText}</small>}</button>;
                })}
              </section>
            )}

            {notice && <div className="t8-creator-v2-notice" role="status"><span>{notice}</span><button type="button" aria-label={copy('关闭提示', 'Dismiss message')} onClick={() => setNotice('')}><X size={13} /></button></div>}
            {startupError && <div className="t8-creator-v2-error" role="alert"><span>{startupError}</span><div><button type="button" title={copy('重试', 'Retry')} aria-label={copy('重新连接创作助手', 'Reconnect Creator Agent')} disabled={loading} onClick={() => { setStartupLoadRevision((current) => current + 1); void refreshCreatorSettings(false); }}>{loading ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} />}</button><button type="button" aria-label={copy('关闭提示', 'Dismiss message')} onClick={() => setStartupError('')}><X size={13} /></button></div></div>}
            {error && <div className="t8-creator-v2-error" role="alert"><span>{error}</span><button type="button" aria-label={copy('关闭提示', 'Dismiss message')} onClick={() => setError('')}><X size={13} /></button></div>}
            {settingsReadError && !settingsOpen && <div className="t8-creator-v2-readiness" role="alert"><span><strong>{copy('创作模型暂时没有连上', 'Could not reach the creative model')}</strong><small>{copy('画布、输入和素材都已保留，连接恢复后重新读取即可。', 'Your canvas, text, and media are saved. Try the check again when the connection is ready.')}</small></span><button type="button" className="is-primary" disabled={isSettingsBusy} onClick={() => void refreshCreatorSettings(false)}>{isSettingsBusy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{copy('重新读取', 'Try again')}</button></div>}
            {creatorLlmConfigured === false && !settingsOpen && <div className="t8-creator-v2-readiness" role="alert"><span><strong>{copy('先设置创作模型', 'Set up a creative model first')}</strong><small>{copy('只需保存一次，首次发送时会验证 API Key；当前输入和素材会保留。', 'Save it once. The API key is verified on first send, and your current text and media will stay here.')}</small></span><button type="button" className="is-primary" onClick={openApiSettings}><Settings size={14} aria-hidden="true" />{copy('配置 API', 'Set up API')}</button></div>}
            {isUploading && uploadStatus && (
              <div className="t8-creator-v2-upload-status" role="status" aria-live="polite">
                <div><span>{copy(
                    `正在上传 ${uploadStatus.current}/${uploadStatus.total}：${uploadStatus.name}`,
                    `Uploading ${uploadStatus.current}/${uploadStatus.total}: ${uploadStatus.name}`,
                  )}</span><button type="button" onClick={cancelUpload}>{copy('取消', 'Cancel')}</button></div>
                <progress value={uploadStatus.percent ?? undefined} max={100} aria-label={copy('附件上传进度', 'Attachment upload progress')} />
              </div>
            )}
            {(attachments.length > 0 || boundSelectionIds.length > 0) && <div className="t8-creator-v2-attachments">{boundSelectionIds.length > 0 && <span title={linkedSelectionTitle}><span className="t8-creator-v2-attachment-label">{linkedSelectionText}</span><button type="button" aria-label={copy('取消引用选区', 'Unlink selection')} onClick={clearBoundSelection}><X size={14} /></button></span>}{attachments.map((item) => <span key={item.assetId} title={item.title || item.kind}><span className="t8-creator-v2-attachment-label">{item.title || item.kind}</span><button type="button" aria-label={copy('移除附件', 'Remove attachment')} onClick={() => setAttachments((current) => current.filter((entry) => entry.assetId !== item.assetId))}><X size={14} /></button></span>)}</div>}

            <footer className="t8-creator-v2-composer">
              <input ref={fileInputRef} className="hidden" type="file" tabIndex={-1} aria-hidden="true" multiple accept="image/*,video/*,audio/*,.txt,.md,.pdf" onChange={onFiles} />
              <textarea ref={composerRef} data-creator-agent-composer="true" rows={2} value={draft} maxLength={30_000} aria-label={copy('描述你想做的作品', 'Describe what you want to make')} placeholder={(sceneNavigation?.total || creationMode === 'scene') ? copy('写一个场景想法，或粘贴完整剧本…', 'Write a scene idea, or paste a full script…') : copy('例如：把这张产品图做成 15 秒电影感广告…', 'For example: Turn this product photo into a cinematic 15-second ad…')} onChange={(event) => {
                const value = event.currentTarget.value;
                composerDraftRef.current = { ...composerDraftRef.current, draft: value };
                setDraft(value);
              }} onKeyDown={onComposerKeyDown} onCompositionStart={() => {
                composerComposingRef.current = true;
              }} onCompositionEnd={() => {
                composerComposingRef.current = false;
                compositionEndedAtRef.current = Date.now();
              }} />
              <div>
                <button type="button" title={copy('添加附件', 'Add attachment')} aria-label={copy('添加附件', 'Add attachment')} disabled={isUploading} onClick={() => fileInputRef.current?.click()}>{isUploading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Paperclip size={16} />}</button>
                <button type="button" className={`has-touch-label${boundSelectionIds.length ? ' is-active' : ''}`} title={props.selectedNodeIds.length || boundSelectionIds.length ? copy('使用画布中选中的内容', 'Use selected canvas items') : copy('先在画布上选中图片、视频或文字', 'Select an image, video, or text item on the canvas first')} aria-label={props.selectedNodeIds.length || boundSelectionIds.length ? copy('使用画布中选中的内容', 'Use selected canvas items') : copy('先在画布上选中图片、视频或文字', 'Select an image, video, or text item on the canvas first')} aria-pressed={boundSelectionIds.length > 0} onClick={pinSelection}><AtSign size={16} /><span className="t8-creator-v2-button-label">{copy('画布', 'Canvas')}</span></button>
                <button type="button" className={`has-touch-label is-scene-mode${(sceneNavigation?.total || creationMode === 'scene') ? ' is-active' : ''}`} title={sceneNavigation?.total ? copy('当前作品正在逐场创作', 'This work is in scene mode') : copy('短想法也会直接写成高质量场稿', 'Turn even a short idea into a polished scene')} aria-label={copy('逐场创作', 'Scene mode')} aria-pressed={Boolean(sceneNavigation?.total || creationMode === 'scene')} disabled={isOperating || Boolean(sceneNavigation?.total)} onClick={() => setCreationMode((current) => current === 'scene' ? 'auto' : 'scene')}><Clapperboard size={16} /><span className="t8-creator-v2-button-label">{(sceneNavigation?.total || creationMode === 'scene') ? copy('逐场创作中', 'Scene mode on') : copy('逐场创作', 'Scene mode')}</span></button>
                {operation === 'reply' && activeResponseId ? <button type="button" className="is-send" title={copy('停止', 'Stop')} aria-label={copy('停止', 'Stop')} onClick={() => void stop()}><Square size={13} fill="currentColor" /></button> : <button type="button" className="is-send" title={settingsReadError ? copy('先重新读取创作模型状态', 'Check the creative model again first') : creatorLlmConfigured !== true ? copy('正在确认创作模型', 'Checking the creative model') : hasTurnInput ? copy('发送', 'Send') : copy('输入想法、添加素材或使用画布内容', 'Add text, media, or use selected canvas items')} aria-label={copy('发送', 'Send')} disabled={!hasTurnInput || isOperating || loading || creatorLlmConfigured !== true} onClick={() => void submit()}><Send size={16} /></button>}
              </div>
            </footer>
          </aside>,
          document.body,
        )}
      </>
    </LocalizedVisibleTree>
  );
}
