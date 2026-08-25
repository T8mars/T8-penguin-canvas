/// <reference types="vite/client" />

declare module 'virtual:t8-local-extensions' {
  import type { FC } from 'react';
  import type { LocalNodeAddonSlotProps, LocalSettingsAddonSlotProps, LocalTopbarSlotProps } from './extensions/localExtensionTypes';

  export const LocalTopbarSlot: FC<LocalTopbarSlotProps>;
  export const LocalNodeAddonSlot: FC<LocalNodeAddonSlotProps>;
  export const LocalSettingsAddonSlot: FC<LocalSettingsAddonSlotProps>;
  export const LocalModalSlot: FC;
}

type T8UpdaterStatusCode =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

interface T8UpdaterProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

interface T8UpdaterStatus {
  status: T8UpdaterStatusCode;
  currentVersion: string;
  availableVersion?: string | null;
  message?: string | null;
  messageKey?: string | null;
  messageParams?: Record<string, string | number | boolean | null> | null;
  progress?: T8UpdaterProgress | null;
  downloaded?: boolean;
  error?: string | null;
  packaged?: boolean;
  updatedAt?: string | null;
}

interface T8UpdaterResult {
  success: boolean;
  code?: string;
  messageKey?: string;
  params?: Record<string, unknown>;
  message?: string;
  info?: unknown;
  status?: T8UpdaterStatus;
}

interface T8DragFileOutStatus {
  requestId?: string;
  success: boolean;
  message?: string;
  code?: string;
  messageKey?: string;
  params?: Record<string, unknown>;
  file?: string;
}

interface T8ParseAuthCookie {
  profileId: string;
  label: string;
  cookie: string;
  count: number;
  length: number;
  expiresAt?: string | null;
  domains?: string[];
}

interface T8ParseAuthSavedRecord {
  profileId: string;
  label: string;
  saved: true;
  encrypted?: boolean;
  savedAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
  length: number;
  count: number;
  domains?: string[];
  cookie?: string;
}

interface T8ParseAuthResult {
  success: boolean;
  message?: string;
  data?: T8ParseAuthCookie
    | T8ParseAuthSavedRecord
    | { records: T8ParseAuthSavedRecord[]; encryptionAvailable: boolean }
    | { profileId: string; label: string; removed: number; savedRemoved?: number };
}

interface T8PickedMediaFile {
  path: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'model3d';
  size: number;
  mime: string;
  relativePath?: string;
}

interface T8PickMediaFilesResult {
  success: boolean;
  cancelled?: boolean;
  message?: string;
  files?: T8PickedMediaFile[];
  truncated?: boolean;
}

interface T8PickDirectoryResult {
  success: boolean;
  cancelled?: boolean;
  message?: string;
  path?: string;
}

type T8AgentControlScope =
  | 'canvas:read'
  | 'canvas:write'
  | 'run:read'
  | 'run:execute'
  | 'asset:read'
  | 'asset:transfer'
  | 'browser:handoff';

interface T8AgentControlPairing {
  pairingId: string;
  userCode: string;
  clientName: string;
  agentKind: string;
  requestedScopes: T8AgentControlScope[];
  createdAt: string;
  expiresAt: string;
}

interface T8AgentControlConnectionSummary {
  schema: 't8-agent-control-connection-summary-v1';
  connected: boolean;
  activeSessionCount: number;
  codexConnected: boolean;
  codexSessionCount: number;
  pendingPairingCount: number;
  codexScopes: T8AgentControlScope[];
  nextCodexExpiryAt: string | null;
}

interface T8AgentControlIpcResult<T = unknown> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
}

interface T8AgentControlPatchPreview {
  patchId: string;
  summary: string;
  baseRevision?: number;
  currentRevision: number;
  previewDigest?: string;
  affectedNodeIds?: string[];
  affectedEdgeIds?: string[];
  operationCount?: number;
  changes?: Array<{
    operationIndex?: number;
    type?: string;
    targetType?: string;
    targetId?: string;
    fields?: string[];
    before?: unknown;
    after?: unknown;
  }>;
  warnings?: string[];
  riskLevel?: 'L1' | 'L2' | 'L3' | string;
  assetId?: string;
  assetPlacement?: {
    nodeId?: string;
    nodeType?: string;
    position?: { x?: number; y?: number };
    targetNodeId?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    lineage?: {
      assetId?: string;
      kind?: string;
      contentHash?: string;
      contentRevision?: number;
    };
    asset?: {
      id?: string;
      kind?: string;
      filename?: string;
      contentHash?: string;
      contentRevision?: number;
      mimeType?: string;
      size?: number;
    };
  };
  projectId?: string;
  canvasId?: string;
  file?: {
    name?: string;
    kind?: string;
    mimeType?: string;
    size?: number;
    sha256?: string;
  };
  destination?: string;
  providerTransfer?: {
    occursNow?: boolean;
    scope?: string;
    message?: string;
  };
  cost?: {
    known?: boolean;
    currency?: string;
    amount?: number | null;
    budget?: number | null;
  };
  run?: {
    planId?: string;
    planDigest?: string;
    requestedNodeIds?: string[];
    authorizedNodeIds?: string[];
    declarations?: Array<{ provider?: string; model?: string; nodeIds?: string[] }>;
    mode?: string;
    budget?: number;
  };
  creator?: {
    action?: string;
    profile?: string;
    profileLabel?: string;
    candidateCount?: number;
    goal?: string;
    ratio?: string;
    durationSec?: number;
    generateScope?: string;
    models?: {
      llm?: { provider?: string; model?: string };
      image?: { provider?: string; model?: string };
      video?: { provider?: string; model?: string };
    };
  };
}

