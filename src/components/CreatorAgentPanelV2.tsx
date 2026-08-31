import {
  AtSign,
  Check,
  History,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
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
  cancelCreatorActionV2,
  createCreatorConversationV2,
  formatCreatorModelLabel,
  formatCreatorProviderLabel,
  getCreatorCatalogV2,
  getCreatorConversationV2,
  getCreatorSettingsV2,
  listCreatorConversationsV2,
  saveCreatorSettingsV2,
  sendCreatorAssetToCanvasV2,
  sendCreatorMessageV2,
  stopCreatorResponseV2,
  subscribeCreatorEventsV2,
  type CreatorActionV2,
  type CreatorCatalogV2,
  type CreatorConversationV2,
  type CreatorMediaRef,
  type CreatorMessageV2,
  type CreatorPreferencesV2,
} from '../services/creatorAgentV2';
import type { ThemeTokens } from '../theme/types';

export interface CreatorAgentPanelV2Props {
  projectId: string;
  canvasId: string;
  selectedNodeIds: string[];
  visualStyle: string;
  themeMode: 'light' | 'dark';
  themeTokens: ThemeTokens;
  onFocusNode: (nodeId: string) => void;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PHASES = [
  ['idea', '想法', 'Idea'],
  ['script', '方案', 'Plan'],
  ['assets', '素材', 'Assets'],
  ['shots', '制作', 'Create'],
  ['candidates', '挑选', 'Choose'],
  ['delivery', '完成', 'Done'],
] as const;

const DEFAULT_PREFERENCES: CreatorPreferencesV2 = {
  providerId: 'auto',
  llm: null,
  image: null,
  video: null,
  catalogDigest: null,
};

type CreatorOperation =
  | 'idle'
  | 'new-conversation'
  | 'history-load'
  | 'history-more'
  | 'settings-load'
  | 'settings-save'
  | 'reply'
  | 'action-confirm'
  | 'action-revise'
  | 'canvas-send'
  | 'upload';

function errorText(error: unknown, fallback = '操作没有完成，请重试') {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (/(?:\bHTTP\s*\d{3}\b|\bECONN\w*\b|\bENOTFOUND\b|\bETIMEDOUT\b|\bERR_[A-Z_]+\b|\bCREATOR_[A-Z_]+\b|TypeError|stack trace)/iu.test(error.message)) return fallback;
  // Backend diagnostic messages are intentionally stable Chinese strings.
  // They are not user/model content, so an English workspace should receive
  // the local fallback instead of leaking untranslated system copy.
  if (/\p{Script=Han}/u.test(fallback) !== /\p{Script=Han}/u.test(error.message)) return fallback;
  return error.message;
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

export default function CreatorAgentPanelV2(props: CreatorAgentPanelV2Props) {
  const { i18n } = useTranslation();
  const isChinese = i18n.language.toLowerCase().startsWith('zh');
  const copy = useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const visibleMessageBody = useCallback((message: CreatorMessageV2) => {
    if (message.status === 'stopped') return copy('已停止。', 'Stopped.');
    if (message.status === 'failed') {
      return message.errorCode === 'CREATOR_LLM_INTERRUPTED'
        ? copy('上次回复被应用关闭中断，请重新发送。', 'The previous reply was interrupted when the app closed. Send it again.')
        : copy('这次回复没有完成。', 'This reply did not finish.');
    }
    return message.body || (message.status === 'streaming' ? copy('正在想…', 'Thinking…') : '');
  }, [copy]);
  const draftKey = `t8.creator-agent.v2.draft.${props.projectId}.${props.canvasId}`;
  const [open, setOpen] = useState(props.initialOpen === true);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<CreatorOperation>('idle');
  const [conversation, setConversation] = useState<CreatorConversationV2 | null>(null);
  const [messages, setMessages] = useState<CreatorMessageV2[]>([]);
  const [action, setAction] = useState<CreatorActionV2 | null>(null);
  const [draft, setDraft] = useState(() => {
    try { return window.sessionStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const [attachments, setAttachments] = useState<CreatorMediaRef[]>([]);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreatorConversationV2[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catalog, setCatalog] = useState<CreatorCatalogV2 | null>(null);
  const [preferences, setPreferences] = useState<CreatorPreferencesV2>(DEFAULT_PREFERENCES);
  const [settingsDraft, setSettingsDraft] = useState<CreatorPreferencesV2>(DEFAULT_PREFERENCES);
  const [sentNodes, setSentNodes] = useState<Record<string, string>>({});
  const [boundSelectionIds, setBoundSelectionIds] = useState<string[]>([]);
  const [activeResponseId, setActiveResponseId] = useState('');
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const activeResponseRef = useRef('');
  const sequenceRef = useRef(0);
  const draftRef = useRef(draft);
  const panelTitleId = useId();
  const historyPopoverId = useId();
  const settingsPopoverId = useId();
  const isOperating = operation !== 'idle';
  const isUploading = operation === 'upload';
  const isSettingsBusy = operation === 'settings-load' || operation === 'settings-save';
  const isHistoryBusy = operation === 'history-load' || operation === 'history-more';
  const blocksComposer = operation === 'new-conversation'
    || operation === 'reply'
    || operation === 'action-confirm'
    || operation === 'action-revise'
    || operation === 'canvas-send';
  const finishOperation = useCallback((expected: CreatorOperation) => {
    setOperation((current) => current === expected ? 'idle' : current);
  }, []);
  const setPanelOpen = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setOpen((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      props.onOpenChange?.(next);
      return next;
    });
  }, [props.onOpenChange]);
  const dismissSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsDraft(preferences);
  }, [preferences]);
  const lastSequence = useMemo(() => Math.max(
    conversation?.sequence || 0,
    ...messages.map((message) => message.sequence),
    action?.sequence || 0,
  ), [action?.sequence, conversation?.sequence, messages]);
  const latestAssistant = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant'), [messages]);
  const knownMedia = useMemo(() => new Map([
    ...messages.flatMap((message) => message.media),
    ...(action?.resultAssets || []),
  ].map((asset) => [asset.assetId, asset])), [action?.resultAssets, messages]);
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
  }) as CSSProperties, [props.themeTokens]);

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-canvas-floating-ui="creator-agent-launcher-slot"]');
    setLauncherHost(host);
    return () => setLauncherHost(null);
  }, [props.canvasId]);

  useEffect(() => {
    draftRef.current = draft;
    const timeout = window.setTimeout(() => {
      try {
        if (draft) window.sessionStorage.setItem(draftKey, draft);
        else window.sessionStorage.removeItem(draftKey);
      } catch { /* Session draft persistence is best effort. */ }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, draftKey]);

  useEffect(() => () => {
    try {
      if (draftRef.current) window.sessionStorage.setItem(draftKey, draftRef.current);
      else window.sessionStorage.removeItem(draftKey);
    } catch { /* Flush the latest draft when this canvas-scoped panel unmounts. */ }
  }, [draftKey]);

  const loadConversation = useCallback(async (sessionId: string) => {
    const snapshot = await getCreatorConversationV2(sessionId, props.projectId, props.canvasId);
    setConversation(snapshot.conversation);
    setMessages(snapshot.messages);
    setAction(snapshot.pendingAction);
    setNextBeforeSequence(snapshot.nextBeforeSequence);
    sequenceRef.current = Math.max(
      snapshot.conversation.sequence || 0,
      ...snapshot.messages.map((message) => message.sequence),
      snapshot.pendingAction?.sequence || 0,
    );
    setSentNodes({});
  }, [props.canvasId, props.projectId]);

  const ensureConversation = useCallback(async () => {
    if (conversation) return conversation;
    const listed = await listCreatorConversationsV2(props.projectId, props.canvasId);
    const current = listed.items[0];
    if (current) {
      await loadConversation(current.id);
      return current;
    }
    const created = await createCreatorConversationV2(props.projectId, props.canvasId);
    setConversation(created.conversation);
    setMessages([]);
    setAction(null);
    return created.conversation;
  }, [conversation, loadConversation, props.canvasId, props.projectId]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    void ensureConversation().catch((loadError) => {
      if (!cancelled) setError(errorText(loadError, copy('操作没有完成，请重试', 'Could not open Creator Agent. Please try again.')));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [copy, ensureConversation, open]);

  useEffect(() => {
    sequenceRef.current = Math.max(sequenceRef.current, lastSequence);
  }, [lastSequence]);

  useEffect(() => {
    if (!open || !conversation) return undefined;
    return subscribeCreatorEventsV2(conversation.id, props.projectId, props.canvasId, sequenceRef.current, {
      onCursor: (sequence) => {
        sequenceRef.current = Math.max(sequenceRef.current, sequence);
      },
      onMessage: (message) => {
        sequenceRef.current = Math.max(sequenceRef.current, message.sequence);
        setMessages((current) => mergeMessage(current, message));
        if (message.role === 'assistant' && message.responseId === activeResponseRef.current) {
          setActiveResponseId(message.status === 'streaming' ? message.responseId : '');
        }
      },
      onAction: (next) => {
        sequenceRef.current = Math.max(sequenceRef.current, next.sequence);
        setAction(next.status === 'cancelled' ? null : next);
        if (next.status === 'completed' && next.resultAssets.length) {
          setMessages((current) => current.map((message) => message.actionId === next.id
            ? { ...message, media: next.resultAssets }
            : message));
        }
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'ambiguous') finishOperation('action-confirm');
      },
      onConversation: (next) => {
        sequenceRef.current = Math.max(sequenceRef.current, next.sequence);
        setConversation(next);
      },
    });
  }, [conversation?.id, finishOperation, open, props.canvasId, props.projectId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [action, messages]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const settleMessageScroll = useCallback(() => {
    requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container || !stickToBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
    });
  }, []);

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

  const newConversation = useCallback(async () => {
    if (isOperating) return;
    if ((draft.trim() || attachments.length) && !window.confirm(copy('当前还未发送，确定开始新对话吗？', 'Your unsent draft will stay saved, but attachments will be cleared. Start a new conversation?'))) return;
    setOperation('new-conversation');
    setError('');
    try {
      const created = await createCreatorConversationV2(props.projectId, props.canvasId);
      setConversation(created.conversation);
      setMessages([]);
      setAction(null);
      setAttachments([]);
      setHistoryOpen(false);
      dismissSettings();
      setSentNodes({});
      setBoundSelectionIds([]);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (nextError) { setError(errorText(nextError, copy('没有新建成功，请重试', 'Could not start a new conversation.'))); } finally { finishOperation('new-conversation'); }
  }, [attachments.length, copy, dismissSettings, draft, finishOperation, isOperating, props.canvasId, props.projectId]);

  const openHistory = useCallback(async () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    dismissSettings();
    if (!nextOpen) return;
    if (isOperating) {
      setHistoryOpen(false);
      return;
    }
    setOperation('history-load');
    try {
      const listed = await listCreatorConversationsV2(props.projectId, props.canvasId);
      setHistory(listed.items);
      setHistoryBefore(listed.nextBefore);
    } catch (historyError) { setError(errorText(historyError, copy('历史记录读取失败', 'Could not load conversation history.'))); } finally { finishOperation('history-load'); }
  }, [copy, dismissSettings, finishOperation, historyOpen, isOperating, props.canvasId, props.projectId]);

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
    if (!historyBefore || isOperating) return;
    setOperation('history-more');
    try {
      const listed = await listCreatorConversationsV2(props.projectId, props.canvasId, historyBefore);
      setHistory((current) => [...new Map([...current, ...listed.items].map((item) => [item.id, item])).values()]);
      setHistoryBefore(listed.nextBefore);
    } catch (loadError) {
      setError(errorText(loadError, copy('更早的历史没有加载成功', 'Could not load more history.')));
    } finally { finishOperation('history-more'); }
  }, [copy, finishOperation, historyBefore, isOperating, props.canvasId, props.projectId]);

  const selectHistoryConversation = useCallback(async (sessionId: string) => {
    if (isOperating || sessionId === conversation?.id) {
      setHistoryOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    setOperation('history-load');
    setError('');
    setHistoryOpen(false);
    try {
      await loadConversation(sessionId);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (loadError) {
      setError(errorText(loadError, copy('这段历史没有打开成功', 'Could not open this conversation.')));
      requestAnimationFrame(() => historyButtonRef.current?.focus());
    } finally {
      finishOperation('history-load');
    }
  }, [conversation?.id, copy, finishOperation, isOperating, loadConversation]);

  const openSettings = useCallback(async () => {
    const nextOpen = !settingsOpen;
    setSettingsOpen(nextOpen);
    setHistoryOpen(false);
    if (!nextOpen) {
      setSettingsDraft(preferences);
      return;
    }
    if (isOperating) {
      setSettingsOpen(false);
      return;
    }
    setOperation('settings-load');
    setError('');
    try {
      const [settingsResult, catalogResult] = await Promise.all([
        getCreatorSettingsV2(props.projectId, props.canvasId),
        getCreatorCatalogV2(props.projectId, props.canvasId),
      ]);
      setPreferences(settingsResult.preferences);
      setSettingsDraft(settingsResult.preferences);
      setCatalog(catalogResult);
    } catch (settingsError) { setError(errorText(settingsError, copy('设置读取失败', 'Could not load generation settings.'))); } finally { finishOperation('settings-load'); }
  }, [copy, finishOperation, isOperating, props.canvasId, props.projectId, settingsOpen]);

  const saveSettings = useCallback(async () => {
    if (!catalog || isOperating) return;
    setOperation('settings-save');
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
    } catch (settingsError) { setError(errorText(settingsError, copy('设置没有保存成功', 'Could not save generation settings.'))); } finally { finishOperation('settings-save'); }
  }, [catalog, copy, finishOperation, isOperating, props.canvasId, props.projectId, settingsDraft]);

  const submit = useCallback(async (text = draft, overrideAttachments?: CreatorMediaRef[]) => {
    const content = text.trim();
    if (!content || isOperating) return;
    let sessionId = conversation?.id || '';
    let responseId = '';
    setOperation('reply');
    setError('');
    setDraft('');
    setHistoryOpen(false);
    dismissSettings();
    try {
      const current = await ensureConversation();
      sessionId = current.id;
      const clientRequestId = crypto.randomUUID();
      responseId = `response-${clientRequestId}`;
      activeResponseRef.current = responseId;
      const pending = sendCreatorMessageV2(current.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        text: content,
        clientRequestId,
        attachments: overrideAttachments || attachments,
        selectedNodeIds: boundSelectionIds,
      });
      const snapshot = await pending;
      setConversation(snapshot.conversation);
      setMessages(snapshot.messages);
      setAction(snapshot.pendingAction);
      setAttachments([]);
      setBoundSelectionIds([]);
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
        setDraft(content);
        if (overrideAttachments) setAttachments(overrideAttachments);
      } else {
        setAttachments([]);
        setBoundSelectionIds([]);
      }
      if (!durableStatus) {
        setError(errorText(sendError, copy('这次回复没有完成，请重试', 'The reply did not finish. Please try again.')));
      }
    } finally {
      if (activeResponseRef.current === responseId) {
        activeResponseRef.current = '';
        setActiveResponseId('');
      }
      finishOperation('reply');
    }
  }, [attachments, boundSelectionIds, conversation?.id, copy, dismissSettings, draft, ensureConversation, finishOperation, isOperating, props.canvasId, props.projectId]);

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
      setError(errorText(confirmError, copy('没有开始生成，请重试', 'Generation did not start. Please try again.')));
    }
  }, [action, conversation, copy, finishOperation, isOperating, props.canvasId, props.projectId]);

  const redoAction = useCallback(() => {
    if (!action || isOperating) return;
    void submit(
      copy('这个版本不合适，换一个明显不同的方向。', "This version isn't right. Try a clearly different direction."),
      action.resultAssets,
    );
  }, [action, copy, isOperating, submit]);

  const restoreFailedTurn = useCallback((assistant: CreatorMessageV2) => {
    const user = assistant.replyToMessageId
      ? messages.find((item) => item.id === assistant.replyToMessageId && item.role === 'user')
      : [...messages].reverse().find((item) => item.role === 'user' && item.sequence < assistant.sequence);
    if (!user) return;
    setDraft(user.body);
    setAttachments(user.media.slice(0, 12));
    setBoundSelectionIds(user.selectedNodes.map((node) => node.nodeId).slice(0, 24));
    setError('');
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [messages]);

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
    } catch (sendError) { setError(errorText(sendError, copy('没有发送到画布，请重试', 'Could not send this result to the canvas.'))); } finally { finishOperation('canvas-send'); }
  }, [conversation, copy, finishOperation, isOperating, props]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length || isOperating) return;
    setOperation('upload');
    setError('');
    try {
      for (const file of files.slice(0, Math.max(0, 12 - attachments.length))) {
        const result = await api.uploadResourceLocalFile(file, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          sourceNodeType: 'creator-agent-v2',
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
    } catch (uploadError) { setError(errorText(uploadError, copy('附件没有上传成功', 'Could not upload the attachment.'))); } finally { finishOperation('upload'); }
  }, [attachments.length, copy, finishOperation, isOperating, props.canvasId, props.projectId]);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    void uploadFiles(files);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const pinSelection = () => {
    if (boundSelectionIds.length) {
      setBoundSelectionIds([]);
      return;
    }
    if (!props.selectedNodeIds.length) return;
    setBoundSelectionIds((current) => current.length ? [] : [...props.selectedNodeIds]);
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

  const customized = preferences.providerId !== 'auto' || preferences.llm || preferences.image || preferences.video;
  const launcherStatus = error ? 'warning' : isOperating || action?.status === 'running' || action?.status === 'ambiguous' ? 'running' : action?.status === 'pending' ? 'approval' : action?.status === 'completed' ? 'completed' : 'idle';
  const operationAnnouncement = loading
    ? copy('正在打开创作', 'Opening your workspace')
    : operation === 'upload'
      ? copy('正在添加附件', 'Adding attachments')
      : operation === 'reply'
        ? copy('正在回复', 'Preparing a reply')
        : operation === 'action-confirm'
          ? copy('正在生成', 'Generating')
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
      aria-label={open ? copy('关闭创作 Agent', 'Close Creator Agent') : copy('打开创作 Agent', 'Open Creator Agent')}
      aria-expanded={open}
      onClick={() => setPanelOpen((current) => {
        if (current) {
          setHistoryOpen(false);
          dismissSettings();
        }
        return !current;
      })}
    >
      <span className="t8-creator-agent-launcher__label" aria-hidden="true">AI</span>
      <span className="t8-creator-agent-launcher__glyph" aria-hidden="true">{open ? <X size={17} /> : <Sparkles size={17} />}</span>
      <span className="t8-creator-agent-launcher__status" aria-hidden="true" />
    </button>
  );

  return (
    <LocalizedVisibleTree area="creatorAgent" catalog={CREATOR_AGENT_VISIBLE_CATALOG}>
      <>
        {launcherHost ? createPortal(launcher, launcherHost) : launcher}
        {open && (
          <aside
            className="t8-creator-v2-panel nodrag nopan nowheel"
            data-theme-mode={props.themeMode}
            data-theme-visual={props.visualStyle}
            style={style}
            role="dialog"
            aria-modal="false"
            aria-labelledby={panelTitleId}
          >
            <header className="t8-creator-v2-header">
              <div><Sparkles size={17} aria-hidden="true" /><strong id={panelTitleId}>Creator Agent</strong></div>
              <nav aria-label={copy('Creator Agent 操作', 'Creator Agent actions')}>
                <button ref={historyButtonRef} type="button" title={copy('历史', 'History')} aria-label={copy('历史', 'History')} aria-controls={historyPopoverId} aria-expanded={historyOpen} disabled={isOperating && !historyOpen} onClick={() => void openHistory()}><History size={16} /></button>
                <button type="button" title={copy('新对话', 'New conversation')} aria-label={copy('新对话', 'New conversation')} disabled={isOperating} onClick={() => void newConversation()}><Plus size={16} /></button>
                <button ref={settingsButtonRef} type="button" className={customized ? 'is-customized' : ''} title={copy('生成设置', 'Generation settings')} aria-label={copy('生成设置', 'Generation settings')} aria-controls={settingsPopoverId} aria-expanded={settingsOpen} disabled={isOperating && !settingsOpen} onClick={() => void openSettings()}><Settings size={16} /></button>
                <button type="button" title={copy('关闭', 'Close')} aria-label={copy('关闭', 'Close')} onClick={() => { setHistoryOpen(false); dismissSettings(); setPanelOpen(false); requestAnimationFrame(() => launcherRef.current?.focus()); }}><X size={17} /></button>
              </nav>
            </header>

            <ol className="t8-creator-v2-phases" aria-label={copy('创作进度', 'Creation progress')}>
              {PHASES.map(([id, zhLabel, enLabel], index) => {
                const currentIndex = PHASES.findIndex(([phase]) => phase === (conversation?.phase || 'idea'));
                return <li key={id} aria-current={index === currentIndex ? 'step' : undefined} aria-label={`${copy(zhLabel, enLabel)}${index === currentIndex ? copy('，当前步骤', ', current step') : index < currentIndex ? copy('，已完成', ', complete') : ''}`} className={index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : ''}><i aria-hidden="true">{index < currentIndex ? <Check size={10} /> : index + 1}</i><span aria-hidden="true">{copy(zhLabel, enLabel)}</span></li>;
              })}
            </ol>

            {historyOpen && (
              <section id={historyPopoverId} className="t8-creator-v2-popover is-history" role="region" aria-label={copy('历史对话', 'Conversation history')} aria-busy={isHistoryBusy}>
                {history.length ? history.map((item) => (
                  <button key={item.id} type="button" className={item.id === conversation?.id ? 'is-current' : ''} aria-current={item.id === conversation?.id ? 'true' : undefined} disabled={isOperating} onClick={() => void selectHistoryConversation(item.id)}>
                    <strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleDateString(isChinese ? 'zh-CN' : 'en-US')}</small>
                  </button>
                )) : <p>{copy('还没有历史对话', 'No earlier conversations')}</p>}
                {historyBefore && <button type="button" disabled={isHistoryBusy} onClick={() => void loadMoreHistory()}>{isHistoryBusy ? copy('正在加载…', 'Loading…') : copy('更早的对话', 'Earlier conversations')}</button>}
              </section>
            )}

            {settingsOpen && (
              <section id={settingsPopoverId} className="t8-creator-v2-popover is-settings" role="region" aria-label={copy('生成设置', 'Generation settings')} aria-busy={isSettingsBusy}>
                {isSettingsBusy && !catalog ? <p><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{copy('正在读取设置…', 'Loading settings…')}</p> : (
                  <>
                    <label><span>{copy('API 渠道', 'API provider')}</span><select value={settingsDraft.providerId} disabled={isOperating} onChange={(event) => setSettingsDraft((current) => ({ ...current, providerId: event.currentTarget.value, llm: null, image: null, video: null }))}>
                      <option value="auto">{copy('智能选择（推荐）', 'Automatic (recommended)')}</option>
                      {catalog?.providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.configured}>{formatCreatorProviderLabel(provider.id, provider.label, isChinese)}{provider.configured ? '' : copy('（未配置）', ' (not configured)')}</option>)}
                    </select></label>
                    {(['llm', 'image', 'video'] as const).map((kind) => (
                      <label key={kind}><span>{isChinese ? { llm: 'LLM 模型', image: '图像模型', video: '视频模型' }[kind] : { llm: 'LLM model', image: 'Image model', video: 'Video model' }[kind]}</span><select value={settingsDraft[kind] ? JSON.stringify([settingsDraft[kind]?.providerId, settingsDraft[kind]?.modelId]) : ''} disabled={isOperating} onChange={(event) => setModel(kind, event.currentTarget.value)}>
                        <option value="">{copy('智能选择（推荐）', 'Automatic (recommended)')}</option>
                        {modelOptions(kind).map((item) => <option key={`${item.providerId}:${item.modelId}`} value={JSON.stringify([item.providerId, item.modelId])} disabled={!item.configured}>{formatCreatorModelLabel(item, isChinese)}</option>)}
                      </select></label>
                    ))}
                    <footer><button type="button" disabled={isOperating} onClick={() => setSettingsDraft({ ...DEFAULT_PREFERENCES, catalogDigest: catalog?.catalogDigest || null })}>{copy('恢复智能选择', 'Use automatic settings')}</button><button type="button" className="is-primary" disabled={isOperating} onClick={() => void saveSettings()}>{copy('保存', 'Save')}</button></footer>
                  </>
                )}
              </section>
            )}

            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{operationAnnouncement}</span>

            <div
              ref={messagesRef}
              className="t8-creator-v2-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={loading || operation === 'reply' || operation === 'action-confirm'}
              onScroll={(event) => {
                const element = event.currentTarget;
                stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
              }}
            >
              {loading && <p className="t8-creator-v2-state"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{copy('正在打开创作…', 'Opening your workspace…')}</p>}
              {!loading && nextBeforeSequence && <button type="button" className="t8-creator-v2-load-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? copy('正在加载…', 'Loading…') : copy('查看更早消息', 'Earlier messages')}</button>}
              {!loading && messages.length === 0 && <p className="t8-creator-v2-empty">{copy('说说你想做什么，我来把它变成作品。', 'Tell me what you want to make. I’ll help turn it into a finished piece.')}</p>}
              {messages.map((message) => (
                <article key={message.id} className={`t8-creator-v2-message is-${message.role}`} data-status={message.status}>
                  <div data-i18n-skip="true">{visibleMessageBody(message)}</div>
                  {message.media.length > 0 && (
                    <div className="t8-creator-v2-message-media">
                      {message.media.map((asset) => (
                        <section key={asset.assetId} className="t8-creator-v2-result" aria-label={asset.title || copy('生成结果', 'Generated result')}>
                          {asset.kind === 'image' && asset.previewUrl && <img src={asset.previewUrl} alt={asset.title || copy('生成图片', 'Generated image')} loading="lazy" onLoad={settleMessageScroll} />}
                          {asset.kind === 'video' && asset.previewUrl && <video src={asset.previewUrl} aria-label={asset.title || copy('生成视频', 'Generated video')} controls preload="metadata" onLoadedMetadata={settleMessageScroll} />}
                          {message.role === 'assistant' && message.actionId && <footer><button type="button" disabled={isOperating} onClick={() => { setAttachments([asset]); requestAnimationFrame(() => composerRef.current?.focus()); }}>{copy('继续调整', 'Adjust')}</button><button type="button" className="is-primary" disabled={isOperating} onClick={() => void sendToCanvas(asset, message.actionId)}>{sentNodes[asset.assetId] ? copy('已发送 · 查看', 'Sent · View') : copy('发送到画布', 'Send to canvas')}</button></footer>}
                        </section>
                      ))}
                    </div>
                  )}
                  {message.actionId === action?.id && action?.status === 'pending' && (
                    <section className="t8-creator-v2-decision">
                      <p>{action.type === 'image'
                        ? copy(`生成 ${action.parameters.count || 1} 张 ${action.parameters.ratio || ''} 图片`, `Generate ${action.parameters.count || 1} ${action.parameters.ratio || ''} image${Number(action.parameters.count || 1) === 1 ? '' : 's'}`)
                        : copy(`生成 ${action.parameters.duration || 6} 秒 ${action.parameters.ratio || ''} 视频`, `Generate a ${action.parameters.duration || 6}s ${action.parameters.ratio || ''} video`)}</p>
                      <footer><button type="button" disabled={isOperating} onClick={() => void revisePendingAction()}>{copy('再改改', 'Revise')}</button><button type="button" className="is-primary" disabled={isOperating} onClick={() => void confirmAction()}>{copy('开始生成', 'Generate')}</button></footer>
                    </section>
                  )}
                  {message.actionId === action?.id && (action?.status === 'running' || action?.status === 'ambiguous') && <p className="t8-creator-v2-state"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{action.status === 'ambiguous' ? copy('仍在生成，已接管原任务…', 'Still generating. Reconnecting to the original task…') : copy('正在生成…', 'Generating…')}</p>}
                  {message.actionId === action?.id && action?.status === 'failed' && <section className="t8-creator-v2-decision is-error"><p>{errorText(action.errorMessage ? new Error(action.errorMessage) : null, copy('这次没有生成出来。', 'This generation did not finish.'))}</p><button type="button" disabled={isOperating} onClick={redoAction}><RefreshCw size={13} />{copy('重新安排', 'Try another')}</button></section>}
                  {message.status === 'failed' && <button type="button" disabled={isOperating} onClick={() => restoreFailedTurn(message)}>{copy('重新编辑', 'Edit and retry')}</button>}
                  {message.id === latestAssistant?.id && !action && message.status === 'completed' && message.suggestions.length === 3 && (
                    <div className="t8-creator-v2-suggestions">
                      {message.suggestions.map((suggestion) => <button key={suggestion.intentKind} type="button" data-role={suggestion.role} data-i18n-skip="true" disabled={isOperating} onClick={() => void submit(suggestion.sendText, suggestion.inputAssetIds.length ? suggestion.inputAssetIds.map((assetId) => knownMedia.get(assetId)).filter((asset): asset is CreatorMediaRef => Boolean(asset)) : undefined)}>{suggestion.label}</button>)}
                    </div>
                  )}
                </article>
              ))}
            </div>

            {error && <div className="t8-creator-v2-error" role="alert">{error}</div>}
            {(attachments.length > 0 || boundSelectionIds.length > 0) && <div className="t8-creator-v2-attachments">{boundSelectionIds.length > 0 && <span>{copy(`已引用 ${boundSelectionIds.length} 个画布节点`, `${boundSelectionIds.length} canvas node${boundSelectionIds.length === 1 ? '' : 's'} linked`)}<button type="button" aria-label={copy('取消引用选区', 'Unlink selection')} disabled={isOperating} onClick={() => setBoundSelectionIds([])}><X size={11} /></button></span>}{attachments.map((item) => <span key={item.assetId}>{item.title || item.kind}<button type="button" aria-label={copy('移除附件', 'Remove attachment')} disabled={isOperating} onClick={() => setAttachments((current) => current.filter((entry) => entry.assetId !== item.assetId))}><X size={11} /></button></span>)}</div>}

            <footer className="t8-creator-v2-composer">
              <input ref={fileInputRef} className="sr-only" type="file" multiple accept="image/*,video/*,audio/*,.txt,.md,.pdf" onChange={onFiles} />
              <textarea ref={composerRef} rows={2} value={draft} maxLength={30_000} aria-label={copy('描述你想做的作品', 'Describe what you want to make')} placeholder={copy('描述你想做的作品…', 'Describe what you want to make…')} disabled={loading || blocksComposer} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={onComposerKeyDown} />
              <div>
                <button type="button" title={copy('添加附件', 'Add attachment')} aria-label={copy('添加附件', 'Add attachment')} disabled={isOperating} onClick={() => fileInputRef.current?.click()}>{isUploading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Paperclip size={16} />}</button>
                <button type="button" className={boundSelectionIds.length ? 'is-active' : ''} title={copy('引用当前选区', 'Use selected nodes')} aria-label={copy('引用当前选区', 'Use selected nodes')} aria-pressed={boundSelectionIds.length > 0} disabled={isOperating || (props.selectedNodeIds.length === 0 && boundSelectionIds.length === 0)} onClick={pinSelection}><AtSign size={16} /></button>
                {operation === 'reply' && activeResponseId ? <button type="button" className="is-send" title={copy('停止', 'Stop')} aria-label={copy('停止', 'Stop')} onClick={() => void stop()}><Square size={13} fill="currentColor" /></button> : <button type="button" className="is-send" title={copy('发送', 'Send')} aria-label={copy('发送', 'Send')} disabled={!draft.trim() || isOperating || loading} onClick={() => void submit()}><Send size={16} /></button>}
              </div>
            </footer>
          </aside>
        )}
      </>
    </LocalizedVisibleTree>
  );
}
