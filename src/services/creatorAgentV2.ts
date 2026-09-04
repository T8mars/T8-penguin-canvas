const BASE = '/api/creator-agent/v2';

export type CreatorPhase = 'idea' | 'script' | 'assets' | 'shots' | 'candidates' | 'delivery';
export type CreatorMediaKind = 'image' | 'video' | 'audio' | 'file';

export interface CreatorMediaRef {
  assetId: string;
  kind: CreatorMediaKind;
  contentHash?: string | null;
  contentRevision?: number;
  mimeType?: string | null;
  duration?: number;
  ref?: string | null;
  previewUrl?: string | null;
  title?: string | null;
  reviewStatus?: 'pending' | 'reviewed';
  adoptionStatus?: 'pending' | 'adopted';
  placementStatus?: 'pending' | 'completed';
  sentToCanvas?: boolean;
  canvasNodeId?: string | null;
  canvasRevision?: number | null;
  shotId?: string | null;
  shotOrdinal?: number | null;
  outputIndex?: number;
}

export interface CreatorShotV2 {
  shotId: string;
  ordinal: number;
  title: string;
  prompt: string;
  parameters: { ratio?: string; count?: number; duration?: number; resolution?: string };
  inputAssetIds: string[];
  status: 'pending' | 'running' | 'ambiguous' | 'completed' | 'failed' | 'cancelled';
  resultAssets: CreatorMediaRef[];
  runId: string | null;
  nodeRunId: string | null;
  attemptId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreatorSelectedNodeRefV2 {
  nodeId: string;
  type: string;
  label: string;
  assetId: string | null;
  content: string | null;
}

export interface CreatorMessageV2 {
  id: string;
  sessionId: string;
  sequence: number;
  role: 'user' | 'assistant';
  body: string;
  status: 'streaming' | 'completed' | 'failed' | 'stopped';
  suggestions: CreatorSuggestionV2[];
  actionId: string | null;
  media: CreatorMediaRef[];
  responseId: string | null;
  replyToMessageId: string | null;
  selectedNodes: CreatorSelectedNodeRefV2[];
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreatorSuggestionV2 {
  label: string;
  sendText: string;
  intentKind: string;
  role: 'recommended' | 'alternative' | 'execute';
  inputAssetIds: string[];
}

export interface CreatorActionV2 {
  id: string;
  sessionId: string;
  sequence: number;
  type: 'image' | 'video';
  prompt: string;
  parameters: { ratio?: string; count?: number; duration?: number; resolution?: string };
  modelSnapshot: { kind: 'image' | 'video'; providerId: string; modelId: string; catalogDigest: string };
  inputAssetIds: string[];
  workBinding: {
    schema: 't8-creator-scene-action-binding-v1';
    workId: string | null;
    workRevision: number;
    workDigest: string | null;
    sceneId: string;
    scenePartId: string | null;
    sceneRevision: number;
    contextDigest: string;
    shotIds: string[];
    shotPlanDigest: string | null;
  } | null;
  shots: CreatorShotV2[];
  status: 'pending' | 'running' | 'ambiguous' | 'completed' | 'failed' | 'cancelled';
  runIntentId: string | null;
  runId: string | null;
  resultAssets: CreatorMediaRef[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreatorConversationV2 {
  schema: 't8-creator-conversation-v2';
  id: string;
  projectId: string;
  canvasId: string;
  title: string;
  phase: CreatorPhase;
  status: 'active' | 'completed' | 'archived';
  sequence: number;
  workingBrief: {
    goal: string;
    format: string;
    audience: string;
    style: string;
    story: string;
    assets: string;
    constraints: string;
    decisions: string;
    openQuestion: string;
  };
  phaseEvidence: {
    source: string;
    requestedPhase: CreatorPhase | null;
    acceptedPhase: CreatorPhase | null;
    transition: 'advance' | 'stay' | 'revise';
    reason: string;
    at: number;
  };
  currentSceneId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreatorLongScriptSceneV2 {
  sceneId: string;
  orderKey: string;
  title: string;
  sourceText: string;
  sourcePartId: string | null;
  sourcePartIndex: number;
  sourcePartCount: number;
  sourcePartHasDraft: boolean;
  draftText: string;
  sourceIntegrity: boolean;
  status: 'draft' | 'confirmed' | 'stale';
  purpose: string;
  objective: string;
  obstacle: string;
  turn: string;
  valueChange: string;
  activeEntityIds: string[];
  locationId: string | null;
  recordRevision: number;
}

export interface CreatorLongScriptNavigationV2 {
  schema: 't8-creator-long-script-navigation-v1';
  scriptId: string | null;
  title: string;
  currentSceneId: string | null;
  currentScene: CreatorLongScriptSceneV2 | null;
  scenes: Array<{
    sceneId: string;
    index: number;
    number: number;
    title: string;
    status: string;
    recordRevision: number;
  }>;
  total: number;
  work: { revision: number; digest: string | null };
}

export interface CreatorSnapshotV2 {
  conversation: CreatorConversationV2;
  messages: CreatorMessageV2[];
  pendingAction: CreatorActionV2 | null;
  work?: { snapshot: { revision: number; workDigest: string } | null; artifacts: unknown[] };
  nextBeforeSequence: number | null;
}

export interface CreatorChoiceV2 {
  providerId: string;
  modelId: string;
}

export interface CreatorPreferencesV2 {
  providerId: string;
  llm: CreatorChoiceV2 | null;
  image: CreatorChoiceV2 | null;
  video: CreatorChoiceV2 | null;
  catalogDigest: string | null;
  updatedAt?: number;
}

export interface CreatorCatalogItemV2 extends CreatorChoiceV2 {
  label: string;
  providerLabel: string;
  family: string;
  configured: boolean;
  recommended: boolean;
  visionCapable: boolean;
}

export interface CreatorCatalogV2 {
  catalogDigest: string;
  providers: Array<{ id: string; label: string; configured: boolean }>;
  llm: CreatorCatalogItemV2[];
  image: CreatorCatalogItemV2[];
  video: CreatorCatalogItemV2[];
}

/**
 * Prefer the provider catalog's own display label. When a provider does not
 * supply one, preserve the model id verbatim instead of inventing a friendly
 * name or removing technical suffixes that may distinguish billable models.
 */
export function formatCreatorProviderLabel(providerId: string, catalogLabel: string, isChinese = true) {
  const known = {
    'seedance-nz': ['贞贞的平价AI小屋', 'Zhenzhen Budget AI House'],
    zhenzhen: ['贞贞的AI工坊', 'Zhenzhen AI Studio'],
  } as const;
  const localized = known[providerId as keyof typeof known];
  return localized ? localized[isChinese ? 0 : 1] : String(catalogLabel || providerId).trim();
}

export function formatCreatorModelLabel(item: CreatorCatalogItemV2, isChinese = true) {
  const modelId = String(item.modelId || '').trim();
  const catalogLabel = String(item.label || '').trim();
  // The generated catalog is currently authored in Chinese. In an English
  // workspace, preserve the exact model id rather than leaking a mixed-locale
  // suffix that can also obscure which billable model is selected.
  const label = !isChinese && /\p{Script=Han}/u.test(catalogLabel) ? modelId : (catalogLabel || modelId);
  const providerLabel = formatCreatorProviderLabel(item.providerId, item.providerLabel, isChinese);
  if (!providerLabel || item.providerId === 'seedance-nz') return label;
  if (label.toLocaleLowerCase().startsWith(providerLabel.toLocaleLowerCase())) return label;
  return `${providerLabel} · ${label}`;
}

/**
 * Model families come from the signed capability catalog. Localizing this
 * exact catalog field makes a long native select scannable without guessing
 * at, shortening, or otherwise changing the billable model id.
 */
export function formatCreatorModelFamily(family: string, isChinese = true) {
  const normalized = String(family || '').trim().toLowerCase();
  const known: Record<string, readonly [string, string]> = {
    llm: ['语言模型', 'Language models'],
    'minimax-h3-context-ir': ['MiniMax H3 官方增强', 'Official MiniMax H3'],
    'qwen-image-3.0': ['Qwen Image 3.0', 'Qwen Image 3.0'],
    'grok-image': ['Grok Image', 'Grok Image'],
    'grok-image-tools': ['Grok Image 工具', 'Grok Image tools'],
    'seedream-v5-pro': ['Seedream 5 Pro', 'Seedream 5 Pro'],
    'seedream-layer-decomposition': ['Seedream 分层', 'Seedream layers'],
    'gpt-image-2': ['GPT Image 2', 'GPT Image 2'],
    'wan-image': ['Wan Image', 'Wan Image'],
    'nano-banana-2': ['Nano Banana 2', 'Nano Banana 2'],
    'nano-banana-pro': ['Nano Banana Pro', 'Nano Banana Pro'],
    'hailuo-2.3': ['Hailuo / MiniMax H3', 'Hailuo / MiniMax H3'],
    'kling-v3.0': ['Kling 3.0', 'Kling 3.0'],
    'vidu-q3': ['Vidu Q3', 'Vidu Q3'],
    'wan-2.7-spicy': ['Wan Video', 'Wan Video'],
    'seedance-2.0': ['Seedance 2.0', 'Seedance 2.0'],
    'seedance-2.5': ['Seedance 2.5', 'Seedance 2.5'],
    'veo3.1': ['Veo', 'Veo'],
    'happyhorse-1.1': ['HappyHorse 1.1', 'HappyHorse 1.1'],
    'grok-video-3': ['Grok Video', 'Grok Video'],
    'fashvsr-video-upscale': ['FlashVSR 视频超分', 'FlashVSR video upscale'],
    'zhenzhen-upscaler': ['视频超分', 'Video upscale'],
  };
  const localized = known[normalized];
  return localized ? localized[isChinese ? 0 : 1] : (family || (isChinese ? '其他模型' : 'Other models'));
}

interface Envelope<T> {
  schema: 't8-creator-agent-http-v2';
  ok: boolean;
  data?: T;
  message?: string;
  code?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const envelope = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !envelope?.ok || envelope.data == null) {
    const error = new Error(envelope?.message || `创作 Agent 请求失败（HTTP ${response.status}）`);
    Object.assign(error, { code: envelope?.code || 'CREATOR_AGENT_V2_REQUEST_FAILED', status: response.status });
    throw error;
  }
  return envelope.data;
}

const scopeQuery = (projectId: string, canvasId: string) => new URLSearchParams({ projectId, canvasId });

export async function listCreatorConversationsV2(projectId: string, canvasId: string, before?: string) {
  const query = scopeQuery(projectId, canvasId);
  query.set('limit', '20');
  if (before) query.set('before', String(before));
  return request<{ items: CreatorConversationV2[]; nextBefore: string | null }>(`/sessions?${query}`);
}

export async function createCreatorConversationV2(projectId: string, canvasId: string, title?: string) {
  return request<{ conversation: CreatorConversationV2 }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ projectId, canvasId, title }),
  });
}