interface T8AgentControlApprovalBinding {
  schema: 't8-agent-control-approval-binding-v1';
  action: T8AgentControlApproval['action'];
  sessionId: string;
  projectId: string;
  canvasId: string;
  subject: Record<string, unknown>;
  subjectKey: string;
  subjectVersionDigest: string;
  planDigest: string;
  modelDecisionDigest?: string | null;
  boundary: {
    providerSelections?: Array<{
      kind?: string;
      mode?: string;
      status?: string;
      provider?: string;
      model?: string;
      nodeIds?: string[];
    }>;
    costTier?: {
      status?: 'known' | 'unknown';
      message?: string;
      [key: string]: unknown;
    };
    privacyBoundary?: {
      status?: 'known' | 'unknown';
      message?: string;
      [key: string]: unknown;
    };
    providerTransfer?: {
      status?: string;
      occursNow?: boolean;
      scope?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  boundaryDigest: string;
  bindingDigest: string;
}

interface T8AgentControlApproval {
  approvalRequestId: string;
  action: 'patch.apply' | 'patch.revert' | 'asset.place' | 'asset.import' | 'asset.download' | 'delivery.package' | 'run.start' | 'run.retry' | 'creative.apply';
  operationId?: string;
  clientName: string;
  projectId: string;
  canvasId: string;
  patchId?: string;
  preview: T8AgentControlPatchPreview;
  expectedRevision?: number | null;
  approvalBinding?: T8AgentControlApprovalBinding | null;
  createdAt: string;
  expiresAt: string;
}

interface T8AgentControlCanvasMutation {
  schema: 't8-agent-control-canvas-mutation-v1';
  approvalRequestId: string;
  action: 'patch.apply' | 'patch.revert';
  projectId: string;
  canvasId: string;
  patchId: string;
  revision: number;
  warningCodes: string[];
  committedAt: string;
}

interface Window {
  t8pc?: {
    getInfo: () => Promise<{
      packaged: boolean;
      backendPort: number;
      userData: string;
      version: string;
      locale?: 'zh-CN' | 'en-US';
      updater?: T8UpdaterStatus;
    }>;
    locale?: {
      get: () => Promise<{ locale: 'zh-CN' | 'en-US' }>;
      set: (locale: 'zh-CN' | 'en-US') => Promise<{
        success: boolean;
        locale: 'zh-CN' | 'en-US';
        code?: string;
        messageKey?: string;
      }>;
    };
    openExternal: (url: string) => Promise<{ success: boolean; message?: string }>;
    openPath: (targetPath: string) => Promise<{ success: boolean; message?: string; path?: string }>;
    pickMediaFiles?: (options?: { directory?: boolean; multiple?: boolean; kinds?: Array<'image' | 'video' | 'audio' | 'model3d'> }) => Promise<T8PickMediaFilesResult>;
    pickDirectory?: (options?: {
      title?: string;
      buttonLabel?: string;
    }) => Promise<T8PickDirectoryResult>;
    getPathForFile?: (file: File) => string;
    dragFileOut?: (payload: { url?: string; path?: string; filename?: string; kind?: string; requestId?: string }) => void;
    onDragFileOutStatus?: (callback: (status: T8DragFileOutStatus) => void) => () => void;
    parseAuth?: {
      login: (profileId: string) => Promise<T8ParseAuthResult>;
      getCookie: (profileId: string) => Promise<T8ParseAuthResult>;
      listSaved: (profileId?: string) => Promise<T8ParseAuthResult>;
      save: (profileId: string, cookieText: string, meta?: Record<string, unknown>) => Promise<T8ParseAuthResult>;
      load: (profileId: string) => Promise<T8ParseAuthResult>;
      clear: (profileId: string) => Promise<T8ParseAuthResult>;
    };
    agentControl?: {
      getConnectionSummary: () => Promise<T8AgentControlIpcResult<T8AgentControlConnectionSummary>>;
      listPendingPairings: () => Promise<T8AgentControlIpcResult<T8AgentControlPairing[]>>;
      approvePairing: (input: {
        pairingId: string;
        userCode: string;
        approvedScopes: T8AgentControlScope[];
      }) => Promise<T8AgentControlIpcResult<{ pairingId: string; status: string; sessionId?: string }>>;
      denyPairing: (pairingId: string) => Promise<T8AgentControlIpcResult<{ pairingId: string; status: string }>>;
      listPendingApprovals: () => Promise<T8AgentControlIpcResult<T8AgentControlApproval[]>>;
      approveOperation: (approvalRequestId: string) => Promise<T8AgentControlIpcResult<{
        approvalRequestId: string;
        status: string;
        approvedAt?: string;
      }>>;
      denyOperation: (approvalRequestId: string) => Promise<T8AgentControlIpcResult<{
        approvalRequestId: string;
        status: string;
      }>>;
      onCanvasMutation: (callback: (event: T8AgentControlCanvasMutation) => void) => () => void;
    };
    updater?: {
      getStatus: () => Promise<T8UpdaterStatus>;
      check: () => Promise<T8UpdaterResult>;
      download: () => Promise<T8UpdaterResult>;
      install: () => Promise<T8UpdaterResult>;
      onStatus: (callback: (status: T8UpdaterStatus) => void) => () => void;
    };
  };
}
