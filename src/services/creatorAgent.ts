import type { CanvasPatch } from '../types/project';
import capabilitySurfaceContractJson from '../generated/creator-agent-capability-surfaces.json';

const BASE = '/api/creator-agent/v1';

export interface CreatorAgentCapabilitySurface {
  id: string;
  creatorLabel: string;
  category: string;
  approval: 'L0' | 'L1' | 'L2' | 'L3';
  requiredScopes: string[];
  supports: string[];
  agentTool: {
    name: string;
    version: string;
    protocol: 't8-versioned-creative-tool-v1';
    requestSchema: 't8-versioned-creative-tool-request-v1';
    resultSchema: 't8-versioned-creative-tool-result-v1';
    defaultOperation: string;
    directOperations: string[];
    requestAction: string;
    handler: string;
    service: string;
    method: string;
    bindingOperation: string;
  };
  cli: { command: string; subcommand: string; operation: string };
  ui: {
    action: string;
    requestAction: string;
    operations: CreatorAgentCapability['operations'];
  };
}

interface CreatorAgentCapabilitySurfaceContract {
  schema: 't8-creative-capability-surfaces-v1';
  capabilityManifestVersion: string;
  sourceDigest: string;
  capabilityGraphDigest: string;
  counts: { capabilities: number; agentTools: number; cliOperations: number; uiActions: number };
  capabilities: CreatorAgentCapabilitySurface[];
}

export const CREATOR_AGENT_CAPABILITY_SURFACES = Object.freeze(
  capabilitySurfaceContractJson as CreatorAgentCapabilitySurfaceContract,
);

export interface CreatorAgentCapability {
  id: string;
  aliases: string[];
  creatorLabel: string;
  summary: string;
  category: string;
  handler: string;
  nodeTypes: string[];
  inputKinds: string[];
  outputKinds: string[];
  approval: 'L0' | 'L1' | 'L2' | 'L3';
  requiredScopes: string[];
  supports: string[];
  evidence: string[];
  cli: { command: string; subcommand: string };
  uiAction: string;
  operations: Array<{
    operation: string;
    riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
    approvalRequired: boolean;
    boundary: string;
    requiredScopes: string[];
  }>;
}

export interface CreatorAgentCapabilities {
  schema: 't8-creative-capability-manifest-v1';
  version: string;
  digest: string;
  principles: {
    oneSentenceStart: boolean;
    directCanvasMutation: false;
    previewBeforeApply: true;
    explicitApprovalForWrites: true;
    preserveAcceptedAndLocked: boolean;
    requirePhysicalArtifactEvidence: boolean;
  };
  capabilityGraph: {
    schema: 't8-creative-capability-graph-v1';
    aggregateDigest: string;
    artifactDigest: string;
    counts: {
      capabilities: number;
      handlers: number;
      nodes: number;
      executableNodes: number;
      generatableNodes: number;
      referencedNodes: number;
      unreferencedNodes: number;
      directCapabilityNodes: number;
      internalCompatNodes: number;
      semanticSupersededNodes: number;
      publicCapabilityGapNodes: number;
      accountedNodes: number;
      unexplainedNodes: number;
      fullyOperableNodes: number;
      runtimeEntries: number;
      unknownNodeReferences: number;
      runtimeByKind: Record<string, number>;
      runtimeByProvider: Record<string, number>;
      operations: number;
      operationRiskByLevel: Record<'L0' | 'L1' | 'L2' | 'L3', number>;
      missingOperationRisk: number;
    };
    readinessSummary: {
      known: number;
      executable: number;
      blocked: number;
      missingCredential: number;
      unknownComponent: number;
      unknownRegion: number;
    };
  };
  capabilities: CreatorAgentCapability[];
}

export type CreatorAgentModelKind = 'llm' | 'image' | 'video' | 'audio';
export interface CreatorAgentRuntimeReadiness {
  known: boolean;
  installed: boolean | null;
  credentialReady: boolean | null;
  regionReady: boolean | null;
  executable: boolean;
  available: boolean;
  requiresRuntimeCheck: boolean;
  blockers: Array<{ code: string; message: string }>;
}

export interface CreatorAgentCatalogModel {
  id: string;
  kind: CreatorAgentModelKind;
  provider: string;
  platformLabel?: string;
  model: string;
  label?: string;
  family?: string;
  available?: boolean;
  configured?: boolean;
  readiness?: CreatorAgentRuntimeReadiness;
  source?: string;
  parameters?: Record<string, unknown>;
}

export interface CreatorAgentCatalogAction {
  id: string;
  kind: string;
  provider: string;
  platformLabel: string;
  action: string;
  label: string;
  family: string;
  resultKind: string;
  parameters?: Record<string, unknown>;
  available?: boolean;
  readiness?: CreatorAgentRuntimeReadiness;
}

export interface CreatorAgentRuntimeCatalog {
  schema: 't8-creator-agent-runtime-catalog-v1';
  sourceDigest: string;
  generatedFrom: string[];
  platforms: Array<{ id: string; label: string; description: string }>;
  models: CreatorAgentCatalogModel[];
  actions: CreatorAgentCatalogAction[];
  counts: {
    models: number;
    actions: number;
    executableModels: number;
    blockedModels: number;
    executableActions: number;
    blockedActions: number;
  };
  warning: string;
}

export type CreatorAgentMessageRequestStatus = 'in-progress' | 'completed' | 'failed' | 'stopped';

export type CreatorAgentModelPreferences = Partial<Record<
  CreatorAgentModelKind,
  { provider: string; model: string }
>>;

export type CreatorAgentAttachmentKind = 'image' | 'video' | 'audio' | 'text' | 'file';