export async function getCreatorConversationV2(sessionId: string, projectId: string, canvasId: string, beforeSequence?: number) {
  const query = scopeQuery(projectId, canvasId);
  query.set('limit', '24');
  if (beforeSequence) query.set('beforeSequence', String(beforeSequence));
  return request<CreatorSnapshotV2>(`/sessions/${encodeURIComponent(sessionId)}?${query}`);
}

export async function getCreatorLongScriptScenesV2(sessionId: string, projectId: string, canvasId: string) {
  return request<CreatorLongScriptNavigationV2>(
    `/sessions/${encodeURIComponent(sessionId)}/scenes?${scopeQuery(projectId, canvasId)}`,
  );
}

export async function setCreatorCurrentSceneV2(
  sessionId: string,
  sceneId: string,
  projectId: string,
  canvasId: string,
) {
  return request<{ navigation: CreatorLongScriptNavigationV2 }>(
    `/sessions/${encodeURIComponent(sessionId)}/current-scene`,
    { method: 'PUT', body: JSON.stringify({ projectId, canvasId, sceneId }) },
  );
}

export async function confirmCreatorCurrentSceneV2(
  sessionId: string,
  sceneId: string,
  projectId: string,
  canvasId: string,
  clientRequestId: string,
  scenePartId?: string | null,
) {
  return request<{ navigation: CreatorLongScriptNavigationV2 }>(
    `/sessions/${encodeURIComponent(sessionId)}/current-scene/confirm`,
    { method: 'POST', body: JSON.stringify({ projectId, canvasId, sceneId, scenePartId, clientRequestId }) },
  );
}

export async function sendCreatorMessageV2(sessionId: string, input: {
  projectId: string;
  canvasId: string;
  text: string;
  locale?: 'zh-CN' | 'en';
  clientRequestId: string;
  attachments?: CreatorMediaRef[];
  selectedNodeIds?: string[];
  currentSceneId?: string | null;
  creationMode?: 'auto' | 'scene';
}) {
  return request<CreatorSnapshotV2 & { assistant: CreatorMessageV2; evidence: { providerCalls: number } }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function stopCreatorResponseV2(sessionId: string, responseId: string, projectId: string, canvasId: string) {
  return request<{ stopped: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/responses/${encodeURIComponent(responseId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ projectId, canvasId }),
  });
}

export async function confirmCreatorActionV2(sessionId: string, actionId: string, projectId: string, canvasId: string) {
  return request<{ action: CreatorActionV2 }>(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ projectId, canvasId }),
  });
}

export async function cancelCreatorActionV2(sessionId: string, actionId: string, projectId: string, canvasId: string) {
  return request<{ action: CreatorActionV2 }>(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ projectId, canvasId }),
  });
}

export async function retryCreatorActionV2(sessionId: string, actionId: string, projectId: string, canvasId: string) {
  return request<{ action: CreatorActionV2 }>(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      canvasId,
      clientRequestId: `creator-action-retry:${actionId}`,
    }),
  });
}