export interface CreatorAgentAttachment {
  id: string;
  assetId?: string;
  kind: CreatorAgentAttachmentKind;
  name: string;
  ref: string;
  mimeType?: string;
  size?: number;
  contentHash?: string;
  contentRevision?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface CreatorAgentCanvasObject {
  nodeId: string;
  nodeType: string;
  label: string;
  status: string;
  selected: boolean;
  inViewport: boolean;
  mediaKinds: Array<'image' | 'video' | 'audio' | 'text' | 'model3d'>;
  resultCount: number;
  accepted: boolean;
  lockKeys: string[];
  upstreamCount: number;
  downstreamCount: number;
}

export interface CreatorAgentAssetLineageSummary {
  assetId: string;
  kind: 'image' | 'video' | 'audio' | 'text' | 'model3d' | 'other';
  label: string;
  eventCount: number;
  relations: string[];
  parentAssetIds: string[];
  sourceNodeIds: string[];
  runIds: string[];
  nodeRunIds: string[];
  derivedOperations: string[];
  truncated: boolean;
}

export interface CreatorAgentContext {
  nodeCount: number;
  edgeCount: number;
  nodeTypeCounts?: Record<string, number>;
  selectedNodeIds: string[];
  selectedNodeTypes: string[];
  referencedNodeIds?: string[];
  referencedNodeTypes?: string[];
  canvasTitle?: string;
  canvasRevision?: number | null;
  phase?: string;
  viewport?: { x: number; y: number; zoom: number } | null;
  failedRunCount?: number;
  outputAssetCount?: number;
  canvasObjects?: CreatorAgentCanvasObject[];
  offscreenSummary?: {
    nodeCount: number;
    failedCount: number;
    outputCount: number;
    lockedCount: number;
  };
  recentActions?: Array<{
    eventType: string;
    label: string;
    createdAt: string;
  }>;
  assetLineage?: CreatorAgentAssetLineageSummary[];
  recentRuns?: Array<{
    runId: string;
    status: string;
    nodeRunCount: number;
    failedNodeCount: number;
    outputAssetCount: number;
  }>;
}

export interface CreatorAgentSuggestion {
  id: string;
  label: string;
  description?: string;
  intent: string;
  arguments: Record<string, unknown>;
  expectedEffect: string;
  riskLevel: string;
  requiredCapabilityIds: string[];
  disabledReason: string;
  executable: boolean;
  operationContracts: CreatorAgentSuggestionOperationContract[];
  blockers: Array<{ code: string; message: string }>;
  unblockActions: string[];
}

export interface CreatorAgentDecisionOption {
  id: string;
  label: string;
  description: string;
  value: string;
  creatorPrompt: string;
  action: 'answer' | 'confirm-stage' | 'revise-stage';
}

export interface CreatorAgentDecision {
  id: string;
  kind: 'choice' | 'stage-confirmation';
  topic: string;
  question: string;
  whyItMatters: string;
  options: [CreatorAgentDecisionOption, CreatorAgentDecisionOption, CreatorAgentDecisionOption];
  status: 'pending' | 'resolved';
  answer: {
    source: 'option' | 'custom';
    optionId: string | null;
    value: string;
  } | null;
}

export interface CreatorAgentDecisionDocument {
  schema: 't8-creator-decision-document-v1';
  documentId: string;
  versionId: string;
  contentDigest: string;
  sessionId: string;
  family: 'story' | 'commerce' | 'image' | 'video' | 'audio' | 'mixed';
  phase: CreatorAgentProductionPhase;
  revision: number;
  status: 'collecting' | 'ready-for-confirmation' | 'confirmed';
  currentDecisionId: string | null;
  decisions: CreatorAgentDecision[];
  revisionNotes: string[];
}

export interface CreatorAgentSuggestionOperationContract {
  capabilityId: string;
  operation: string;
  riskLevel: 'L0';
  approvalRequired: false;
  boundary: string;
  requiredScopes: string[];
}

export interface CreatorAgentModelInputCompatibility {
  status: 'compatible' | 'incompatible' | 'unverified';
  confidence: number;
  reasons: string[];
  limitations: string[];
  request: {
    creativeKind: string;
    recipe: string;
    attachmentKinds: string[];
    attachmentEvidenceDigest: string;
    ratio: string;
    duration: number;
  };
}


export interface CreatorAgentModelDecisionReceipt {
  schema: 't8-model-decision-receipt-v1';
  mode: 'smart' | 'fixed' | 'mixed';
  generatedAt: string;
  providerCalls: 0;
  canvasWrites: 0;
  catalogDigest: string;
  requestDigest: string;
  attachmentEvidenceDigest: string;
  receiptDigest: string;
  ready: boolean;
  decisions: Array<{
    kind: CreatorAgentModelKind;
    kindLabel: string;
    required: boolean;
    mode: 'smart' | 'fixed';
    status: 'ready' | 'blocked';
    selected: {
      id: string;
      provider: string;
      platformLabel: string;
      model: string;
      label: string;
      family: string;
      executable: boolean;
      blockers: Array<{ code: string; message: string }>;
      limitations: string[];
      compatibility: CreatorAgentModelInputCompatibility;
    } | null;
    reasons: string[];
    blockers: Array<{ code: string; message: string }>;
    alternatives: Array<{
      id: string;
      provider: string;
      platformLabel: string;
      model: string;
      label: string;
      family: string;
      executable: boolean;
      blockers: Array<{ code: string; message: string }>;
      limitations: string[];
      compatibility: CreatorAgentModelInputCompatibility;
    }>;
    inputCompatibility: CreatorAgentModelInputCompatibility;
    estimates: {
      cost: { status: 'unknown'; message: string };
      latency: { status: 'unknown'; message: string };
    };
  }>;
  approvalBoundary: {
    providerSelections: Array<{
      kind: string;
      mode: string;
      status: string;
      provider: string;
      model: string;
    }>;
    costTier: { status: 'unknown'; message: string };
    privacyBoundary: { status: 'unknown'; message: string };
  };
  fallbackPolicy: {
    silentProviderFallback: false;
    silentCostTierFallback: false;
    silentPrivacyBoundaryFallback: false;
    providerChangeRequiresApproval: true;
    message: string;
  };
}

export interface CreatorAgentSuggestionInvariantReceipt {
  schema: 't8-creator-suggestion-invariant-receipt-v1';
  suggestionSetCount: 1;
  itemCount: 3;
  uniqueIdCount: 3;
  uniqueIntentCount: 3;
  capabilityIdCount: number;
  invalidCapabilityIds: string[];
  invalidContractCount: 0;
  fakeEnabledActionCount: 0;
  unexplainedDisabledActionCount: 0;
  setDigest: string;
}

export interface CreatorAgentSuggestionSet {
  schema: 't8-creator-suggestion-set-v1';
  deterministic: true;
  providerCalls: 0;
  setDigest: string;
  binding: {
    schema: 't8-creator-suggestion-binding-v1';
    canvasRevision: number | null;
    contextDigest: string;
    assetVersion: string;
    planDigest: string | null;
    responseDigest?: string;
    artifactDigest?: string;
    artifactId?: string;
    artifactVersionId?: string;
    workId?: string;
    workRevision?: number;
    workDigest?: string;
    decisionDocumentId?: string;
    decisionDocumentVersionId?: string;
    decisionDocumentDigest?: string;
    currentDecisionId?: string | null;
  };
  source?: {
    schema?: string;
    taskFamily?: string;
    responseDigest?: string;
    artifactDigest?: string;
    artifactId?: string;
    artifactVersionId?: string;
    artifactRevision?: number;
    artifactKind?: string;
    evidenceMode?: string;
    primaryFocus?: string;
    headings?: string[];
    documentCount?: number;
  };
  items: CreatorAgentSuggestion[];
  invariantReceipt?: CreatorAgentSuggestionInvariantReceipt;
}

export interface CreatorAgentCreativeArtifactSection {
  id: string;
  title: string;
  level: number;
  bodyMarkdown: string;
}

export interface CreatorAgentCreativeArtifactContent {
  schema: 't8-creator-artifact-content-v1';
  bodyMarkdown: string;
  sections: CreatorAgentCreativeArtifactSection[];
  contentDigest: string;
}

export interface CreatorAgentCreativeArtifactDiffOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  beforeDigest?: string;
  afterDigest?: string;
}

export interface CreatorAgentCreativeArtifactDiff {
  schema: 't8-creator-artifact-diff-v1';
  baseRevision: number;
  baseVersionId: string | null;
  operations: CreatorAgentCreativeArtifactDiffOperation[];
}

export interface CreatorAgentCreativeArtifactVersion {
  schema: 't8-creator-artifact-version-v1';
  artifactId: string;
  versionId: string;
  revision: number;
  taskFamily: 'commerce' | 'image' | 'video' | 'story' | 'audio' | 'mixed';
  kind: string;
  title: string;
  status: 'model-draft' | 'offline-draft';
  content: CreatorAgentCreativeArtifactContent;
  source: {
    responseId: string;
    responseDigest: string;
    responseBodyDigest: string;
    responseEvidenceDigest?: string;
    planDigest: string | null;
    proposalDigest: string;
  };
  diff: CreatorAgentCreativeArtifactDiff;
  createdAt: string;
  versionDigest: string;
}

export interface CreatorAgentCreativeArtifactSummary {
  artifactId: string;
  versionId: string;
  revision: number;
  taskFamily: CreatorAgentCreativeArtifactVersion['taskFamily'];
  kind: string;
  title: string;
  status: CreatorAgentCreativeArtifactVersion['status'];
  contentDigest: string;
  updatedAt: string;
}

export interface CreatorAgentArtifactCompilation {
  schema: 't8-creator-artifact-compilation-v1';
  status: 'created' | 'reused' | 'failed';
  code: string;
  message: string;
  proposalDigest?: string;
  artifactVersion: CreatorAgentCreativeArtifactVersion | null;
}
export interface CreatorAgentQuestion {
  id: string;
  question: string;
  reason: string;
}

export interface CreatorAgentProductionDocumentDiff {
  schema: 't8-creator-production-document-diff-v1';
  baseRevision: number;
  baseVersionId: string;
  changedFields: Array<{
    field: string;
    label: string;
    change: 'added' | 'removed' | 'changed';
    before: string;
    after: string;
  }>;
}

export interface CreatorAgentProductionDocument {
  schema: 't8-creator-production-document-v1';
  id: string;
  kind:
    | 'production-brief'
    | 'reference-breakdown'
    | 'script-doc'
    | 'world-bible'
    | 'character-bible'
    | 'asset-needs'
    | 'shot-list'
    | 'audio-plan'
    | 'storyboard'
    | 'prompt-pack'
    | 'candidate-review'
    | 'edit-decision-list'
    | 'qc-report'
    | 'delivery-manifest';
  label: string;
  revision: number;
  versionId: string;
  status: 'draft' | 'confirmed';
  contentDigest: string;
  content: {
    status?: string;
    goal?: string;
    audience?: string;
    format?: string;
    ratio?: string;
    durationSec?: number;
    style?: string;
    language?: string;
    sourceText?: string;
    sourceBinding?: {
      assetId: string;
      kind: 'video';
      contentRevision: number;
      contentHash: string | null;
      filename: string;
      mimeType: string;
      byteSize: number;
      mediaUrl: string;
    } | null;
    requestedScopes?: string[];
    evidenceRequirements?: string[];
    generationPolicy?: {
      providerCallsNow: 0;
      mediaGenerationCalls: 0;
      autoRun: false;
    };
    summary?: {
      totalDuration?: string;
      shotCount?: number;
      averageShotDuration?: string;
      editingDensity?: string;
      rhythmPattern?: string;
      cameraLanguage?: string;
      soundStructure?: string;
      transcriptEvidence?: string;
      transcriptAttribution?: 'provider-segments' | 'untimed' | '';
    } | null;
    limitations?: string[];
    resultEvidence?: {
      schema: 't8-reference-video-breakdown-evidence-v1';
      sourceNodeId: string;
      requestId: string;
      canvasRevision: number;
      runBindingStatus: 'awaiting-run-evidence' | 'pending' | 'verified' | 'failed' | 'invalid-run-evidence';
      runId: string;
      nodeRunId: string;
      attemptId: string;
      runStatus: string;
      nodeRunStatus: string;
      attemptStatus: string;
      runCanvasRevision: number;
      runEvidenceReason: string;
      outputDigest: string;
      resultStatus: string;
    } | null;
    analysisError?: string;
    structureStatus?: string;
    outline?: unknown[];
    characters?: Array<{
      id?: string;
      name: string;
      sourceLine?: number;
      sourceEvidence?: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      appearance?: string;
      wardrobe?: string;
      personality?: string;
      continuityNotes?: string[];
      unresolved?: string[];
    }>;
    scenes?: Array<{
      id: string;
      ordinal: number;
      title: string;
      sourceRange: { lineStart: number; lineEnd: number };
      shotIds: string[];
    }>;
    shots?: Array<{
      id: string;
      ordinal: number;
      marker: string;
      title: string;
      sceneId: string | null;
      sourceRange: { lineStart: number; lineEnd: number };
      sourceText: string;
      sourceTextTruncated: boolean;
      sourceShotId?: string;
      sceneTitle?: string;
      sourceEvidence?: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      description?: string;
      durationSec?: number | null;
      startTimecode?: string;
      endTimecode?: string;
      shotSize?: string;
      cameraMovement?: string;
      composition?: string;
      action?: string;
      dialogue?: string;
      narration?: string;
      music?: string;
      ambience?: string;
      sfx?: string;
      soundDesign?: string;
      editablePrompt?: string;
      confidence?: number | string;
      evidence?: string[];
      relatedAssetNeedIds?: string[];
      status?: 'source-proposed';
      unresolved?: string[];
    }>;
    scriptAnalysis?: {
      schema: 't8-creator-script-analysis-v1';
      status: 'source-structured' | 'needs-structure';
      method: 'deterministic-source-map';
      sourceBacked: true;
      sourceDigest: string;
      providerCalls: 0;
      inferredFacts: 0;
      counts: {
        scenes: number;
        shots: number;
        characters: number;
      };
      unresolved: string[];
    };
    derivation?: {
      schema: 't8-creator-source-derivation-v1' | 't8-creator-evidence-derivation-v1';
      method: 'deterministic-source-map' | 'persisted-candidate-evidence' | 'verified-adopted-video-sequence' | 'persisted-artifact-qc-evidence' | 'verified-local-delivery-package-evidence';
      sourceBacked?: true;
      sourceDocumentId: string;
      sourceVersionId: string;
      sourceContentDigest: string;
      sourceDigest?: string;
      providerCalls?: 0;
      inferredFacts?: 0;
      canvasRevision?: number;
      evidenceDigest?: string;
      documentProviderCalls?: 0;
      documentDeliveryWrites?: 0;
      documentCanvasWrites?: 0;
    };
    counts?: {
      total?: number;
      characters?: number;
      locations?: number;
      scenes?: number;
      shots?: number;
      ready?: number;
      missing?: number;
      drafts?: number;
      reviewed?: number;
      withResult?: number;
      adopted?: number;
      blocked?: number;
      dialogue?: number;
      voiceover?: number;
      music?: number;
      ambience?: number;
      sfx?: number;
      candidates?: number;
      missingDuration?: number;
      missingShots?: number;
      pass?: number;
      fail?: number;
      unknown?: number;
      included?: number;
      awaiting?: number;
      packageFiles?: number;
      licenseKnown?: number;
      licenseUnknown?: number;
      checks?: number;
    };
    needs?: Array<{
      id: string;
      kind: 'character' | 'location';
      label: string;
      status: 'missing';
      sourceEvidence: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      requirements: string[];
      acceptedAssetId: string | null;
      locked: boolean;
    }>;
    items?: Array<{
      id: string;
      shotListItemId: string;
      sourceShotId: string;
      ordinal: number;
      shotOrdinal: number;
      title: string;
      sceneTitle: string;
      role: 'dialogue' | 'voiceover' | 'music' | 'ambience' | 'sfx';
      cueText: string;
      sourceEvidence: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      trackStatus: 'source-draft';
      promptSource: 'script-evidence';
      speaker: string | null;
      voice: string | null;
      timing: {
        startSec: number | null;
        endSec: number | null;
        durationSec: number | null;
      };
      loudness: number | null;
      referenceAssetIds: string[];
      provider: string | null;
      model: string | null;
      generationStatus: 'not-requested';
      resultUrls: string[];
      locked: boolean;
      unresolved: string[];
    }>;
    mix?: {
      schema: 't8-creator-audio-mix-plan-v1';
      strategy: 'per-shot-layered';
      roles: Array<'dialogue' | 'voiceover' | 'music' | 'ambience' | 'sfx'>;
      timingStatus: 'unassigned';
      loudnessStatus: 'unassigned';
      duckingStatus: 'unassigned';
      fadesStatus: 'unassigned';
      requiresCreatorReview: true;
    };
    prompts?: Array<{
      id: string;
      storyboardFrameId: string;
      shotListItemId: string;
      sourceShotId: string;
      ordinal: number;
      title: string;
      sceneTitle: string;
      sourceEvidence: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      promptStatus: 'source-draft';
      promptSource: 'script-evidence';
      positivePrompt: string;
      negativePrompt: string;
      motionPrompt: string;
      audioPrompt: string;
      referenceAssetIds: string[];
      modelSelection: {
        image: string | null;
        video: string | null;
        audio: string | null;
      };
      creatorReviewed: boolean;
      locked: boolean;
      unresolved: string[];
    }>;
    promptBindings?: Array<{
      promptPackItemId: string;
      storyboardFrameId: string;
      ordinal: number;
      title: string;
      candidateIds: string[];
      selectedCandidateId: string | null;
      reviewStatus: 'missing' | 'pending' | 'reviewed';
      adoptionStatus: 'not-adopted' | 'adopted';
    }>;
    candidates?: Array<{
      id: string;
      promptPackItemId: string;
      storyboardFrameId: string;
      shotListItemId: string;
      sourceShotId: string;
      nodeId: string;
      nodeType: string;
      groupId: string;
      candidateId: string;
      candidateIndex: number;
      candidateLabel: string;
      status: string;
      provider: string;
      model: string;
      resultKind: 'image' | 'video' | 'audio' | 'text' | null;
      resultUrls: string[];
      resultEvidence: {
        url: string | null;
        assetId: string | null;
        contentHash: string | null;
      };
      executionEvidence: {
        runId: string | null;
        nodeRunId: string | null;
        attemptId: string | null;
        taskId: string | null;
      };
      review: {
        status: 'pending' | 'verified';
        reason?: string;
        reviewer?: string;
        reviewedAt?: string | null;
        hardGateFailures?: string[];
        hardGatesPassed?: boolean;
      };
      adoption: {
        status: 'not-adopted' | 'adopted' | 'unverified-legacy';
        receiptVerified: boolean;
        acceptedAt: string | null;
        locks: Record<string, boolean>;
      };
    }>;
    sequence?: Array<{
      id: string;
      candidateEvidenceId: string;
      promptPackItemId: string;
      storyboardFrameId: string;
      shotListItemId: string;
      sourceShotId: string;
      ordinal: number;
      title: string;
      candidateId: string;
      nodeId: string;
      resultEvidence: {
        assetId: string | null;
        contentHash: string | null;
        referenceAvailable: true;
      };
      sourceDurationSec: number | null;
      requestedDurationSec: number | null;
      durationEvidence: 'persisted-result-metadata' | 'missing';
      sourceInSec: number | null;
      sourceOutSec: number | null;
      timelineStartSec: number | null;
      timelineEndSec: number | null;
      placementPolicy: 'source-order-full-clip-draft';
      transition: {
        type: 'cut';
        durationSec: 0;
        source: 'default-draft';
      };
      audioPolicy: null;
      editStatus: 'ready-for-review' | 'duration-missing';
      locked: boolean;
      unresolved: string[];
    }>;
    qcItems?: Array<{
      id: string;
      editDecisionItemId: string;
      ordinal: number;
      title: string;
      candidateId: string;
      nodeId: string;
      assetId: string | null;
      contentHash: string | null;
      status: 'pass' | 'fail' | 'unknown';
      counts: {
        total: number;
        pass: number;
        fail: number;
        unknown: number;
      };
      verificationEvidence: {
        schema: string;
        runId: string;
        verificationDigest: string;
        verifiedAt: string;
        receiptVerified: boolean;
      } | null;
      checks: Array<{
        id: string;
        label: string;
        status: 'pass' | 'fail' | 'unknown';
        detail: string;
      }>;
    }>;
    deliverables?: Array<{
      id: string;
      qcItemId: string;
      editDecisionItemId: string;
      ordinal: number;
      title: string;
      assetId: string | null;
      contentHash: string | null;
      qcStatus: 'pass' | 'fail' | 'unknown';
      status: 'blocked-by-qc' | 'awaiting-current-delivery' | 'included-and-verified';
    }>;
    packageEvidence?: {
      schema: 't8-creator-delivery-evidence-v1';
      approvalRequestId: string;
      planId: string;
      packageName: string;
      packageDigest: string;
      selectionDigest: string;
      scope: 'project' | 'canvas';
      canvasRevision: number;
      catalogRevision: number | null;
      itemCount: number;
      totalBytes: number;
      verifiedItems: number;
      verifiedBytes: number;
      valid: true;
      licenseSummary: { known: number; unknown: number };
      recordedAt: string;
      exactQcAssetsIncluded: true;
    } | null;
    timeline?: {
      schema: 't8-creator-edl-v1';
      sequencePolicy: 'prompt-order';
      placementPolicy: 'source-order-full-clip-draft';
      timingStatus: 'empty' | 'ready' | 'incomplete';
      totalDurationSec: number | null;
      transitionPolicy: 'default-cut-draft';
      audioPolicy: 'unassigned';
      subtitlePolicy: 'unassigned';
      requiresCreatorReview: true;
    };
    frames?: Array<{
      id: string;
      shotListItemId: string;
      sourceShotId: string;
      ordinal: number;
      title: string;
      sceneTitle: string;
      sourceEvidence: {
        lineStart: number;
        lineEnd: number;
        sourceText: string;
        sourceTextTruncated: boolean;
      };
      frameStatus: 'missing';
      candidateIds: string[];
      selectedCandidateId: string | null;
      assetId: string | null;
      acceptedAt: string | null;
      locked: boolean;
      prompt: string;
      composition: string;
      continuityNotes: string[];
      unresolved: string[];
    }>;
    adoptionPolicy?: 'explicit-only' | 'explicit-action-only';
    reviewPolicy?: 'explicit-confirmation' | 'actual-media-required' | 'verified-adopted-video-only';
    generationScope?: 'none';
    verificationPolicy?: 'persisted-receipts-only';
    visualStyle?: string;
    deliveryPolicy?: 'completed-verified-package-receipts-only';
    releaseReadiness?: 'ready' | 'needs-license-review' | 'blocked';
    ignoredReceiptCount?: number;
    locations?: unknown[];
    worldRules?: unknown[];
    missingSections?: string[];
    continuityLocks?: string[];
    editingGuidance?: string;
  };
  editableFields: string[];
  editableByNaturalLanguage: boolean;
  requiresCreatorConfirmation: true;
  sourcePlanId: string;
  supersedesRevision?: number;
  changeSummary?: CreatorAgentProductionDocumentDiff;
}