export async function sendCreatorAssetToCanvasV2(sessionId: string, actionId: string, assetId: string, projectId: string, canvasId: string) {
  return request<{ nodeId: string; duplicate: boolean; canvasRevision: number }>(
    `/sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(assetId)}/send-to-canvas`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, actionId,
        clientRequestId: `creator-media-send:${actionId}:${assetId}`,
      }),
    },
  );
}

export async function markCreatorAssetReviewedV2(
  sessionId: string,
  actionId: string,
  assetId: string,
  kind: 'image' | 'video',
  projectId: string,
  canvasId: string,
) {
  return request<{ action: CreatorActionV2 }>(
    `/sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(assetId)}/reviewed`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, actionId,
        clientRequestId: `creator-media-review:${actionId}:${assetId}`,
        evidenceKind: kind === 'video' ? 'video-frame-visible' : 'image-visible',
      }),
    },
  );
}

export async function getCreatorSettingsV2(projectId: string, canvasId: string) {
  return request<{ preferences: CreatorPreferencesV2 }>(`/settings?${scopeQuery(projectId, canvasId)}`);
}

export async function saveCreatorSettingsV2(projectId: string, canvasId: string, preferences: CreatorPreferencesV2) {
  return request<{ preferences: CreatorPreferencesV2 }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ projectId, canvasId, preferences }),
  });
}

export async function getCreatorCatalogV2(projectId: string, canvasId: string) {
  return request<CreatorCatalogV2>(`/settings/catalog?${scopeQuery(projectId, canvasId)}`);
}

export function subscribeCreatorEventsV2(sessionId: string, projectId: string, canvasId: string, after: number, handlers: {
  onMessage: (message: CreatorMessageV2) => void;
  onAction: (action: CreatorActionV2) => void;
  onConversation?: (conversation: CreatorConversationV2) => void;
  onWork?: () => void;
  onCursor?: (sequence: number) => void;
  onError?: () => void;
}) {
  const query = scopeQuery(projectId, canvasId);
  query.set('after', String(Math.max(0, after)));
  const source = new EventSource(`${BASE}/sessions/${encodeURIComponent(sessionId)}/events?${query}`);
  const parse = <T,>(event: MessageEvent<string>) => {
    try {
      const envelope = JSON.parse(event.data) as { sequence?: number; data?: T };
      const sequence = Math.max(0, Math.trunc(Number(envelope.sequence || event.lastEventId) || 0));
      if (sequence) handlers.onCursor?.(sequence);
      return envelope.data || null;
    } catch { return null; }
  };
  source.addEventListener('message', (event) => {
    const value = parse<CreatorMessageV2>(event as MessageEvent<string>);
    if (value) handlers.onMessage(value);
  });
  source.addEventListener('action', (event) => {
    const value = parse<CreatorActionV2>(event as MessageEvent<string>);
    if (value) handlers.onAction(value);
  });
  source.addEventListener('conversation', (event) => {
    const value = parse<CreatorConversationV2>(event as MessageEvent<string>);
    if (value) handlers.onConversation?.(value);
  });
  source.addEventListener('work', (event) => {
    parse<unknown>(event as MessageEvent<string>);
    handlers.onWork?.();
  });
  source.onerror = () => handlers.onError?.();
  return () => source.close();
}