export interface CreatorAgentProductionDocumentConfirmation {
  schema: 't8-creator-production-document-confirmation-v1';
  confirmationId: string;
  documentId: string;
  kind: CreatorAgentProductionDocument['kind'];
  revision: number;
  versionId: string;
  contentDigest: string;
  sourcePlanId: string;
  sourcePlanDigest: string;
  actor: string;
  confirmedAt: string;
  confirmationDigest: string;
}

export interface CreatorAgentLocalReadinessReceipt {
  schema: 't8-creator-agent-local-readiness-receipt-v1';
  measurement: 'server-monotonic-local-planner';
  localPlanMs: number;
  targetMs: 2000;
  withinTarget: boolean;
  sideEffects: {
    providerCalls: 0;
    canvasWrites: 0;
    productionFileWrites: 0;
  };
}

export interface CreatorAgentPlan {
  schema: string;
  planId: string;
  planDigest: string;
  projectId: string;
  canvasId: string;
  canvasRevision: number;
  action: string;
  kind: string;
  profile: string;
  profileLabel: string;
  brief: {
    goal?: string;
    title?: string;
    audience?: string;
    format?: string;
    ratio?: string;
    durationSec?: number;
    style?: string;
    language?: string;
    summary?: string;
  };
  productionDocuments?: CreatorAgentProductionDocument[];
  questions: CreatorAgentQuestion[];
    models?: Partial<Record<CreatorAgentModelKind, { provider: string; model: string }>>;
  ready: boolean;
  candidateCount: number;
  strategy: {
    previewFirst?: boolean;
    preserveAcceptedVersions?: boolean;
    generateScope?: string;
    autoRunGeneration?: boolean;
  };
  impact: {
    writesNow?: number;
    providerCallsNow?: number;
    fileWritesNow?: number;
    patchOperationCount?: number;
  };
  visibleAssumptions?: {
    durationSec?: number;
    ratio?: string;
    audience?: string;
    style?: string;
    language?: string;
    editableByNaturalLanguage?: boolean;
    models?: Partial<Record<CreatorAgentModelKind, { provider: string; model: string }>>;
  };
  modelDecisionReceipt?: CreatorAgentModelDecisionReceipt | null;
  analysis?: {
    sceneCount?: number;
    shotCount?: number;
    assetCount?: number;
    audioItemCount?: number;
    stage?: string;
    generationStarted?: boolean;
    analysisRunStarted?: boolean;
    status?: string;
    evidenceNodeId?: string;
    evidenceDigest?: string;
    runBindingStatus?: 'awaiting-run-evidence' | 'pending' | 'verified' | 'failed' | 'invalid-run-evidence' | '';
    runId?: string;
    nodeRunId?: string;
    attemptId?: string;
    runStatus?: string;
    nodeRunStatus?: string;
    attemptStatus?: string;
    runEvidenceReason?: string;
    error?: string;
  } | null;
  patchId?: string | null;
  targets?: {
    primaryNodeId?: string;
    storyNodeId?: string;
    proposedNodes?: Array<{ id: string; type: string }>;
  };
  assetPlacement?: {
    asset: {
      id: string;
      filename: string;
      kind: string;
      contentHash: string;
      contentRevision: number;
    };
    nodeId: string;
    nodeType: string;
    position: { x: number; y: number };
    targetNodeId: string | null;
    sourceHandle: string | null;
    targetHandle: string | null;
    edgeId?: string | null;
    lineage: {
      assetId: string;
      kind: string;
      contentHash: string;
      contentRevision: number;
    };
  };
  delivery?: {
    status: 'needs-target' | 'ready';
    packageName?: string;
    destination?: string;
    scope: 'canvas' | 'project';
    itemCount: number;
    totalBytes: number;
    selectionDigest?: string;
    licenseSummary: { known: number; unknown: number };
    assets: Array<{
      assetId: string;
      kind: string;
      filename: string;
      size: number;
      sha256: string;
      renditionRole: string;
      licenseStatus: string;
    }>;
    warnings: string[];
  };
  createdAt: string;
  expiresAt: string;
}

export interface CreatorAgentCandidateReview {
  schema: 't8-creative-review-summary-v1';
  status: 'pending' | 'verified';
  source: string | null;
  reviewer?: string;
  reviewedAt?: string | null;
  reason?: string;
  requiredDimensions: string[];
  reviewedDimensions: string[];
  missingDimensions?: string[];
  hardGateFailures: string[];
  hardGatesPassed?: boolean;
  notes?: string;
}

export interface CreatorAgentCandidate {
  nodeId: string;
  nodeType: string;
  candidateId: string;
  candidateIndex: number;
  candidateLabel: string;
  accepted: boolean;
  locks: Record<string, boolean>;
  model: string;
  provider: string;
  creativeDirection: string;
  promptSummary: string;
  status: string;
  hasResult: boolean;
  resultKind: 'image' | 'video' | 'audio' | 'text' | null;
  resultText: string;
  resultUrls: string[];
  reviewEvidence: {
    url: string | null;
    assetId: string | null;
    contentHash: string | null;
  };
  media: {
    kind: 'image' | 'video' | 'audio';
    urls: string[];
    assetId: string | null;
    contentHash: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
    mime: string | null;
    ratio: string | null;
    resolution: string | null;
    quality: string | null;
  } | null;
  qa: {
    ready: boolean;
    creativeReady: boolean;
    warnings: string[];
    accepted: boolean;
    continuityLocked: boolean;
  };
  review: CreatorAgentCandidateReview;
  versionCount: number;
  activeBranchId: string;
}

export interface CreatorAgentCandidateComparison {
  schema: 't8-creative-comparison-v2';
  groupId: string;
  canvasRevision: number;
  candidates: CreatorAgentCandidate[];
  contactSheet: {
    schema: 't8-creative-contact-sheet-v1';
    items: Array<{
      nodeId: string;
      label: string;
      direction: string;
      media: CreatorAgentCandidate['media'];
      qa: CreatorAgentCandidate['qa'];
      review: CreatorAgentCandidateReview;
    }>;
  };
  acceptedNodeId: string | null;
  reviewCoverage: {
    verified: number;
    totalWithResult: number;
    hardGateFailures: string[];
  };
  requiresVisualReview: boolean;
  guidance: string[];
}

export interface CreatorAgentToolProposal {
  schema: 't8-creator-tool-proposal-v1';
  proposalId: string;
  proposalDigest: string;
  binding: {
    sessionId: string;
    projectId: string;
    canvasId: string;
    responseId: string;
    responseDigest: string;
    planId: string | null;
    planDigest: string | null;
    artifactId: string | null;
    artifactVersionId: string | null;
    artifactDigest: string | null;
    workId: string | null;
    workRevision: number | null;
    workDigest: string | null;
    canvasRevision: number | null;
  };
  tool: {
    protocol: 't8-versioned-creative-tool-v1';
    requestSchema: string;
    name: string;
    version: string;
    capabilityId: string;
    creatorLabel?: string;
    operation: string;
    requestAction: string;
    capabilityManifestDigest: string;
    capabilityGraphDigest: string;
  };
  request: {
    schema: string;
    tool: string;
    version: string;
    operation: string;
    projectId: string;
    canvasId: string;
    clientRequestId: string | null;
    input: Record<string, unknown>;
  };
  gate: {
    riskLevel: string;
    approvalRequired: boolean;
    requiredScopes: string[];
    directOperation: boolean;
    previewRequired: boolean;
    dispatchAllowed: false;
    status: 'proposed';
  };
  execution: {
    status: 'not-started';
    canvasWrites: 0;
    providerCalls: 0;
    fileWrites: 0;
  };
  createdAt: string;
}

export type CreatorAgentWorkQualityMode = 'quick' | 'standard' | 'quality';

export interface CreatorAgentWorkArtifactDiffOperation {
  op: 'add' | 'replace' | 'remove' | 'lock' | 'unlock';
  path: string;
  beforeDigest?: string;
  afterDigest?: string;
}

export interface CreatorAgentWorkArtifactVersion {
  schema: 't8-creator-work-artifact-version-v1';
  artifactId: string;
  versionId: string;
  revision: number;
  kind: string;
  title: string;
  status: 'model-draft' | 'creator-edited' | 'accepted' | 'rejected';
  fields: Record<string, unknown>;
  fieldLocks: string[];
  dependencies: Array<{
    artifactId: string;
    versionId: string;
    versionDigest: string;
    kind: string;
  }>;
  invalidates: string[];
  source: {
    responseId: string | null;
    logicalRequestId: string | null;
    llmTurnReceiptDigest: string | null;
    proposalDigest: string | null;
    editor: string | null;
  };
  diff: {
    schema: 't8-creator-work-artifact-diff-v1';
    baseVersionId: string | null;
    operations: CreatorAgentWorkArtifactDiffOperation[];
  };
  createdAt: string;
  versionDigest: string;
}

export interface CreatorAgentWorkArtifactSummary {
  artifactId: string;
  versionId: string;
  revision: number;
  kind: string;
  title: string;
  status: CreatorAgentWorkArtifactVersion['status'];
  fieldCount: number;
  lockedFieldCount: number;
  versionDigest: string;
  updatedAt: string;
}

export interface CreatorAgentWorkSnapshot {
  schema: 't8-creator-work-snapshot-v1';
  workId: string;
  revision: number;
  taskProfile: {
    family: 'commerce' | 'image' | 'video' | 'story' | 'audio' | 'mixed';
    intent: string;
    deliveryKind: string;
    modalities: string[];
    targetPlatform: string | null;
    qualityMode: CreatorAgentWorkQualityMode;
  };
  artifactVersionIds: string[];
  changedArtifactIds: string[];
  invalidatedKinds: string[];
  updatedAt: string;
  workDigest: string;
}

export interface CreatorAgentLlmTurnReceipt {
  schema: 't8-creator-llm-turn-receipt-v1';
  sessionId: string;
  responseId: string;
  logicalRequestId: string;
  phase?: 'invocation' | 'compiled';
  status: string;
  qualityMode: CreatorAgentWorkQualityMode;
  providerCalls: number;
  provider: string | null;
  model: string | null;
  modelDecisionDigest: string | null;
  promptContractDigest: string | null;
  mediaObservationDigest: string | null;
  calls: Array<{
    index: number;
    role: string;
    status: string;
    provider: string | null;
    model: string | null;
    requestId: string | null;
    finishReason: string | null;
  }>;
  workProposalDigest: string | null;
  invocationReceiptDigest?: string | null;
  inputBindings?: Array<{
    assetId: string | null;
    contentRevision: number;
    contentHash: string | null;
    kind: string;
    mimeType: string | null;
    observationDigest: string | null;
  }>;
  artifactBindings?: Array<{
    artifactId: string;
    kind: string;
    baseVersionId: string | null;
    newVersionId: string;
    diffDigest: string;
  }>;
  workSnapshotDigest?: string | null;
  createdAt: string;
  receiptDigest: string;
}

export type CreatorAgentToolProposalReceipt = {
  schema: 't8-creator-tool-proposal-receipt-v1';
  status: 'accepted';
  index: number;
  proposalId: string;
  proposalDigest: string;
  duplicate: boolean;
  gate: CreatorAgentToolProposal['gate'];
  sideEffects: {
    canvasWrites: 0;
    providerCalls: 0;
    fileWrites: 0;
  };
} | {
  schema: 't8-creator-tool-proposal-receipt-v1';
  status: 'rejected';
  index: number;
  code: string;
  message: string;
  sideEffects: {
    canvasWrites: 0;
    providerCalls: 0;
    fileWrites: 0;
  };
};
export interface CreatorAgentEvent {
  schema: 't8-creator-agent-event-v1';
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  payload: {
    text?: string;
    attachments?: CreatorAgentAttachment[];
    plan?: CreatorAgentPlan | null;
    suggestions?: string[];
    requiresExplicitApply?: boolean;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface CreatorAgentRunLink {
  schema: 't8-creator-run-link-v1';
  planId: string;
  planDigest: string;
  patchId: string;
  runId: string;
  runIntentId: string;
  matchedNodeIds: string[];
  linkedAt: string;
}

export interface CreatorAgentArtifactVerification {
  schema: 't8-creator-artifact-verification-v1';
  runId: string;
  verified: boolean;
  reasons: string[];
  run: {
    runId: string;
    status: string;
    canvasRevision: number | null;
    createdAt: number | null;
    finishedAt: number | null;
  } | null;
  nodeRuns: Array<{
    nodeRunId: string;
    nodeId: string;
    status: string;
    latestAttemptId: string | null;
    latestAttemptStatus: string | null;
    outputAssetIds: string[];
  }>;
  assets: Array<{
    assetId: string;
    nodeRunId: string;
    kind: string | null;
    mimeType: string | null;
    contentHash: string | null;
    availability: string | null;
    stored: boolean;
    blobPresent: boolean;
    hashVerified: boolean;
    magicVerified: boolean;
    detectedKind: string | null;
    detectedMimeType: string | null;
    observedContentHash: string | null;
    byteSize: number | null;
    decodeEvidence: string;
    associationVerified: boolean;
    expectedNodeId: string | null;
    expectedShotIds: string[];
    observedShotIds: string[];
    expectedCanvasRevision: number | null;
  }>;
  verifiedAt: string;
    width: number | null;
    height: number | null;
    duration: number | null;
  verificationDigest: string;
}

export interface CreatorAgentDeliveryEvidence {
  schema: 't8-creator-delivery-evidence-v1';
  approvalRequestId: string;
  planId: string;
  packageName: string;
  itemCount: number;
  totalBytes: number;
  packageDigest: string;
  verifiedItems: number;
  selectionDigest?: string;
  scope?: 'project' | 'canvas';
  canvasRevision?: number;
  catalogRevision?: number | null;
  files?: Array<{
    assetId: string;
    size: number;
    sha256: string;
  }>;
  verifiedBytes: number;
  valid: boolean;
  licenseSummary: { known: number; unknown: number };
  status: 'pending' | 'completed' | 'denied' | 'failed';
  expiresAt?: string;
  error?: string;
  recordedAt: string;
}

export type CreatorAgentProductionPhase =
  | 'idea'
  | 'script'
  | 'assets'
  | 'shots'
  | 'candidates'
  | 'delivery';

export interface CreatorAgentProductionState {
  schema: 't8-creator-production-state-v1';
  currentPhase: CreatorAgentProductionPhase;
  revision: number;
  visitedPhases: CreatorAgentProductionPhase[];
  completedPhases: CreatorAgentProductionPhase[];
  invalidatedPhases: CreatorAgentProductionPhase[];
  blocked: {
    phase: CreatorAgentProductionPhase;
    message: string;
    at: string | null;
  } | null;
  checkpoint: {
    type: string;
    planId: string | null;
    planDigest: string | null;
    runId: string | null;
    recordedAt: string | null;
  } | null;
  history: Array<{
    revision: number;
    from: CreatorAgentProductionPhase;
    to: CreatorAgentProductionPhase;
    direction: 'advance' | 'revise';
    reason: string;
    completedPhases: CreatorAgentProductionPhase[];
    invalidatedPhases: CreatorAgentProductionPhase[];
    recordedAt: string | null;
  }>;
}

export interface CreatorAgentProductionPhaseTransition {
  advanced: boolean;
  completed?: boolean;
  completedPhase: CreatorAgentProductionPhase;
  nextPhase: CreatorAgentProductionPhase;
  productionRevision: number;
}

export interface CreatorAgentProductionStageResponse {
  eventId: string;
  responseId: string | null;
  responseDigest: string | null;
  productionPhase: CreatorAgentProductionPhase;
  text: string;
  artifactVersion: CreatorAgentCreativeArtifactVersion;
}

export interface CreatorAgentCanvasRetentionPreview {
  schema: 't8-creator-canvas-retention-preview-v1';
  phase: CreatorAgentProductionPhase;
  label: string;
  plan: CreatorAgentPlan;
  patch: CanvasPatch;
  requiresExplicitApply: true;
}

export interface CreatorAgentSession {
  schema: 't8-creator-agent-session-v1';
  id: string;
  projectId: string;
  canvasId: string;
  title: string;
  status: string;
  phase: string;
  context: CreatorAgentContext;
  production?: CreatorAgentProductionState;
  suggestions: string[];
  suggestionSet?: CreatorAgentSuggestionSet;
  events: CreatorAgentEvent[];
  runLinks: CreatorAgentRunLink[];
  runEventCursors?: Record<string, number>;
  artifactVerifications: CreatorAgentArtifactVerification[];
  creativeArtifactVersions?: CreatorAgentCreativeArtifactVersion[];
  creativeArtifacts?: CreatorAgentCreativeArtifactSummary[];
  workArtifactVersions?: CreatorAgentWorkArtifactVersion[];
  workArtifacts?: CreatorAgentWorkArtifactSummary[];
  creatorWork?: CreatorAgentWorkSnapshot | null;
  creatorLlmTurnReceipts?: CreatorAgentLlmTurnReceipt[];
  decisionDocument?: CreatorAgentDecisionDocument | null;
  decisionDocumentVersions?: CreatorAgentDecisionDocument[];
  deliveryEvidence?: CreatorAgentDeliveryEvidence[];
  productionDocumentConfirmations?: CreatorAgentProductionDocumentConfirmation[];
  toolProposals?: CreatorAgentToolProposal[];
  lastSequence: number;
  latestPlan: CreatorAgentPlan | null;
  createdAt: string;
  updatedAt: string;
}

interface CreatorAgentEnvelope<T> {
  schema: 't8-creator-agent-http-v1';
  ok: boolean;
  message?: string;
  code?: string;
  data?: T;
}

async function creatorRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const envelope = await response.json().catch(() => null) as CreatorAgentEnvelope<T> | null;
  if (!response.ok || !envelope?.ok || envelope.data == null) {
    const error = new Error(envelope?.message || `创作 Agent 请求失败（HTTP ${response.status}）`);
    Object.assign(error, { code: envelope?.code || 'CREATOR_AGENT_REQUEST_FAILED', status: response.status });
    throw error;
  }
  return envelope.data;
}

function validateCreatorAgentCapabilitySurfaces(data: CreatorAgentCapabilities) {
  const contract = CREATOR_AGENT_CAPABILITY_SURFACES;
  const actualById = new Map(data.capabilities.map((capability) => [capability.id, capability]));
  const drifted = data.version !== contract.capabilityManifestVersion
    || data.digest !== contract.sourceDigest
    || data.capabilityGraph.aggregateDigest !== contract.capabilityGraphDigest
    || data.capabilities.length !== contract.counts.capabilities
    || contract.capabilities.some((surface) => {
      const actual = actualById.get(surface.id);
      return !actual
        || surface.agentTool.version !== contract.capabilityManifestVersion
        || surface.agentTool.protocol !== 't8-versioned-creative-tool-v1'
        || surface.agentTool.requestSchema !== 't8-versioned-creative-tool-request-v1'
        || surface.agentTool.resultSchema !== 't8-versioned-creative-tool-result-v1'
        || !surface.agentTool.directOperations.includes(surface.agentTool.defaultOperation)
        || actual.handler !== surface.agentTool.handler
        || actual.cli?.command !== surface.cli.command
        || actual.cli?.subcommand !== surface.cli.subcommand
        || actual.uiAction !== surface.ui.action
        || JSON.stringify(actual.operations) !== JSON.stringify(surface.ui.operations);
    });
  if (drifted) {
    const error = new Error('创作能力已更新，但当前界面动作清单尚未同步；为避免执行错功能，本次操作已停止。');
    Object.assign(error, { code: 'CREATOR_CAPABILITY_SURFACE_DRIFT' });
    throw error;
  }
  return data;
}

export async function getCreatorAgentCapabilities() {
  const data = await creatorRequest<CreatorAgentCapabilities>('/capabilities');
  return validateCreatorAgentCapabilitySurfaces(data);
}

export function getCreatorAgentRuntimeCatalog(projectId: string, canvasId: string) {
  const query = new URLSearchParams({ projectId, canvasId });
  return creatorRequest<CreatorAgentRuntimeCatalog>(`/catalog?${query}`);
}

export async function createCreatorAgentSession(input: {
  sessionId?: string;
  projectId: string;
  canvasId: string;
  title?: string;
  context: CreatorAgentContext;
}) {
  const payload = {
    ...input,
    sessionId: input.sessionId || crypto.randomUUID(),
  };
  const request = () => creatorRequest<CreatorAgentSession>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  try {
    return await request();
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    if (Number.isFinite(status) && status < 500) throw error;
    try {
      return await getCreatorAgentSession(
        payload.sessionId,
        payload.projectId,
        payload.canvasId,
      );
    } catch {
      // The create request may have committed before the transport failed.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    try {
      return await request();
    } catch (retryError) {
      try {
        return await getCreatorAgentSession(
          payload.sessionId,
          payload.projectId,
          payload.canvasId,
        );
      } catch {
        throw retryError;
      }
    }
  }
}

export function listCreatorAgentSessions(projectId: string, canvasId: string, limit = 20) {
  const query = new URLSearchParams({
    projectId,
    canvasId,
    limit: String(Math.max(1, Math.min(100, Math.trunc(limit) || 20))),
  });
  return creatorRequest<{
    sessions: CreatorAgentSession[];
    latest: CreatorAgentSession | null;
  }>(`/sessions?${query}`);
}

export function getLatestCreatorAgentSession(projectId: string, canvasId: string) {
  return listCreatorAgentSessions(projectId, canvasId, 1).then((result) => result.latest);
}

export function getCreatorAgentSession(sessionId: string, projectId: string, canvasId: string) {
  const query = new URLSearchParams({ projectId, canvasId });
  return creatorRequest<CreatorAgentSession>(`/sessions/${encodeURIComponent(sessionId)}?${query}`);
}

export function confirmCreatorAgentProductionDocuments(
  sessionId: string,
  input: {
    projectId: string;
    canvasId: string;
    planId: string;
    planDigest: string;
    documents: Array<{
      documentId: string;
      versionId: string;
      contentDigest: string;
    }>;
    suggestion: { id: string; setDigest: string };
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    confirmations: CreatorAgentProductionDocumentConfirmation[];
    duplicate: boolean;
    phaseTransition: CreatorAgentProductionPhaseTransition | null;
    stageResponse: CreatorAgentProductionStageResponse | null;
    canvasRetention: CreatorAgentCanvasRetentionPreview | null;
  }>(`/sessions/${encodeURIComponent(sessionId)}/production-documents/confirm`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function sendCreatorAgentMessage(sessionId: string, input: {
  projectId: string;
  canvasId: string;
  text: string;
  clientRequestId?: string;
  attachments?: CreatorAgentAttachment[];
  context: CreatorAgentContext;
  kind?: string;
  profile?: string;
  qualityMode?: CreatorAgentWorkQualityMode;
  ratio?: string;
  duration?: number;
  candidates?: number;
  stream?: boolean;
  suggestion?: { id: string; setDigest: string };
  stageContinuation?: boolean;
  modelPreferences?: CreatorAgentModelPreferences;
}) {
  /*
  modelPreferences?: CreatorAgentModelPreferences;
  */
  return creatorRequest<{
    session: CreatorAgentSession;
    userEvent: CreatorAgentEvent;
    assistantEvent: CreatorAgentEvent;
    readinessReceipt?: CreatorAgentLocalReadinessReceipt;
    toolProposals?: CreatorAgentToolProposal[];
    toolProposalReceipts?: CreatorAgentToolProposalReceipt[];
    request?: {
      schema: 't8-creator-message-request-v1';
      clientRequestId: string;
      status: CreatorAgentMessageRequestStatus;
      duplicate: boolean;
    };
    stream?: {
      responseId: string;
      chunkCount: number;
      durable: boolean;
      recovering?: boolean;
      stopped?: boolean;
      remoteTasksAffected?: number;
    };
  }>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...input, stream: input.stream !== false }),
  });
}

export function reviseCreatorAgentWorkArtifact(
  sessionId: string,
  artifactId: string,
  input: {
    projectId: string;
    canvasId: string;
    baseVersionId: string;
    action: 'edit' | 'lock' | 'unlock' | 'accept' | 'reject';
    field?: string;
    value?: unknown;
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    artifactVersion: CreatorAgentWorkArtifactVersion;
    event?: CreatorAgentEvent;
    duplicate: boolean;
  }>(`/sessions/${encodeURIComponent(sessionId)}/work-artifacts/${encodeURIComponent(artifactId)}/revise`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function prepareCreatorAgentToolProposal(
  sessionId: string,
  proposalId: string,
  input: {
    projectId: string;
    canvasId: string;
    proposalDigest: string;
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    proposal: CreatorAgentToolProposal;
    event: CreatorAgentEvent;
    plan: CreatorAgentPlan;
    patch: CanvasPatch;
    duplicate: boolean;
    execution: {
      status: 'prepared';
      requestedOperation: string;
      nextBoundary: 'preview' | 'preview-and-approval';
      sideEffects: { canvasWrites: 0; providerCalls: 0; fileWrites: 0 };
    };
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/tool-proposals/${encodeURIComponent(proposalId)}/prepare`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function recoverCreatorAgentMessageRequest(
  sessionId: string,
  clientRequestId: string,
  input: { projectId: string; canvasId: string },
) {
  const query = new URLSearchParams(input);
  return creatorRequest<{
    schema: 't8-creator-message-request-v1';
    clientRequestId: string;
    requestDigest: string;
    status: CreatorAgentMessageRequestStatus;
    responseId: string;
    chunkCount: number;
    session: CreatorAgentSession;
    userEvent: CreatorAgentEvent;
    assistantEvent: CreatorAgentEvent | null;
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(clientRequestId)}?${query}`,
  );
}

export function stopCreatorAgentResponse(
  sessionId: string,
  responseId: string,
  input: { projectId: string; canvasId: string },
) {
  return creatorRequest<{
    schema: 't8-creator-response-stop-v1';
    responseId: string;
    status: Exclude<CreatorAgentMessageRequestStatus, 'in-progress'>;
    duplicate: boolean;
    remoteTasksAffected: 0;
    session: CreatorAgentSession;
    assistantEvent: CreatorAgentEvent;
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/responses/${encodeURIComponent(responseId)}/stop`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function getCreatorAgentPlanPatch(
  sessionId: string,
  planId: string,
  projectId: string,
  canvasId: string,
) {
  const query = new URLSearchParams({ projectId, canvasId });
  return creatorRequest<{
    planId: string;
    planDigest: string;
    patch: CanvasPatch;
    summary: string;
  }>(`/sessions/${encodeURIComponent(sessionId)}/plans/${encodeURIComponent(planId)}/patch?${query}`);
}

export function createCreatorAgentAssetPlacePlan(
  sessionId: string,
  assetId: string,
  input: {
    projectId: string;
    canvasId: string;
    context: CreatorAgentContext;
    position?: { x: number; y: number };
    targetNodeId?: string;
    sourceHandle?: string;
    targetHandle?: string;
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    userEvent: CreatorAgentEvent;
    assistantEvent: CreatorAgentEvent;
    plan: CreatorAgentPlan;
    patch: CanvasPatch;
    placement: NonNullable<CreatorAgentPlan['assetPlacement']>;
    alreadyApplied: {
      patchId: string;
      baseRevision: number;
      appliedRevision: number;
      previewDigest: string;
      affectedNodeIds: string[];
      affectedEdgeIds: string[];
    } | null;
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}/place-plan`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function getCreatorAgentCandidateComparison(
  sessionId: string,
  input: { projectId: string; canvasId: string; nodeId?: string; groupId?: string },
) {
  const query = new URLSearchParams({
    projectId: input.projectId,
    canvasId: input.canvasId,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
  });
  return creatorRequest<CreatorAgentCandidateComparison>(
    `/sessions/${encodeURIComponent(sessionId)}/comparison?${query}`,
  );
}

export function createCreatorAgentIteratePlan(
  sessionId: string,
  input: {
    projectId: string;
    canvasId: string;
    action: 'review' | 'accept' | 'lock' | 'unlock' | 'branch' | 'rollback';
    nodeId: string;
    lock?: string;
    label?: string;
    version?: string;
    review?: {
      schema: 't8-creative-review-v1';
      source: 'visual-inspection';
      reviewer: string;
      evidence: {
        url?: string;
        assetId?: string;
        contentHash?: string;
      };
      dimensions: Record<string, {
        status: 'pass' | 'warn' | 'fail';
        summary: string;
        evidence: string;
      }>;
      notes?: string;
    };
    context: CreatorAgentContext;
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    userEvent: CreatorAgentEvent;
    assistantEvent: CreatorAgentEvent;
  }>(`/sessions/${encodeURIComponent(sessionId)}/iterate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createCreatorAgentDeliveryPlan(
  sessionId: string,
  input: {
    projectId: string;
    canvasId: string;
    parentPath: string;
    packageName?: string;
    scope?: 'canvas' | 'project';
    assetIds?: string[];
    context: CreatorAgentContext;
  },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    userEvent: CreatorAgentEvent;
    assistantEvent: CreatorAgentEvent;
  }>(`/sessions/${encodeURIComponent(sessionId)}/delivery/plan`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface CreatorAgentDeliveryApproval {
  approvalRequestId: string;
  planId: string;
  status: 'pending';
  expiresAt: string;
  preview: {
    summary: string;
    riskLevel: string;
    operationCount: number;
    destination: string;
    package: {
      name: string;
      itemCount: number;
      totalBytes: number;
      selectionDigest: string;
    };
    warnings: string[];
  };
  session: CreatorAgentSession;
}

export function requestCreatorAgentDeliveryApproval(
  sessionId: string,
  planId: string,
  input: { projectId: string; canvasId: string },
) {
  return creatorRequest<CreatorAgentDeliveryApproval>(
    `/sessions/${encodeURIComponent(sessionId)}/delivery/${encodeURIComponent(planId)}/request-approval`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function completeCreatorAgentDeliveryApproval(
  sessionId: string,
  approvalRequestId: string,
  input: { projectId: string; canvasId: string },
) {
  return creatorRequest<{
    status: 'pending' | 'denied' | 'completed';
    approvalRequestId?: string;
    evidence?: CreatorAgentDeliveryEvidence;
    session: CreatorAgentSession;
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/delivery/approvals/${encodeURIComponent(approvalRequestId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function appendCreatorAgentEvent(sessionId: string, input: {
  projectId: string;
  canvasId: string;
  type: 'plan.previewed' | 'plan.applied' | 'plan.reverted' | 'plan.failed' | 'artifact.sent-to-canvas';
  payload?: Record<string, unknown>;
}) {
  return creatorRequest<CreatorAgentSession>(`/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reconcileCreatorAgentRunLinks(
  sessionId: string,
  input: { projectId: string; canvasId: string; runIds: string[] },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    linked: CreatorAgentRunLink[];
  }>(`/sessions/${encodeURIComponent(sessionId)}/run-links/reconcile`, {
    method: 'POST',
    body: JSON.stringify({
      projectId: input.projectId,
      canvasId: input.canvasId,
      runIds: [...new Set(input.runIds.map(String).filter(Boolean))].slice(0, 12),
    }),
  });
}

export function verifyCreatorAgentRunArtifacts(
  sessionId: string,
  runId: string,
  input: { projectId: string; canvasId: string },
) {
  return creatorRequest<{
    session: CreatorAgentSession;
    verification: CreatorAgentArtifactVerification | null;
  }>(
    `/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/verify-artifacts`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function subscribeCreatorAgentEvents(input: {
  sessionId: string;
  projectId: string;
  canvasId: string;
  after: number;
  onEvent: (event: CreatorAgentEvent) => void;
  onCursorReset?: () => void;
  onStreamError?: (message: string) => void;
  onRunSyncError?: (message: string) => void;
  onConnectionState?: (state: 'connecting' | 'open' | 'reconnecting' | 'stopped') => void;
}) {
  input.onConnectionState?.('connecting');
  const query = new URLSearchParams({
    projectId: input.projectId,
    canvasId: input.canvasId,
    after: String(Math.max(0, Math.trunc(input.after || 0))),
  });
  const stream = new EventSource(
    `${BASE}/sessions/${encodeURIComponent(input.sessionId)}/events?${query}`,
  );
  const handleOpen = () => input.onConnectionState?.('open');
  const handleTransportError = () => input.onConnectionState?.(
    stream.readyState === EventSource.CLOSED ? 'stopped' : 'reconnecting',
  );
  const handleEvent = (raw: Event) => {
    const message = raw as MessageEvent<string>;
    try {
      const parsed = JSON.parse(message.data) as CreatorAgentEvent;
      if (parsed?.schema === 't8-creator-agent-event-v1'
        && parsed.sessionId === input.sessionId
        && Number.isInteger(Number(parsed.sequence))) {
        input.onEvent(parsed);
      }
    } catch {
      // EventSource will continue from its last verified cursor.
    }
  };
  const handleReset = () => input.onCursorReset?.();
  const handleStreamError = (raw: Event) => {
    const message = raw as MessageEvent<string>;
    let detail = '创作会话事件连接已停止，请重新打开面板恢复';
    try {
      const parsed = JSON.parse(message.data) as { message?: string };
      if (parsed?.message) detail = String(parsed.message);
    } catch {
      // Keep the stable user-facing fallback.
    }
    input.onStreamError?.(detail);
    stream.close();
    input.onConnectionState?.('stopped');
  };
  const handleRunSyncError = (raw: Event) => {
    const message = raw as MessageEvent<string>;
    let detail = '真实任务进度暂时无法同步；回复与已有创作记录仍然安全';
    try {
      const parsed = JSON.parse(message.data) as { message?: string };
      if (parsed?.message) detail = String(parsed.message);
    } catch {
      // Keep the stable user-facing fallback without closing the reply stream.
    }
    input.onRunSyncError?.(detail);
  };
  stream.addEventListener('open', handleOpen);
  stream.addEventListener('error', handleTransportError);
  stream.addEventListener('creator.event', handleEvent);
  stream.addEventListener('cursor.reset', handleReset);
  stream.addEventListener('stream.error', handleStreamError);
  stream.addEventListener('run.sync.error', handleRunSyncError);
  return () => {
    stream.removeEventListener('open', handleOpen);
    stream.removeEventListener('error', handleTransportError);
    stream.removeEventListener('creator.event', handleEvent);
    stream.removeEventListener('cursor.reset', handleReset);
    stream.removeEventListener('stream.error', handleStreamError);
    stream.removeEventListener('run.sync.error', handleRunSyncError);
    stream.close();
    input.onConnectionState?.('stopped');
  };
}
