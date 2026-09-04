import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import NodeDomLanguageBoundary from '../i18n/NodeDomLanguageBoundary';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  Handle,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Copy, CopyPlus, Trash2, FolderPlus, PackagePlus, Library, Download, Workflow, Send as SendIcon, Sparkles } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useCanvasStore } from '../stores/canvas';
import { useApiKeysStore } from '../stores/apiKeys';
import { useThemeStore } from '../stores/theme';
import { useShortcutStore } from '../stores/shortcuts';
import { trackAchievementEvent, useAchievementStore } from '../stores/achievements';
import { getTemplateMode, resolveThemeTemplate } from '../theme/defaultTemplates';
import { createCanvasNodeExecutionKey, matchesRunCompletion, registerRunNodeExecutionContexts, useRunBusStore, type RunNodeExecutionContext } from '../stores/runBus';
import { useGroupBusStore, GROUP_COLORS, DEFAULT_GROUP_NAME } from '../stores/groupBus';
import { useRadialMenuStore } from '../stores/radialMenu';
import { useCanvasPerformanceStore } from '../stores/performance';
import { topologicalSort } from '../utils/topologicalSort';
import { excludeRandomRouteBranchDescendants } from '../utils/randomRoute';
import { createRunLaunchQueue } from '../utils/runLaunchQueue';
import { installGlobalWheelBlockObserver } from '../utils/wheelBlock';
import {
  CANVAS_NODE_TEMPERATURE_EVENT,
  installCanvasNodeVisibilityObserver,
} from '../utils/canvasNodeVisibility';
import { markCanvasPerformance } from '../utils/canvasPerformanceProbe';
import { nextAdaptivePollDecision } from '../utils/adaptivePolling';
import type { CanvasSurfaceReadiness } from '../utils/canvasStartupReadiness';
import {
  estimateCanvasHeavyMediaCount,
  isPerformancePinnedNode,
  resolveCanvasPerformanceDecision,
} from '../utils/canvasPerformance';
import {
  buildCanvasPerformanceFixture,
  readCanvasPerformanceFixtureSize,
} from '../utils/canvasPerformanceFixture';
import {
  resolveCanvasZoomReadabilityTier,
  snapCanvasViewportToDevicePixels,
  type CanvasZoomReadabilityTier,
} from '../utils/canvasZoomReadability';
// v1.2.10.5: 节点落点防重叠解析器 (单节点/整组双模式 + 兜底+toast+飞镜)
import {
  placeSingleNode,
  placeBatchNodes,
  defaultSizeOf,
  rectOf,
  rectsIntersect,
  type Rect as PlacementRect,
} from '../utils/nodePlacement';
import {
  expandClipboardNodesForGroups,
  markSystemClipboardAsCanvasNodes,
  offsetClipboardNodes,
  positionClipboardNodesAtAnchor,
  remapPastedGroupMemberIds,
  shouldPreferInternalNodeClipboardPaste,
} from '../utils/canvasClipboard';
import {
  createOutputDataFromItems,
  createUploadDataFromItems,
  createUploadReplacementData,
  fileNameFromUrl,
  getMediaItemsFromData,
  type MediaItem,
  type MediaKind,
} from '../utils/mediaCollection';
import {
  buildPersistentOutputSnapshotData,
  readOutputMaterialPersistenceSetting,
  shouldPreserveAutoOutputMaterialNode,
  writeOutputMaterialPersistenceSetting,
} from '../utils/outputMaterialPersistence';
import {
  readWorkflowDoctorEnabled,
  writeWorkflowDoctorEnabled,
} from '../utils/workflowDoctorPreference';
import { shouldCollectNodeTextOutput } from '../utils/imageNodeOutputMode';
import {
  buildDirectorStoryboardOutputNodeData,
  findDirectorStoryboardOutputItemForNodeData,
  getDirectorStoryboardOutputItemBindingKey,
} from '../utils/directorStoryboard';
import { markCanvasNodesDeleted } from '../utils/deletedNodeRegistry';
import {
  bucketSendableMaterials,
  collectSendableMaterialsFromNode,
  collectSendableMaterialsFromNodes,
  sendableMaterialKey,
  sendableMaterialSignature,
  sendableToMediaItem,
  summarizeSendableMaterials,
  type SendTargetMode,
  type SendableMaterial,
} from '../utils/sendMaterials';
import {
  buildSendNodeFragment,
  instantiateSendNodeFragment,
  summarizeSendNodeFragment,
  type InstantiatedSendNodeFragment,
  type SendNodeFragment,
} from '../utils/sendNodeFragment';
import { createWorkflowResourceManifest } from '../utils/workflowResource';
import {
  assignFreshNodeSerials,
  findNodeBySerialId,
  getNodeSerialId,
  normalizeCanvasNodeSerials,
  parseNodeSerialInput,
} from '../utils/nodeSerialIds';
import { migrateLegacyVolcengineAssetNodes } from '../utils/volcengineAssets';
import { resolveConnectionByNodeSerialId } from '../utils/connectByNodeSerialId';
import { cloneCanvasEntityAsNew, ensureCanvasEntityUids, isCanonicalEntityUid } from '../utils/canvasEntityIdentity';
import { consumeCommittedCanvasNodePatches, readCommittedCanvasNodePatches } from '../utils/committedCanvasNodePatchMailbox';
import { formatShortcutList, matchesAnyShortcut } from '../utils/keyboardShortcuts';
import {
  hasCanvasWriteAuthority,
  requireAuthoritativeCanvasRevision,
} from '../utils/canvasLoadAuthority';
import {
  getBrowserCanvasViewportStorage,
  resolveCanvasInitialViewport,
  stageCanvasViewportWrite,
  writeCanvasViewport,
} from '../utils/canvasViewportStorage';
import { applyNodeAlignment, type NodeAlignAction } from '../utils/nodeAlign';
import {
  RADIAL_MENU_MOVE_TOLERANCE,
  clampRadialMenuCenter,
  distanceBetween,
  normalizeRadialMenuSlots,
  radialSlotIndexFromPointer,
  visibleRadialMenuNodeOptions,
  type RadialMenuPoint,
} from '../utils/radialMenu';
import {
  collectMaterialSetBucketsFromData,
  isMaterialSetKind,
  materialSetItemsToData,
  nonEmptyMaterialSetKinds,
  normalizeMaterialSetItems,
  type MaterialSetItem,
  type MaterialSetKind,
} from '../utils/materialSet';
import { chooseDefaultSendMode, resolveEffectiveSendMode } from '../utils/sendMode';
import {
  DEFAULT_VIDEO_EDIT_DATA,
  appendVideoEditClips,
  createVideoEditClipFromSendable,
  normalizeVideoEditClips,
  type VideoEditClip,
} from '../utils/videoEdit';
import { buildGenerationHistoryDataKey, collectGenerationHistory, countGenerationHistoryItems } from '../utils/generationHistory';
import {
  analyzeSubflowBoundary,
  detachSubflowInstance,
  isPrivateSubflowDataKey,
  loadSubflowDependencyDefinitions,
  subflowDependencyMapKey,
  upgradeSubflowInstances,
  type SubflowBoundaryAnalysis,
  type SubflowDependencyRef,
  type SubflowDefinition,
  type SubflowParameter,
  type SubflowValueSchema,
} from '../utils/subflows';
import {
  commitSubflowDraftHistory,
  createSubflowDraftHistory,
  redoSubflowDraftHistory,
  undoSubflowDraftHistory,
} from '../utils/subflowDraftHistory';
import { buildSubflowInspectorViewportKey } from '../utils/subflowInspectorViewport';
import { validateUploadMediaFile } from '../utils/uploadMediaValidation';
import { defaultFaceExpressionState } from '../utils/faceExpression3D';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildCreativeTargetResult,
  collectCanvasSelectionSummary,
  createCanvasResourcePackageManifest,
  prepareCanvasResourcePackageImport,
} from '../utils/canvasCreativeWorkflow';
import {
  VIBEX_MESSAGE_CONTRACT,
  VIBEX_ONLINE_URL,
  buildVibeXSendNodeSpecs,
  normalizeVibeXResultPayload,
} from '../utils/vibexBridge';
import {
  PHOTOSHOP_MESSAGE_CONTRACT,
  buildPhotoshopSendNodeSpecs,
  normalizePhotoshopResultPayload,
} from '../utils/photoshopBridge';
import { isAltModifierActive } from '../utils/canvasInteraction';
import * as api from '../services/api';
import { logBus } from '../stores/logs';
import CanvasToolbar from './CanvasToolbar';
import ProjectWorkbench from './ProjectWorkbench';
import GenerationHistoryPanel from './GenerationHistoryPanel';
import TerminalPanel from './TerminalPanel';
import CreatorAgentPanel from './CreatorAgentEntry';
import StartupPosterCarousel from './StartupPosterCarousel';
import NodeActionBar from './NodeActionBar';
import RadialNodeMenu from './RadialNodeMenu';
import RadialMenuSettingsModal from './RadialMenuSettingsModal';
import MaterialDragOverlay from './MaterialDragOverlay';
import {
  MATERIAL_CANVAS_DROP_EVENT,
  type MaterialCanvasDropEventDetail,
} from '../stores/dragMaterial';
import ThemeMusicToggle from './ThemeMusicToggle';
import CreativeDeskLayer from './CreativeDeskLayer';
import type { FarmCanvasFloatingFeedback } from './FarmCanvasLayer';
import type { FarmStoryPanelCanvasHint } from './FarmStoryPanel';
import SendMaterialsModal from './SendMaterialsModal';
import RunPreflightModal from './RunPreflightModal';
import SmartImage from './SmartImage';
import CanvasPerformanceControl from './CanvasPerformanceControl';
import {
  CanvasNodeRenderModeProvider,
  CanvasPerformanceRenderProvider,
  useCanvasPerformanceRenderingEnabled,
  type CanvasNodeRenderMode,
} from './CanvasNodeRenderMode';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import { materializeCanvasPatchDraft, type CanvasPatchDraft, type WorkflowDoctorCanvasHighlight } from '../utils/workflowDoctor';
import {
  SCRIPT_MASTER_CANVAS_PATCH_REQUEST_EVENT,
  type ScriptMasterCanvasPatchRequestDetail,
} from '../utils/scriptMasterCanvasBridge';
import {
  activateCanvasPatchPending,
  advanceCanvasPatchMutation,
  canvasPatchHistoryBarrier,
  mergeCanvasPatchGraph,
  mergeCanvasPatchValueWithConflicts,
  reconcileCanvasPatchAutosavePending,
  reconcileCanvasPatchAutosaveResponse,
  type CanvasPatchAutosaveToken,
  type CanvasPatchMergeConflict,
  type CanvasPatchPendingEnvelope,
} from '../utils/canvasPatchMerge';
import { collectFailedDownstreamNodeIds, getRunPlannedEdges, getRunPlannedNodeIds } from '../utils/runCenter';
import {
  buildFrozenRunIntentRuntime,
  buildRunAttemptOriginalReplayRuntime,
  buildRunOriginalReplayRuntime,
  buildSubflowNodeRunOriginalReplayRuntime,
  currentRunReplayRuntimeNodeChanges,
  partitionRunReplayRuntimeNodeChanges,
} from '../utils/runReplay';
import {
  prepareRunAction,
  type RunActionKind,
  type RunActionPreview,
  type RunCostEstimateInput,
  type RunEvidenceRefInput,
  type RunPreflightDiagnosticsInput,
} from '../utils/runPreflight';
import {
  RUN_PREFLIGHT_ASSET_CONCURRENCY,
  RUN_PREFLIGHT_ASSET_LIMIT,
  buildRunPreflightDiagnosticScope,
  buildRunPreflightDiagnostics,
  collectRunPreflightAssetIds,
  type RunPreflightDiagnosticScopeMode,
  workflowAssetsFromRecords,
} from '../utils/runPreflightContext';
import {
  authorizeRunPreflight,
  isSameRunPreflightExecutionSnapshot,
  type RunPreflightExecutionSnapshot,
} from '../utils/runPreflightExecution';
import { createRunPreflightHostContextDigest } from '../utils/runPreflightHostContext';
import {
  buildPossibleDerivedExecutionScope,
  type PossibleDerivedExecutionScope,
} from '../utils/derivedExecutionScope';
import { CANVAS_NODE_RUN_REQUEST_EVENT, createCanvasNodeRunRequestId, type CanvasNodeRunRequestDetail } from '../utils/canvasRunRequest';
import {
  CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  validateSecondaryProviderAction,
  type CanvasSecondaryProviderActionRequestDetail,
  type SecondaryProviderActionEnvelope,
} from '../utils/secondaryProviderAction';
import type { CanvasTemplate } from '../config/canvasTemplates';
import type { CanvasPatch, CanvasPatchPreview, CanvasPatchRecord, VersionedCanvasData, RunContext, RunIntent } from '../types/project';
import PlaceholderNode from './nodes/PlaceholderNode';
import DeletableEdge from './edges/DeletableEdge';
import PerformanceEdge from './edges/PerformanceEdge';
import { NODE_REGISTRY } from '../config/nodeRegistry';
import { EXECUTABLE_NODE_TYPES } from '../config/executableNodeTypes';
import type { CreativeDeskState, FarmAnimalProductId, FarmCanvasState, FarmCropId, FarmDecorObjectType, FarmEventLogItem, FarmTool, NodeType, NodeMeta } from '../types/canvas';
import {
  appendCreativeDeskItem,
  createCreativeDeskImageItem,
  createDefaultCreativeDeskState,
  migrateCreativeDeskToViewportCoordinates,
} from '../utils/creativeDesk';
import {
  FARM_ANIMAL_PRODUCT_DEFINITIONS,
  FARM_BUILDING_DEFINITIONS,
  FARM_CROP_DEFINITIONS,
  FARM_DEFAULT_DECOR_ID,
  FARM_DECOR_DEFINITIONS,
  advanceFarmDay,
  applyFarmTool,
  buildFarmActivityDigest,
  buildFarmBeautyRewards,
  buildFarmBeautyScore,
  buildFarmFocusGoals,
  buildFarmMiniMapMarkers,
  canCompleteFarmNpcVisit,
  canCompleteFarmOrder,
  completeFarmNpcVisit,
  completeFarmOrder,
  countFarmScarecrowUnprotectedDryCrops,
  createFarmState,
  farmDecorIdForResourceObjectType,
  farmMiniMapMarkerMatchesRouteTarget,
  farmToolSupportsContinuousAction,
  isFarmDecorUnlocked,
  sanitizeFarmCanvasState,
  snapFarmPoint,
  type FarmMiniMapMarker,
  type FarmMiniMapRouteHintTarget,
  type FarmToolAction,
} from '../utils/farmCanvas';
import { farmSoundCueForEvent, farmSoundCueForTool, playFarmActionSound, type FarmSoundCue } from '../utils/farmSound';
import { readImageNaturalSize } from '../utils/imageNaturalSize';
import {
  isConnectionValid,
  getConnectionPortType,
  getNodeOutputs,
  getNodeInputs,
  arePortsCompatible,
  PORT_COLOR,
  PORT_LABEL,
  NODE_PORTS,
  type PortType,
} from '../config/portTypes';

type ProjectRunReplayMode = 'full-current' | 'failed-original' | 'full-original' | 'subflow-node-original' | 'attempt-original';

type ProjectRunTerminalStatus = 'succeeded' | 'failed' | 'stopped';

interface PreparedRunExecution {
  executionContexts: Record<string, RunNodeExecutionContext>;
  finalize: (status: ProjectRunTerminalStatus) => Promise<void> | void;
}

interface ActiveCanvasRunControl {
  cancelled: boolean;
  cancelPersistence: Promise<void>;
}

interface RunNodesByOrderOptions {
  parentRunId?: string;
  replayMode?: ProjectRunReplayMode;
  replaySourceRunId?: string;
  replaySourceAttemptId?: string;
  runIntentId?: string;
  executionOrder?: string[];
  originalNodeIdByRuntimeId?: Record<string, string>;
  executionContexts?: Record<string, RunNodeExecutionContext>;
  prepareRunExecution?: (runId: string) => Promise<PreparedRunExecution>;
  actionKind?: RunActionKind;
  evidenceRefs?: RunEvidenceRefInput[];
  requestId?: string;
  runIntentSnapshot?: RunIntent | null;
  suppressBlockedPreflightPresentation?: boolean;
  expectedRevision?: number;
  cost?: RunCostEstimateInput;
  preflightContextNodes?: Node[];
  preflightContextEdges?: Edge[];
  preflightScopeMode?: RunPreflightDiagnosticScopeMode;
  secondaryProviderAction?: SecondaryProviderActionEnvelope | null;
}

function isSecondaryProviderActionRun(run: { summary?: Record<string, unknown> | null }) {
  return typeof run.summary?.secondaryProviderActionId === 'string'
    && run.summary.secondaryProviderActionId.trim().length > 0;
}

const CANVAS_MIN_ZOOM = 0.02;
const CANVAS_OVERVIEW_FIT_OPTIONS = {
  padding: 0.12,
  minZoom: CANVAS_MIN_ZOOM,
  maxZoom: 1.15,
};
const CANVAS_DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const CANVAS_VIEWPORT_STORAGE_THROTTLE_MS = 180;
const CANVAS_PAN_MOUSE_BUTTONS = [0, 1] as const;
const RADIAL_MENU_MOUSE_BUTTON = 2;
const RADIAL_MENU_CONTEXT_SUPPRESS_MS = 700;
const MAX_FARM_FLOATING_FEEDBACKS = 8;
const FARM_FLOATING_FEEDBACK_MS = 1350;
const FARM_FOLLOWUP_NOTICE_MS = 5600;
const FARM_FEEDBACK_SCREEN_TOP_GUARD = 176;
const FARM_DEV_TEST_MATERIAL_AMOUNT = 9999;
const FARM_DEV_TEST_WATER_AMOUNT = 999;
const FARM_JUMP_HIGHLIGHT_MS = 900;
const FARM_MINIMAP_ROUTE_HINT_MS = 1600;
const FARM_SOUND_ENABLED_STORAGE_KEY = 't8-farm-story-sfx-enabled';
const T8_FARM_STORY_PANEL_COLLAPSED_STORAGE_KEY = 't8-farm-story-panel-collapsed';
const FARM_MINIMAP_WIDTH = 214;
const FARM_MINIMAP_HEIGHT = 136;
const FARM_MINIMAP_RIGHT = 24;
const FARM_MINIMAP_BOTTOM = 32;
const FARM_MINIMAP_MARKER_LIMIT = 140;

type NodeIdDialogState =
  | {
      mode: 'connect';
      value: string;
      fromNodeId: string;
      fromHandleType: 'source' | 'target';
      title: string;
      description: string;
      placeholder: string;
    }
  | {
      mode: 'find';
      value: string;
      title: string;
      description: string;
      placeholder: string;
    };

type SubflowDraftState = {
  analysis: SubflowBoundaryAnalysis;
  selectedIds: string[];
  name: string;
  description: string;
  saving: boolean;
};

type SubflowInspectorState = {
  instanceNodeId: string;
  stack: SubflowDefinition[];
  pathNodeIds: string[];
  error?: string;
  detaching?: boolean;
  edit?: {
    depth: number;
    baseRevision: number;
    changeSummary: string;
    draft: SubflowDefinition;
    undoStack: SubflowDefinition[];
    redoStack: SubflowDefinition[];
    selectedNodeId: string | null;
    nodeDataText: string;
    nodeDataError: string;
    saving: boolean;
    conflict?: {
      revision: number;
      latestVersion: number;
      definition: SubflowDefinition;
    };
  };
};

type SubflowInspectorNodeData = {
  label: string;
  sourceHandles: string[];
  targetHandles: string[];
  onOpenNested?: () => void;
};

const SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE = '__t8_subflow_source__';
const SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE = '__t8_subflow_target__';

function SubflowInspectorNode({ data, selected }: NodeProps<Node<SubflowInspectorNodeData>>) {
  const targetHandles = data.targetHandles.length ? data.targetHandles : [SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE];
  const sourceHandles = data.sourceHandles.length ? data.sourceHandles : [SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE];
  return (
    <div
      className={`min-w-[150px] max-w-[260px] rounded border bg-[var(--bg-tertiary)] px-3 py-3 text-xs font-bold text-[var(--text-primary)] shadow-sm ${selected ? 'border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)]/30' : 'border-[var(--border-primary)]'}`}
      onDoubleClick={(event) => {
        if (!data.onOpenNested) return;
        event.stopPropagation();
        data.onOpenNested();
      }}
    >
      {targetHandles.map((handle, index) => (
        <Handle
          key={`target-${handle}`}
          id={handle}
          type="target"
          position={Position.Left}
          style={{ top: `${((index + 1) / (targetHandles.length + 1)) * 100}%` }}
        />
      ))}
      <div className="truncate">{data.label}</div>
      {data.onOpenNested && <button type="button" className="nodrag mt-1 text-[9px] font-semibold text-[var(--accent-primary)] underline-offset-2 hover:underline" onClick={(event) => { event.stopPropagation(); data.onOpenNested?.(); }}>进入子流程</button>}
      {sourceHandles.map((handle, index) => (
        <Handle
          key={`source-${handle}`}
          id={handle}
          type="source"
          position={Position.Right}
          style={{ top: `${((index + 1) / (sourceHandles.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}

const subflowInspectorNodeTypes = { subflowInspector: SubflowInspectorNode };

function cloneSubflowDefinition(definition: SubflowDefinition): SubflowDefinition {
  if (typeof structuredClone === 'function') return structuredClone(definition);
  return JSON.parse(JSON.stringify(definition)) as SubflowDefinition;
}

function parseSubflowPortDefault(raw: string, kind: string) {
  const value = raw.trim();
  if (!value) return undefined;
  if (kind === 'config' || kind === 'metadata') {
    try { return JSON.parse(value); } catch (_) { return value; }
  }
  return value;
}

const SUBFLOW_NON_CONFIG_DATA_KEY = /^(nodeSerialId|lastRunAt|lastRunStatus|lastRunError|progress|status|error|taskId|requestId|result|results|output|outputs|imageUrl|imageUrls|videoUrl|videoUrls|audioUrl|audioUrls|modelUrl|modelUrls|createdAt|updatedAt)$/i;

function inferSubflowValueSchema(value: unknown): SubflowValueSchema | undefined {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return undefined;
}

function subflowParameterCandidates(definition: SubflowDefinition) {
  return definition.nodes.flatMap((node) => {
    const data = (node.data || {}) as Record<string, unknown>;
    const nodeLabel = String(data.label || node.type || node.id);
    return Object.entries(data)
      .filter(([key, value]) => !key.startsWith('_') && !isPrivateSubflowDataKey(key) && !SUBFLOW_NON_CONFIG_DATA_KEY.test(key) && inferSubflowValueSchema(value))
      .map(([key, value]) => ({
        id: `param-${node.id}-${key}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 160),
        name: `${nodeLabel} · ${key}`,
        nodeId: node.id,
        dataKey: key,
        defaultValue: value,
        schema: inferSubflowValueSchema(value),
      } satisfies SubflowParameter));
  });
}
const FARM_MINIMAP_HEAVY_OBJECT_COUNT = 500;
const MAX_EDGE_CUT_FEEDBACKS = 4;
const EDGE_CUT_FEEDBACK_MS = 1100;
const MAX_EDGE_CONNECT_FEEDBACKS = 3;
const EDGE_CONNECT_FEEDBACK_MS = 950;
const RESOURCE_PACKAGE_LIBRARY_KINDS: api.ResourceKind[] = ['image', 'video', 'audio', 'panorama', 'set', 'pose', 'workflow'];

async function loadResourcePackageLibrarySnapshot() {
  const categories: api.ResourceCategory[] = [];
  const items: api.ResourceItem[] = [];
  for (const kind of RESOURCE_PACKAGE_LIBRARY_KINDS) {
    try {
      const [categoryResult, itemResult] = await Promise.all([
        api.getResourceCategories(kind),
        api.getResourceItems({ kind }),
      ]);
      if (categoryResult.success) categories.push(...(categoryResult.data || []));
      if (itemResult.success) items.push(...(itemResult.data || []));
    } catch (error) {
      console.warn('资源包资源库快照读取失败', kind, error);
    }
  }
  return { categories, items };
}

function buildResourcePackageThumbnailRefs(items: Array<{ id?: string; kind?: string; url?: string; nodeId?: string; title?: string }>) {
  return items
    .filter((item) => item.url && item.kind !== 'text')
    .slice(0, 360)
    .map((item, index) => ({
      id: item.id || `history-thumb-${index + 1}`,
      url: item.url || '',
      sourceUrl: item.url || '',
      sourceNodeId: item.nodeId || '',
      kind: item.kind || '',
      title: item.title || '',
    }));
}

type EdgeCutFeedbackKind = 'rope' | 'water' | 'path' | 'generic';
type EdgeConnectFeedbackKind = EdgeCutFeedbackKind;
type FarmNodeVisualState = 'idle' | 'running' | 'success' | 'error' | 'disabled';

interface EdgeCutFeedbackEventDetail {
  x?: number;
  y?: number;
  count?: number;
  edgeKind?: string;
  source?: 'button' | 'slash';
}

interface EdgeCutFeedback {
  id: string;
  x: number;
  y: number;
  count: number;
  kind: EdgeCutFeedbackKind;
  source: 'button' | 'slash';
  title: string;
  detail: string;
}

interface EdgeConnectFeedback {
  id: string;
  x: number;
  y: number;
  kind: EdgeConnectFeedbackKind;
  title: string;
  detail: string;
}

function FarmStoryConnectionLine({
  connectionLineStyle,
  connectionStatus,
  fromPosition,
  fromX,
  fromY,
  toPosition,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const status = connectionStatus || 'pending';

  return (
    <g
      className={`t8-farm-connection-preview is-${status}`}
      data-farm-connection-status={status}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        className={`react-flow__connection-path t8-farm-connection-preview__path is-${status}`}
        style={connectionLineStyle}
      />
      {status === 'invalid' && (
        <g
          className="t8-farm-connection-preview__forbidden"
          transform={`translate(${labelX} ${labelY})`}
        >
          <title>端口不兼容，不能连接</title>
          <rect className="t8-farm-connection-preview__forbidden-post" x="-3" y="8" width="6" height="18" rx="2" />
          <rect className="t8-farm-connection-preview__forbidden-board" x="-22" y="-15" width="44" height="28" rx="5" />
          <circle className="t8-farm-connection-preview__forbidden-ring" cx="0" cy="-1" r="8" />
          <path className="t8-farm-connection-preview__forbidden-slash" d="M -5 -7 L 6 5" />
        </g>
      )}
    </g>
  );
}

interface FarmMiniMapRenderableMarker extends FarmMiniMapMarker {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

interface FarmContinuousFeedbackBatch {
  tool: FarmToolAction['tool'];
  label: string;
  count: number;
  x: number;
  y: number;
  tone: FarmCanvasFloatingFeedback['tone'];
  placement?: FarmCanvasFloatingFeedback['placement'];
  placementEcho?: string;
  beautyGain?: number;
  beautyRewardTitle?: string;
  beautyRewardCount?: number;
  timerId?: number;
}

interface FarmToolSelectionFeedback {
  message: string;
  tone: FarmCanvasFloatingFeedback['tone'];
}

interface FarmFollowupNotice extends FarmStoryPanelCanvasHint {
  id: string;
  createdAt: number;
}

type FarmToolbarConsoleTone = 'water' | 'order' | 'visit' | 'mature' | 'guard' | 'focus' | 'stable';
type FarmToolbarConsoleSection = 'tools' | 'visits' | 'actions' | 'build' | 'focus' | 'activity';

interface FarmToolbarConsoleHint {
  tone: FarmToolbarConsoleTone;
  primary: string;
  secondary: string;
  section: FarmToolbarConsoleSection;
  sectionLabel: string;
  count: number;
  title: string;
}

const FARM_TOOLBAR_CONSOLE_SECTION_LABELS: Record<FarmToolbarConsoleSection, string> = {
  tools: '工具栏',
  visits: '订单来访',
  actions: '底部操作',
  build: '建造装饰',
  focus: '今日目标',
  activity: '最近农活',
};

interface FarmMiniMapRouteHint {
  target: FarmMiniMapRouteHintTarget;
  label: string;
  anchor?: { x: number; y: number };
  id: string;
}

function buildFarmToolbarConsoleHint(
  stateInput: FarmCanvasState | undefined,
  panelOpen: boolean,
): FarmToolbarConsoleHint {
  const state = sanitizeFarmCanvasState(stateInput);
  const plots = state.objects.filter((object) => object.kind === 'plot');
  const dryCount = plots.filter((object) =>
    object.crop &&
    object.crop.stage !== 'mature' &&
    object.crop.stage !== 'withered' &&
    !object.crop.wateredToday).length;
  const matureCount = plots.filter((object) => object.crop?.stage === 'mature').length;
  const readyOrderCount = state.orders.filter((order) => canCompleteFarmOrder(state, order.id)).length;
  const readyNpcVisitCount = state.npcVisits.filter((visit) => !visit.completed && canCompleteFarmNpcVisit(state, visit.id)).length;
  const scarecrowRiskCount = countFarmScarecrowUnprotectedDryCrops(state);
  const focusGoal = buildFarmFocusGoals(state, { maxGoals: 1 })[0];
  const activityDigest = buildFarmActivityDigest(state);
  let hint: Omit<FarmToolbarConsoleHint, 'sectionLabel' | 'title'>;

  if (dryCount > 0) {
    hint = {
      tone: 'water',
      primary: `补水 ${dryCount}`,
      secondary: '缺水作物待处理',
      section: 'tools',
      count: dryCount,
    };
  } else if (readyOrderCount > 0) {
    hint = {
      tone: 'order',
      primary: `交单 ${readyOrderCount}`,
      secondary: '订单材料已齐',
      section: 'visits',
      count: readyOrderCount,
    };
  } else if (readyNpcVisitCount > 0) {
    hint = {
      tone: 'visit',
      primary: `来访 ${readyNpcVisitCount}`,
      secondary: '村民委托可交',
      section: 'visits',
      count: readyNpcVisitCount,
    };
  } else if (matureCount > 0) {
    hint = {
      tone: 'mature',
      primary: `收获 ${matureCount}`,
      secondary: '成熟作物可收',
      section: 'actions',
      count: matureCount,
    };
  } else if (scarecrowRiskCount > 0) {
    hint = {
      tone: 'guard',
      primary: `守护 ${scarecrowRiskCount}`,
      secondary: '稻草人风险',
      section: 'build',
      count: scarecrowRiskCount,
    };
  } else if (focusGoal) {
    hint = {
      tone: 'focus',
      primary: `目标 ${focusGoal.progress}/${focusGoal.target}`,
      secondary: focusGoal.title,
      section: 'focus',
      count: focusGoal.target - focusGoal.progress,
    };
  } else {
    hint = {
      tone: 'stable',
      primary: '稳定',
      secondary: activityDigest.todayTotal > 0 ? `今日 ${activityDigest.todayTotal} 条农活` : '今天还没开工',
      section: 'activity',
      count: activityDigest.todayTotal,
    };
  }

  const sectionLabel = FARM_TOOLBAR_CONSOLE_SECTION_LABELS[hint.section];
  return {
    ...hint,
    sectionLabel,
    title: `${panelOpen ? '收起' : '展开'}牧场控制台：当前优先 ${hint.primary} · ${hint.secondary} · ${sectionLabel}`,
  };
}

function findNearestFarmMiniMapRouteHintMarker(
  markers: FarmMiniMapRenderableMarker[],
  anchor?: { x: number; y: number },
) {
  if (!markers.length) return null;
  const locatable = markers.filter((marker) => marker.objectId);
  const candidates = locatable.length > 0 ? locatable : markers;
  if (!anchor) return candidates[0] || null;
  return candidates
    .slice()
    .sort((a, b) => {
      const ax = a.x + a.width / 2;
      const ay = a.y + a.height / 2;
      const bx = b.x + b.width / 2;
      const by = b.y + b.height / 2;
      return Math.hypot(ax - anchor.x, ay - anchor.y) - Math.hypot(bx - anchor.x, by - anchor.y);
    })[0] || null;
}

function farmFeedbackToneForTool(
  tool: FarmToolAction['tool'],
  hasError = false,
): FarmCanvasFloatingFeedback['tone'] {
  if (hasError) return 'warning';
  if (tool === 'water') return 'water';
  if (tool === 'harvest') return 'reward';
  if (tool === 'build' || tool === 'decor') return 'build';
  return 'success';
}

type FarmActionFeedbackAnchor = { x: number; y: number; placement: FarmCanvasFloatingFeedback['placement'] };

function farmActionSnappedPoint(action: FarmToolAction, gridSize: number) {
  return snapFarmPoint({ x: action.x, y: action.y }, gridSize);
}

function farmActionFeedbackFootprintForAction(
  action: FarmToolAction,
  gridSize: number,
) {
  const point = farmActionSnappedPoint(action, gridSize);
  if (action.tool === 'build') {
    const building = FARM_BUILDING_DEFINITIONS[action.buildingId || 'hut'];
    return {
      x: point.x,
      y: point.y,
      width: Math.max(1, building?.widthCells || 1) * gridSize,
      height: Math.max(1, building?.heightCells || 1) * gridSize,
    };
  }
  return {
    x: point.x,
    y: point.y,
    width: gridSize,
    height: gridSize,
  };
}

function farmActionFeedbackObjectForAction(
  objects: FarmCanvasState['objects'],
  action: FarmToolAction,
  gridSize: number,
) {
  const point = farmActionSnappedPoint(action, gridSize);
  const actionKind = action.tool === 'build'
    ? 'building'
    : action.tool === 'decor'
      ? 'decor'
      : undefined;
  return objects.find((object) => {
    if (actionKind && object.kind !== actionKind) return false;
    const width = Math.max(1, object.widthCells || 1) * gridSize;
    const height = Math.max(1, object.heightCells || 1) * gridSize;
    return point.x >= object.x
      && point.x < object.x + width
      && point.y >= object.y
      && point.y < object.y + height;
  });
}

function farmActionFeedbackAnchor(
  previous: FarmCanvasState,
  next: FarmCanvasState,
  action: FarmToolAction,
  options: { screenTopGuard?: number } = {},
): FarmActionFeedbackAnchor {
  const gridSize = next.gridSize || previous.gridSize || 64;
  const fallbackFootprint = farmActionFeedbackFootprintForAction(action, gridSize);
  const screenTopGuard = options.screenTopGuard ?? FARM_FEEDBACK_SCREEN_TOP_GUARD;
  const shouldPlaceBelowForScreen = typeof action.screenY === 'number' && action.screenY < screenTopGuard;
  const fallbackPlacement: FarmCanvasFloatingFeedback['placement'] = shouldPlaceBelowForScreen || fallbackFootprint.y <= gridSize ? 'below' : 'above';
  const target = farmActionFeedbackObjectForAction(next.objects, action, gridSize)
    || farmActionFeedbackObjectForAction(previous.objects, action, gridSize);

  if (!target) {
    return {
      x: fallbackFootprint.x + fallbackFootprint.width / 2,
      y: fallbackPlacement === 'above' ? fallbackFootprint.y : fallbackFootprint.y + fallbackFootprint.height,
      placement: fallbackPlacement,
    };
  }

  const width = Math.max(1, target.widthCells || 1) * gridSize;
  const height = Math.max(1, target.heightCells || 1) * gridSize;
  const placement: FarmCanvasFloatingFeedback['placement'] = shouldPlaceBelowForScreen || target.y <= gridSize ? 'below' : 'above';
  return {
    x: target.x + width / 2,
    y: placement === 'above' ? target.y : target.y + height,
    placement,
  };
}

function formatFarmSelectionResourceShortage(
  cost: { gold?: number; wood?: number; stone?: number },
  resources: FarmCanvasState['resources'],
) {
  const parts = [
    (cost.gold || 0) > resources.gold ? `金币${resources.gold}/${cost.gold}` : '',
    (cost.wood || 0) > resources.wood ? `木${resources.wood}/${cost.wood}` : '',
    (cost.stone || 0) > resources.stone ? `石${resources.stone}/${cost.stone}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function buildFarmToolSelectionFeedback(
  tool: FarmTool,
  stateInput: FarmCanvasState,
  options: { resourceDecorLabel?: string } = {},
): FarmToolSelectionFeedback {
  const state = sanitizeFarmCanvasState(stateInput);
  const continuousHint = farmToolSupportsContinuousAction(tool) ? '按住拖动可连续操作。' : '';
  if (tool === 'select') {
    return { message: '选择工具：点击牧场对象查看状态。', tone: 'success' };
  }
  if (tool === 'hoe') {
    return { message: `锄地工具：点击空草地开垦。${continuousHint}`, tone: 'success' };
  }
  if (tool === 'seed') {
    const cropId = 'turnip';
    const seedCount = state.resources.seeds[cropId] || 0;
    const cropLabel = FARM_CROP_DEFINITIONS[cropId]?.label || '萝卜';
    return seedCount > 0
      ? { message: `播种工具：${cropLabel}种子 x${seedCount}。${continuousHint}`, tone: 'success' }
      : { message: `播种工具：${cropLabel}种子不足，先完成订单补种。`, tone: 'warning' };
  }
  if (tool === 'water') {
    return state.resources.water > 0
      ? { message: `浇水工具：水桶 ${state.resources.water}。${continuousHint}`, tone: 'water' }
      : { message: '浇水工具：水桶已空，过一天或建水井补水。', tone: 'warning' };
  }
  if (tool === 'harvest') {
    const matureCount = state.objects.filter((object) => object.kind === 'plot' && object.crop?.stage === 'mature').length;
    return matureCount > 0
      ? { message: `收获工具：成熟作物 x${matureCount}。${continuousHint}`, tone: 'reward' }
      : { message: '收获工具：暂无成熟作物，先浇水等待成长。', tone: 'warning' };
  }
  if (tool === 'shovel') {
    return { message: `铲除工具：清理田地、作物或装饰。${continuousHint}`, tone: 'success' };
  }
  if (tool === 'build') {
    const building = FARM_BUILDING_DEFINITIONS[state.selectedBuildingId || 'hut'] || FARM_BUILDING_DEFINITIONS.hut;
    const shortage = formatFarmSelectionResourceShortage(building.cost, state.resources);
    return shortage
      ? { message: `建造目标：${building.label}，资源不足：${shortage}。`, tone: 'warning' }
      : { message: `建造目标：${building.label}，点击画布放置。`, tone: 'build' };
  }
  if (tool === 'decor') {
    if (state.selectedResourceDecor) {
      const label = options.resourceDecorLabel || '资源装饰';
      return { message: `装饰目标：${label}，点击画布放置。按住拖动可连续放置。`, tone: 'build' };
    }
    const decor = FARM_DECOR_DEFINITIONS[state.selectedDecorId || FARM_DEFAULT_DECOR_ID] || FARM_DECOR_DEFINITIONS[FARM_DEFAULT_DECOR_ID];
    return isFarmDecorUnlocked(state, decor.id)
      ? { message: `装饰目标：${decor.label}，点击画布放置。按住拖动可连续放置。`, tone: 'build' }
      : { message: `装饰目标：${decor.label}尚未解锁，先完成订单。`, tone: 'warning' };
  }
  if (tool === 'move') {
    return state.selectedObjectId
      ? { message: '移动工具：点击新位置搬运已选对象。', tone: 'build' }
      : { message: '移动工具：先点击一个牧场对象，再点新位置。', tone: 'warning' };
  }
  if (tool === 'delete') {
    return state.objects.length > 0
      ? { message: `删除工具：当前可清理对象 x${state.objects.length}。${continuousHint}`, tone: 'warning' }
      : { message: '删除工具：当前没有可清理的牧场对象。', tone: 'warning' };
  }
  return { message: '牧场工具已选中。', tone: 'success' };
}

function compactFarmFloatingMessage(message: string) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function farmContinuousFeedbackLabel(tool: FarmToolAction['tool']) {
  if (tool === 'hoe') return '已开垦';
  if (tool === 'seed') return '已播种';
  if (tool === 'water') return '已浇水';
  if (tool === 'harvest') return '已收获';
  if (tool === 'shovel' || tool === 'delete') return '已清理';
  if (tool === 'decor') return '已布置';
  return '';
}

function findNewFarmPlacedObjectId(
  previous: FarmCanvasState,
  next: FarmCanvasState,
  tool: FarmToolAction['tool'],
) {
  if (tool !== 'build' && tool !== 'decor') return null;
  const previousIds = new Set(previous.objects.map((object) => object.id));
  const expectedKind = tool === 'build' ? 'building' : 'decor';
  const placedObject = next.objects.find((object) => object.kind === expectedKind && !previousIds.has(object.id));
  return placedObject?.id || null;
}

function farmBeautyGainForAction(
  previous: FarmCanvasState,
  next: FarmCanvasState,
  tool: FarmToolAction['tool'],
) {
  if (tool !== 'build' && tool !== 'decor') return 0;
  const previousScore = buildFarmBeautyScore(previous).score;
  const nextScore = buildFarmBeautyScore(next).score;
  return Math.max(0, nextScore - previousScore);
}

function farmBeautyRewardUnlockForAction(
  previous: FarmCanvasState,
  next: FarmCanvasState,
  tool: FarmToolAction['tool'],
) {
  if (tool !== 'build' && tool !== 'decor') return null;
  const previousUnlocked = new Set(
    buildFarmBeautyRewards(previous)
      .filter((reward) => reward.unlocked)
      .map((reward) => reward.id),
  );
  const newlyUnlocked = buildFarmBeautyRewards(next)
    .filter((reward) => reward.unlocked && !previousUnlocked.has(reward.id));
  if (newlyUnlocked.length === 0) return null;
  return {
    title: newlyUnlocked[0].title,
    count: newlyUnlocked.length,
  };
}

function farmPlacementEchoForAction(feedback: string, tool: FarmToolAction['tool']) {
  if (tool === 'build' && feedback.startsWith('已建造 ')) return feedback.replace(/^已建造\s*/, '落成：');
  if (tool === 'decor' && feedback.startsWith('已放置 ')) return feedback.replace(/^已放置\s*/, '布置：');
  return '';
}

function farmMiniMapMarkerFeedback(marker: FarmMiniMapMarker) {
  if (marker.kind === 'mature') return `已定位成熟作物：${marker.label}`;
  if (marker.kind === 'dry') return `已定位待浇水作物：${marker.label}`;
  if (marker.kind === 'withered') return `已定位枯萎作物：${marker.label}`;
  if (marker.kind === 'order') return `已定位订单目标：${marker.label}`;
  if (marker.kind === 'npc') return `已定位来访目标：${marker.label}`;
  if (marker.kind === 'rare') return `已定位惊喜事件：${marker.label}`;
  if (marker.kind === 'animal') return `已定位动物：${marker.label}`;
  if (marker.kind === 'cluster') return `已定位标记簇：${marker.label}`;
  return `已定位：${marker.label}`;
}

function farmMiniMapMarkerTone(kind: FarmMiniMapMarker['kind']): FarmCanvasFloatingFeedback['tone'] {
  if (kind === 'dry') return 'water';
  if (kind === 'withered') return 'warning';
  if (kind === 'building' || kind === 'path' || kind === 'cluster') return 'build';
  if (kind === 'mature' || kind === 'order' || kind === 'npc' || kind === 'rare') return 'reward';
  return 'success';
}

function farmMiniMapMarkerSoundCue(kind: FarmMiniMapMarker['kind']): FarmSoundCue {
  if (kind === 'mature' || kind === 'rare') return 'harvest';
  if (kind === 'dry') return 'water';
  if (kind === 'withered') return 'select';
  if (kind === 'order' || kind === 'npc') return 'order';
  if (kind === 'building') return 'build';
  return 'select';
}

function farmNodeVisualStateFromData(data: unknown): FarmNodeVisualState {
  const source = (data || {}) as Record<string, any>;
  if (source.disabled || source.isDisabled || source.locked) return 'disabled';
  const status = String(source.status || source.runStatus || '').toLowerCase();
  const busyStatus = ['generating', 'running', 'submitting', 'polling', 'streaming', 'loading'];
  if (source.isRunning || source.isPolling || source.busy || busyStatus.includes(status)) return 'running';
  if (status === 'success' || status === 'completed' || status === 'complete' || status === 'done') return 'success';
  if (status === 'error' || status === 'failed' || status === 'failure' || source.error) return 'error';
  return 'idle';
}

function withFarmNodeVisualState(node: Node): Node {
  if (node.type === 'groupBox' || node.type === 'bulkPhantom') return node;
  const visualState = farmNodeVisualStateFromData(node.data);
  const currentClassName = typeof node.className === 'string' ? node.className : '';
  const className = `${currentClassName} t8-farm-node-state is-farm-node-${visualState}`.trim();
  if (className === currentClassName) return node;
  return { ...node, className };
}

function withGardenDefenseNodeVisualState(node: Node): Node {
  if (node.type === 'groupBox' || node.type === 'bulkPhantom') return node;
  const visualState = farmNodeVisualStateFromData(node.data);
  const currentClassName = typeof node.className === 'string' ? node.className : '';
  const className = `${currentClassName} t8-garden-node-state is-garden-node-${visualState}`.trim();
  if (className === currentClassName) return node;
  return { ...node, className };
}

function normalizeEdgeCutKind(kind: unknown): EdgeCutFeedbackKind {
  if (kind === 'rope' || kind === 'water' || kind === 'path') return kind;
  return 'generic';
}

function edgeCutUnit(kind: EdgeCutFeedbackKind) {
  if (kind === 'rope') return '根麻绳';
  if (kind === 'water') return '条水渠';
  if (kind === 'path') return '段田埂';
  return '条连线';
}

function farmConnectionKindFromPortType(portType: PortType | null | undefined): EdgeConnectFeedbackKind {
  if (portType === 'image' || portType === 'video' || portType === 'audio' || portType === 'model3d') return 'water';
  if (portType === 'any' || portType === 'config' || portType === 'metadata') return 'path';
  if (portType === 'text') return 'rope';
  return portType ? 'rope' : 'generic';
}

function buildEdgeCutFeedbackCopy(
  count: number,
  kind: EdgeCutFeedbackKind,
  source: 'button' | 'slash',
  visualStyle: string,
) {
  const unit = edgeCutUnit(kind);
  if (visualStyle === 'farm-story') {
    const action = source === 'button' ? '剪枝剪咔嚓' : '镰刀划过';
    return {
      title: `${action} · 已断开 ${count} ${unit}`,
      detail: kind === 'water' ? '水渠已截流，素材流向已独立。' : kind === 'path' ? '田埂小路已切开，控制流不再相连。' : '断藤蔓已收好，画布保持清爽。',
    };
  }
  return {
    title: `已断开 ${count} ${unit}`,
    detail: source === 'button' ? '中点按钮断开完成。' : '划线剪断完成。',
  };
}

function buildEdgeConnectFeedbackCopy(kind: EdgeConnectFeedbackKind, visualStyle: string) {
  if (visualStyle === 'farm-story') {
    if (kind === 'water') {
      return {
        title: '接上水渠',
        detail: '媒体素材流向已经连通。',
      };
    }
    if (kind === 'path') {
      return {
        title: '铺好田埂',
        detail: '控制小路已经接到目标。',
      };
    }
    if (kind === 'rope') {
      return {
        title: '牵好麻绳',
        detail: '数据流已经绑到目标。',
      };
    }
  }
  return {
    title: '已连接',
    detail: '节点连线已建立。',
  };
}

function clampEdgeCutFeedbackPosition(x: number, y: number) {
  const width = typeof window !== 'undefined' ? window.innerWidth : 420;
  const height = typeof window !== 'undefined' ? window.innerHeight : 260;
  return {
    x: Math.min(Math.max(Number.isFinite(x) ? x : width / 2, 92), Math.max(92, width - 92)),
    y: Math.min(Math.max(Number.isFinite(y) ? y : height / 2, 88), Math.max(88, height - 34)),
  };
}

function clampMiniMapPercent(value: number, min = 3, max = 97) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(max, Math.max(min, value));
}

function clampMiniMapSizePercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getFarmMiniMapNodeRect(node: Node) {
  const typed = node as Node & { width?: number; height?: number; measured?: { width?: number; height?: number } };
  const x = Number(node.position?.x);
  const y = Number(node.position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    width: Number(typed.width || typed.measured?.width || (node.type === 'groupBox' ? 480 : 280)),
    height: Number(typed.height || typed.measured?.height || (node.type === 'groupBox' ? 320 : 180)),
  };
}

function buildFarmMiniMapBounds(markers: FarmMiniMapMarker[], nodes: Node[]) {
  const rects = [
    ...nodes.map(getFarmMiniMapNodeRect).filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect)),
    ...markers.map((marker) => ({
      x: marker.x,
      y: marker.y,
      width: marker.width,
      height: marker.height,
    })),
  ].filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    return { x: -512, y: -320, width: 1024, height: 640 };
  }

  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = Math.min(768, Math.max(96, Math.max(width, height) * 0.08));
  return {
    x: minX - padding,
    y: minY - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

function layoutFarmMiniMapMarkers(markers: FarmMiniMapMarker[], nodes: Node[]): FarmMiniMapRenderableMarker[] {
  if (markers.length === 0) return [];
  const bounds = buildFarmMiniMapBounds(markers, nodes);
  return markers.map((marker) => {
    const centerX = marker.x + marker.width / 2;
    const centerY = marker.y + marker.height / 2;
    const isAreaMarker = marker.kind === 'building' || marker.kind === 'path' || marker.kind === 'cluster';
    return {
      ...marker,
      leftPct: clampMiniMapPercent(((centerX - bounds.x) / bounds.width) * 100),
      topPct: clampMiniMapPercent(((centerY - bounds.y) / bounds.height) * 100),
      widthPct: clampMiniMapSizePercent((marker.width / bounds.width) * 100, isAreaMarker ? 2.8 : 1.8, marker.kind === 'path' ? 18 : marker.kind === 'cluster' ? 11 : 13),
      heightPct: clampMiniMapSizePercent((marker.height / bounds.height) * 100, isAreaMarker ? 2.4 : 1.8, marker.kind === 'path' ? 8 : marker.kind === 'cluster' ? 9 : 11),
    };
  });
}

function farmPortTypeFromHandleId(handleId: string | null | undefined): PortType | null {
  const id = String(handleId || '').toLowerCase();
  if (!id) return null;
  if (id.includes('model') || id.includes('3d')) return 'model3d';
  if (id.includes('metadata') || id.includes('meta') || id.includes('portrait')) return 'metadata';
  if (id.includes('config')) return 'config';
  if (id.includes('audio') || id.includes('sound') || id.includes('voice')) return 'audio';
  if (id.includes('video') || id.includes('movie')) return 'video';
  if (id.includes('image') || id.includes('img') || id.includes('frame') || id === 'first' || id === 'last' || id === 'a' || id === 'b') return 'image';
  if (id.includes('text') || id.includes('prompt') || id.includes('caption')) return 'text';
  if (id.includes('any')) return 'any';
  return null;
}

function primaryFarmPortType(types: PortType[]): PortType | null {
  if (types.length === 0) return null;
  const concrete = types.filter((type) => type !== 'any');
  if (concrete.length === 1) return concrete[0];
  if (types.length === 1) return types[0];
  if (types.includes('any')) return 'any';
  return 'any';
}

function inferFarmHandlePortType(
  node: Node | null | undefined,
  handleType: 'source' | 'target',
  handleId: string | null | undefined,
): PortType | null {
  const declaredTypes = handleType === 'source' ? getNodeOutputs(node) : getNodeInputs(node);
  const typeFromId = farmPortTypeFromHandleId(handleId);
  if (typeFromId && (declaredTypes.length === 0 || declaredTypes.includes(typeFromId) || declaredTypes.includes('any'))) {
    return typeFromId;
  }
  return primaryFarmPortType(declaredTypes);
}

function farmAchievementTypeForEvent(kind?: FarmEventLogItem['kind']): api.AchievementEventPayload['type'] | null {
  if (kind === 'plot_tilled') return 'farm.plot_tilled';
  if (kind === 'crop_planted') return 'farm.crop_planted';
  if (kind === 'crop_watered') return 'farm.crop_watered';
  if (kind === 'crop_harvested') return 'farm.crop_harvested';
  if (kind === 'order_completed') return 'farm.order_completed';
  if (kind === 'building_placed') return 'farm.building_placed';
  if (kind === 'decor_placed') return 'farm.decor_placed';
  if (kind === 'rare_event') return 'farm.rare_crop';
  return null;
}

function farmAchievementKindForEvent(event: FarmEventLogItem) {
  if (event.rareEventId) return event.rareEventId;
  if (event.cropId) return event.cropId;
  if (event.objectKind) return event.objectKind;
  if (event.kind === 'order_completed') return 'order';
  return 'farm';
}

function lazyCanvasNode(load: () => Promise<any>, displayName: string): ComponentType<any> {
  const LazyNode = lazy(load);
  const WrappedNode = (props: any) => (
    <Suspense fallback={<PlaceholderNode {...props} />}>
      <LazyNode {...props} />
    </Suspense>
  );
  WrappedNode.displayName = `LazyCanvasNode(${displayName})`;
  return WrappedNode;
}

const FarmCanvasLayer = lazy(() => import('./FarmCanvasLayer'));
const GardenDefenseExperience = lazy(() => import('../features/garden-defense/GardenDefenseExperience.tsx'));
const DragonBallRadar = lazy(() => import('./DragonBallRadar'));
const SaintSeiyaSanctuary = lazy(() => import('./SaintSeiyaSanctuary'));
const TetrisPanel = lazy(() => import('./TetrisPanel'));
const FarmStoryPanel = lazy(() => import('./FarmStoryPanel'));

const TextNode = lazyCanvasNode(() => import('./nodes/TextNode'), 'TextNode');
const ImageNode = lazyCanvasNode(() => import('./nodes/ImageNode'), 'ImageNode');
const LLMNode = lazyCanvasNode(() => import('./nodes/LLMNode'), 'LLMNode');
const VideoNode = lazyCanvasNode(() => import('./nodes/VideoNode'), 'VideoNode');
const VideoEditNode = lazyCanvasNode(() => import('./nodes/VideoEditNode'), 'VideoEditNode');
const SeedanceNode = lazyCanvasNode(() => import('./nodes/SeedanceNode'), 'SeedanceNode');
const Seedance25Node = lazyCanvasNode(() => import('./nodes/Seedance25Node'), 'Seedance25Node');
const FashVsrNode = lazyCanvasNode(() => import('./nodes/FashVsrNode'), 'FashVsrNode');
const DirectorStoryboardNode = lazyCanvasNode(() => import('./nodes/DirectorStoryboardNode'), 'DirectorStoryboardNode');
const StoryNode = lazyCanvasNode(() => import('./nodes/StoryNode'), 'StoryNode');
const ScriptMasterNode = lazyCanvasNode(() => import('./nodes/ScriptMasterNode'), 'ScriptMasterNode');
const MiniMaxH3PromptEnhancerNode = lazyCanvasNode(() => import('./nodes/MiniMaxH3PromptEnhancerNode'), 'MiniMaxH3PromptEnhancerNode');
const MiniMaxMusic3PromptEnhancerNode = lazyCanvasNode(() => import('./nodes/MiniMaxMusic3PromptEnhancerNode'), 'MiniMaxMusic3PromptEnhancerNode');
const MinimaxH3OfficialPromptEnhancerNode = lazyCanvasNode(() => import('./nodes/MinimaxH3OfficialPromptEnhancerNode'), 'MinimaxH3OfficialPromptEnhancerNode');
const Seedance20PromptEnhancerNode = lazyCanvasNode(() => import('./nodes/Seedance20PromptEnhancerNode'), 'Seedance20PromptEnhancerNode');
const MvMusicMasterNode = lazyCanvasNode(() => import('./nodes/MvMusicMasterNode'), 'MvMusicMasterNode');
const LocalizationMasterNode = lazyCanvasNode(() => import('./nodes/LocalizationMasterNode'), 'LocalizationMasterNode');
const AudioNode = lazyCanvasNode(() => import('./nodes/AudioNode'), 'AudioNode');
const RunningHubNode = lazyCanvasNode(() => import('./nodes/RunningHubNode'), 'RunningHubNode');
const RhConfigNode = lazyCanvasNode(() => import('./nodes/RhConfigNode'), 'RhConfigNode');
const RHToolsNode = lazyCanvasNode(() => import('./nodes/RHToolsNode'), 'RHToolsNode');
const RHToolboxNode = lazyCanvasNode(() => import('./nodes/RHToolboxNode'), 'RHToolboxNode');
const FalToolboxNode = lazyCanvasNode(() => import('./nodes/FalToolboxNode'), 'FalToolboxNode');
const Model3DPreviewNode = lazyCanvasNode(() => import('./nodes/Model3DPreviewNode'), 'Model3DPreviewNode');
const Model3DNode = lazyCanvasNode(() => import('./nodes/Model3DNode'), 'Model3DNode');
const VolcengineAssetsNode = lazyCanvasNode(() => import('./nodes/VolcengineAssetsNode'), 'VolcengineAssetsNode');
const GrokImageToolsNode = lazyCanvasNode(() => import('./nodes/GrokImageToolsNode'), 'GrokImageToolsNode');
const FaceExpression3DNode = lazyCanvasNode(() => import('./nodes/FaceExpression3DNode'), 'FaceExpression3DNode');
const PrevisStudioNode = lazyCanvasNode(() => import('./nodes/PrevisStudioNode'), 'PrevisStudioNode');
const GrokOAuthAgentNode = lazyCanvasNode(() => import('./nodes/GrokOAuthAgentNode'), 'GrokOAuthAgentNode');
const CodexCliAgentNode = lazyCanvasNode(() => import('./nodes/CodexCliAgentNode'), 'CodexCliAgentNode');
const CodexImageConjureNode = lazyCanvasNode(() => import('./nodes/CodexImageConjureNode'), 'CodexImageConjureNode');
const ArtistStyleMasterNode = lazyCanvasNode(() => import('./nodes/ArtistStyleMasterNode'), 'ArtistStyleMasterNode');
const AnimeTagMasterNode = lazyCanvasNode(() => import('./nodes/AnimeTagMasterNode'), 'AnimeTagMasterNode');
const ComfyUIStoreNode = lazyCanvasNode(() => import('./nodes/ComfyUIStoreNode'), 'ComfyUIStoreNode');
const ComfyUIAppMakerNode = lazyCanvasNode(() => import('./nodes/ComfyUIAppMakerNode'), 'ComfyUIAppMakerNode');
const ResizeNode = lazyCanvasNode(() => import('./nodes/ResizeNode'), 'ResizeNode');
const UpscaleNode = lazyCanvasNode(() => import('./nodes/UpscaleNode'), 'UpscaleNode');
const GridCropNode = lazyCanvasNode(() => import('./nodes/GridCropNode'), 'GridCropNode');
const GridEditorNode = lazyCanvasNode(() => import('./nodes/GridEditorNode'), 'GridEditorNode');
const CombineNode = lazyCanvasNode(() => import('./nodes/CombineNode'), 'CombineNode');
const RemoveBgNode = lazyCanvasNode(() => import('./nodes/RemoveBgNode'), 'RemoveBgNode');
const ImageCompareNode = lazyCanvasNode(() => import('./nodes/ImageCompareNode'), 'ImageCompareNode');
const ToolboxParamNode = lazyCanvasNode(() => import('./nodes/ToolboxParamNode'), 'ToolboxParamNode');
const PortraitMasterNode = lazyCanvasNode(() => import('./nodes/PortraitMasterNode'), 'PortraitMasterNode');
const PoseMasterNode = lazyCanvasNode(() => import('./nodes/PoseMasterNode'), 'PoseMasterNode');
const Panorama3DNode = lazyCanvasNode(() => import('./nodes/Panorama3DNode'), 'Panorama3DNode');
const AggregateParserNode = lazyCanvasNode(() => import('./nodes/AggregateParserNode'), 'AggregateParserNode');
const BatchProcessorNode = lazyCanvasNode(() => import('./nodes/BatchProcessorNode'), 'BatchProcessorNode');
const BatchTaggerNode = lazyCanvasNode(() => import('./nodes/BatchTaggerNode'), 'BatchTaggerNode');
const TopazImageUpscaleNode = lazyCanvasNode(() => import('./nodes/TopazImageUpscaleNode'), 'TopazImageUpscaleNode');
const TopazVideoUpscaleNode = lazyCanvasNode(() => import('./nodes/TopazVideoUpscaleNode'), 'TopazVideoUpscaleNode');
const IdeaNode = lazyCanvasNode(() => import('./nodes/IdeaNode'), 'IdeaNode');
const BpNode = lazyCanvasNode(() => import('./nodes/BpNode'), 'BpNode');
const RelayNode = lazyCanvasNode(() => import('./nodes/RelayNode'), 'RelayNode');
const RemoveAiWatermarkNode = lazyCanvasNode(() => import('./nodes/RemoveAiWatermarkNode'), 'RemoveAiWatermarkNode');
const VideoOutputNode = lazyCanvasNode(() => import('./nodes/VideoOutputNode'), 'VideoOutputNode');
const PortraitMetadataNode = lazyCanvasNode(() => import('./nodes/PortraitMetadataNode'), 'PortraitMetadataNode');
const StoryboardGridNode = lazyCanvasNode(() => import('./nodes/StoryboardGridNode'), 'StoryboardGridNode');
const PresetImageNode = lazyCanvasNode(() => import('./nodes/PresetImageNode'), 'PresetImageNode');
const DrawingBoardNode = lazyCanvasNode(() => import('./nodes/DrawingBoardNode'), 'DrawingBoardNode');
const BrowserNode = lazyCanvasNode(() => import('./nodes/BrowserNode'), 'BrowserNode');
const FrameExtractorNode = lazyCanvasNode(() => import('./nodes/FrameExtractorNode'), 'FrameExtractorNode');
const FramePairNode = lazyCanvasNode(() => import('./nodes/FramePairNode'), 'FramePairNode');
const LoopNode = lazyCanvasNode(() => import('./nodes/LoopNode'), 'LoopNode');
const RandomRouteNode = lazyCanvasNode(() => import('./nodes/RandomRouteNode'), 'RandomRouteNode');
const SubflowNode = lazyCanvasNode(() => import('./nodes/SubflowNode'), 'SubflowNode');
const PickFromSetNode = lazyCanvasNode(() => import('./nodes/PickFromSetNode'), 'PickFromSetNode');
const TextSplitNode = lazyCanvasNode(() => import('./nodes/TextSplitNode'), 'TextSplitNode');
const MaterialSetNode = lazyCanvasNode(() => import('./nodes/MaterialSetNode'), 'MaterialSetNode');
const GenerationTargetNode = lazyCanvasNode(() => import('./nodes/GenerationTargetNode'), 'GenerationTargetNode');
const VibeXNode = lazyCanvasNode(() => import('./nodes/VibeXNode'), 'VibeXNode');
const UploadNode = lazyCanvasNode(() => import('./nodes/UploadNode'), 'UploadNode');
const OutputNode = lazyCanvasNode(() => import('./nodes/OutputNode'), 'OutputNode');
const FeishuBitableInputNode = lazyCanvasNode(() => import('./nodes/FeishuBitableInputNode'), 'FeishuBitableInputNode');
const FeishuBitableOutputNode = lazyCanvasNode(() => import('./nodes/FeishuBitableOutputNode'), 'FeishuBitableOutputNode');
const GroupBoxNode = lazyCanvasNode(() => import('./nodes/GroupBoxNode'), 'GroupBoxNode');
const RH_TOOLBOX_MAKER_MODULE = './nodes/RHToolboxMakerNode';
const FAL_TOOLBOX_MAKER_MODULE = './nodes/FalToolboxMakerNode';
const RHToolboxMakerNode = import.meta.env?.DEV
  ? lazyCanvasNode(() => import(/* @vite-ignore */ RH_TOOLBOX_MAKER_MODULE), 'RHToolboxMakerNode')
  : PlaceholderNode;
const FalToolboxMakerNode = import.meta.env?.DEV
  ? lazyCanvasNode(() => import(/* @vite-ignore */ FAL_TOOLBOX_MAKER_MODULE), 'FalToolboxMakerNode')
  : PlaceholderNode;

// Phase 4 阶段:全部 24 个节点均已实现业务逻辑
const SPECIFIC_NODES: Record<string, any> = {
  // Core (9)
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  'video-edit': VideoEditNode,
  seedance: SeedanceNode, // 完全对齐 gpt-image-2-web Seedance2.0(独立 /seedance/v3 路径)
  seedance25: Seedance25Node,
  'fashvsr-video-upscale': FashVsrNode,
  'director-storyboard': DirectorStoryboardNode,
  story: StoryNode,
  'script-master': ScriptMasterNode,
  'minimax-h3-prompt-enhancer': MiniMaxH3PromptEnhancerNode,
  'minimax-music3-prompt-enhancer': MiniMaxMusic3PromptEnhancerNode,
  'minimax-h3-official-prompt-enhancer': MinimaxH3OfficialPromptEnhancerNode,
  'seedance20-prompt-enhancer': Seedance20PromptEnhancerNode,
  'mv-music-master': MvMusicMasterNode,
  'localization-master': LocalizationMasterNode,
  audio: AudioNode,
  llm: LLMNode,
  runninghub: RunningHubNode,
  // RH 钱包应用：复用 RunningHubNode。v1.2.9.16 起与普通 RunningHub 节点统一使用 settings.rhApiKey
  'runninghub-wallet': RunningHubNode,
  'rh-config': RhConfigNode,
  // RH 工具节点：内置启动器 + 应用运行面板（v1.2.10+）
  'rh-tools': RHToolsNode,
  'rh-toolbox': RHToolboxNode,
  vibex: VibeXNode,
  ...(import.meta.env?.DEV ? { 'rh-toolbox-maker': RHToolboxMakerNode } : {}),
  'fal-toolbox': FalToolboxNode,
  'model-3d-preview': Model3DPreviewNode,
  'model-3d': Model3DNode,
  'grok-image-tools': GrokImageToolsNode,
  'face-expression-3d': FaceExpression3DNode,
  'previs-studio': PrevisStudioNode,
  'model-3d-upload': UploadNode,
  'grok-oauth-agent': GrokOAuthAgentNode,
  'codex-cli-agent': CodexCliAgentNode,
  'codex-image-conjure': CodexImageConjureNode,
  'artist-style-master': ArtistStyleMasterNode,
  'anime-tag-master': AnimeTagMasterNode,
  ...(import.meta.env?.DEV ? { 'fal-toolbox-maker': FalToolboxMakerNode } : {}),
  'comfyui-store': ComfyUIStoreNode,
  'comfyui-app-maker': ComfyUIAppMakerNode,
  // Special (5)
  'multi-angle-3d': PresetImageNode,
  'panorama-720': PresetImageNode,
  'penguin-portrait': PresetImageNode,
  'portrait-metadata': PortraitMetadataNode,
  'storyboard-grid': StoryboardGridNode,
  // Utility (9)
  'drawing-board': DrawingBoardNode,
  browser: BrowserNode,
  'image-compare': ImageCompareNode,
  'frame-extractor': FrameExtractorNode,
  'frame-pair': FramePairNode,
  loop: LoopNode,
  'random-route': RandomRouteNode,
  subflow: SubflowNode,
  'pick-from-set': PickFromSetNode,
  'text-split': TextSplitNode,
  'material-set': MaterialSetNode,
  'generation-target': GenerationTargetNode,
  resize: ResizeNode,
  combine: CombineNode,
  'remove-bg': RemoveBgNode,
  upscale: UpscaleNode,
  'grid-crop': GridCropNode,
  'grid-editor': GridEditorNode,
  // Auxiliary (5)
  edit: ImageNode, // 复用 ImageNode,默认偏向 edit 能力
  idea: IdeaNode,
  bp: BpNode,
  relay: RelayNode,
  'remove-ai-watermark': RemoveAiWatermarkNode,
  'video-output': VideoOutputNode,
  // Toolbox (5)
  cinematic: ToolboxParamNode,
  'video-motion': ToolboxParamNode,
  'multi-angle-visual': ToolboxParamNode,
  'portrait-master': PortraitMasterNode,
  'pose-master': PoseMasterNode,
  'aggregate-parser': AggregateParserNode,
  'batch-processor': BatchProcessorNode,
  'batch-tagger': BatchTaggerNode,
  'topaz-image-upscale': TopazImageUpscaleNode,
  'topaz-video-upscale': TopazVideoUpscaleNode,
  'panorama-3d': Panorama3DNode,
  // Input - 上传素材
  upload: UploadNode,
  // Output (1) - 输出素材(文本/图像/视频/音频 预览 + 文本双击编辑)
  output: OutputNode,
  'volcengine-assets': VolcengineAssetsNode,
  'feishu-bitable-input': FeishuBitableInputNode,
  'feishu-bitable-output': FeishuBitableOutputNode,
};

const WorkflowDoctorHighlightContext = createContext<ReadonlyMap<string, WorkflowDoctorCanvasHighlight>>(new Map());
const NODE_SERIAL_ANCHOR_LEFT = '--t8-node-serial-anchor-left';
const NODE_SERIAL_ANCHOR_TOP = '--t8-node-serial-anchor-top';

function findNodeSerialAnchorTarget(badgeEl: HTMLElement): HTMLElement | null {
  const parent = badgeEl.parentElement;
  if (!parent) return null;
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child === badgeEl) continue;
    if (child.classList.contains('react-flow__handle')) continue;
    if (child.classList.contains('t8-node-serial-badge')) continue;
    if (child.classList.contains('t8-workflow-doctor-node-marker')) continue;
    return child;
  }
  return null;
}

function formatBadgeAnchorPx(value: number): string {
  if (!Number.isFinite(value)) return '0px';
  return `${Math.round(value * 100) / 100}px`;
}

function useNodeSerialBadgeAnchor(badgeRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const badgeEl = badgeRef.current;
    const parentEl = badgeEl?.parentElement;
    if (!badgeEl || !parentEl || typeof window === 'undefined') return;
    const badge = badgeEl;
    const parent = parentEl;

    let frame = 0;
    let observedTarget: HTMLElement | null = null;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(applyAnchor);
    };

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => schedule());
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => schedule());

    function applyAnchor() {
      frame = 0;
      const targetEl = findNodeSerialAnchorTarget(badge);
      if (!targetEl) return;

      if (resizeObserver && observedTarget !== targetEl) {
        if (observedTarget) resizeObserver.unobserve(observedTarget);
        observedTarget = targetEl;
        resizeObserver.observe(targetEl);
      }

      const parentRect = parent.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const scaleX = targetEl.offsetWidth > 0 ? targetRect.width / targetEl.offsetWidth : 1;
      const scaleY = targetEl.offsetHeight > 0 ? targetRect.height / targetEl.offsetHeight : scaleX;
      const anchorLeft = scaleX > 0
        ? (targetRect.right - parentRect.left) / scaleX
        : targetEl.offsetLeft + targetEl.offsetWidth;
      const anchorTop = scaleY > 0
        ? (targetRect.top - parentRect.top) / scaleY
        : targetEl.offsetTop;

      badge.style.setProperty(NODE_SERIAL_ANCHOR_LEFT, formatBadgeAnchorPx(anchorLeft));
      badge.style.setProperty(NODE_SERIAL_ANCHOR_TOP, formatBadgeAnchorPx(anchorTop));
    }

    resizeObserver?.observe(parent);
    mutationObserver?.observe(parent, { childList: true });
    window.addEventListener('resize', schedule);
    applyAnchor();
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', schedule);
      badge.style.removeProperty(NODE_SERIAL_ANCHOR_LEFT);
      badge.style.removeProperty(NODE_SERIAL_ANCHOR_TOP);
    };
  }, [badgeRef, enabled]);
}

function NodeSerialBadge({ data }: { data: unknown }) {
  const serialId = parseNodeSerialInput((data as any)?.nodeSerialId);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  useNodeSerialBadgeAnchor(badgeRef, Boolean(serialId));
  if (!serialId) return null;
  return (
    <span ref={badgeRef} className="t8-node-serial-badge" title={`NodeID #${serialId}`}>
      #{serialId}
    </span>
  );
}

function useWorkflowDoctorPortHighlights(
  markerRef: RefObject<HTMLSpanElement | null>,
  highlight: WorkflowDoctorCanvasHighlight | undefined,
) {
  useLayoutEffect(() => {
    const marker = markerRef.current;
    const parent = marker?.parentElement;
    if (!marker || !parent || !highlight || typeof window === 'undefined') return;
    let frame = 0;
    let marked: HTMLElement[] = [];
    const clear = () => {
      marked.forEach((handle) => {
        handle.classList.remove('t8-workflow-doctor-port-highlight');
        delete handle.dataset.doctorSeverity;
      });
      marked = [];
    };
    const apply = () => {
      frame = 0;
      clear();
      const inputIds = new Set(highlight.inputPortIds);
      const outputIds = new Set(highlight.outputPortIds);
      parent.querySelectorAll<HTMLElement>('.react-flow__handle').forEach((handle) => {
        const rawHandleId = handle.getAttribute('data-handleid');
        const handleId = rawHandleId == null || rawHandleId === '' ? null : rawHandleId;
        const isInput = handle.classList.contains('target') || handle.classList.contains('react-flow__handle-left');
        const isOutput = handle.classList.contains('source') || handle.classList.contains('react-flow__handle-right');
        if ((!isInput || !inputIds.has(handleId)) && (!isOutput || !outputIds.has(handleId))) return;
        handle.classList.add('t8-workflow-doctor-port-highlight');
        handle.dataset.doctorSeverity = highlight.severity;
        marked.push(handle);
      });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => schedule());
    observer?.observe(parent, { childList: true, subtree: true });
    apply();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      clear();
    };
  }, [highlight, markerRef]);
}

function WorkflowDoctorNodeMarker({ nodeId }: { nodeId: string }) {
  const highlights = useContext(WorkflowDoctorHighlightContext);
  const highlight = highlights.get(nodeId);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  useWorkflowDoctorPortHighlights(markerRef, highlight);
  if (!highlight) return null;
  return (
    <span
      ref={markerRef}
      className="t8-workflow-doctor-node-marker"
      data-doctor-severity={highlight.severity}
      title={`工作流医生：${highlight.issueCount} 项 · ${highlight.ruleIds.join('、')}`}
    >
      <span className="t8-workflow-doctor-node-marker__label" aria-hidden="true">! {highlight.issueCount}</span>
    </span>
  );
}

function withNodeSerialBadge(Component: ComponentType<any>): ComponentType<any> {
  const WrappedNode = (props: any) => {
    const performanceRenderingEnabled = useCanvasPerformanceRenderingEnabled();
    const pinned = isPerformancePinnedNode(props);
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const [temperature, setTemperature] = useState<CanvasNodeRenderMode>(() => (
      performanceRenderingEnabled && !pinned ? 'cold' : 'hot'
    ));

    useEffect(() => {
      if (!performanceRenderingEnabled || pinned) {
        setTemperature('hot');
        return undefined;
      }
      const nodeElement = anchorRef.current?.closest<HTMLElement>('.react-flow__node');
      if (!nodeElement) return undefined;
      const syncTemperature = () => {
        setTemperature(nodeElement.dataset.t8ViewportTemperature === 'hot' ? 'hot' : 'cold');
      };
      const onTemperature = (event: Event) => {
        const next = (event as CustomEvent<{ temperature?: unknown }>).detail?.temperature;
        setTemperature(next === 'hot' ? 'hot' : 'cold');
      };
      syncTemperature();
      nodeElement.addEventListener(CANVAS_NODE_TEMPERATURE_EVENT, onTemperature);
      return () => nodeElement.removeEventListener(CANVAS_NODE_TEMPERATURE_EVENT, onTemperature);
    }, [performanceRenderingEnabled, pinned, props?.id]);

    const renderMode: CanvasNodeRenderMode = performanceRenderingEnabled && !pinned ? temperature : 'hot';
    return (
      <CanvasNodeRenderModeProvider mode={renderMode}>
        <Component {...props} />
        {/* Keep the visible node card as the first element child. Every visual
            theme intentionally skins that stable surface with
            `.react-flow__node > div:first-child`; placing the performance
            observer anchor before it silently disabled light-mode styling. */}
        <span ref={anchorRef} className="t8-node-temperature-anchor" aria-hidden="true" />
        <NodeSerialBadge data={props?.data} />
        <WorkflowDoctorNodeMarker nodeId={String(props?.id || '')} />
      </CanvasNodeRenderModeProvider>
    );
  };
  WrappedNode.displayName = `NodeSerialBadge(${Component.displayName || Component.name || 'Node'})`;
  return WrappedNode;
}

// 节点初始 data(用于区分共享组件的 kind/preset/model 等)
const INITIAL_DATA: Record<string, Record<string, any>> = {
  image: { model: 'gpt-image-2', apiModel: 'gpt-image-2', aspectRatio: '1:1', sizeLevel: '1K', gptImageQuality: 'auto', gptImageModeration: 'auto', qwenSizingMode: 'auto', qwenResolution: '1k', qwenCustomSize: '1024*1024', qwenImageCount: 1, qwenSeed: -1, qwenNegativePrompt: '', qwenPromptExtend: true, referenceImages: [], imageOnlyOutput: true, reuseResult: false },
  edit: { mode: 'edit', model: 'gpt-image-2', apiModel: 'gpt-image-2', aspectRatio: '1:1', sizeLevel: '1K', gptImageQuality: 'auto', gptImageModeration: 'auto', qwenSizingMode: 'auto', qwenResolution: '1k', qwenCustomSize: '1024*1024', qwenImageCount: 1, qwenSeed: -1, qwenNegativePrompt: '', qwenPromptExtend: true, referenceImages: [], imageOnlyOutput: true, reuseResult: false },
  video: { reuseResult: false },
  'video-edit': { ...DEFAULT_VIDEO_EDIT_DATA, clips: [], settings: { ...DEFAULT_VIDEO_EDIT_DATA.settings }, job: { ...DEFAULT_VIDEO_EDIT_DATA.job } },
  seedance: {
    seedanceApiSource: 'auto',
    seedanceNzModel: 'fast',
    model: 'doubao-seedance-2-0-fast-260128',
    duration: 5,
    ratio: '16:9',
    resolution: '480p',
    generateAudio: true,
    returnLastFrame: false,
    watermark: false,
    webSearch: false,
    seed: -1,
    maxPoll: 360,
    pollInt: 10,
    frameMode: 'auto',
    reuseResult: false,
  },
  seedance25: {
    seedanceApiSource: 'seedance-nz',
    model: 'seedance-2.5-global-standard-i2v',
    duration: 5,
    ratio: 'adaptive',
    resolution: '720p',
    generateAudio: true,
    returnLastFrame: false,
    seed: -1,
    maxPoll: 720,
    pollInt: 5,
    reuseResult: false,
  },
  'fashvsr-video-upscale': {
    fashVsrVariant: true,
    videoBuiltinSource: 'seedance-nz',
    mainId: 'fashvsr-video-upscale',
    model: 'FlashVSR_video_upscale',
    localRefVideos: [],
    reuseResult: false,
  },
  'director-storyboard': {
    seedanceApiSource: 'auto',
    seedanceNzModel: 'fast',
    model: 'doubao-seedance-2-0-fast-260128',
    ratio: '16:9',
    resolution: '480p',
    generateAudio: true,
    returnLastFrame: false,
    watermark: false,
    webSearch: false,
    seed: -1,
    directorBridgePanelEnabled: false,
    bridgeEnabled: false,
    bridgeDurationSec: 4,
    bridgePrompt: '',
    directorBridgePromptPresets: [],
    directorBridgeSelectedPresetId: '',
    directorBridgePresetName: '',
    shots: [
      { id: 'shot-1', title: 'S1', durationSec: 5, prompt: '', frameMode: 'auto', localRefImages: [], localRefVideos: [], localRefAudios: [] },
      { id: 'shot-2', title: 'S2', durationSec: 5, prompt: '', frameMode: 'auto', localRefImages: [], localRefVideos: [], localRefAudios: [] },
      { id: 'shot-3', title: 'S3', durationSec: 5, prompt: '', frameMode: 'auto', localRefImages: [], localRefVideos: [], localRefAudios: [] },
    ],
    shotResults: {},
    videoUrls: [],
    outputText: '',
    status: 'idle',
  },
  story: {
    storyProject: null,
    storyRunMode: 'all',
    storyRunTargetId: '',
    storyRunRequestId: '',
    outputText: '',
    videoUrl: '',
    videoUrls: [],
    status: 'idle',
  },
  'script-master': {
    scriptMasterProject: null,
    scriptMasterProjectId: '',
    scriptMasterRevision: 0,
    outputText: '',
    prompt: '',
    status: 'idle',
    error: '',
  },
  cinematic: { kind: 'cinematic', cinematicLanguage: 'en', cinematicStrength: 'balanced' },
  'video-motion': { kind: 'video-motion', motionLanguage: 'en' },
  'portrait-master': {
    portraitLanguage: 'en',
    portraitSelection: {},
    portraitLocks: {},
    portraitWeights: {},
    portraitCustomText: '',
    prompt: '',
  },
  'pose-master': {
    kind: 'pose-master',
    poseLanguage: 'en',
    posePresetId: 'standing',
    poseViewId: 'front',
    poseShotId: 'full-body',
    poseIntensityId: 'natural',
    poseBatchCount: 4,
    poseBatchMode: 'next',
    poseFavorites: [],
    poseCustomText: '',
    prompt: '',
  },
  'aggregate-parser': {
    aggregateParserInput: '',
    aggregateParserMode: 'download',
    aggregateParserModeUserSet: false,
    aggregateParserProxy: '',
    aggregateParserCookie: '',
    aggregateParserAcceptedCompliance: false,
    aggregateParserPreferUpstream: true,
    aggregateParserResult: null,
    aggregateParserMedia: [],
    prompt: '',
    outputText: '',
    textSegments: [],
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrls: [],
    status: 'idle',
  },
  'batch-processor': {
    batchProcessorItems: [],
    batchProcessorResults: [],
    batchProcessorProgress: { total: 0, done: 0, ok: 0, fail: 0, running: 0, pending: 0, percent: 0, status: 'idle' },
    batchProcessorNameMode: 'original',
    batchProcessorRenamePattern: 'batch-{index}-{name}',
    batchProcessorSequenceStart: 1,
    batchProcessorIndexPadding: 3,
    batchProcessorOutputFormat: 'keep',
    batchProcessorOperation: 'trim',
    batchProcessorTrimBlackBars: true,
    batchProcessorTrimMode: 'auto',
    batchProcessorTrimAxis: 'vertical',
    batchProcessorTrimStrategy: 'auto',
    batchProcessorTrimThreshold: 18,
    batchProcessorTrimManualTop: 0,
    batchProcessorTrimManualRight: 0,
    batchProcessorTrimManualBottom: 0,
    batchProcessorTrimManualLeft: 0,
    batchProcessorRemoveBg: false,
    batchProcessorCutoutOutputRatio: 'keep',
    batchProcessorExpandCanvas: false,
    batchProcessorExpandPresetId: 'landscape-16-9',
    batchProcessorPadBackground: '#00000000',
    batchProcessorUpscale: false,
    batchProcessorLocalConcurrency: 4,
    batchProcessorRhConcurrency: 2,
    batchProcessorRetryCount: 1,
    batchProcessorContinueOnError: true,
    batchProcessorQuality: 90,
    status: 'idle',
    error: '',
  },
  'batch-tagger': {
    batchTagItems: [],
    batchTagResults: [],
    batchTagProgress: { total: 0, done: 0, ok: 0, fail: 0, running: 0, pending: 0, percent: 0, status: 'idle' },
    batchTagMode: 'tags',
    batchTagProviderSource: 'zhenzhen',
    batchTagProviderId: '',
    batchTagProviderModel: 'gpt-4o-mini',
    batchTagVideoMode: 'frames',
    batchTagFrameCount: 8,
    batchTagMaxTags: 30,
    batchTagFormats: ['txt'],
    batchTagConcurrency: 2,
    batchTagRetryCount: 1,
    batchTagContinueOnError: true,
    batchTagOverwrite: false,
    batchTagPrompt: '',
    outputText: '',
    metadata: null,
    status: 'idle',
    error: '',
  },
  'topaz-image-upscale': {
    topazGigapixelPath: '',
    topazGigapixelModel: 'std',
    topazGigapixelScale: 2,
    topazGigapixelEnableSettings: true,
    topazGigapixelDenoise: 1,
    topazGigapixelSharpen: 1,
    topazGigapixelCompression: 67,
    topazGigapixelFineDetail: 50,
    topazGigapixelPreDownscaling: 75,
    topazGigapixelShowAdvanced: false,
    imageUrl: '',
    imageUrls: [],
    urls: [],
    status: 'idle',
    error: '',
  },
  'topaz-video-upscale': {
    topazVideoPath: '',
    topazVideoEnableUpscale: true,
    topazVideoUpscaleModel: 'iris-3',
    topazVideoUpscaleFactor: 2,
    topazVideoCompression: 1,
    topazVideoBlend: 0,
    topazVideoEnableInterpolation: false,
    topazVideoInputFps: 24,
    topazVideoInterpolationMultiplier: 2,
    topazVideoInterpolationModel: 'apo-8',
    topazVideoUseGpu: true,
    topazVideoPreserveAudio: true,
    topazVideoShowAdvanced: false,
    videoUrl: '',
    videoUrls: [],
    status: 'idle',
    error: '',
  },
  'text-split': {
    sourceText: '',
    splitMode: 'line',
    delimiter: '---',
    chunkSize: 600,
    regexPattern: '',
    regexFlags: 'gm',
    regexStrategy: 'split',
    removeEmpty: true,
    trim: true,
    normalizeSpaces: false,
    stripNumbering: false,
    preferUpstream: true,
    textSplitFavorites: [],
    textSegments: [],
    segments: [],
  },
  'multi-angle-visual': {
    kind: 'multi-angle-visual',
    multiAngleAzimuth: 0,
    multiAngleElevation: 0,
    multiAngleDistance: 5,
    multiAnglePromptMode: 'qwen',
    multiAngleLanguage: 'en',
    multiAngleBatchMode: 'single',
    multiAngleBatchCustomAngles: '',
    multiAnglePrefix: '',
    multiAngleSuffix: '',
    multiAngleCustom: '',
    multiAngleFavorites: [],
    prompt: '<sks> front view eye-level shot medium shot',
  },
  'multi-angle-3d': { preset: 'multi-angle-3d' },
  'panorama-720': { preset: 'panorama-720' },
  'penguin-portrait': { preset: 'penguin-portrait' },
  audio: { mode: 'generate', version: 'v5.5', title: '', tags: '', seed: 0, continueAt: 28, reuseResult: false },
  runninghub: { reuseResult: false },
  'runninghub-wallet': { reuseResult: false },
  llm: {
    model: 'gemini-3.5-flash',
    system: '',
    prompt: '',
    temperature: 0.7,
    maxTokens: 16384,
    stream: true,
    history: [],
  },
  'minimax-h3-prompt-enhancer': {
    userPrompt: '',
    taskType: 'T2VA',
    durationSeconds: 5,
    shotCount: 0,
    rewriteMode: 'balanced',
    descriptionTarget: 0,
    outputLanguage: '中文',
    promptMode: '官方增强',
    officialSkillProfile: '现有兼容（保留中英文）',
    creativePreset: '无（仅核心规则）',
    referenceTemplate: '',
    referenceContext: '',
    constraints: '',
    seed: 0,
    llmApiSource: 'seedance-nz',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    status: 'idle',
    error: '',
    enhancedPrompt: '',
    prompt: '',
  },
  'minimax-music3-prompt-enhancer': {
    musicIdea: '',
    lyrics: '',
    lyricsMode: 'auto',
    qualityMode: 'official-full',
    semanticMode: 'private',
    manualSemanticProfile: '',
    editRequest: '',
    editScope: 'auto',
    editSection: 'Verse',
    editSectionOccurrence: 1,
    structurePreset: 'auto',
    customStructure: '',
    language: 'auto',
    customLanguage: '',
    captionLanguage: 'English',
    meter: 'auto',
    customMeter: '',
    durationSeconds: 0,
    bpm: 0,
    keyScale: '',
    captionWords: 0,
    constraints: '',
    seed: 0,
    llmApiSource: 'seedance-nz',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    status: 'idle',
    error: '',
    lyricsResult: '',
    musicCaption: '',
    music3PayloadJson: '',
    enhancementReportJson: '',
    music3StageCache: {},
  },
  'minimax-h3-official-prompt-enhancer': {
    userPrompt: '',
    model: 'minmax-h3-context-ir-text',
    duration: 4,
    ratio: '16:9',
    status: 'idle',
    error: '',
    progress: '',
    taskId: '',
    taskProvider: 'seedance-nz',
    resultText: '',
    enhancedPrompt: '',
    prompt: '',
  },
  'seedance20-prompt-enhancer': {
    userPrompt: '',
    taskIntent: 'AUTO',
    complexityMode: 'auto',
    durationSeconds: 0,
    shotCount: 0,
    rewriteMode: 'balanced',
    outputDetail: 'auto',
    outputLanguage: '中文',
    promptMode: '官方优化',
    referenceSyntax: 'official-cn',
    subtitlePolicy: 'auto',
    stabilityConstraints: 'auto',
    customLengthTarget: 0,
    referenceTemplate: '',
    referenceRoles: '',
    referenceContext: '',
    constraints: '',
    seed: 0,
    llmApiSource: 'seedance-nz',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    status: 'idle',
    error: '',
    enhancedPrompt: '',
    prompt: '',
  },
  'mv-music-master': {
    lyricsText: '',
    styleDescription: '',
    mvType: 'hybrid',
    creativity: 'balanced',
    shotMode: 'bpm-auto',
    fixedShotCount: 4,
    aspectRatio: '16:9',
    subtitlePolicy: 'lyrics',
    llmApiSource: 'seedance-nz',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    mvImageProvider: 'seedance-nz',
    mvImageModel: 'zhenzhen-image-g2-i2i',
    mvVideoFamily: 'seedance',
    mvVideoProvider: 'seedance-nz',
    mvVideoModel: 'fast',
    mvVideoResolution: '1080p',
    mvComposeResolution: '1080p',
    status: 'idle',
    error: '',
    mvProject: {
      schema: 't8-mv-music-master-project-v1',
      revision: 0,
      stage: 'materials',
      lyricUnits: [],
      lyricWarnings: [],
      approvals: {
        schema: 't8-mv-project-approvals-v1',
        musicRights: false,
        portraitConsent: false,
        styleReferenceRights: false,
        paidGeneration: false,
        maxTasksPerBatch: 50,
        updatedAt: 0,
      },
    },
  },
  'localization-master': {
    mode: 'full',
    sourceLanguage: 'AUTO',
    targetLanguage: 'EN',
    sourceText: '',
    llmApiSource: 'seedance-nz',
    llmModel: 'bytedance/doubao-seed-2.1-pro',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: 'bytedance/doubao-seed-2.1-pro',
    providerParams: {},
    status: 'idle',
    error: '',
    localizationProject: {
      schema: 't8-localization-project-v1',
      revision: 0,
      stage: 'materials',
      mode: 'full',
      sourceLanguage: 'AUTO',
      targetLanguage: 'EN',
      sourceMediaUrl: '',
      sourceMediaKind: 'none',
      sourceText: '',
      units: [],
      glossaryText: '',
      protectedTermsText: '',
      llmApiSource: 'seedance-nz',
      llmModel: 'bytedance/doubao-seed-2.1-pro',
      providerSource: 'zhenzhen',
      providerId: '',
      providerModel: 'bytedance/doubao-seed-2.1-pro',
      providerParams: {},
      voiceProfiles: [],
      timelinePolicy: 'shift',
      timingMode: 'pad',
      asrEnabled: true,
      asrRetryCount: 1,
      asrThreshold: 0.82,
      subtitleTimingMode: 'actual',
      subtitleTextMode: 'asr_passed',
      subtitleIncludeRole: true,
      postprocessPreset: 'voice_clarity',
      postprocessStrength: 0.8,
      modelLicenseConfirmed: false,
      warnings: [],
      updatedAt: 0,
    },
  },
  upload: { uploadType: null },
  'model-3d-upload': { uploadType: 'model3d', lockedUploadType: 'model3d' },
  'material-set': { materialSetKind: null, materialSetItems: [] },
  'generation-target': {
    targetType: 'image',
    title: '生成目标框',
    prompt: '',
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    sizeLevel: '1K',
    status: 'idle',
    resultUrl: '',
    resultUrls: [],
    resultVersions: [],
  },
  // RH 工具节点（v1.2.10.1+）：启动器状态字段 + 运行状态字段（与 RunningHubNode 对齐）
  // 启动器：rhToolsActiveCategoryId / rhToolsActiveAppId / rhToolsSearchQuery
  // 运行态：appInfo / paramValues / instanceType / status / taskId / urls / error / rhCode / materialOrder
  // 输出字段：imageUrl / videoUrl / audioUrl（按扩展名分流给下游 OutputNode）
  'rh-tools': {
    reuseResult: false,
    rhToolsActiveCategoryId: 'all',
    rhToolsActiveAppId: '',
    rhToolsSearchQuery: '',
    appInfo: null,
    paramValues: {},
    materialOrder: [],
    instanceType: '',
    status: 'idle',
    taskId: '',
    urls: [],
    error: '',
    rhCode: 0,
    imageUrl: '',
    videoUrl: '',
    audioUrl: '',
  },
  'rh-toolbox': {
    reuseResult: false,
    rhToolboxCategoryId: 'all',
    rhToolboxActiveToolId: '',
    rhToolboxSearchQuery: '',
    rhToolboxUserParams: {},
    materialOrder: [],
    excludedMaterialIds: [],
    instanceType: '',
    status: 'idle',
    taskId: '',
    urls: [],
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrls: [],
    outputText: '',
    error: '',
  },
  'fal-toolbox': {
    falToolboxCategoryId: 'all',
    falToolboxActiveToolId: '',
    falToolboxSearchQuery: '',
    falToolboxUserParams: {},
    materialOrder: [],
    excludedMaterialIds: [],
    status: 'idle',
    requestId: '',
    urls: [],
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrls: [],
    modelUrls: [],
    modelUrl: '',
    directModelUrl: '',
    directModelUrls: [],
    outputText: '',
    error: '',
  },
  'codex-cli-agent': {
    codexMode: 'chat',
    codexPreset: '提示词增强',
    codexModel: '',
    codexProfile: '',
    codexSandbox: 'workspace-write',
    codexApprovalPolicy: 'never',
    codexReasoningEffort: '',
    codexWebSearch: false,
    codexIncludePlanTool: true,
    codexExecutablePath: '',
    codexExtraArgs: '',
    codexSessionId: '',
    codexSelectedSkillNames: [],
    codexMessages: [],
    codexArtifacts: [],
    codexVersions: [],
    materialOrder: [],
    excludedMaterialIds: [],
    codexQuickPrompt: '',
    codexQuickPromptMentions: [],
    codexPersistPrompt: false,
    codexBriefSubject: '',
    codexBriefStyle: '',
    codexBriefCamera: '',
    codexBriefLighting: '',
    codexBriefComposition: '',
    codexTargetPlatform: '通用',
    codexAspectRatio: '自动',
    codexStyleLock: '',
    codexNegativePrompt: '',
    codexAutoNegativePrompt: true,
    codexBatchVariantCount: 1,
    codexLastRunSummary: '',
    outputText: '',
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrls: [],
    modelUrl: '',
    modelUrls: [],
    status: 'idle',
    error: '',
  },
  'codex-image-conjure': {
    codexConjurePrompt: '',
    codexConjurePromptMentions: [],
    codexConjureTemplateId: '',
    codexConjureSnippetQuery: '',
    codexConjureSelectedSkillNames: ['imagegen'],
    codexConjureModel: 'gpt-5.5',
    codexConjureAspectRatio: '9:16',
    codexConjureSize: '2K',
    codexConjureQuality: '高',
    codexConjureCount: 1,
    codexConjureBatchCount: 1,
    codexConjureConcurrency: 1,
    codexConjurePromptMode: '原始模式',
    codexConjureFormat: 'png',
    codexConjureBackground: '自动',
    codexConjureNegativePrompt: '',
    codexConjureAutoPublish: true,
    codexConjurePersistPrompt: true,
    codexConjurePersistRefs: true,
    codexConjureGalleryQuery: '',
    codexConjureGalleryRefs: [],
    codexConjureMaterialOrder: [],
    codexConjureExcludedMaterialIds: [],
    codexConjureTasks: [],
    codexConjureLastRunSummary: '',
    outputText: '',
    imageUrl: '',
    imageUrls: [],
    status: 'idle',
    error: '',
  },
  'model-3d-preview': {
    modelUrl: '',
    modelUrls: [],
    modelPreviewIndex: 0,
    modelPreviewAutoRotate: true,
    imageUrl: '',
    imageUrls: [],
    urls: [],
    outputText: '',
    status: 'idle',
    error: '',
    size: { w: 520, h: 440 },
  },
  'model-3d': {
    threeDTab: 'hunyuan-3d',
    model: 'hunyuan3d-v3.1-text-to-3d',
    prompt: '',
    faceCount: 500000,
    enablePbr: false,
    generateType: 'Normal',
    materialOrder: [],
    modelUrl: '',
    modelUrls: [],
    urls: [],
    status: 'idle',
    progress: '',
    error: '',
    size: { w: 360, h: 560 },
  },
  'grok-image-tools': {
    grokToolMode: 'segment',
    sourceTaskId: '',
    includeMaskRle: false,
    grokImageId: '',
    grokObjects: [],
    grokSegmentationResult: null,
    prompt: '',
    selectionMode: 'object_indices',
    selectionJson: '[0]',
    imageUrl: '',
    imageUrls: [],
    urls: [],
    status: 'idle',
    progress: '',
    error: '',
    size: { w: 360, h: 520 },
  },
  'face-expression-3d': {
    faceExpression3DState: defaultFaceExpressionState(),
    imageUrl: '',
    imageUrls: [],
    urls: [],
    metadata: null,
    status: 'idle',
    error: '',
    size: { w: 520, h: 520 },
  },
  'previs-studio': {
    previsProject: null,
    previsProjectRevision: 0,
    previsRunKind: 'image',
    previsRunRequestId: '',
    previsSource: {
      repository: 'https://github.com/GuiYi-Xi/monoform-previs-studio',
      commit: '77f4bae83eeee550a6f416757231f438155bf674',
      author: 'GuiYi-Xi',
    },
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    outputText: '',
    metadata: null,
    status: 'idle',
    error: '',
    size: { w: 500, h: 460 },
  },
  'comfyui-store': {
    comfyuiStoreProviderId: '',
    comfyuiStoreCategoryId: 'all',
    comfyuiStoreActiveAppId: '',
    comfyuiStoreSearchQuery: '',
    comfyuiStoreParamValues: {},
    materialOrder: [],
    excludedMaterialIds: [],
    status: 'idle',
    taskId: '',
    imageUrl: '',
    imageUrls: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrls: [],
    outputText: '',
    outputKinds: [],
    primaryKind: '',
    outputSaveErrors: [],
    error: '',
  },
  'comfyui-app-maker': {
    comfyMakerTitle: 'Anima 文生图',
    comfyMakerAppId: 'anima-text-to-image-v1',
    comfyMakerCategoryId: 'image',
    comfyMakerDescription: '从 ComfyUI API Workflow 自动生成的本地应用',
    comfyMakerWorkflowRaw: '',
    text: '',
    outputText: '',
  },
  ...(import.meta.env?.DEV ? {
    'rh-toolbox-maker': {
      rhToolboxMakerTitle: '智能抠图',
      rhToolboxMakerId: 'image-cutout-v1',
      rhToolboxMakerDescription: '维护者预置 RH 工具模板',
      rhToolboxMakerCategoryId: 'image-tools',
      rhToolboxMakerWebappId: '',
      rhToolboxMakerCapabilities: 'image.cutout\nimage.edit',
      rhToolboxMakerEnabled: true,
      rhToolboxMakerShowInNode: true,
      rhToolboxMakerAccent: '#22c55e',
      rhToolboxMakerPollIntervalMs: 5000,
      rhToolboxMakerMaxPolls: 720,
      rhToolboxMakerInputs: [
        {
          rowId: 'input-1',
          key: 'source-image',
          label: '原图',
          kind: 'image',
          rhNodeId: '7',
          fieldName: 'image',
          required: true,
          uploadAsset: true,
        },
      ],
      rhToolboxMakerOutputs: [
        {
          rowId: 'output-1',
          key: 'output-image',
          label: '输出图',
          kind: 'image',
          role: 'append-output',
        },
      ],
      rhToolboxMakerUserParams: [],
      rhToolboxMakerFixedParams: [],
      text: '',
      outputText: '',
    },
    'fal-toolbox-maker': {
      falToolboxMakerUrl: 'https://fal.ai/models/xai/grok-imagine-image/quality/edit/api',
      falToolboxMakerEndpoint: 'xai/grok-imagine-image/quality/edit',
      falToolboxMakerTitle: 'Grok Imagine Image Edit',
      falToolboxMakerId: 'grok-imagine-image-edit',
      falToolboxMakerCategoryId: 'image-edit',
      falToolboxMakerDescription: '从 fal.ai API 文档生成的 Fal 超市草稿',
      falToolboxMakerCapabilities: 'image.edit\nimage.generate',
      falToolboxMakerOutputKind: 'image',
      falToolboxMakerHasImageInput: true,
      falToolboxMakerImageMultiple: false,
      falToolboxMakerImageBase64: true,
      text: '',
      outputText: '',
    },
  } : {}),
  // 循环器: 默认串联 + image kind
  loop: { mode: 'serial', kind: 'image', outputs: [], progress: { done: 0, total: 0, ok: 0, fail: 0 } },
  // 随机路由: 默认 10 个输出口，每次随机放行 1 个分支。
  'random-route': {
    randomRouteTotalOutputs: 10,
    randomRoutePassCount: 1,
    randomRouteActiveHandles: [],
    randomRouteLastOrder: [],
    randomRouteLastOkCount: 0,
    randomRouteLastFailCount: 0,
    status: 'idle',
    error: '',
  },
  // 从合集获取: 默认 image + 第 1 个
  'pick-from-set': { pickKind: 'image', pickIndex: 1 },
  'image-compare': { mode: 'slider', align: 'contain', split: 50, opacity: 50, threshold: 24 },
  'panorama-3d': {
    panoramaRatio: 'ultrawide',
    panoramaCustomW: 21,
    panoramaCustomH: 9,
    panoramaYaw: 0,
    panoramaPitch: 0,
    panoramaFov: 75,
    panoramaAutoRotate: false,
    panoramaPanelMode: 'text',
    panoramaGenerationMode: 'text',
    panoramaSizeLevel: '1K',
    panoramaPrompt: '',
    panoramaPromptFinal: '',
    panoramaViewerPosition: '',
    panoramaViewCenter: '',
    panoramaSourceUrl: '',
    panoramaGeneratedUrl: '',
    panoramaReferenceUrl: '',
    panoramaGeneratedHistory: [],
    panoramaCameraViews: [],
    panoramaActiveCameraViewId: '',
    panoramaHotspots: [],
    panoramaAvatars: [],
    panoramaAvatarKeyframes: [],
    panoramaKeyframeSequenceCount: 8,
    panoramaOcclusionMasks: [],
    panoramaOcclusionMaskVisible: true,
    panoramaActiveAvatarId: '',
    panoramaSceneSnapshot: null,
    panoramaControlSnapshotUrl: '',
    panoramaActionPrompt: '',
    panoramaActionPlan: null,
    panoramaAvatarPanelOpen: true,
    panoramaAvatarPickMode: false,
    panoramaAvatarIkEditMode: false,
    panoramaActorOverlayVisible: true,
    panoramaCompositionGuide: 'off',
    panoramaSceneLegendVisible: true,
    panoramaScenePrompt: '',
    panoramaStoryboardPromptEnabled: false,
    panoramaStoryboardPromptText: '｛［人物］是@在做［动作］，｝',
    panoramaStoryboardPromptSnapshotText: '',
    panoramaStoryboardPresetPrompt: '｛［人物］是@在做［动作］，｝',
    panoramaStoryboardPresetName: '',
    panoramaStoryboardPromptPresets: [],
    panoramaStoryboardSelectedPresetId: '',
    panoramaShotCamera: {
      mode: 'panorama-view',
      presetId: 'full-body',
      targetAvatarId: '',
      targetBone: 'body',
      framingRatio: '16:9',
      closeupStrength: 28,
      lowAngle: 10,
    },
    imageUrl: '',
    imageUrls: [],
    urls: [],
    status: 'idle',
  },
  vibex: {
    vibexFrameMode: 'online',
    vibexCustomUrl: '',
    vibexNodeWidth: 1080,
    vibexNodeHeight: 820,
    label: 'VibeX工作台',
  },
  'feishu-bitable-input': {
    feishuApiBase: 'https://open.feishu.cn',
    feishuLink: '',
    feishuAppToken: '',
    feishuTableId: '',
    feishuViewId: '',
    feishuTextField: '',
    feishuRecordLimit: 20,
    feishuFields: [],
    feishuRows: [],
    textSegments: [],
    imageUrls: [],
    videoUrls: [],
    audioUrls: [],
    status: 'idle',
  },
  'volcengine-assets': {
    volcengineAssetsProfileId: 'volcengine',
    volcengineAssetsProjectName: '',
    volcengineAssetsResolvedProject: 'default',
    volcengineAssetsGroupId: '',
    volcengineAssetsPageNumber: 1,
    volcengineAssetsRelayTargetId: '',
    selectedAssets: [],
    outputs: { image: { imageUrl: '', imageUrls: [] }, video: { videoUrl: '', videoUrls: [] }, audio: { audioUrl: '', audioUrls: [] } },
    imageUrl: '', imageUrls: [], videoUrl: '', videoUrls: [], audioUrl: '', audioUrls: [],
    status: 'idle',
  },
  'feishu-bitable-output': {
    feishuApiBase: 'https://open.feishu.cn',
    feishuOutputLink: '',
    feishuOutputAppToken: '',
    feishuOutputTableId: '',
    feishuOutputRecordId: '',
    feishuWriteMode: 'auto',
    feishuWriteTextField: 'T8文本',
    feishuWriteAttachmentField: 'T8附件',
    feishuWriteStatusField: 'T8状态',
    feishuWriteAttachments: true,
    feishuWritePreview: null,
    status: 'idle',
  },
  'drawing-board': { boardRatio: '16:9', boardWidth: 960, boardHeight: 540, boardElements: [], boardColor: '#111827', boardStrokeSize: 5 },
  'grid-crop': { rows: 3, cols: 3, gap: 0 },
  'grid-editor': {
    gridEditorRows: 3,
    gridEditorCols: 3,
    gridEditorWidth: 1200,
    gridEditorHeight: 1200,
    gridEditorGap: 0,
    gridEditorBackground: '#111827',
    gridEditorFit: 'adaptive',
    gridEditorShowIndexes: false,
    gridEditorOrder: [],
    gridEditorLocalItems: [],
    gridEditorHiddenIds: [],
  },
  'remove-ai-watermark': {
    aiWatermarkMode: 'smart',
    aiWatermarkProcessAll: false,
    aiWatermarkOptions: {
      mark: 'auto',
      detect: true,
      inpaint: true,
      inpaintMethod: 'ns',
      inpaintStrength: 0.85,
      stripMetadata: true,
      runInvisible: false,
      regions: [],
      backend: 'cv2',
      eraseMethod: 'telea',
      dilate: 3,
      pipeline: 'controlnet',
      device: 'auto',
      steps: 50,
      humanize: 0,
      unsharp: 0,
      upscaler: 'lanczos',
      model: '',
      guidanceScale: '',
      maxResolution: 0,
      minResolution: 1024,
      controlnetScale: 1,
      auto: false,
      adaptivePolish: true,
      restoreFaces: false,
      restoreFacesWeight: 0.5,
      keepStandardMetadata: true,
      noVisible: false,
    },
  },
};

// 网格吸附步长 / 对齐阈值(世界坐标)
const SNAP_GRID: [number, number] = [20, 20];
const EDGE_MOTION_HEAVY_EDGE_COUNT = 36;
const EDGE_MOTION_RELEASE_DELAY_MS = 160;
const ALIGN_THRESHOLD = 6;

interface SendNodeSpec {
  type: NodeType;
  data: Record<string, any>;
}

const WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT = {
  type: 't8:web-image-result',
  source: 't8-web-image-extension',
} as const;

type WebImageExtensionSendMode = 'prompt' | 'image' | 'both' | 'reference';

interface WebImageExtensionPayload {
  messageId?: string;
  mode?: WebImageExtensionSendMode | string;
  prompt?: string;
  images?: Array<string | { url?: string; imageUrl?: string; name?: string; mime?: string; size?: number; width?: number; height?: number; sourceUrl?: string; pageUrl?: string }>;
  imageUrls?: string[];
  sourceImageUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  source?: string;
  webAssetItems?: Array<{ url?: string; imageUrl?: string; name?: string; mime?: string; size?: number; width?: number; height?: number; sourceUrl?: string; pageUrl?: string }>;
}

type BasicMediaKind = Exclude<MediaKind, 'model3d'>;

function normalizeWebImageSendMode(value: unknown): WebImageExtensionSendMode {
  const mode = String(value || '').trim();
  return mode === 'prompt' || mode === 'image' || mode === 'both' || mode === 'reference' ? mode : 'both';
}

function cleanWebImageText(value: unknown, maxLen = 8000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function webImagePayloadImages(payload: WebImageExtensionPayload): MediaItem[] {
  const raw = Array.isArray(payload.images) ? payload.images : Array.isArray(payload.webAssetItems) ? payload.webAssetItems : payload.imageUrls;
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const url = typeof item === 'string' ? item : item?.url || item?.imageUrl || '';
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    out.push({
      kind: 'image',
      url: cleanUrl,
      name: typeof item === 'string' ? fileNameFromUrl(cleanUrl) : (item.name || fileNameFromUrl(cleanUrl)),
      mime: typeof item === 'string' ? '' : item.mime || '',
      size: typeof item === 'string' ? 0 : item.size || 0,
    });
  }
  return out.slice(0, 50);
}

function webAssetPayloadMetadata(payload: WebImageExtensionPayload) {
  const raw = Array.isArray(payload.webAssetItems) ? payload.webAssetItems : Array.isArray(payload.images) ? payload.images : [];
  return raw
    .filter((item) => !!item && typeof item === 'object')
    .map((item: any) => ({
      url: String(item.url || item.imageUrl || '').slice(0, 4096),
      name: String(item.name || '').slice(0, 200),
      mime: String(item.mime || '').slice(0, 120),
      size: Math.max(0, Number(item.size) || 0),
      width: Math.max(0, Number(item.width) || 0),
      height: Math.max(0, Number(item.height) || 0),
      sourceUrl: String(item.sourceUrl || '').slice(0, 4096),
      pageUrl: String(item.pageUrl || payload.pageUrl || '').slice(0, 2048),
    }))
    .slice(0, 50);
}

function buildWebImageSendNodeSpecs(payload: WebImageExtensionPayload): SendNodeSpec[] {
  const mode = normalizeWebImageSendMode(payload.mode);
  const prompt = cleanWebImageText(payload.prompt);
  const includePromptInOutput = mode === 'both' && !!prompt;
  const sourceImageUrl = cleanWebImageText(payload.sourceImageUrl, 2048);
  const pageUrl = cleanWebImageText(payload.pageUrl, 2048);
  const pageTitle = cleanWebImageText(payload.pageTitle, 200);
  const specs: SendNodeSpec[] = [];
  const imageItems = webImagePayloadImages(payload);
  if (mode === 'reference' && imageItems.length > 0) {
    specs.push({
      type: 'upload',
      data: {
        ...createUploadDataFromItems('image', imageItems),
        label: `网页采集 · ${imageItems.length} 张`,
        sendSource: 'web-asset-importer',
        source: 'web-asset-importer',
        webAssetImporter: true,
        webAssetItems: webAssetPayloadMetadata(payload),
        webAssetPageUrl: pageUrl,
        webAssetPageTitle: pageTitle,
      },
    });
    return specs;
  }
  if (mode === 'prompt' && prompt) {
    specs.push({
      type: 'text',
      data: {
        prompt,
        text: prompt,
        label: '网页反推提示词',
        source: 'web-image-reverse',
        webImageReversePrompt: prompt,
        webImageReverseSourceImageUrl: sourceImageUrl,
        webImageReversePageUrl: pageUrl,
        webImageReversePageTitle: pageTitle,
      },
    });
  }
  if ((mode === 'image' || mode === 'both') && imageItems.length > 0) {
    specs.push({
      type: 'output',
      data: {
        ...createOutputDataFromItems('image', imageItems),
        ...(includePromptInOutput ? {
          prompt,
          outputText: prompt,
          directOutputText: prompt,
          webImageReversePrompt: prompt,
        } : {}),
        sendSource: 'web-image-reverse',
        source: 'web-image-reverse',
        webImageReverseSourceImageUrl: sourceImageUrl,
        webImageReversePageUrl: pageUrl,
        webImageReversePageTitle: pageTitle,
      },
    });
  }
  return specs;
}

function mediaItemsFromSendables(items: SendableMaterial[], kind: BasicMediaKind): MediaItem[] {
  return items
    .map(sendableToMediaItem)
    .filter((item): item is MediaItem => !!item && item.kind === kind);
}

function cloneRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...(value as Record<string, any>) };
  }
}

function portraitMasterDataFromSource(data: unknown): Record<string, any> | null {
  const cloned = cloneRecord(data);
  const hasConfig = cloned.portraitMetadata || cloned.portraitSelection || cloned.portraitSummary || cloned.portraitStats;
  if (!hasConfig) return null;
  [
    'status',
    'error',
    'taskId',
    'progress',
    'isRunning',
    'isPolling',
    'pollingTimer',
    'sentFromMaterialBridge',
    'sendBridgeSignature',
    'sendBridgeMode',
    'sendBridgeSourceCanvasId',
    'sendBridgeSourceNodeIds',
    'sendBridgeCreatedAt',
  ].forEach((key) => {
    delete cloned[key];
  });
  const promptText = String(cloned.prompt || cloned.outputText || cloned.text || '').trim();
  cloned.prompt = promptText;
  cloned.text = promptText;
  cloned.outputText = promptText;
  return cloned;
}

function buildSendNodeSpecs(materials: SendableMaterial[], mode: SendTargetMode): SendNodeSpec[] {
  const buckets = bucketSendableMaterials(materials);
  const specs: SendNodeSpec[] = [];
  const textValues = buckets.text.map((item) => (item.text || '').trim()).filter(Boolean);
  const mediaKinds: BasicMediaKind[] = ['image', 'video', 'audio'];

  if (mode === 'portrait-master') {
    const seen = new Set<string>();
    for (const item of materials) {
      if (item.sourceType !== 'portrait-master' || !item.sourceNodeData) continue;
      const key = item.sourceNodeId || JSON.stringify(item.sourceNodeData.portraitMetadata || item.sourceNodeData.portraitSelection || {});
      if (seen.has(key)) continue;
      const data = portraitMasterDataFromSource(item.sourceNodeData);
      if (!data) continue;
      seen.add(key);
      specs.push({ type: 'portrait-master', data });
    }
    return specs;
  }

  if (mode === 'material-set') {
    for (const kind of ['image', 'video', 'audio', 'text'] as MaterialSetKind[]) {
      if (buckets[kind].length === 0) continue;
      specs.push({
        type: 'material-set',
        data: materialSetItemsToData(kind, buckets[kind]),
      });
    }
    return specs;
  }

  if (mode === 'output') {
    for (const kind of mediaKinds) {
      const items = mediaItemsFromSendables(buckets[kind], kind);
      if (items.length === 0) continue;
      specs.push({
        type: 'output',
        data: {
          ...createOutputDataFromItems(kind, items),
          sendSource: 'cross-canvas',
        },
      });
    }
    if (textValues.length > 0) {
      specs.push({
        type: 'output',
        data: {
          directOutputText: textValues.join('\n\n'),
          directTextSegments: textValues,
          textSegments: textValues,
          sendSource: 'cross-canvas',
        },
      });
    }
    return specs;
  }

  if (mode === 'split-upload') {
    for (const kind of mediaKinds) {
      const items = mediaItemsFromSendables(buckets[kind], kind);
      for (const item of items) {
        specs.push({
          type: 'upload',
          data: createUploadDataFromItems(kind, [item]),
        });
      }
    }
    textValues.forEach((text) => {
      specs.push({ type: 'text', data: { prompt: text, text } });
    });
    return specs;
  }

  for (const kind of mediaKinds) {
    const items = mediaItemsFromSendables(buckets[kind], kind);
    if (items.length === 0) continue;
    specs.push({
      type: 'upload',
      data: createUploadDataFromItems(kind, items),
    });
  }
  textValues.forEach((text) => {
    specs.push({ type: 'text', data: { prompt: text, text } });
  });
  return specs;
}

function basePositionForAppend(existingNodes: Node[]): { x: number; y: number } {
  const normalNodes = existingNodes.filter((node) => node.id !== BULK_PHANTOM_ID);
  if (normalNodes.length === 0) return { x: 80, y: 80 };
  const rects = normalNodes.map((node) => rectOf(node));
  const maxRight = Math.max(...rects.map((rect) => rect.x + rect.w));
  const minY = Math.min(...rects.map((rect) => rect.y));
  return { x: maxRight + 120, y: minY };
}

function materialNodesFromSpecs(
  specs: SendNodeSpec[],
  existingNodes: Node[],
  base: { x: number; y: number },
  bridge?: { signature: string; mode: SendTargetMode; sourceCanvasId?: string | null; sourceNodeIds?: string[] },
): Node[] {
  const stamp = Date.now();
  const desired = specs.map((spec, index) => {
    const size = defaultSizeOf(spec.type);
    return {
      x: base.x + (index % 2) * (size.w + 80),
      y: base.y + Math.floor(index / 2) * (size.h + 80),
      w: size.w,
      h: size.h,
    };
  });
  const offset = placeBatchNodes(desired, existingNodes, {
    source: 'placement:send-materials',
  });
  return specs.map((spec, index) => ({
    id: `${spec.type}-send-${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    type: spec.type,
    position: {
      x: desired[index].x + offset.dx,
      y: desired[index].y + offset.dy,
    },
    selected: true,
    data: {
      ...(INITIAL_DATA[spec.type] || {}),
      ...spec.data,
      sentFromMaterialBridge: true,
      sendBridgeSignature: bridge?.signature || '',
      sendBridgeMode: bridge?.mode,
      sendBridgeSourceCanvasId: bridge?.sourceCanvasId || undefined,
      sendBridgeSourceNodeIds: bridge?.sourceNodeIds || [],
      sendBridgeCreatedAt: stamp,
    },
  })) as Node[];
}

function placeInstantiatedNodeFragment(
  instance: InstantiatedSendNodeFragment,
  existingNodes: Node[],
): InstantiatedSendNodeFragment {
  if (instance.nodes.length === 0) return instance;
  const desiredRects = instance.nodes.map((node) => rectOf(node));
  const offset = placeBatchNodes(desiredRects, existingNodes, {
    source: 'placement:send-node-fragment',
  });
  if (offset.dx === 0 && offset.dy === 0) return instance;
  return {
    ...instance,
    nodes: instance.nodes.map((node) => ({
      ...node,
      position: {
        x: (node.position?.x ?? 0) + offset.dx,
        y: (node.position?.y ?? 0) + offset.dy,
      },
    })),
  };
}

function sourceNodeIdsFromMaterials(materials: SendableMaterial[]): string[] {
  const ids = new Set<string>();
  materials.forEach((item) => {
    if (typeof item.sourceNodeId === 'string' && item.sourceNodeId.trim()) {
      ids.add(item.sourceNodeId.trim());
    }
  });
  return [...ids].sort();
}

function videoEditTargetLabel(node: Node): string {
  const serial = getNodeSerialId(node);
  return serial ? `视频剪辑#${serial}` : `视频剪辑 ${node.id.slice(-6)}`;
}

function selectVideoEditTargetNode(nodes: Node[], targetNodeId?: string | null): Node | null {
  const candidates = nodes.filter((node) => node.type === 'video-edit');
  if (targetNodeId) return candidates.find((node) => node.id === targetNodeId) || null;
  return candidates.length === 1 ? candidates[0] : null;
}

function videoEditPatchFromIncomingClips(data: any, incomingClips: VideoEditClip[]): Record<string, any> {
  const nextClips = appendVideoEditClips(data?.clips, incomingClips);
  return {
    clips: nextClips,
    selectedClipId: data?.selectedClipId && nextClips.some((clip) => clip.id === data.selectedClipId)
      ? data.selectedClipId
      : nextClips[0]?.id || '',
    status: nextClips.length ? 'ready' : 'idle',
    error: '',
    videoEditLastReceivedAt: Date.now(),
  };
}

function removeDuplicateSendBridgeNodes(
  nodes: Node[],
  edges: Edge[],
  materials: SendableMaterial[],
  signature: string,
  sourceCanvasId?: string | null,
): { nodes: Node[]; edges: Edge[]; removed: number } {
  const materialKeys = new Set(
    materials
      .map((item) => sendableMaterialKey(item))
      .filter(Boolean),
  );
  const currentSourceNodeIds = new Set(sourceNodeIdsFromMaterials(materials));
  const normalizedSourceCanvasId = typeof sourceCanvasId === 'string' ? sourceCanvasId : '';
  const removeIds = new Set<string>();
  for (const node of nodes) {
    const data = node.data as any;
    if (!data?.sentFromMaterialBridge) continue;
    if (signature && data.sendBridgeSignature === signature) {
      removeIds.add(node.id);
      continue;
    }
    const nodeSourceCanvasId = typeof data.sendBridgeSourceCanvasId === 'string' ? data.sendBridgeSourceCanvasId : '';
    const nodeSourceIds: string[] = Array.isArray(data.sendBridgeSourceNodeIds)
      ? data.sendBridgeSourceNodeIds.filter(
          (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()),
        )
      : [];
    const sharesSourceNode =
      currentSourceNodeIds.size > 0 &&
      nodeSourceIds.some((nodeId) => currentSourceNodeIds.has(nodeId));
    const bridgeFromSameSourceCanvas =
      Boolean(normalizedSourceCanvasId) &&
      nodeSourceCanvasId === normalizedSourceCanvasId;
    if (sharesSourceNode || bridgeFromSameSourceCanvas) {
      removeIds.add(node.id);
      continue;
    }
    if (data.sendBridgeSignature) continue;
    const nodeKeys = collectSendableMaterialsFromNode(node)
      .map((item) => sendableMaterialKey(item))
      .filter(Boolean);
    if (nodeKeys.length > 0 && nodeKeys.every((key) => materialKeys.has(key))) {
      removeIds.add(node.id);
    }
  }
  if (removeIds.size === 0) return { nodes, edges, removed: 0 };
  return {
    nodes: nodes.filter((node) => !removeIds.has(node.id)),
    edges: edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
    removed: removeIds.size,
  };
}

function centerOfMaterialNodes(nodes: Node[]): { x: number; y: number } | null {
  if (nodes.length === 0) return null;
  const rects = nodes.map((node) => rectOf(node));
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function centerOfNavigableNodes(nodes: Node[]): { x: number; y: number } {
  const valid = (node: Node, includeGroups: boolean) => {
    if (!node.id || node.id === BULK_PHANTOM_ID) return false;
    if ((node as any).hidden) return false;
    if (!includeGroups && node.type === 'groupBox') return false;
    return true;
  };
  const normalNodes = nodes.filter((node) => valid(node, false));
  const fallbackNodes = normalNodes.length > 0 ? normalNodes : nodes.filter((node) => valid(node, true));
  return centerOfMaterialNodes(fallbackNodes) || { x: 0, y: 0 };
}

// 把所有节点类型都注册到对应组件(已实现的用业务组件,其余用 Placeholder)
const nodeTypes = NODE_REGISTRY.reduce<Record<string, any>>((acc, m) => {
  acc[m.type] = withNodeSerialBadge(SPECIFIC_NODES[m.type] || PlaceholderNode);
  return acc;
}, {});
// 节点组容器(不在 NODE_REGISTRY 中,作为独立的视觉容器节点类型)
nodeTypes.groupBox = withNodeSerialBadge(GroupBoxNode);

// SHIFT 批量移线 phantom 节点: 拖拽期间充当边的临时锐点,跟随鼠标移动
function BulkPhantomNode() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent' }} />
    </>
  );
}
nodeTypes.bulkPhantom = BulkPhantomNode;
const BULK_PHANTOM_ID = '__bulk_phantom__';

function findNearestNavigableNode(nodes: Node[], center: { x: number; y: number }): Node | null {
  const valid = (node: Node, includeGroups: boolean) => {
    if (!node.id || node.id === BULK_PHANTOM_ID) return false;
    if ((node as any).hidden) return false;
    if (!includeGroups && node.type === 'groupBox') return false;
    return true;
  };
  const candidates = nodes.filter((node) => valid(node, false));
  const fallbackCandidates = candidates.length > 0 ? candidates : nodes.filter((node) => valid(node, true));
  let best: Node | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  fallbackCandidates.forEach((node) => {
    const rect = rectOf(node);
    const nodeCenter = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const dx = nodeCenter.x - center.x;
    const dy = nodeCenter.y - center.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  });
  return best;
}

function pulseNearestNode(nodeId: string) {
  window.setTimeout(() => {
    const css = (window as any).CSS;
    const safeId = typeof css?.escape === 'function'
      ? css.escape(nodeId)
      : nodeId.replace(/["\\]/g, '\\$&');
    const el = document.querySelector(`.react-flow__node[data-id="${safeId}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.remove('t8-nearest-node-pulse');
    void el.offsetWidth;
    el.classList.add('t8-nearest-node-pulse');
    window.setTimeout(() => el.classList.remove('t8-nearest-node-pulse'), 1300);
  }, 460);
}

// 边类型: 默认边采用可点击断开的 DeletableEdge
const edgeTypes = {
  default: DeletableEdge,
  deletable: DeletableEdge,
};
const performanceEdgeTypes = {
  default: PerformanceEdge,
  deletable: PerformanceEdge,
};

export interface AddNodeOptions {
  atScreen?: { x: number; y: number };
  data?: Record<string, any>;
}

export type AddNodeFn = (type: NodeType, options?: AddNodeOptions) => string;

interface RadialMenuSession {
  anchor: RadialMenuPoint;
  center: RadialMenuPoint;
  cursor: RadialMenuPoint;
  activeIndex: number | null;
}

interface RadialPressState {
  pointerId: number;
  start: RadialMenuPoint;
  timer: number;
  open: boolean;
}

interface FileDragOutFeedback {
  x: number;
  y: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail: string;
}

export interface InsertWorkflowOptions {
  atScreen?: { x: number; y: number };
  title?: string;
}

export type InsertWorkflowFn = (fragment: SendNodeFragment, options?: InsertWorkflowOptions) => void;

const MEDIA_EXTENSIONS: Record<MediaKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
  model3d: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'usdz', 'zip'],
};

const FILE_DRAG_OUT_MOVE_TOLERANCE = 4;
const INTERNAL_NODE_PASTE_DELAY_MS = 120;
const EXTERNAL_MEDIA_PASTE_DEDUPE_MS = 900;
const QUICK_DUPLICATE_OFFSET = { x: 40, y: 40 } as const;
type ClipboardPastePlacementMode = 'pointer' | 'offset';

function inferCanvasMediaKind(file: File): MediaKind | null {
  const mime = file.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
  if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
  if (MEDIA_EXTENSIONS.audio.includes(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.model3d.includes(ext)) return 'model3d';
  return null;
}

function fallbackMediaName(file: File, kind: MediaKind, index: number): string {
  if (file.name) return file.name;
  const ext = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'wav' : 'glb';
  return `canvas-${kind}-${Date.now()}-${index + 1}.${ext}`;
}

async function uploadCanvasMediaFile(file: File, kind: MediaKind, index: number): Promise<MediaItem> {
  const validationError = validateUploadMediaFile(file, kind);
  if (validationError) throw new Error(validationError);

  const fileName = fallbackMediaName(file, kind, index);
  const fd = new FormData();
  fd.append('file', file, fileName);
  const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `上传失败 HTTP ${res.status}`);
  }
  if (!json.success || !json.data?.url) {
    throw new Error(json.error || '上传失败:未返回 URL');
  }
  return {
    kind,
    url: json.data.url,
    name: fileName,
    size: file.size,
    mime: file.type,
  };
}

function collectCanvasMediaFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || !inferCanvasMediaKind(file)) return;
    const key = canvasMediaFileKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  Array.from(dataTransfer.files || []).forEach(push);
  Array.from(dataTransfer.items || []).forEach((item) => {
    if (item.kind === 'file') push(item.getAsFile());
  });
  return files;
}

function canvasMediaFileKey(file: File): string {
  return `${file.name || 'clipboard-file'}|${file.size}|${file.type || 'application/octet-stream'}`;
}

function hasFileTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types || []).includes('Files');
}

type PlacementShelfSource = '粘贴' | '发送' | '生成' | '画布' | '手动';

interface PlacementShelfItem {
  id: string;
  nodeId: string;
  kind: MediaKind | 'node';
  url: string;
  title: string;
  previewUrl?: string;
  source: PlacementShelfSource;
  createdAt: number;
}

function mimeForExternalDrag(kind: string, url: string) {
  const ext = (url.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  if (kind === 'image') {
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/png';
  }
  if (kind === 'video') {
    if (ext === 'webm') return 'video/webm';
    if (ext === 'mov') return 'video/quicktime';
    return 'video/mp4';
  }
  if (kind === 'audio') {
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'ogg') return 'audio/ogg';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'm4a') return 'audio/mp4';
    return 'audio/mpeg';
  }
  return 'application/octet-stream';
}

function absoluteMaterialUrl(url: string) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  const origin = typeof window !== 'undefined' && window.location.protocol !== 'file:'
    ? window.location.origin
    : 'http://127.0.0.1:18766';
  try {
    return new URL(clean, origin).href;
  } catch {
    return clean;
  }
}

function canUseNativeDragOut(url: string) {
  const clean = String(url || '').trim();
  if (!clean) return false;
  if (/^file:\/\//i.test(clean)) return true;
  const prefixes = ['/files/input/', '/input/', '/files/output/', '/output/', '/files/thumbnails/', '/thumbnails/'];
  if (prefixes.some((prefix) => clean.startsWith(prefix))) return true;
  try {
    const parsed = new URL(clean, absoluteMaterialUrl('/'));
    const host = parsed.hostname.toLowerCase();
    const isLocalHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    return isLocalHost && prefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function isLeftRightMouseChord(buttons: number | undefined | null) {
  const mask = Number(buttons || 0);
  return (mask & 1) !== 0 && (mask & 2) !== 0;
}

function placementShelfNodeTitle(node: Node): string {
  const data = (node.data || {}) as any;
  const meta = NODE_REGISTRY.find((item) => item.type === node.type);
  const raw =
    data.title ||
    data.label ||
    data.name ||
    data.displayName ||
    meta?.label ||
    node.type ||
    '节点';
  const title = String(raw).trim();
  return title || '节点';
}

function placementShelfItemFromNode(
  node: Node,
  source: PlacementShelfSource,
  options?: { includeNodeFallback?: boolean },
): PlacementShelfItem | null {
  const data = (node.data || {}) as any;
  for (const kind of ['image', 'video', 'audio', 'model3d'] as MediaKind[]) {
    const first = getMediaItemsFromData(data, kind)[0];
    if (!first?.url) continue;
    return {
      id: `${node.id}:${kind}:${first.url}`,
      nodeId: node.id,
      kind,
      url: first.url,
      previewUrl: kind === 'image' || kind === 'video' ? first.url : undefined,
      title: first.name || fileNameFromUrl(first.url) || PORT_LABEL[kind],
      source,
      createdAt: Date.now(),
    };
  }
  if (options?.includeNodeFallback) {
    return {
      id: `${node.id}:node`,
      nodeId: node.id,
      kind: 'node',
      url: '',
      title: placementShelfNodeTitle(node),
      source,
      createdAt: Date.now(),
    };
  }
  return null;
}

function placementShelfItemsFromCanvasNodes(nodes: Node[], source: PlacementShelfSource): PlacementShelfItem[] {
  return nodes
    .slice()
    .reverse()
    .map((node) => placementShelfItemFromNode(node, source))
    .filter((item): item is PlacementShelfItem => !!item);
}

function findUploadNodeIdFromTarget(target: EventTarget | Element | null | undefined): string {
  if (typeof Element === 'undefined') return '';
  if (!(target instanceof Element)) return '';
  const el = target.closest('[data-upload-node-id]') as HTMLElement | null;
  return String(el?.dataset?.uploadNodeId || '').trim();
}

function chooseUploadReplacementKind(existingKind: any, buckets: Record<MediaKind, File[]>, firstKind: MediaKind | null): MediaKind | null {
  const current = (['image', 'video', 'audio', 'model3d'] as MediaKind[]).includes(existingKind) ? existingKind as MediaKind : null;
  if (current && buckets[current].length > 0) return current;
  return firstKind;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable;
}

function isCanvasOverviewShortcutBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target as HTMLElement;
  if (el === document.body || el === document.documentElement) return false;
  if (isTextEditingTarget(el)) return true;
  return !!el.closest(
    [
      'button',
      'a',
      '[role="button"]',
      '[data-canvas-floating-ui]',
      '.react-flow__node',
      '.t8-canvas-toolbar',
      '.t8-context-menu',
      '.t8-sidebar',
    ].join(','),
  );
}

function isRadialMenuPaneTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target as HTMLElement;
  if (isTextEditingTarget(el)) return false;
  if (
    el.closest(
      [
        '.react-flow__node',
        '.react-flow__handle',
        '.react-flow__edge',
        '.react-flow__controls',
        '.react-flow__minimap',
        '[data-canvas-floating-ui]',
        '[data-drag-source]',
        'button',
        'a',
        '[role="button"]',
        '.t8-canvas-toolbar',
        '.t8-sidebar',
      ].join(','),
    )
  ) {
    return false;
  }
  return !!el.closest('.react-flow__pane, .react-flow__background, .react-flow__renderer');
}

type ModelUsageHelpSection = {
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
};

type ModelUsageHelpTabId = 'budget-house' | 'workshop';

const ZHENZHEN_BUDGET_HOUSE_MODEL_USAGE_HELP_SECTIONS: readonly ModelUsageHelpSection[] = [
  {
    title: '渠道与宽审核',
    paragraphs: [
      '与贞贞的AI工坊不同，模型以国内模型以及一些海外核心模型为主，使用完全不同的渠道，部分模型价格更优惠。',
      '支持宽审核开通；请合规使用，需要宽审核版 Seedream 等模型可联系 T8 开通。除版权内容外，图像及视频均可正常生成。',
    ],
  },
  {
    title: '视频模型',
    items: [
      'Seedance 2.0 官方特价版：价格比字节签约价格还优惠一点，不排队、不卡人脸，并支持宽审核（版权除外）。720P 约 1 元/秒，480P Mini 不到 0.25 元/秒。',
      'zhenzhen-video-gk-v15：480P 15 秒约 0.35 元，720P 15 秒约 0.63 元；模型能力类似 Grok Imagine 1.5。',
      'zhenzhen-video-g-omni-flash：支持视频编辑；模型能力类似 Veo Omni。',
    ],
  },
  {
    title: '图像模型',
    items: [
      'zhenzhen-image-g-v2-lowprice：特价 1K 不到 0.04 元、2K 约 0.09 元、4K 约 0.12 元；模型能力类似 GPT Image 2。',
      'zhenzhen-image-nb-2：1K / 2K 约 0.16 元，4K 约 0.24 元；模型能力类似 Nano Banana 2。',
      'zhenzhen-image-nb-pro：1K 约 0.32 元，4K 约 0.41 元；模型能力类似 Nano Banana Pro。',
      'midjourney-imagine：4 图约 0.39 元起，支持 V8.2。',
      'dola-seedream-5.0-pro-i2i：敏感类目最佳模型，需要联系 T8 开通。',
      'zhenzhen-image-gk-v15-edit：审核等级比 dola-seedream-5.0-pro-i2i 稍高、比其他模型低，作为第二推荐；模型能力类似 Grok Image 1.5 Edit。',
    ],
  },
];

const ZHENZHEN_WORKSHOP_MODEL_USAGE_HELP_SECTIONS: readonly ModelUsageHelpSection[] = [
  {
    title: '特别注意事项',
    paragraphs: [
      '如果不小心网页崩溃等，但是实际任务没失败，需要去网站异步任务看下，有个蓝色的TASKID，点进去可以看到下载地址，手动下载。另外fal模型会预扣3.4个币，生成结束后会多退少补。seedance2.0模型会预扣10个币，生成结束后多退少补',
    ],
  },
  {
    title: '图像模型注意事项（2K，4K只有FAL长期稳定，其他都不保证稳定）',
    items: [
      '2026.06.25谷歌香蕉模型从preview模型升级为正式版，模型名字需要修改，如之前是 gemini-3-pro-image-preview ，需要改为 gemini-3-pro-image，请求的模型名字之前带preview 的都去掉preview以下是新名字gemini-3-pro-image，gemini-3-pro-image-2k，gemini-3-pro-image-4k，gemini-3.1-flash-image，gemini-3.1-flash-image-512px，gemini-3.1-flash-image-2k，gemini-3.1-flash-image-4k，特殊的nano-banana-pro模型不需要修改',
      'gpt-image-2模型，新增azure特价分组，固定0.3积分，支持2K,4K，目前稳定（2K,4K没法保证永久稳定，最稳定是FAL模型方法），支持质量参数传入！（2026.06.17）',
      'gpt-image-2-all模型（default分组）只能出1K图，速度最快，最稳定，审核最松',
      'gpt-image-2模型（default分组）可以出1K，2K，4K图，2K，4K不一定稳定，如果提示系统错误，降低分辨率重试，超过1K，需要选择分辨率， auto不支持1K以上',
      'gpt-image-2-fal模型，兜底模型，支持2K，4K，价格较贵',
      'gpt-image-2-2k模型是备用模型，非gpt-image-2模型分支，直接支持2k，目前0.1积分,2026.06.10新增（default分组）',
      'gpt-image-2-4k模型是备用模型，非gpt-image-2模型分支，直接支持2k，目前0.1积分,2026.06.10新增（default分组）',
      'nano-banana-2和nano-banana-pro模型，需要用gemini优质分组，default分组不稳定（尤其4K）',
      'nano-banana-2-fal和nano-banana-pro-fal模型，兜底模型，支持4K，价格较贵',
      'grok-4.2-image模型（Default分组），审核最松，可以做各种姿势，支持多图编辑，保持一致性需要单独写保证脸部100%一致性不变',
      'MJ系列模型（Default分组），不同模型的用法都不一样，参考官方，推荐用fast模式，relax模式封号比较严重',
    ],
  },
  {
    title: '视频模型注意事项',
    items: [
      '20250624更新，seedance2.0新增mini模型（720P是满血版的一半），支持原生4K，电影级质感（仅满血720P可选）',
      'seedance2.0（Default分组）非远景推荐480P+FAST模式，质量吊打快乐马，价格只要5个币15秒，后续用flashvsr放大即可，720P满血15秒大概15币，不排队，支持真人',
      'seedance2.0（sd-global分组）需要联系T8微信单独开通，只支持企业开通，由于除版权外基本无审核，防止有人搞色情，需要签协议才能开通，价格和上面一样',
      'veo3.1模型，需要看下网站左侧分类教程，有多个分组可用，目前比较稳的是veo&grok备用分组2的veo3.1模型和默认分组的fal模型',
      'veo-omni模型，需要使用default分组（veo-omnii模型是2026.06.06刚上架的）',
      'grok-video模型，需要看下网站左侧分类教程，有多个分组可用，目前比较稳的是fal模型和默认分组，新增支持最新imagine 1.5模型（支持图生视频FAL模型），最佳SD平替（default分组），以及veo&grok备用分组2，支持15秒多参生视频，2026.06.11修复grok-video-3模型的defualt默认分组，直接升级成imagine 1.5模型，0.5积分10秒，2026.06.12新增grok-video-1.5-6s，grok-video-1.5-10s，grok-video-1.5-15s模型，默认720P，分组default，3个模型，分别是0.5，0.7，0.7积分，最佳SD2.0平替',
      'sora-2模型，支持sora-vip分组以及default默认分组的FAL模型（sora-vip分组是2026.06.06刚修复的）',
    ],
  },
  {
    title: '音频模型注意事项',
    paragraphs: [
      'suno v5.5模型（Default分组）支持生成，翻唱，延长，一次生成两首歌，翻唱模式情况下，如果是版权歌曲大概率会失败，需要做各种前置处理，可以在网站异步任务查看。',
    ],
  },
  {
    title: 'LLM模型注意事项',
    paragraphs: [
      'LLM模型有时候因为官方问题会出现速度慢，失败等现象，这时候换个模型即可或者换一下分组即可，预置了多个模型。',
    ],
  },
];

const MODEL_USAGE_HELP_TABS: readonly {
  id: ModelUsageHelpTabId;
  label: string;
  sections: readonly ModelUsageHelpSection[];
}[] = [
  {
    id: 'budget-house',
    label: '贞贞的平价AI小屋',
    sections: ZHENZHEN_BUDGET_HOUSE_MODEL_USAGE_HELP_SECTIONS,
  },
  {
    id: 'workshop',
    label: '贞贞的AI工坊',
    sections: ZHENZHEN_WORKSHOP_MODEL_USAGE_HELP_SECTIONS,
  },
];

function getReactFlowHandleInfo(target: EventTarget | null): {
  nodeId: string;
  handleType: 'source' | 'target';
  handleId: string | null;
} | null {
  if (!(target instanceof Element)) return null;
  const handleEl = target.closest('.react-flow__handle') as HTMLElement | null;
  if (!handleEl) return null;
  const nodeId =
    handleEl.getAttribute('data-nodeid') ||
    handleEl.closest('.react-flow__node')?.getAttribute('data-id') ||
    '';
  const rawType =
    handleEl.getAttribute('data-handletype') ||
    (handleEl.classList.contains('source') ? 'source' : handleEl.classList.contains('target') ? 'target' : '');
  if (!nodeId || (rawType !== 'source' && rawType !== 'target')) return null;
  return {
    nodeId,
    handleType: rawType,
    handleId: handleEl.getAttribute('data-handleid') || null,
  };
}

function PlacementShelf({
  items,
  open,
  isDark,
  isPixel,
  onToggle,
  onHide,
  onClear,
  onMoveNode,
  onRemove,
}: {
  items: PlacementShelfItem[];
  open: boolean;
  isDark: boolean;
  isPixel: boolean;
  onToggle: () => void;
  onHide: () => void;
  onClear: () => void;
  onMoveNode: (item: PlacementShelfItem, point: { x: number; y: number }) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('canvas');
  const [drag, setDrag] = useState<{ item: PlacementShelfItem; x: number; y: number } | null>(null);
  const [expandedVisibleCount, setExpandedVisibleCount] = useState(20);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      setDrag((prev) => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev));
    };
    const onUp = (event: PointerEvent) => {
      const item = drag.item;
      setDrag(null);
      onMoveNode(item, { x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [drag, onMoveNode]);

  useEffect(() => {
    if (!open) setExpandedVisibleCount(20);
  }, [open]);

  const visible = items.slice(0, open ? expandedVisibleCount : 5);
  const shellStyle: CSSProperties = isPixel
    ? {
        border: '2px solid var(--px-ink, #1A1410)',
        background: 'var(--px-surface, #fff7c2)',
        color: 'var(--px-ink, #1A1410)',
        boxShadow: '4px 4px 0 var(--px-ink, #1A1410)',
        borderRadius: 12,
      }
    : {
        border: `1px solid ${isDark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)'}`,
        background: isDark ? 'rgba(17,24,39,.92)' : 'rgba(255,255,255,.94)',
        color: isDark ? '#f8fafc' : '#111827',
        boxShadow: '0 18px 48px rgba(0,0,0,.28)',
        borderRadius: 14,
        backdropFilter: 'blur(12px)',
      };
  const itemStyle: CSSProperties = isPixel
    ? {
        border: '1.5px solid var(--px-ink, #1A1410)',
        background: 'var(--px-card, #fffdf1)',
        boxShadow: '1px 1px 0 var(--px-ink, #1A1410)',
      }
    : {
        border: `1px solid ${isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.10)'}`,
        background: isDark ? 'rgba(255,255,255,.06)' : 'rgba(15,23,42,.04)',
      };

  return (
    <>
      <div
        data-canvas-floating-ui="placement-shelf"
        data-placement-shelf-hidden="false"
        className="t8-placement-shelf p-2"
        style={shellStyle}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className={isPixel ? 'px-btn px-btn--sm px-btn--ghost !py-1' : 'rounded-md px-2 py-1 text-xs font-bold hover:bg-black/10'}
            onClick={onToggle}
            title={open ? t('controls.shelfCollapseLimited', { count: 5 }) : t('controls.shelfExpandLimited', { count: 20 })}
          >
            <LucideIcons.Inbox size={13} className="mr-1 inline-block" />
            {t('controls.shelfLabel', { visible: visible.length, limit: items.length })}
          </button>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                type="button"
                className="t8-mini-icon-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClear();
                }}
                aria-label={t('controls.shelfClear')}
                title={t('controls.shelfClear')}
              >
                <LucideIcons.Trash2 size={13} />
              </button>
            )}
            <button
              type="button"
              className="t8-placement-shelf__hide t8-mini-icon-button"
              data-canvas-floating-ui="placement-shelf-hide"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onHide();
              }}
              aria-label={t('controls.shelfHide')}
              title={t('controls.shelfHide')}
            >
              <LucideIcons.EyeOff size={13} />
            </button>
            <button
              type="button"
              className="t8-mini-icon-button"
              onClick={onToggle}
              title={open ? t('controls.shelfClose') : t('controls.shelfOpen')}
            >
              {open ? <LucideIcons.ChevronDown size={14} /> : <LucideIcons.ChevronUp size={14} />}
            </button>
          </div>
        </div>
        <div className="t8-placement-shelf__grid grid grid-cols-5 gap-2">
          {visible.length === 0 && (
            <div className="t8-placement-shelf__empty col-span-5 px-2 py-1 text-[10px] opacity-70">
              {t('controls.shelfEmpty')}
            </div>
          )}
          {visible.map((item) => {
            const Icon = item.kind === 'image'
              ? LucideIcons.Image
              : item.kind === 'video'
                ? LucideIcons.Video
                : item.kind === 'audio'
                  ? LucideIcons.Music
                  : item.kind === 'model3d'
                    ? LucideIcons.Box
                    : LucideIcons.Workflow;
            return (
              <div
                key={item.id}
                className="nodrag nopan group relative h-14 w-14 cursor-grab overflow-hidden rounded-md"
                style={itemStyle}
                title={t('controls.shelfMoveHint', { source: item.source, title: item.title })}
                data-drag-source={item.url ? true : undefined}
                data-drag-kind={item.url ? item.kind : undefined}
                data-drag-url={item.url || undefined}
                data-drag-preview={item.url ? (item.previewUrl || item.url) : undefined}
                data-drag-node-id={item.nodeId}
                data-resource-title={item.title}
                draggable={!!item.url}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDrag({ item, x: event.clientX, y: event.clientY });
                }}
              >
                {item.kind === 'image' && item.url ? (
                  <SmartImage src={item.url} alt={item.title} thumbSize={160} className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-black/65 px-1 text-center">
                    <Icon size={22} className="text-white/90" />
                    {item.kind === 'node' && (
                      <span className="max-w-full truncate text-[9px] font-bold text-white/80">{t('controls.shelfNode')}</span>
                    )}
                  </div>
                )}
                <div className="absolute left-0 top-0 max-w-full truncate rounded-br bg-black/70 px-1 py-0.5 text-[9px] font-bold text-white">
                  {item.source}
                </div>
                <button
                  type="button"
                  className="absolute right-0 top-0 hidden h-4 w-4 items-center justify-center bg-black/70 text-white group-hover:flex"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                  title={t('controls.shelfRemove')}
                >
                  <LucideIcons.X size={10} />
                </button>
              </div>
            );
          })}
        </div>
        {open && visible.length < items.length && (
          <button
            type="button"
            className={isPixel
              ? 'px-btn px-btn--sm px-btn--ghost mt-2 w-full !py-1'
              : 'mt-2 w-full rounded-md px-2 py-1 text-xs font-bold hover:bg-black/10'}
            onClick={() => setExpandedVisibleCount((count) => Math.min(items.length, count + 20))}
          >
            {t('controls.shelfLoadMore', { count: Math.min(20, items.length - visible.length) })}
          </button>
        )}
      </div>
      {drag && (
        <div
          className="pointer-events-none fixed z-[100] flex h-12 w-12 items-center justify-center rounded-md border bg-black/70 text-white shadow-xl"
          style={{ left: drag.x + 10, top: drag.y + 10 }}
        >
          <LucideIcons.Move size={20} />
        </div>
      )}
    </>
  );
}

interface CanvasInnerProps {
  onAddNodeRef?: React.MutableRefObject<AddNodeFn | null>;
  onInsertWorkflowRef?: React.MutableRefObject<InsertWorkflowFn | null>;
  onReadinessChange?: (readiness: CanvasSurfaceReadiness) => void;
  onRetryLoadRef?: React.MutableRefObject<(() => void) | null>;
  persistenceRuntime: CanvasPersistenceRuntime;
  themeStyleOverride?: string;
  apiSettingsRevision?: number;
  onOpenApiSettings?: () => void;
}

type PersistableCanvasPatchState = {
  nodes: Node[];
  edges: Edge[];
  creativeDesk: CreativeDeskState;
  farmCanvas: FarmCanvasState;
  nextNodeSerialId: number;
  snapshot: string;
};

type PendingCanvasSave = PersistableCanvasPatchState & CanvasPatchPendingEnvelope;

type CanvasPersistenceRuntime = {
  saveTimersByCanvas: Map<string, number>;
  pendingSaveFlushersByCanvas: Map<string, () => void>;
  pendingSaveByCanvas: Map<string, PendingCanvasSave>;
  latestPersistableByCanvas: Map<string, PersistableCanvasPatchState>;
  autosaveGenerationByCanvas: Map<string, number>;
  lastSavedByCanvas: Map<string, string>;
  lastSavedNodeCountByCanvas: Map<string, number>;
  skipInitialAutosaveCanvasIds: Set<string>;
  skipInitialHistoryCanvasIds: Set<string>;
  canvasRevisions: Map<string, number>;
  canvasMutationQueues: Map<string, Promise<void>>;
  allowEmptySaveCanvasIds: Set<string>;
};

function createCanvasPersistenceRuntime(): CanvasPersistenceRuntime {
  return {
    saveTimersByCanvas: new Map(),
    pendingSaveFlushersByCanvas: new Map(),
    pendingSaveByCanvas: new Map(),
    latestPersistableByCanvas: new Map(),
    autosaveGenerationByCanvas: new Map(),
    lastSavedByCanvas: new Map(),
    lastSavedNodeCountByCanvas: new Map(),
    skipInitialAutosaveCanvasIds: new Set(),
    skipInitialHistoryCanvasIds: new Set(),
    canvasRevisions: new Map(),
    canvasMutationQueues: new Map(),
    allowEmptySaveCanvasIds: new Set(),
  };
}

function pendingCanvasSaveFromState(
  state: PersistableCanvasPatchState,
  options: {
    baseSnapshot: string;
    baseRevision: number;
    conflicts?: CanvasPatchMergeConflict[];
    conflicted?: boolean;
  },
): PendingCanvasSave {
  const conflicts = options.conflicts || [];
  return {
    ...state,
    baseSnapshot: options.baseSnapshot,
    baseRevision: options.baseRevision,
    conflicted: options.conflicted ?? conflicts.length > 0,
    conflicts,
  };
}

function canvasPatchStateFromCanonicalParts(
  nodes: Node[],
  edges: Edge[],
  creativeDesk: CreativeDeskState,
  farmCanvas: FarmCanvasState,
  nextNodeSerialId: number,
): PersistableCanvasPatchState {
  return {
    nodes,
    edges,
    creativeDesk,
    farmCanvas,
    nextNodeSerialId,
    snapshot: JSON.stringify({ nodes, edges, creativeDesk, farmCanvas, nextNodeSerialId }),
  };
}

function persistableCanvasPatchStateFromParts(
  nodes: Node[],
  edges: Edge[],
  creativeDesk: CreativeDeskState,
  farmCanvas: FarmCanvasState,
  nextNodeSerialId: number,
): PersistableCanvasPatchState {
  const persistNodes = nodes.filter((node) => node.id !== BULK_PHANTOM_ID && !(node.data as any)?.__subflowRuntime);
  const transientSubflowIds = new Set(nodes.filter((node) => (node.data as any)?.__subflowRuntime).map((node) => node.id));
  const persistEdges = edges.filter((edge) => edge.source !== BULK_PHANTOM_ID
    && edge.target !== BULK_PHANTOM_ID
    && !transientSubflowIds.has(edge.source)
    && !transientSubflowIds.has(edge.target)
    && !(edge.data as any)?.__subflowRuntime);
  return canvasPatchStateFromCanonicalParts(persistNodes, persistEdges, creativeDesk, farmCanvas, nextNodeSerialId);
}

function parsePersistableCanvasPatchSnapshot(snapshot: string): Omit<PersistableCanvasPatchState, 'snapshot'> | null {
  try {
    const value = JSON.parse(snapshot) as Partial<PersistableCanvasPatchState>;
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
    return {
      nodes: value.nodes as Node[],
      edges: value.edges as Edge[],
      creativeDesk: value.creativeDesk || createDefaultCreativeDeskState(),
      farmCanvas: sanitizeFarmCanvasState(value.farmCanvas),
      nextNodeSerialId: Math.max(1, Number(value.nextNodeSerialId) || 1),
    };
  } catch {
    return null;
  }
}

function mergeConcurrentCanvasPatchState(
  baselineSnapshot: string,
  local: Omit<PersistableCanvasPatchState, 'snapshot'>,
  authoritative: Omit<PersistableCanvasPatchState, 'snapshot'>,
): { state: PersistableCanvasPatchState; conflicts: CanvasPatchMergeConflict[] } {
  const baseline = parsePersistableCanvasPatchSnapshot(baselineSnapshot) || authoritative;
  const graph = mergeCanvasPatchGraph<Node, Edge>({
    baseNodes: baseline.nodes,
    localNodes: local.nodes,
    authoritativeNodes: authoritative.nodes,
    baseEdges: baseline.edges,
    localEdges: local.edges,
    authoritativeEdges: authoritative.edges,
  });
  const creativeDeskResult = mergeCanvasPatchValueWithConflicts<CreativeDeskState>(
    baseline.creativeDesk,
    local.creativeDesk,
    authoritative.creativeDesk,
    'creativeDesk',
  );
  const farmCanvasResult = mergeCanvasPatchValueWithConflicts<FarmCanvasState>(
    baseline.farmCanvas,
    local.farmCanvas,
    authoritative.farmCanvas,
    'farmCanvas',
  );
  const creativeDesk = creativeDeskResult.value;
  const farmCanvas = sanitizeFarmCanvasState(farmCanvasResult.value);
  const nextNodeSerialId = Math.max(
    1,
    Number(local.nextNodeSerialId) || 1,
    Number(authoritative.nextNodeSerialId) || 1,
  );
  const snapshot = JSON.stringify({ nodes: graph.nodes, edges: graph.edges, creativeDesk, farmCanvas, nextNodeSerialId });
  return {
    state: { nodes: graph.nodes, edges: graph.edges, creativeDesk, farmCanvas, nextNodeSerialId, snapshot },
    conflicts: [...graph.conflicts, ...creativeDeskResult.conflicts, ...farmCanvasResult.conflicts],
  };
}

function requireVersionedCanvasPatchDocument(value: unknown, canvasId: string): VersionedCanvasData {
  const document = value as Partial<VersionedCanvasData> | null;
  if (!document || document.schema !== 't8-canvas-document' || document.schemaVersion !== 2
    || document.canvasId !== canvasId || typeof document.projectId !== 'string' || !document.projectId
    || !Number.isSafeInteger(document.revision) || Number(document.revision) < 1
    || !Array.isArray(document.nodes) || !Array.isArray(document.edges)
    || !document.viewport || typeof document.viewport !== 'object'
    || ![document.viewport.x, document.viewport.y, document.viewport.zoom].every((item) => typeof item === 'number' && Number.isFinite(item))
    || typeof document.updatedAt !== 'number' || !Number.isFinite(document.updatedAt)) {
    throw new Error('服务端返回的画布权威文档无效');
  }
  return document as VersionedCanvasData;
}

function CanvasInner({ onAddNodeRef, onInsertWorkflowRef, onReadinessChange, onRetryLoadRef, persistenceRuntime, themeStyleOverride, apiSettingsRevision, onOpenApiSettings }: CanvasInnerProps) {
  const { t } = useTranslation(['canvas', 'common']);
  const { activeId, canvases, refreshCanvasMetadata, setActive } = useCanvasStore();
  const performanceFixtureSize = useMemo(
    () => (typeof window === 'undefined' ? null : readCanvasPerformanceFixtureSize(window.location.search)),
    [],
  );
  const performanceFixtureCanvasId = performanceFixtureSize == null
    ? null
    : `__t8-performance-fixture-${performanceFixtureSize}__`;
  const renderedCanvasId = performanceFixtureCanvasId || activeId;
  const { theme, style, templateId, customTemplates } = useThemeStore();
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const shortcutText = useCallback((actionId: string) => formatShortcutList(shortcuts[actionId]), [shortcuts]);
  const currentTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const visualStyle = themeStyleOverride || currentTemplate.visuals?.style || style;
  const isOp = visualStyle === 'op';
  const isNaruto = visualStyle === 'naruto';
  const isEva = visualStyle === 'eva';
  const isYyh = visualStyle === 'yyh';
  const isSlamdunk = visualStyle === 'slamdunk';
  const isSoccer = visualStyle === 'soccer-hero';
  const isDragonBall = visualStyle === 'dragon-ball';
  const isTetris = visualStyle === 'tetris';
  const isSaintSeiya = visualStyle === 'saint-seiya';
  const isFarmStory = visualStyle === 'farm-story';
  const isGardenDefense = visualStyle === 'garden-defense';
  const farmDevToolsEnabled = isFarmStory && import.meta.env.DEV;
  const themeTokens = getTemplateMode(currentTemplate, theme).tokens;
  const { screenToFlowPosition, setCenter, getViewport, setViewport, fitView } = useReactFlow();
  const radialSlotsRaw = useRadialMenuStore((s) => s.slots);
  const radialLongPressMs = useRadialMenuStore((s) => s.longPressMs);
  const radialSlots = useMemo(
    () => normalizeRadialMenuSlots(NODE_REGISTRY, radialSlotsRaw),
    [radialSlotsRaw],
  );
  const radialNodeOptions = useMemo(() => visibleRadialMenuNodeOptions(NODE_REGISTRY), []);
  const radialNodesByType = useMemo(
    () => new Map(radialNodeOptions.map((node) => [node.type, node])),
    [radialNodeOptions],
  );
  const graphMutationEpochRef = useRef(0);
  const [nodes, rawSetNodes] = useState<Node[]>([]);
  const [edges, rawSetEdges] = useState<Edge[]>([]);
  const nodesRef = useRef<Node[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  const setNodes = useCallback((action: SetStateAction<Node[]>) => {
    const next = advanceCanvasPatchMutation({ value: nodesRef.current, epoch: graphMutationEpochRef.current }, action);
    const identified = ensureCanvasEntityUids(next.value, 'node');
    nodesRef.current = identified;
    graphMutationEpochRef.current = next.epoch;
    rawSetNodes(identified);
  }, []);
  const setEdges = useCallback((action: SetStateAction<Edge[]>) => {
    const next = advanceCanvasPatchMutation({ value: edgesRef.current, epoch: graphMutationEpochRef.current }, action);
    const identified = ensureCanvasEntityUids(next.value, 'edge');
    edgesRef.current = identified;
    graphMutationEpochRef.current = next.epoch;
    rawSetEdges(identified);
  }, []);
  const replaceHydratedCanvasGraph = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    graphMutationEpochRef.current += 1;
    rawSetNodes(nextNodes);
    rawSetEdges(nextEdges);
  }, []);
  const [runReplayRuntime, setRunReplayRuntime] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const runReplayRuntimeRef = useRef(runReplayRuntime);
  runReplayRuntimeRef.current = runReplayRuntime;
  const [generationHistoryOpen, setGenerationHistoryOpen] = useState(false);
  const [projectWorkbenchOpen, setProjectWorkbenchOpen] = useState(false);
  const [workflowDoctorHighlights, setWorkflowDoctorHighlights] = useState<WorkflowDoctorCanvasHighlight[]>([]);
  const workflowDoctorHighlightMap = useMemo(
    () => new Map(workflowDoctorHighlights.map((highlight) => [highlight.nodeId, highlight])),
    [workflowDoctorHighlights],
  );
  const handleDoctorHighlightsChange = useCallback((highlights: WorkflowDoctorCanvasHighlight[]) => {
    setWorkflowDoctorHighlights(highlights);
  }, []);
  const [canvasPatchConflictMessage, setCanvasPatchConflictMessage] = useState('');
  const generationHistoryDataKey = useMemo(() => buildGenerationHistoryDataKey(nodes), [nodes]);
  const generationHistoryCount = useMemo(() => countGenerationHistoryItems(nodes), [generationHistoryDataKey]);
  const generationHistoryItems = useMemo(
    () => (generationHistoryOpen ? collectGenerationHistory(nodes) : []),
    [generationHistoryDataKey, generationHistoryOpen],
  );
  const [creativeDesk, rawSetCreativeDesk] = useState<CreativeDeskState>(() => createDefaultCreativeDeskState());
  const [farmCanvas, rawSetFarmCanvas] = useState<FarmCanvasState>(() => createFarmState());
  const creativeDeskRef = useRef(creativeDesk);
  const farmCanvasRef = useRef(farmCanvas);
  const setCreativeDesk = useCallback((action: SetStateAction<CreativeDeskState>) => {
    const next = advanceCanvasPatchMutation({ value: creativeDeskRef.current, epoch: graphMutationEpochRef.current }, action);
    creativeDeskRef.current = next.value;
    graphMutationEpochRef.current = next.epoch;
    rawSetCreativeDesk(next.value);
  }, []);
  const setFarmCanvas = useCallback((action: SetStateAction<FarmCanvasState>) => {
    const next = advanceCanvasPatchMutation({ value: farmCanvasRef.current, epoch: graphMutationEpochRef.current }, action);
    farmCanvasRef.current = next.value;
    graphMutationEpochRef.current = next.epoch;
    rawSetFarmCanvas(next.value);
  }, []);
  const [farmCanvasEditing, setFarmCanvasEditing] = useState(false);
  const [farmStoryPanelOpen, setFarmStoryPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(T8_FARM_STORY_PANEL_COLLAPSED_STORAGE_KEY) === '0';
    } catch {
      return false;
    }
  });
  const [farmStoryPriorityFocusRequestId, setFarmStoryPriorityFocusRequestId] = useState(0);
  const [farmCanvasFeedback, setFarmCanvasFeedback] = useState('点击工具后，在画布空白处开始经营。');
  const [farmFloatingFeedbacks, setFarmFloatingFeedbacks] = useState<FarmCanvasFloatingFeedback[]>([]);
  const [farmFollowupNotice, setFarmFollowupNotice] = useState<FarmFollowupNotice | null>(null);
  const [farmJumpHighlightObjectId, setFarmJumpHighlightObjectId] = useState<string | null>(null);
  const [farmMiniMapRouteHint, setFarmMiniMapRouteHint] = useState<FarmMiniMapRouteHint | null>(null);
  const [farmResourceDecorItems, setFarmResourceDecorItems] = useState<api.ResourceItem[]>([]);
  const [farmResourceDecorLoading, setFarmResourceDecorLoading] = useState(false);
  const [edgeCutFeedbacks, setEdgeCutFeedbacks] = useState<EdgeCutFeedback[]>([]);
  const [edgeConnectFeedbacks, setEdgeConnectFeedbacks] = useState<EdgeConnectFeedback[]>([]);
  const [farmSoundEnabled, setFarmSoundEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(FARM_SOUND_ENABLED_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const farmMatureJumpIndexRef = useRef(0);
  const farmJumpHighlightTimerRef = useRef<number | null>(null);
  const farmMiniMapRouteHintTimerRef = useRef<number | null>(null);
  const farmResourceDecorLoadedRef = useRef(false);
  const farmFloatingFeedbackTimersRef = useRef<Map<string, number>>(new Map());
  const farmFollowupNoticeTimerRef = useRef<number | null>(null);
  const farmContinuousFeedbackBatchRef = useRef<FarmContinuousFeedbackBatch | null>(null);
  const webImageImportMessageIdsRef = useRef<Set<string>>(new Set());
  const vibeXImportMessageIdsRef = useRef<Set<string>>(new Set());
  const photoshopImportMessageIdsRef = useRef<Set<string>>(new Set());
  const edgeCutFeedbackTimersRef = useRef<Map<string, number>>(new Map());
  const edgeConnectFeedbackTimersRef = useRef<Map<string, number>>(new Map());
  const farmAchievementEventIdsRef = useRef<Set<string>>(new Set());
  const lastCanvasPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [creativeDeskEditing, setCreativeDeskEditing] = useState(false);
  const [creativeDeskActiveItemId, setCreativeDeskActiveItemId] = useState<string | null>(null);
  const [creativeDeskResources, setCreativeDeskResources] = useState<api.ResourceItem[]>([]);
  const [creativeDeskResourceLoading, setCreativeDeskResourceLoading] = useState(false);
  const [creativeDeskMessage, setCreativeDeskMessage] = useState('');
  const [radialMenu, setRadialMenu] = useState<RadialMenuSession | null>(null);
  const [fileDragOutActive, setFileDragOutActive] = useState(false);
  const [fileDragOutFeedback, setFileDragOutFeedback] = useState<FileDragOutFeedback | null>(null);
  const radialPanLocked = Boolean(radialMenu);
  const canvasPanLocked = radialPanLocked || fileDragOutActive;
  const memoPanOnDrag = useMemo(() => (canvasPanLocked ? false : [...CANVAS_PAN_MOUSE_BUTTONS]), [canvasPanLocked]);
  const [placementShelfItems, setPlacementShelfItems] = useState<PlacementShelfItem[]>([]);
  const [placementShelfOpen, setPlacementShelfOpen] = useState(false);
  const [placementShelfHidden, setPlacementShelfHidden] = useState(false);
  const placementShelfClearedCanvasIdsRef = useRef<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [canvasLoadFailure, setCanvasLoadFailure] = useState<{
    canvasId: string;
    message: string;
  } | null>(null);
  const [canvasLoadAttempt, setCanvasLoadAttempt] = useState(0);
  const [backgroundSaveFailure, setBackgroundSaveFailure] = useState<{
    canvasId: string;
    nodeId: string;
    message: string;
    kind: 'persist-failed' | 'active-sync-failed';
  } | null>(null);
  const [initialCanvasViewport, setInitialCanvasViewport] = useState<{ canvasId: string; viewport: Viewport | null } | null>(null);
  const [loadedCanvasId, setLoadedCanvasId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeCanvasRevision, setActiveCanvasRevision] = useState(0);
  const [initializedFlowCanvasId, setInitializedFlowCanvasId] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const saveTimersByCanvasRef = useRef(persistenceRuntime.saveTimersByCanvas);
  const pendingSaveFlushersByCanvasRef = useRef(persistenceRuntime.pendingSaveFlushersByCanvas);
  const pendingSaveByCanvasRef = useRef(persistenceRuntime.pendingSaveByCanvas);
  const latestPersistableByCanvasRef = useRef(persistenceRuntime.latestPersistableByCanvas);
  const autosaveGenerationByCanvasRef = useRef(persistenceRuntime.autosaveGenerationByCanvas);
  const lastSavedByCanvasRef = useRef(persistenceRuntime.lastSavedByCanvas);
  const lastSavedNodeCountByCanvasRef = useRef(persistenceRuntime.lastSavedNodeCountByCanvas);
  const skipInitialAutosaveCanvasIdsRef = useRef(persistenceRuntime.skipInitialAutosaveCanvasIds);
  const skipInitialHistoryCanvasIdsRef = useRef(persistenceRuntime.skipInitialHistoryCanvasIds);
  const canvasViewportStorageTimerRef = useRef<number | null>(null);
  const pendingCanvasViewportStorageRef = useRef<{ canvasId: string; viewport: Viewport } | null>(null);
  const canvasRevisionsRef = useRef(persistenceRuntime.canvasRevisions);
  const canvasMutationQueuesRef = useRef(persistenceRuntime.canvasMutationQueues);
  const patchPreviewBaselinesRef = useRef<Map<string, { canvasId: string; revision: number; snapshot: string; mutationEpoch: number }>>(new Map());
  const handledBrowserHandoffsRef = useRef(new Set<string>());
  const nextNodeSerialIdRef = useRef(1);
  const radialMenuRef = useRef<RadialMenuSession | null>(null);
  const radialPressRef = useRef<RadialPressState | null>(null);
  const radialViewportLockRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const radialContextMenuSuppressedUntilRef = useRef(0);
  const fileDragOutFeedbackTimerRef = useRef<number | null>(null);
  const allowEmptySaveCanvasIdsRef = useRef(persistenceRuntime.allowEmptySaveCanvasIds);
  const edgeMotionReleaseTimerRef = useRef<number | null>(null);
  const [viewportMoving, setViewportMoving] = useState(false);
  const [canvasZoomReadability, setCanvasZoomReadability] = useState<CanvasZoomReadabilityTier>('detail');
  const [nodeDragging, setNodeDragging] = useState(false);
  const [dragSaveTick, setDragSaveTick] = useState(0);
  const loadedRef = useRef(loaded);
  const loadedCanvasIdRef = useRef<string | null>(loadedCanvasId);
  loadedRef.current = loaded;
  loadedCanvasIdRef.current = loadedCanvasId;
  const lastDone = useRunBusStore((s) => s.lastDone);
  const lastAchievementDoneTsRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBackgroundSaveFailure = (event: Event) => {
      const detail = (event as CustomEvent<{
        canvasId?: unknown;
        nodeId?: unknown;
        message?: unknown;
      }>).detail;
      if (
        typeof detail?.canvasId !== 'string'
        || typeof detail.nodeId !== 'string'
        || typeof detail.message !== 'string'
        || !detail.canvasId.trim()
        || !detail.nodeId.trim()
        || !detail.message.trim()
      ) return;
      setBackgroundSaveFailure({
        canvasId: detail.canvasId,
        nodeId: detail.nodeId,
        message: detail.message,
        kind: 'persist-failed',
      });
    };
    window.addEventListener('penguin:canvas-background-save-error', handleBackgroundSaveFailure);
    return () => window.removeEventListener('penguin:canvas-background-save-error', handleBackgroundSaveFailure);
  }, []);
  const achievementProfileLoaded = useAchievementStore((state) => Boolean(state.profile));
  const achievementTrackingEnabled = useAchievementStore((state) => state.profile?.preferences?.enabled !== false);
  const rhDuckDecodedUnlocked = useAchievementStore((state) => Boolean(state.profile?.unlockedAchievements?.['rh-duck-decoded']));
  const yyhPortraitOutputUnlocked = useAchievementStore((state) => Boolean(state.profile?.unlockedAchievements?.['yyh-portrait-output']));
  const hiddenOutputSyncRef = useRef<Set<string>>(new Set());

  useEffect(() => () => {
    farmFloatingFeedbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    farmFloatingFeedbackTimersRef.current.clear();
    if (farmFollowupNoticeTimerRef.current !== null) {
      window.clearTimeout(farmFollowupNoticeTimerRef.current);
      farmFollowupNoticeTimerRef.current = null;
    }
    if (farmContinuousFeedbackBatchRef.current?.timerId) {
      window.clearTimeout(farmContinuousFeedbackBatchRef.current.timerId);
    }
    farmContinuousFeedbackBatchRef.current = null;
    if (farmJumpHighlightTimerRef.current) {
      window.clearTimeout(farmJumpHighlightTimerRef.current);
    }
    farmJumpHighlightTimerRef.current = null;
    if (farmMiniMapRouteHintTimerRef.current) {
      window.clearTimeout(farmMiniMapRouteHintTimerRef.current);
    }
    farmMiniMapRouteHintTimerRef.current = null;
    edgeCutFeedbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    edgeCutFeedbackTimersRef.current.clear();
    edgeConnectFeedbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    edgeConnectFeedbackTimersRef.current.clear();
  }, []);

  useEffect(() => {
    setFarmFloatingFeedbacks([]);
    if (farmContinuousFeedbackBatchRef.current?.timerId) {
      window.clearTimeout(farmContinuousFeedbackBatchRef.current.timerId);
    }
    farmContinuousFeedbackBatchRef.current = null;
    if (farmJumpHighlightTimerRef.current) {
      window.clearTimeout(farmJumpHighlightTimerRef.current);
    }
    farmJumpHighlightTimerRef.current = null;
    setFarmJumpHighlightObjectId(null);
    if (farmMiniMapRouteHintTimerRef.current) {
      window.clearTimeout(farmMiniMapRouteHintTimerRef.current);
    }
    farmMiniMapRouteHintTimerRef.current = null;
    setFarmMiniMapRouteHint(null);
    setEdgeCutFeedbacks([]);
    setEdgeConnectFeedbacks([]);
    edgeConnectFeedbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    edgeConnectFeedbackTimersRef.current.clear();
    farmAchievementEventIdsRef.current.clear();
  }, [loadedCanvasId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FARM_SOUND_ENABLED_STORAGE_KEY, farmSoundEnabled ? '1' : '0');
    } catch {
      // Local preference only.
    }
  }, [farmSoundEnabled]);

  const playFarmSound = useCallback((cue: FarmSoundCue) => {
    playFarmActionSound(cue, { enabled: farmSoundEnabled });
  }, [farmSoundEnabled]);

  const handleFarmToggleSound = useCallback((enabled: boolean) => {
    setFarmSoundEnabled(enabled);
    if (enabled) playFarmActionSound('select', { enabled: true });
  }, []);

  const trackFarmAchievementFromEvent = useCallback((event?: FarmEventLogItem, previousEventId?: string) => {
    if (!event || event.id === previousEventId) return;
    const type = farmAchievementTypeForEvent(event.kind);
    if (!type || farmAchievementEventIdsRef.current.has(event.id)) return;
    farmAchievementEventIdsRef.current.add(event.id);
    if (farmAchievementEventIdsRef.current.size > 200) {
      farmAchievementEventIdsRef.current = new Set(Array.from(farmAchievementEventIdsRef.current).slice(-120));
    }
    trackAchievementEvent({
      type,
      theme: 'farm-story',
      kind: farmAchievementKindForEvent(event),
    });
  }, []);

  const trackFarmAchievementsFromEvents = useCallback((events: FarmEventLogItem[] | undefined, previousEventId?: string) => {
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (event.id === previousEventId) break;
      trackFarmAchievementFromEvent(event);
    }
  }, [trackFarmAchievementFromEvent]);

  const pushFarmFloatingFeedback = useCallback((feedback: Omit<FarmCanvasFloatingFeedback, 'id'>) => {
    if (!feedback.message) return;
    const id = `farm-float-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextFeedback: FarmCanvasFloatingFeedback = {
      ...feedback,
      id,
      message: compactFarmFloatingMessage(feedback.message),
    };
    setFarmFloatingFeedbacks((prev) => {
      const next = [nextFeedback, ...prev].slice(0, MAX_FARM_FLOATING_FEEDBACKS);
      const keptIds = new Set(next.map((item) => item.id));
      prev.forEach((item) => {
        if (keptIds.has(item.id)) return;
        const timerId = farmFloatingFeedbackTimersRef.current.get(item.id);
        if (timerId) window.clearTimeout(timerId);
        farmFloatingFeedbackTimersRef.current.delete(item.id);
      });
      return next;
    });
    const timerId = window.setTimeout(() => {
      setFarmFloatingFeedbacks((prev) => prev.filter((item) => item.id !== id));
      farmFloatingFeedbackTimersRef.current.delete(id);
    }, FARM_FLOATING_FEEDBACK_MS);
    farmFloatingFeedbackTimersRef.current.set(id, timerId);
  }, []);

  const flashFarmObject = useCallback((objectId: string) => {
    if (!objectId) return;
    if (farmJumpHighlightTimerRef.current) {
      window.clearTimeout(farmJumpHighlightTimerRef.current);
    }
    setFarmJumpHighlightObjectId(objectId);
    farmJumpHighlightTimerRef.current = window.setTimeout(() => {
      setFarmJumpHighlightObjectId((current) => (current === objectId ? null : current));
      farmJumpHighlightTimerRef.current = null;
    }, FARM_JUMP_HIGHLIGHT_MS);
  }, []);

  const flashFarmMiniMapRouteHint = useCallback((target: FarmMiniMapRouteHintTarget | undefined, label = '', anchor?: { x: number; y: number }) => {
    if (!target) return;
    if (farmMiniMapRouteHintTimerRef.current) {
      window.clearTimeout(farmMiniMapRouteHintTimerRef.current);
    }
    setFarmMiniMapRouteHint({
      target,
      label,
      anchor,
      id: `farm-route-${Date.now()}`,
    });
    farmMiniMapRouteHintTimerRef.current = window.setTimeout(() => {
      setFarmMiniMapRouteHint((current) => (current?.target === target ? null : current));
      farmMiniMapRouteHintTimerRef.current = null;
    }, FARM_MINIMAP_ROUTE_HINT_MS);
  }, []);

  const flushFarmContinuousFeedback = useCallback(() => {
    const batch = farmContinuousFeedbackBatchRef.current;
    if (!batch) return;
    if (batch.timerId) window.clearTimeout(batch.timerId);
    farmContinuousFeedbackBatchRef.current = null;
    const placementSuffix = batch.placementEcho ? ` · ${batch.placementEcho}` : '';
    const beautySuffix = batch.beautyGain ? ` · 漂亮度 +${batch.beautyGain}` : '';
    const beautyRewardSuffix = batch.beautyRewardCount
      ? batch.beautyRewardCount > 1
        ? ` · 美化奖励 +${batch.beautyRewardCount}`
        : ` · 解锁${batch.beautyRewardTitle || '美化奖励'}`
      : '';
    pushFarmFloatingFeedback({
      x: batch.x,
      y: batch.y,
      placement: batch.placement || 'above',
      message: `${batch.label} x${batch.count}${placementSuffix}${beautySuffix}${beautyRewardSuffix}`,
      tone: batch.beautyGain || batch.beautyRewardCount ? 'reward' : batch.tone,
    });
  }, [pushFarmFloatingFeedback]);

  const queueFarmContinuousFeedback = useCallback((entry: Omit<FarmContinuousFeedbackBatch, 'count' | 'timerId'>) => {
    const previous = farmContinuousFeedbackBatchRef.current;
    if (previous && previous.tool !== entry.tool) {
      flushFarmContinuousFeedback();
    } else if (previous?.timerId) {
      window.clearTimeout(previous.timerId);
    }
    const current = farmContinuousFeedbackBatchRef.current;
    const count = current && current.tool === entry.tool ? current.count + 1 : 1;
    const beautyGain = Math.max(0, Math.round(Number(entry.beautyGain) || 0))
      + (current && current.tool === entry.tool ? current.beautyGain || 0 : 0);
    const beautyRewardCount = Math.max(0, Math.round(Number(entry.beautyRewardCount) || 0))
      + (current && current.tool === entry.tool ? current.beautyRewardCount || 0 : 0);
    const nextBatch: FarmContinuousFeedbackBatch = {
      ...entry,
      count,
      placement: entry.placement || (current && current.tool === entry.tool ? current.placement : undefined),
      placementEcho: entry.placementEcho || (current && current.tool === entry.tool ? current.placementEcho : undefined),
      beautyGain: beautyGain || undefined,
      beautyRewardTitle: current && current.tool === entry.tool
        ? current.beautyRewardTitle || entry.beautyRewardTitle
        : entry.beautyRewardTitle,
      beautyRewardCount: beautyRewardCount || undefined,
      timerId: window.setTimeout(() => {
        flushFarmContinuousFeedback();
      }, 320),
    };
    farmContinuousFeedbackBatchRef.current = nextBatch;
  }, [flushFarmContinuousFeedback]);

  const pushEdgeCutFeedback = useCallback((detail: EdgeCutFeedbackEventDetail) => {
    if (typeof window === 'undefined') return;
    const count = Math.max(1, Math.min(99, Math.round(Number(detail.count) || 1)));
    const kind = normalizeEdgeCutKind(detail.edgeKind);
    const source = detail.source === 'button' ? 'button' : 'slash';
    const position = clampEdgeCutFeedbackPosition(
      Number(detail.x ?? lastCanvasPointerRef.current?.x ?? window.innerWidth / 2),
      Number(detail.y ?? lastCanvasPointerRef.current?.y ?? window.innerHeight / 2),
    );
    const copy = buildEdgeCutFeedbackCopy(count, kind, source, visualStyle);
    const id = `edge-cut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const feedback: EdgeCutFeedback = {
      id,
      count,
      kind,
      source,
      x: position.x,
      y: position.y,
      title: copy.title,
      detail: copy.detail,
    };
    setEdgeCutFeedbacks((prev) => {
      const next = [feedback, ...prev].slice(0, MAX_EDGE_CUT_FEEDBACKS);
      const keptIds = new Set(next.map((item) => item.id));
      prev.forEach((item) => {
        if (keptIds.has(item.id)) return;
        const timerId = edgeCutFeedbackTimersRef.current.get(item.id);
        if (timerId) window.clearTimeout(timerId);
        edgeCutFeedbackTimersRef.current.delete(item.id);
      });
      return next;
    });
    const timerId = window.setTimeout(() => {
      setEdgeCutFeedbacks((prev) => prev.filter((item) => item.id !== id));
      edgeCutFeedbackTimersRef.current.delete(id);
    }, EDGE_CUT_FEEDBACK_MS);
    edgeCutFeedbackTimersRef.current.set(id, timerId);
  }, [visualStyle]);

  const pushEdgeConnectFeedback = useCallback((detail: { portType?: PortType | null; edgeKind?: string; x?: number; y?: number }) => {
    if (typeof window === 'undefined') return;
    const kind = normalizeEdgeCutKind(detail.edgeKind || farmConnectionKindFromPortType(detail.portType));
    const position = clampEdgeCutFeedbackPosition(
      Number(detail.x ?? lastCanvasPointerRef.current?.x ?? window.innerWidth / 2),
      Number(detail.y ?? lastCanvasPointerRef.current?.y ?? window.innerHeight / 2),
    );
    const copy = buildEdgeConnectFeedbackCopy(kind, visualStyle);
    const id = `edge-connect-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const feedback: EdgeConnectFeedback = {
      id,
      kind,
      x: position.x,
      y: position.y,
      title: copy.title,
      detail: copy.detail,
    };
    setEdgeConnectFeedbacks((prev) => {
      const next = [feedback, ...prev].slice(0, MAX_EDGE_CONNECT_FEEDBACKS);
      const keptIds = new Set(next.map((item) => item.id));
      prev.forEach((item) => {
        if (keptIds.has(item.id)) return;
        const timerId = edgeConnectFeedbackTimersRef.current.get(item.id);
        if (timerId) window.clearTimeout(timerId);
        edgeConnectFeedbackTimersRef.current.delete(item.id);
      });
      return next;
    });
    const timerId = window.setTimeout(() => {
      setEdgeConnectFeedbacks((prev) => prev.filter((item) => item.id !== id));
      edgeConnectFeedbackTimersRef.current.delete(id);
    }, EDGE_CONNECT_FEEDBACK_MS);
    edgeConnectFeedbackTimersRef.current.set(id, timerId);
  }, [visualStyle]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleEdgeCutFeedback = (event: Event) => {
      pushEdgeCutFeedback(((event as CustomEvent<EdgeCutFeedbackEventDetail>).detail || {}) as EdgeCutFeedbackEventDetail);
    };
    window.addEventListener('penguin:edge-cut-feedback', handleEdgeCutFeedback);
    return () => window.removeEventListener('penguin:edge-cut-feedback', handleEdgeCutFeedback);
  }, [pushEdgeCutFeedback]);

  const getFarmViewportCenter = useCallback(() => {
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = flowEl?.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [screenToFlowPosition]);

  const handleFarmFollowupCanvasHint = useCallback((hint: FarmStoryPanelCanvasHint) => {
    setFarmCanvasFeedback(hint.message);
    const noticeId = `farm-followup-${Date.now().toString(36)}`;
    setFarmFollowupNotice({
      ...hint,
      id: noticeId,
      createdAt: Date.now(),
    });
    if (farmFollowupNoticeTimerRef.current !== null) {
      window.clearTimeout(farmFollowupNoticeTimerRef.current);
    }
    farmFollowupNoticeTimerRef.current = window.setTimeout(() => {
      setFarmFollowupNotice((current) => (current?.id === noticeId ? null : current));
      farmFollowupNoticeTimerRef.current = null;
    }, FARM_FOLLOWUP_NOTICE_MS);
    if (hint.routeTarget) {
      const center = getFarmViewportCenter();
      flashFarmMiniMapRouteHint(hint.routeTarget, hint.routeLabel || hint.message, center);
    }
  }, [flashFarmMiniMapRouteHint, getFarmViewportCenter]);

  // 选中节点 / 剪贴板
  const selectedCount = useMemo(
    () => nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0),
    [nodes],
  );
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[]; incomingEdges?: Edge[]; outgoingEdges?: Edge[] } | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalPasteTimerRef = useRef<number | null>(null);
  const internalClipboardCopiedAtRef = useRef(0);
  const lastExternalMediaPasteRef = useRef<{ signature: string; mediaSignature: string; at: number } | null>(null);

  // 拖线到空白处的候选节点菜单(connection picker)
  const [picker, setPicker] = useState<{
    fromNodeId: string;
    fromHandleType: 'source' | 'target';
    flowPos: { x: number; y: number };
    screenPos: { x: number; y: number };
  } | null>(null);
  const [nodeIdDialog, setNodeIdDialog] = useState<NodeIdDialogState | null>(null);
  const connectingFromRef = useRef<{
    nodeId: string;
    handleType: 'source' | 'target';
  } | null>(null);
  const isConnectionDraggingRef = useRef(false);
  const connectionPanModeRef = useRef(false);
  const connectionPanPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [connectionPanModeActive, setConnectionPanModeActive] = useState(false);
  const [modelHelpOpen, setModelHelpOpen] = useState(false);
  const [modelHelpTab, setModelHelpTab] = useState<ModelUsageHelpTabId>('budget-house');
  const [radialSettingsOpen, setRadialSettingsOpen] = useState(false);
  const [controlToolsOpen, setControlToolsOpen] = useState(false);
  const altDragCloneRef = useRef<{
    placeholderIds: Map<string, string>; // origId -> placeholderId
  } | null>(null);
  const altKeyPressedRef = useRef(false);
  const altNodeDragIntentRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altKeyPressedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altKeyPressedRef.current = false;
    };
    const latchNodePointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      altNodeDragIntentRef.current = Boolean(target?.closest('.react-flow__node'))
        && isAltModifierActive(event, altKeyPressedRef.current);
    };
    const clearAltState = () => {
      altKeyPressedRef.current = false;
      altNodeDragIntentRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', latchNodePointerDown, true);
    window.addEventListener('mousedown', latchNodePointerDown, true);
    window.addEventListener('blur', clearAltState);
    document.addEventListener('visibilitychange', clearAltState);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', latchNodePointerDown, true);
      window.removeEventListener('mousedown', latchNodePointerDown, true);
      window.removeEventListener('blur', clearAltState);
      document.removeEventListener('visibilitychange', clearAltState);
    };
  }, []);

  const setConnectionPanMode = useCallback((enabled: boolean) => {
    connectionPanModeRef.current = enabled;
    connectionPanPointerRef.current = null;
    setConnectionPanModeActive((current) => (current === enabled ? current : enabled));
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('connection-pan-mode', enabled);
    }
  }, []);

  const resetConnectionPanMode = useCallback(() => {
    isConnectionDraggingRef.current = false;
    setConnectionPanMode(false);
  }, [setConnectionPanMode]);

  const clearEdgeMotionReleaseTimer = useCallback(() => {
    if (edgeMotionReleaseTimerRef.current) {
      window.clearTimeout(edgeMotionReleaseTimerRef.current);
      edgeMotionReleaseTimerRef.current = null;
    }
  }, []);

  const releaseEdgeMotionSoon = useCallback((setter: (value: boolean) => void) => {
    clearEdgeMotionReleaseTimer();
    edgeMotionReleaseTimerRef.current = window.setTimeout(() => {
      setter(false);
      edgeMotionReleaseTimerRef.current = null;
    }, EDGE_MOTION_RELEASE_DELAY_MS);
  }, [clearEdgeMotionReleaseTimer]);

  const restoreRadialViewportLock = useCallback(() => {
    const locked = radialViewportLockRef.current;
    if (!locked) return;
    const current = getViewport();
    if (
      Math.abs(current.x - locked.x) > 0.01 ||
      Math.abs(current.y - locked.y) > 0.01 ||
      Math.abs(current.zoom - locked.zoom) > 0.0001
    ) {
      void setViewport(locked);
    }
  }, [getViewport, setViewport]);

  const flushCanvasViewportStorage = useCallback(() => {
    if (canvasViewportStorageTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(canvasViewportStorageTimerRef.current);
    }
    canvasViewportStorageTimerRef.current = null;
    const pending = pendingCanvasViewportStorageRef.current;
    pendingCanvasViewportStorageRef.current = null;
    if (!pending) return;
    writeCanvasViewport(
      getBrowserCanvasViewportStorage(),
      pending.canvasId,
      pending.viewport,
    );
  }, []);

  const scheduleCanvasViewportStorage = useCallback((canvasId: string, viewport: Viewport) => {
    if (typeof window === 'undefined') return;
    const staged = stageCanvasViewportWrite(
      pendingCanvasViewportStorageRef.current,
      canvasId,
      viewport,
    );
    if (!staged) return;
    if (staged.displaced) flushCanvasViewportStorage();
    pendingCanvasViewportStorageRef.current = staged.pending;
    if (canvasViewportStorageTimerRef.current !== null) return;
    canvasViewportStorageTimerRef.current = window.setTimeout(
      flushCanvasViewportStorage,
      CANVAS_VIEWPORT_STORAGE_THROTTLE_MS,
    );
  }, [flushCanvasViewportStorage]);

  const handleViewportMoveStart = useCallback(() => {
    if (radialViewportLockRef.current) {
      restoreRadialViewportLock();
      return;
    }
    clearEdgeMotionReleaseTimer();
    setViewportMoving(true);
  }, [clearEdgeMotionReleaseTimer, restoreRadialViewportLock]);

  const handleViewportMove = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
    const nextTier = resolveCanvasZoomReadabilityTier(viewport.zoom);
    setCanvasZoomReadability((currentTier) => currentTier === nextTier ? currentTier : nextTier);
  }, []);

  const handleViewportMoveEnd = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
    if (radialViewportLockRef.current) {
      restoreRadialViewportLock();
      return;
    }
    const snappedViewport = snapCanvasViewportToDevicePixels(
      viewport,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    );
    const canvasId = loadedCanvasIdRef.current;
    if (canvasId && loadedRef.current) {
      scheduleCanvasViewportStorage(canvasId, snappedViewport);
    }
    if (
      Math.abs(snappedViewport.x - viewport.x) > 0.001 ||
      Math.abs(snappedViewport.y - viewport.y) > 0.001
    ) {
      void setViewport(snappedViewport);
    }
    releaseEdgeMotionSoon(setViewportMoving);
  }, [releaseEdgeMotionSoon, restoreRadialViewportLock, scheduleCanvasViewportStorage, setViewport]);

  // ===== SHIFT+拖拽 Handle 批量移线 =====
  // 按住 SHIFT 从节点入口(target handle)拖出，可一次性把所有入边移到另一个节点的入口。
  // 同理也支持从 source handle SHIFT+拖拽移动所有出边。
  const bulkReconnectRef = useRef<{
    fromNodeId: string;
    handleType: 'source' | 'target';
    edges: Edge[];
  } | null>(null);

  // nodes/edges refs are synchronously advanced by the wrapped setters above,
  // so a Patch response cannot miss a same-batch local mutation.
  useEffect(() => {
    radialMenuRef.current = radialMenu;
  }, [radialMenu]);

  const annotateThemedPortHandles = useCallback(() => {
    if ((!isFarmStory && !isGardenDefense) || typeof document === 'undefined') return;
    const ariaTheme = isGardenDefense ? 'garden-defense' : 'farm-story';
    const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
    document.querySelectorAll<HTMLElement>('.react-flow__handle').forEach((handleEl) => {
      const nodeId =
        handleEl.getAttribute('data-nodeid') ||
        handleEl.closest('.react-flow__node')?.getAttribute('data-id') ||
        '';
      const rawHandleType =
        handleEl.getAttribute('data-handletype') ||
        (handleEl.classList.contains('source') ? 'source' : handleEl.classList.contains('target') ? 'target' : '');
      if (rawHandleType !== 'source' && rawHandleType !== 'target') return;
      const node = nodeById.get(nodeId);
      const portType = inferFarmHandlePortType(node, rawHandleType, handleEl.getAttribute('data-handleid'));
      if (!portType) {
        handleEl.removeAttribute('data-t8-port-type');
        handleEl.removeAttribute('data-t8-port-label');
        if (['farm-story', 'garden-defense'].includes(handleEl.getAttribute('data-t8-port-aria') || '')) {
          handleEl.removeAttribute('aria-label');
          handleEl.removeAttribute('data-t8-port-aria');
        }
        return;
      }
      handleEl.setAttribute('data-t8-port-type', portType);
      handleEl.setAttribute('data-t8-port-label', PORT_LABEL[portType]);
      handleEl.setAttribute('data-t8-port-aria', ariaTheme);
      handleEl.setAttribute('aria-label', `${PORT_LABEL[portType]}${rawHandleType === 'source' ? '输出' : '输入'}端口`);
    });
  }, [isFarmStory, isGardenDefense]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const clearThemedPortHandles = () => {
      document.querySelectorAll<HTMLElement>('.react-flow__handle[data-t8-port-type]').forEach((handleEl) => {
        handleEl.removeAttribute('data-t8-port-type');
        handleEl.removeAttribute('data-t8-port-label');
        if (['farm-story', 'garden-defense'].includes(handleEl.getAttribute('data-t8-port-aria') || '')) {
          handleEl.removeAttribute('aria-label');
          handleEl.removeAttribute('data-t8-port-aria');
        }
      });
    };
    if (!isFarmStory && !isGardenDefense) {
      clearThemedPortHandles();
      return undefined;
    }
    annotateThemedPortHandles();
    const root = document.querySelector('.react-flow') || document.body;
    const observer = new MutationObserver(() => annotateThemedPortHandles());
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [annotateThemedPortHandles, isFarmStory, isGardenDefense, nodes]);

  const suppressRadialContextMenu = useCallback(() => {
    radialContextMenuSuppressedUntilRef.current = Date.now() + RADIAL_MENU_CONTEXT_SUPPRESS_MS;
  }, []);

  const isRadialMenuContextMenuSuppressed = useCallback(() => (
    Date.now() < radialContextMenuSuppressedUntilRef.current ||
    Boolean(radialMenuRef.current) ||
    Boolean(radialPressRef.current?.open)
  ), []);

  useEffect(() => {
    if (!loaded || !achievementProfileLoaded || !achievementTrackingEnabled) return;
    const syncOnce = (key: string, payload: Parameters<typeof trackAchievementEvent>[0]) => {
      if (hiddenOutputSyncRef.current.has(key)) return;
      hiddenOutputSyncRef.current.add(key);
      trackAchievementEvent(payload);
    };
    const hasRhDuckDecodedOutput = nodes.some((node) => Boolean((node.data as any)?.rhDuckDecoded));
    if (hasRhDuckDecodedOutput && !rhDuckDecodedUnlocked) {
      syncOnce('rh-duck-used-output', {
        type: 'hidden_mode.used',
        theme: 'rh',
        kind: 'rh-duck',
        mode: 'used',
        nodeType: 'upload',
      });
    }
    const hasYyhPortraitHiddenOutput = nodes.some((node) => Boolean((node.data as any)?.yyhPortraitHidden));
    if (hasYyhPortraitHiddenOutput && !yyhPortraitOutputUnlocked) {
      syncOnce('yyh-portrait-used-output', {
        type: 'hidden_mode.used',
        theme: 'yyh',
        kind: 'yyh-portrait',
        mode: 'used',
        nodeType: 'portrait-master',
      });
    }
  }, [
    achievementProfileLoaded,
    achievementTrackingEnabled,
    loaded,
    nodes,
    rhDuckDecodedUnlocked,
    yyhPortraitOutputUnlocked,
  ]);

  useEffect(() => {
    if (!lastDone?.ok || !lastDone.ts || lastAchievementDoneTsRef.current === lastDone.ts) return;
    lastAchievementDoneTsRef.current = lastDone.ts;
    const node = nodesRef.current.find((item) => item.id === lastDone.id);
    const nodeType = String(node?.type || 'unknown');
    trackAchievementEvent({ type: 'node.run_success', theme: visualStyle, nodeType });
    window.dispatchEvent(new CustomEvent('t8:tetris-energy-bonus', {
      detail: { amount: 12, nodeType },
    }));
    if (nodeType === 'panorama-3d') {
      trackAchievementEvent({ type: 'panorama.generated', theme: visualStyle, nodeType });
    } else if (nodeType === 'aggregate-parser') {
      trackAchievementEvent({ type: 'parsehub.resolved', theme: visualStyle, nodeType });
    }
  }, [lastDone, visualStyle]);

  const assignActiveNodeSerials = useCallback((incomingNodes: Node[], existingNodes?: Node[]) => {
    const result = assignFreshNodeSerials(incomingNodes, existingNodes || nodesRef.current, nextNodeSerialIdRef.current);
    nextNodeSerialIdRef.current = result.nextNodeSerialId;
    return result.nodes;
  }, []);

  const registerPlacementShelfNodes = useCallback((incomingNodes: Node[], source: PlacementShelfSource) => {
    const mapped = incomingNodes
      .map((node) => placementShelfItemFromNode(node, source))
      .filter((item): item is PlacementShelfItem => !!item);
    if (mapped.length === 0) return;
    setPlacementShelfItems((prev) => {
      const replacementIds = new Set(mapped.map((item) => item.nodeId));
      return [...mapped, ...prev.filter((item) => !replacementIds.has(item.nodeId))];
    });
  }, []);

  const addNodesToPlacementShelf = useCallback((nodeIds: string[]) => {
    const idSet = new Set(nodeIds.filter(Boolean));
    if (idSet.size === 0) return;
    const mapped = nodesRef.current
      .filter((node) => idSet.has(node.id))
      .map((node) => (
        placementShelfItemFromNode(node, '手动') ||
        placementShelfItemFromNode(node, '手动', { includeNodeFallback: true })
      ))
      .filter((item): item is PlacementShelfItem => !!item);
    if (mapped.length === 0) {
      logBus.warn('没有找到可加入放置栏的节点', '放置栏');
      return;
    }
    setPlacementShelfItems((prev) => {
      const replacementIds = new Set(mapped.map((item) => item.nodeId));
      return [...mapped, ...prev.filter((item) => !replacementIds.has(item.nodeId))];
    });
    setPlacementShelfHidden(false);
    setPlacementShelfOpen(true);
    logBus.success(`已添加 ${mapped.length} 个节点到放置栏`, '放置栏');
  }, []);

  const clearPlacementShelf = useCallback(() => {
    if (activeId) placementShelfClearedCanvasIdsRef.current.add(activeId);
    setPlacementShelfHidden(true);
    setPlacementShelfItems([]);
    setPlacementShelfOpen(false);
    logBus.success('已清空放置栏', '放置栏');
  }, [activeId]);

  const movePlacementShelfNode = useCallback((item: PlacementShelfItem, point: { x: number; y: number }) => {
    const node = nodesRef.current.find((candidate) => candidate.id === item.nodeId);
    if (!node) {
      setPlacementShelfItems((prev) => prev.filter((entry) => entry.nodeId !== item.nodeId));
      logBus.warn('放置栏映射的节点已不存在，已移除该条目', '放置栏');
      return;
    }
    const rect = rectOf(node);
    const flowPoint = screenToFlowPosition(point);
    const nextPosition = {
      x: flowPoint.x - rect.w / 2,
      y: flowPoint.y - rect.h / 2,
    };
    setNodes((prev) =>
      prev.map((candidate) => (
        candidate.id === item.nodeId
          ? {
              ...candidate,
              selected: true,
              position: nextPosition,
              data: { ...(candidate.data || {}), userMoved: true },
            }
          : { ...candidate, selected: false }
      )),
    );
    logBus.success(`已移动放置栏素材：${item.title}`, '放置栏');
  }, [screenToFlowPosition]);

  const markManualNodeDeletion = useCallback(
    (nodeIds: Iterable<string>, beforeNodes?: Node[]) => {
      if (!activeId) return;
      const idList = [...nodeIds].filter((id) => typeof id === 'string' && id.trim());
      if (idList.length === 0) return;
      markCanvasNodesDeleted(activeId, idList);
      const removeIds = new Set(idList);
      const baseNodes = beforeNodes || nodesRef.current;
      const remaining = baseNodes.filter((node) => node.id !== BULK_PHANTOM_ID && !removeIds.has(node.id));
      if (remaining.length === 0) {
        allowEmptySaveCanvasIdsRef.current.add(activeId);
      }
    },
    [activeId],
  );

  useEffect(() => {
    const onOpenSendMaterials = (event: Event) => {
      const detail = (event as CustomEvent<{
        materials?: SendableMaterial[];
        nodeFragment?: SendNodeFragment;
        sourceLabel?: string;
        defaultMode?: SendTargetMode;
        atScreen?: { x: number; y: number };
      }>).detail || {};
      const materials = Array.isArray(detail.materials) ? detail.materials : [];
      const nodeFragment = detail.nodeFragment?.nodes?.length ? detail.nodeFragment : undefined;
      if (materials.length === 0 && !nodeFragment) return;
      setSendModal({
        materials,
        nodeFragment,
        sourceLabel: detail.sourceLabel || '素材',
        defaultMode: detail.defaultMode || 'auto',
        atScreen: detail.atScreen,
      });
    };
    window.addEventListener('penguin:open-send-materials', onOpenSendMaterials);
    return () => window.removeEventListener('penguin:open-send-materials', onOpenSendMaterials);
  }, []);

  // 吸附 + 对齐辅助线
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [outputMaterialPersistenceEnabled, setOutputMaterialPersistenceEnabled] = useState(() =>
    readOutputMaterialPersistenceSetting(),
  );
  const toggleOutputMaterialPersistence = useCallback(() => {
    setOutputMaterialPersistenceEnabled((current) => {
      const next = !current;
      writeOutputMaterialPersistenceSetting(next);
      return next;
    });
  }, []);
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });

  // 批量运行状态
  const [isRunning, setIsRunning] = useState(false);
  const [workflowDoctorEnabled, setWorkflowDoctorEnabled] = useState(() =>
    readWorkflowDoctorEnabled(),
  );
  const activeCanvasRunsRef = useRef(new Set<ActiveCanvasRunControl>());
  const activeRunPlansRef = useRef(new Map<symbol, Set<string>>());
  const runLaunchQueueRef = useRef(createRunLaunchQueue());
  const pendingCanvasNodeRunRequestsRef = useRef(new Set<string>());
  const canvasNodeRunRetryAfterRef = useRef(new Map<string, number>());
  const [runPreflightModal, setRunPreflightModal] = useState<{
    loading: boolean;
    preview: RunActionPreview | null;
  } | null>(null);
  const runPreflightAbortRef = useRef<AbortController | null>(null);
  const runPreflightPendingRef = useRef(false);
  const runIntentWorkerIdRef = useRef('');
  if (!runIntentWorkerIdRef.current) {
    const nonce = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runIntentWorkerIdRef.current = `host-renderer:${nonce}`;
  }
  const runIntentWorkerBusyRef = useRef(false);
  const runIntentRetryAfterRef = useRef<Map<string, number>>(new Map());
  const runPreflightDecisionRef = useRef<((confirmed: boolean) => void) | null>(null);
  const runPreflightPresentedDigestRef = useRef<string | null>(null);
  const batchTotal = useRunBusStore((s) => s.batchTotal);
  const batchDone = useRunBusStore((s) => s.batchDoneCount);

  // 选区右键菜单(框选后右键 或 节点上右键)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
  } | null>(null);
  const [subflowDraft, setSubflowDraft] = useState<SubflowDraftState | null>(null);
  const [subflowInspector, setSubflowInspector] = useState<SubflowInspectorState | null>(null);
  const subflowEditDragStartRef = useRef<SubflowDefinition | null>(null);
  const subflowInspectorViewportsRef = useRef<Record<string, { x: number; y: number; zoom: number }>>({});
  const [selectionContextSubmenu, setSelectionContextSubmenu] = useState<'align' | null>(null);
  const selectionContextSubmenuCloseTimerRef = useRef<number | null>(null);
  const [sendModal, setSendModal] = useState<{
    materials: SendableMaterial[];
    nodeFragment?: SendNodeFragment;
    sourceLabel: string;
    defaultMode: SendTargetMode;
    atScreen?: { x: number; y: number };
  } | null>(null);
  const pendingSendFocusRef = useRef<{
    canvasId: string;
    center: { x: number; y: number };
    zoom: number;
  } | null>(null);
  const pendingSendFocusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onOpenSubflow = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; definition?: SubflowDefinition }>).detail;
      if (detail?.definition && detail.nodeId) {
        setSubflowInspector({ instanceNodeId: detail.nodeId, stack: [detail.definition], pathNodeIds: [detail.nodeId] });
      }
    };
    window.addEventListener('penguin:subflow-open', onOpenSubflow);
    return () => window.removeEventListener('penguin:subflow-open', onOpenSubflow);
  }, []);

  // 画布空白区右键菜单(快速添加节点)
  const [paneMenu, setPaneMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // 历史栈
  const applySnapshot = useCallback((snap: { nodes: Node[]; edges: Edge[] }) => {
    setNodes(snap.nodes);
    setEdges(snap.edges);
  }, []);
  const { capture: histCapture, captureTransition: histCaptureTransition, undo: histUndo, redo: histRedo, reset: histReset, canUndo, canRedo } =
    useCanvasHistory(applySnapshot);
  const captureTimer = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const setCanvasRevision = useCallback((canvasId: string, revision: unknown) => {
    const numeric = Number(revision);
    if (!Number.isSafeInteger(numeric) || numeric < 1) return;
    canvasRevisionsRef.current.set(canvasId, numeric);
    if (useCanvasStore.getState().activeId === canvasId) setActiveCanvasRevision(numeric);
  }, []);

  const enqueueCanvasMutation = useCallback(function enqueue<T>(canvasId: string, work: () => Promise<T>): Promise<T> {
    const previous = canvasMutationQueuesRef.current.get(canvasId) || Promise.resolve();
    const result = previous.catch(() => undefined).then(work);
    const barrier = result.then(() => undefined, () => undefined);
    canvasMutationQueuesRef.current.set(canvasId, barrier);
    void barrier.finally(() => {
      if (canvasMutationQueuesRef.current.get(canvasId) === barrier) canvasMutationQueuesRef.current.delete(canvasId);
    });
    return result;
  }, []);

  const cancelScheduledHistoryCapture = useCallback(() => {
    if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
    captureTimer.current = null;
  }, []);

  // 节点/连线变更后,在拖拽结束 + 短暂防抖窗口内压栈一次
  const scheduleCapture = useCallback(
    (snap: { nodes: Node[]; edges: Edge[] }) => {
      if (isDraggingRef.current) return;
      cancelScheduledHistoryCapture();
      captureTimer.current = window.setTimeout(() => {
        captureTimer.current = null;
        histCapture(snap);
      }, 250);
    },
    [cancelScheduledHistoryCapture, histCapture]
  );

  // 加载画布数据
  useEffect(() => {
    if (performanceFixtureSize != null && performanceFixtureCanvasId) {
      markCanvasPerformance('canvas-hydration-start');
      setCanvasLoadFailure(null);
      cancelScheduledHistoryCapture();
      setActiveProjectId(null);
      setActiveCanvasRevision(0);
      setInitializedFlowCanvasId(null);
      setCanvasPatchConflictMessage('');
      patchPreviewBaselinesRef.current.clear();
      const fixture = buildCanvasPerformanceFixture(performanceFixtureSize);
      nextNodeSerialIdRef.current = performanceFixtureSize + 1;
      replaceHydratedCanvasGraph(fixture.nodes as Node[], fixture.edges as Edge[]);
      setCreativeDesk(createDefaultCreativeDeskState());
      setFarmCanvas(createFarmState());
      setFarmCanvasEditing(false);
      setCreativeDeskEditing(false);
      setCreativeDeskActiveItemId(null);
      setPlacementShelfItems([]);
      setPlacementShelfOpen(false);
      setInitialCanvasViewport({
        canvasId: performanceFixtureCanvasId,
        viewport: { x: 64, y: 64, zoom: 0.72 },
      });
      histReset();
      setLoadedCanvasId(performanceFixtureCanvasId);
      setLoaded(true);
      return;
    }
    if (!activeId) {
      setCanvasLoadFailure(null);
      cancelScheduledHistoryCapture();
      nextNodeSerialIdRef.current = 1;
      setNodes([]);
      setEdges([]);
      setCreativeDesk(createDefaultCreativeDeskState());
      setFarmCanvas(createFarmState());
      setFarmCanvasEditing(false);
      setFarmCanvasFeedback('点击工具后，在画布空白处开始经营。');
      setCreativeDeskEditing(false);
      setCreativeDeskActiveItemId(null);
      setPlacementShelfItems([]);
      setPlacementShelfOpen(false);
      setLoaded(false);
      setInitialCanvasViewport(null);
      setLoadedCanvasId(null);
      setActiveProjectId(null);
      setActiveCanvasRevision(0);
      setInitializedFlowCanvasId(null);
      setCanvasPatchConflictMessage('');
      patchPreviewBaselinesRef.current.clear();
      skipInitialAutosaveCanvasIdsRef.current.clear();
      skipInitialHistoryCanvasIdsRef.current.clear();
      histReset();
      return;
    }
    const requestedCanvasId = activeId;
    markCanvasPerformance('canvas-hydration-start');
    setCanvasLoadFailure(null);
    cancelScheduledHistoryCapture();
    setActiveProjectId(null);
    setActiveCanvasRevision(0);
    setInitializedFlowCanvasId(null);
    setCanvasPatchConflictMessage('');
    setInitialCanvasViewport(null);
    skipInitialAutosaveCanvasIdsRef.current.delete(requestedCanvasId);
    skipInitialHistoryCanvasIdsRef.current.delete(requestedCanvasId);
    patchPreviewBaselinesRef.current.clear();
    setLoaded(false);
    setLoadedCanvasId(null);
    let cancelled = false;
    api
      .getCanvasData(requestedCanvasId)
      .then((data) => {
        if (cancelled || useCanvasStore.getState().activeId !== requestedCanvasId) return;
        const revision = requireAuthoritativeCanvasRevision(data.revision);
        const projectId = String(data.projectId || 'project-local').trim() || 'project-local';
        setActiveProjectId(projectId);
        setCanvasRevision(requestedCanvasId, revision);
        const authoritativeCreativeDesk = migrateCreativeDeskToViewportCoordinates(data.creativeDesk, data.viewport);
        const authoritativeFarmCanvas = sanitizeFarmCanvasState(data.farmCanvas);
        const authoritativeNextNodeSerialId = Math.max(1, Number(data.nextNodeSerialId) || 1);
        const authoritativeState = canvasPatchStateFromCanonicalParts(
          data.nodes || [], data.edges || [], authoritativeCreativeDesk, authoritativeFarmCanvas, authoritativeNextNodeSerialId,
        );
        const existingPending = pendingSaveByCanvasRef.current.get(requestedCanvasId) || null;
        let renderedState = authoritativeState;
        let activatedPending: PendingCanvasSave | null = null;
        let shouldSchedulePendingCas = false;
        if (existingPending) {
          const reconciled = existingPending.conflicted
            ? { state: existingPending as PersistableCanvasPatchState, conflicts: existingPending.conflicts }
            : mergeConcurrentCanvasPatchState(existingPending.baseSnapshot, existingPending, authoritativeState);
          const reconciliationBlocked = existingPending.conflicted || reconciled.conflicts.length > 0;
          const reconciledPending = pendingCanvasSaveFromState(reconciled.state, {
            baseSnapshot: reconciliationBlocked ? existingPending.baseSnapshot : authoritativeState.snapshot,
            baseRevision: reconciliationBlocked ? existingPending.baseRevision : revision,
            conflicts: existingPending.conflicted ? existingPending.conflicts : reconciled.conflicts,
            conflicted: reconciliationBlocked,
          });
          const activation = activateCanvasPatchPending({
            authoritativeSnapshot: authoritativeState.snapshot,
            authoritativeRevision: revision,
            pending: reconciledPending,
          });
          renderedState = reconciled.state;
          activatedPending = activation.pending;
          shouldSchedulePendingCas = activation.shouldScheduleCas;
          if (activation.blocked) {
            const conflictMessage = '本地画布与服务端存在未解决冲突；已保留本地内容并阻止自动覆盖，请先处理冲突。';
            setCanvasPatchConflictMessage(conflictMessage);
            logBus.warn(conflictMessage, '画布同步');
          }
        }
        const ns = renderedState.nodes;
        const es = renderedState.edges;
        const nextCreativeDesk = renderedState.creativeDesk;
        const nextFarmCanvas = renderedState.farmCanvas;
        const savedNextNodeSerialId = renderedState.nextNodeSerialId;
        // ⚡ 兑底补丁: 历史画布中可能存在 connectable=false 的旧 groupBox 节点
        // (5656721 事故期间创建的 group), 加载时强制打开可连接以恢复右侧聚合输出口
        let groupBoxRepaired = false;
        const repairedNodeCandidates = ns.map((n: any) => {
          if (n.type === 'groupBox' && n.connectable === false) {
            groupBoxRepaired = true;
            return { ...n, connectable: true };
          }
          return n;
        });
        const legacyVolcengineMigration = migrateLegacyVolcengineAssetNodes(groupBoxRepaired ? repairedNodeCandidates : ns);
        const serialInputNodes = legacyVolcengineMigration.nodes;
        const normalized = normalizeCanvasNodeSerials(serialInputNodes, savedNextNodeSerialId);
        nextNodeSerialIdRef.current = normalized.nextNodeSerialId;
        const normalizedNodes = normalized.changed ? normalized.nodes : serialInputNodes;
        const fixedNs = ensureCanvasEntityUids(normalizedNodes, 'node');
        const fixedEs = ensureCanvasEntityUids(es, 'edge');
        const canonicalizationChanged = groupBoxRepaired
          || legacyVolcengineMigration.changed
          || normalized.changed
          || normalized.nextNodeSerialId !== savedNextNodeSerialId
          || fixedNs !== normalizedNodes
          || fixedEs !== es;
        const normalizedRenderedState = canonicalizationChanged
          ? canvasPatchStateFromCanonicalParts(
              fixedNs, fixedEs, nextCreativeDesk, nextFarmCanvas, normalized.nextNodeSerialId,
            )
          : renderedState;
        latestPersistableByCanvasRef.current.set(requestedCanvasId, normalizedRenderedState);
        autosaveGenerationByCanvasRef.current.set(
          requestedCanvasId,
          (autosaveGenerationByCanvasRef.current.get(requestedCanvasId) || 0) + 1,
        );
        if (activatedPending) {
          activatedPending = { ...activatedPending, ...normalizedRenderedState };
          if (!activatedPending.conflicted && activatedPending.snapshot === authoritativeState.snapshot) {
            activatedPending = null;
            shouldSchedulePendingCas = false;
            pendingSaveByCanvasRef.current.delete(requestedCanvasId);
          } else {
            pendingSaveByCanvasRef.current.set(requestedCanvasId, activatedPending);
          }
        } else {
          pendingSaveByCanvasRef.current.delete(requestedCanvasId);
        }
        replaceHydratedCanvasGraph(fixedNs, fixedEs);
        setCreativeDesk(nextCreativeDesk);
        setFarmCanvas(nextFarmCanvas);
        setFarmCanvasEditing(false);
        setFarmCanvasFeedback('点击工具后，在画布空白处开始经营。');
        setCreativeDeskEditing(false);
        setCreativeDeskActiveItemId(null);
        setPlacementShelfItems(placementShelfClearedCanvasIdsRef.current.has(requestedCanvasId) ? [] : placementShelfItemsFromCanvasNodes(fixedNs, '画布'));
        setPlacementShelfOpen(false);
        const restoredViewport = resolveCanvasInitialViewport(
          getBrowserCanvasViewportStorage(),
          requestedCanvasId,
          data.viewport,
        );
        setInitialCanvasViewport({ canvasId: requestedCanvasId, viewport: restoredViewport });
        // GET authority is the only saved baseline. Pending local state must never
        // be relabelled as durable merely because it is rendered after activation.
        lastSavedByCanvasRef.current.set(requestedCanvasId, authoritativeState.snapshot);
        lastSavedNodeCountByCanvasRef.current.set(requestedCanvasId, authoritativeState.nodes.length);
        allowEmptySaveCanvasIdsRef.current.delete(requestedCanvasId);
        cancelScheduledHistoryCapture();
        skipInitialHistoryCanvasIdsRef.current.add(requestedCanvasId);
        if (!activatedPending && normalizedRenderedState.snapshot === authoritativeState.snapshot) {
          skipInitialAutosaveCanvasIdsRef.current.add(requestedCanvasId);
        }
        histReset({ nodes: fixedNs, edges: fixedEs }, { deferClone: true });
        setLoadedCanvasId(requestedCanvasId);
        setLoaded(true);
        setCanvasLoadFailure(null);
        if (shouldSchedulePendingCas && activatedPending && !activatedPending.conflicted) {
          setDragSaveTick((tick) => tick + 1);
        }
      })
      .catch((e) => {
        if (cancelled || useCanvasStore.getState().activeId !== requestedCanvasId) return;
        const message = e instanceof Error ? e.message : '未知加载错误';
        console.error('加载画布失败', e);
        setCanvasLoadFailure({ canvasId: requestedCanvasId, message });
        setActiveProjectId(null);
        setActiveCanvasRevision(0);
        setInitializedFlowCanvasId(null);
        setLoadedCanvasId(null);
        setLoaded(false);
        logBus.warn('画布加载失败，已保持只读：' + message, '画布同步');
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeId,
    cancelScheduledHistoryCapture,
    canvasLoadAttempt,
    histReset,
    performanceFixtureCanvasId,
    performanceFixtureSize,
    replaceHydratedCanvasGraph,
    setCanvasRevision,
  ]);

  const handleAuthoritativeFlowInit = useCallback(() => {
    const canvasId = loadedCanvasIdRef.current;
    if (!canvasId
      || !loadedRef.current
      || useCanvasStore.getState().activeId !== canvasId
      || !canvasRevisionsRef.current.has(canvasId)) return;
    setInitializedFlowCanvasId(canvasId);
  }, []);

  useEffect(() => {
    if (!loaded || !loadedCanvasId || loadedCanvasId !== renderedCanvasId) return undefined;
    let idleHandle: number | null = null;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      markCanvasPerformance('canvas-first-frame');
      secondFrame = window.requestAnimationFrame(() => {
        const finish = () => markCanvasPerformance('canvas-interactive');
        if ('requestIdleCallback' in window) {
          idleHandle = (window as Window & { requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number })
            .requestIdleCallback(finish, { timeout: 500 });
        } else idleHandle = globalThis.setTimeout(finish, 0) as unknown as number;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (idleHandle != null) {
        if ('cancelIdleCallback' in window) {
          (window as Window & { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(idleHandle);
        } else globalThis.clearTimeout(idleHandle);
      }
    };
  }, [loaded, loadedCanvasId, renderedCanvasId]);

  useEffect(() => {
    return () => {
      flushCanvasViewportStorage();
      for (const flushPendingAutosave of [...pendingSaveFlushersByCanvasRef.current.values()]) {
        flushPendingAutosave();
      }
      patchPreviewBaselinesRef.current.clear();
      cancelScheduledHistoryCapture();
      if (edgeMotionReleaseTimerRef.current) {
        window.clearTimeout(edgeMotionReleaseTimerRef.current);
        edgeMotionReleaseTimerRef.current = null;
      }
    };
  }, [assignActiveNodeSerials, cancelScheduledHistoryCapture, flushCanvasViewportStorage, releaseEdgeMotionSoon]);

  useEffect(() => {
    if (!activeId || !loaded || loadedCanvasId !== activeId) return;
    const pending = pendingSendFocusRef.current;
    if (!pending || pending.canvasId !== activeId) return;
    pendingSendFocusRef.current = null;
    if (pendingSendFocusTimerRef.current) window.clearTimeout(pendingSendFocusTimerRef.current);
    pendingSendFocusTimerRef.current = window.setTimeout(() => {
      setCenter(pending.center.x, pending.center.y, {
        zoom: pending.zoom,
        duration: 520,
      });
      pendingSendFocusTimerRef.current = null;
    }, 90);
  }, [activeId, loaded, loadedCanvasId, nodes.length, setCenter]);

  useEffect(() => {
    return () => {
      if (pendingSendFocusTimerRef.current) window.clearTimeout(pendingSendFocusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeId || !loaded || loadedCanvasId !== activeId) return;
    if (altDragCloneRef.current) return;
    if (nodes.some((node) => node.id === BULK_PHANTOM_ID || String(node.id || '').startsWith('_alt-ph-'))) return;
    const normalized = normalizeCanvasNodeSerials(nodes, nextNodeSerialIdRef.current);
    nextNodeSerialIdRef.current = Math.max(nextNodeSerialIdRef.current, normalized.nextNodeSerialId);
    if (normalized.changed) {
      setNodes(normalized.nodes);
    }
  }, [activeId, loaded, loadedCanvasId, nodes]);

  // nodes/edges 变化后压栈(节流防止拖拽中海量入栈)
  useEffect(() => {
    if (!loaded || loadedCanvasId !== activeId) return;
    if (activeId && skipInitialHistoryCanvasIdsRef.current.delete(activeId)) return;
    scheduleCapture({ nodes, edges });
  }, [nodes, edges, activeId, loaded, loadedCanvasId, scheduleCapture]);

  // 自动保存(防抖 800ms,防空数据覆盖)
  useEffect(() => {
    if (!activeId || !loaded || loadedCanvasId !== activeId) return;
    const currentRevision = canvasRevisionsRef.current.get(activeId);
    if (!hasCanvasWriteAuthority({
      activeCanvasId: activeId,
      loadedCanvasId,
      loaded,
      revision: currentRevision,
    })) return;
    const authoritativeRevision = requireAuthoritativeCanvasRevision(currentRevision);
    if (isDraggingRef.current) return;
    if (skipInitialAutosaveCanvasIdsRef.current.delete(activeId)) return;
    const nextNodeSerialId = nextNodeSerialIdRef.current;
    const canvasIdForSave = activeId;
    // 过滤 SHIFT 批量移线拖拽过程中的 phantom 节点与重定向边(不作为持久化快照)
    const currentState = persistableCanvasPatchStateFromParts(
      nodes,
      edges,
      creativeDesk,
      farmCanvas,
      nextNodeSerialId,
    );
    const { nodes: persistNodes, edges: persistEdges, snapshot } = currentState;
    latestPersistableByCanvasRef.current.set(canvasIdForSave, currentState);
    const previousSnapshot = lastSavedByCanvasRef.current.get(canvasIdForSave) || '';
    const existingPending = pendingSaveByCanvasRef.current.get(canvasIdForSave) || null;
    const currentPending = pendingCanvasSaveFromState(currentState, {
      baseSnapshot: existingPending?.baseSnapshot || previousSnapshot,
      baseRevision: existingPending?.baseRevision ?? authoritativeRevision,
    });
    const reconciliation = reconcileCanvasPatchAutosavePending({
      authoritativeSnapshot: previousSnapshot,
      current: currentPending,
      pending: existingPending,
    });
    if (reconciliation.cancelTimer) {
      autosaveGenerationByCanvasRef.current.set(
        canvasIdForSave,
        (autosaveGenerationByCanvasRef.current.get(canvasIdForSave) || 0) + 1,
      );
      const blockedTimer = saveTimersByCanvasRef.current.get(canvasIdForSave);
      if (blockedTimer !== undefined) window.clearTimeout(blockedTimer);
      saveTimersByCanvasRef.current.delete(canvasIdForSave);
      pendingSaveFlushersByCanvasRef.current.delete(canvasIdForSave);
    }
    if (reconciliation.shouldReturn) {
      if (reconciliation.pending) pendingSaveByCanvasRef.current.set(canvasIdForSave, reconciliation.pending);
      else pendingSaveByCanvasRef.current.delete(canvasIdForSave);
      return;
    }
    const previousNodeCount = lastSavedNodeCountByCanvasRef.current.get(canvasIdForSave) || 0;
    const allowEmptySave = allowEmptySaveCanvasIdsRef.current.has(canvasIdForSave);
    if (persistNodes.length === 0 && previousNodeCount > 0 && !allowEmptySave) {
      // 防止空数据覆盖
      return;
    }
    const previousTimer = saveTimersByCanvasRef.current.get(canvasIdForSave);
    if (previousTimer) window.clearTimeout(previousTimer);
    pendingSaveFlushersByCanvasRef.current.delete(canvasIdForSave);
    pendingSaveByCanvasRef.current.set(canvasIdForSave, currentPending);
    const generation = (autosaveGenerationByCanvasRef.current.get(canvasIdForSave) || 0) + 1;
    autosaveGenerationByCanvasRef.current.set(canvasIdForSave, generation);
    const token: CanvasPatchAutosaveToken<PendingCanvasSave> = {
      generation,
      snapshot,
      pendingIdentity: currentPending,
    };
    let timer: number;
    let started = false;
    const flushPendingAutosave = () => {
      if (started) return;
      started = true;
      if (timer) window.clearTimeout(timer);
      if (pendingSaveFlushersByCanvasRef.current.get(canvasIdForSave) === flushPendingAutosave) {
        pendingSaveFlushersByCanvasRef.current.delete(canvasIdForSave);
      }
      void (async () => {
      const payload = { nodes: persistNodes, edges: persistEdges, viewport: getViewport(), nextNodeSerialId, creativeDesk, farmCanvas };
      const latestStateForResponse = () => {
        const active = useCanvasStore.getState().activeId === canvasIdForSave
          && loadedRef.current
          && loadedCanvasIdRef.current === canvasIdForSave;
        if (active) {
          const state = persistableCanvasPatchStateFromParts(
            nodesRef.current,
            edgesRef.current,
            creativeDeskRef.current,
            farmCanvasRef.current,
            nextNodeSerialIdRef.current,
          );
          latestPersistableByCanvasRef.current.set(canvasIdForSave, state);
          return { active, state };
        }
        return {
          active,
          state: latestPersistableByCanvasRef.current.get(canvasIdForSave)
            || pendingSaveByCanvasRef.current.get(canvasIdForSave)
            || token.pendingIdentity,
        };
      };
      const invalidateOutstandingAutosaves = () => {
        autosaveGenerationByCanvasRef.current.set(
          canvasIdForSave,
          (autosaveGenerationByCanvasRef.current.get(canvasIdForSave) || 0) + 1,
        );
        const scheduledTimer = saveTimersByCanvasRef.current.get(canvasIdForSave);
        if (scheduledTimer !== undefined) window.clearTimeout(scheduledTimer);
        saveTimersByCanvasRef.current.delete(canvasIdForSave);
        pendingSaveFlushersByCanvasRef.current.delete(canvasIdForSave);
      };
      try {
        await enqueueCanvasMutation(canvasIdForSave, async () => {
          // 计时器等待其他 mutation 时，generation 或 pending 身份任一变化都使旧 PUT 失效。
          if (autosaveGenerationByCanvasRef.current.get(canvasIdForSave) !== token.generation
            || pendingSaveByCanvasRef.current.get(canvasIdForSave) !== token.pendingIdentity) return;
          const putBaseRevision = requireAuthoritativeCanvasRevision(canvasRevisionsRef.current.get(canvasIdForSave));
          const saved = await api.saveCanvasData(canvasIdForSave, payload, {
            allowEmpty: allowEmptySave,
            baseRevision: putBaseRevision,
          });
          const savedRevision = Number(saved.revision);
          if (!Number.isSafeInteger(savedRevision) || savedRevision < 1) {
            throw new Error('画布自动保存未返回有效 revision');
          }
          const latest = latestStateForResponse();
          const latestPending = pendingSaveByCanvasRef.current.get(canvasIdForSave) || null;
          const response = reconcileCanvasPatchAutosaveResponse({
            outcome: 'success',
            savedRevision,
            token,
            currentGeneration: autosaveGenerationByCanvasRef.current.get(canvasIdForSave) || 0,
            current: pendingCanvasSaveFromState(latest.state, {
              baseSnapshot: latestPending?.baseSnapshot || token.pendingIdentity.baseSnapshot,
              baseRevision: latestPending?.baseRevision ?? token.pendingIdentity.baseRevision,
              conflicts: latestPending?.conflicts,
              conflicted: latestPending?.conflicted,
            }),
            pending: latestPending,
            active: latest.active,
          });
          invalidateOutstandingAutosaves();
          setCanvasRevision(canvasIdForSave, savedRevision);
          api.autoSaveCanvasData(canvasIdForSave, {
            ...payload,
            revision: savedRevision,
            updatedAt: saved.updatedAt,
          }).catch((e) => {
            console.warn('画布自动保存到本地路径失败', e);
          });
          if (allowEmptySave) allowEmptySaveCanvasIdsRef.current.delete(canvasIdForSave);
          lastSavedByCanvasRef.current.set(canvasIdForSave, response.acceptedSnapshot || snapshot);
          lastSavedNodeCountByCanvasRef.current.set(canvasIdForSave, persistNodes.length);
          if (response.pending) pendingSaveByCanvasRef.current.set(canvasIdForSave, response.pending);
          else pendingSaveByCanvasRef.current.delete(canvasIdForSave);
          if (response.shouldScheduleCas) setDragSaveTick((tick) => tick + 1);
          useCanvasStore.setState((state) => ({
            canvases: state.canvases.map((canvas) =>
              canvas.id === canvasIdForSave
                ? { ...canvas, nodeCount: persistNodes.length, updatedAt: Date.now() }
                : canvas,
            ),
          }));
        });
      } catch (e) {
        if (e instanceof api.ApiRequestError && e.status === 409) {
          const latest = latestStateForResponse();
          const latestPending = pendingSaveByCanvasRef.current.get(canvasIdForSave) || null;
          const response = reconcileCanvasPatchAutosaveResponse({
            outcome: 'conflict',
            token,
            currentGeneration: autosaveGenerationByCanvasRef.current.get(canvasIdForSave) || 0,
            current: pendingCanvasSaveFromState(latest.state, {
              baseSnapshot: latestPending?.baseSnapshot || token.pendingIdentity.baseSnapshot,
              baseRevision: latestPending?.baseRevision ?? token.pendingIdentity.baseRevision,
              conflicts: latestPending?.conflicts,
              conflicted: latestPending?.conflicted,
            }),
            pending: latestPending,
            active: latest.active,
          });
          invalidateOutstandingAutosaves();
          if (response.pending) pendingSaveByCanvasRef.current.set(canvasIdForSave, response.pending);
          else pendingSaveByCanvasRef.current.delete(canvasIdForSave);
          if (response.pending?.conflicted) {
            logBus.warn('画布 revision 冲突；本地修改已保留并阻止自动覆盖，请先处理冲突。', '画布同步');
            if (latest.active) {
              setCanvasPatchConflictMessage('画布 revision 冲突；本地修改已保留并阻止自动覆盖，请先处理冲突。');
            }
            console.warn('画布版本冲突，已停止旧快照覆盖；等待协作同步', e.data);
          } else {
            if (latest.active) setCanvasPatchConflictMessage('');
            if (response.shouldScheduleCas) setDragSaveTick((tick) => tick + 1);
            console.warn('旧画布保存请求已被新的权威 revision 取代；保留合并结果并继续补偿保存', e.data);
          }
        } else if (pendingSaveByCanvasRef.current.get(canvasIdForSave)?.snapshot === snapshot
          && useCanvasStore.getState().activeId === canvasIdForSave) {
          // 短暂网络故障保留同一快照，并重新进入防抖保存；409 必须先显式同步，不能盲重试覆盖。
          setDragSaveTick((tick) => tick + 1);
        }
        console.error('保存画布失败', e);
      } finally {
        if (saveTimersByCanvasRef.current.get(canvasIdForSave) === timer) {
          saveTimersByCanvasRef.current.delete(canvasIdForSave);
        }
        if (pendingSaveFlushersByCanvasRef.current.get(canvasIdForSave) === flushPendingAutosave) {
          pendingSaveFlushersByCanvasRef.current.delete(canvasIdForSave);
        }
      }
      })();
    };
    timer = window.setTimeout(flushPendingAutosave, 800);
    saveTimersByCanvasRef.current.set(canvasIdForSave, timer);
    pendingSaveFlushersByCanvasRef.current.set(canvasIdForSave, flushPendingAutosave);
  }, [nodes, edges, creativeDesk, farmCanvas, activeId, loaded, loadedCanvasId, getViewport, dragSaveTick, enqueueCanvasMutation, setCanvasRevision]);

  const getCreativeDeskCenter = useCallback(() => {
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = flowEl?.getBoundingClientRect();
    return rect
      ? { x: rect.width / 2, y: rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }, []);

  const loadCreativeDeskResources = useCallback(async () => {
    setCreativeDeskResourceLoading(true);
    setCreativeDeskMessage('');
    try {
      const result = await api.getResourceItems({ kind: 'image' });
      if (!result.success) throw new Error(result.error || '资源库读取失败');
      const items = result.data || [];
      setCreativeDeskResources(items);
      setCreativeDeskMessage(items.length > 0 ? `已载入 ${items.length} 张图片` : '资源库暂无图片');
    } catch (err: any) {
      setCreativeDeskMessage(err?.message || '资源库读取失败');
    } finally {
      setCreativeDeskResourceLoading(false);
    }
  }, []);

  const loadFarmResourceDecorItems = useCallback(async () => {
    setFarmResourceDecorLoading(true);
    try {
      const result = await api.getResourceItems({ kind: 'image' });
      if (!result.success) throw new Error(result.error || '资源库读取失败');
      const items = result.data || [];
      farmResourceDecorLoadedRef.current = true;
      setFarmResourceDecorItems(items);
      setFarmCanvasFeedback(items.length > 0 ? `已载入 ${items.length} 张资源库图片，可制作牧场装饰。` : '资源库暂无图像，先上传图片再制作牧场装饰。');
    } catch (err: any) {
      farmResourceDecorLoadedRef.current = true;
      setFarmCanvasFeedback(err?.message || '资源库读取失败');
    } finally {
      setFarmResourceDecorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!creativeDeskEditing) return;
    void loadCreativeDeskResources();
  }, [creativeDeskEditing, loadCreativeDeskResources]);

  useEffect(() => {
    if (!isFarmStory || !farmCanvasEditing) return;
    if (farmResourceDecorLoadedRef.current || farmResourceDecorItems.length > 0 || farmResourceDecorLoading) return;
    void loadFarmResourceDecorItems();
  }, [farmCanvasEditing, farmResourceDecorItems.length, farmResourceDecorLoading, isFarmStory, loadFarmResourceDecorItems]);

  const handleCreativeDeskUploadFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => inferCanvasMediaKind(file) === 'image');
    if (images.length === 0) {
      setCreativeDeskMessage('请选择图片文件');
      return;
    }
    setCreativeDeskResourceLoading(true);
    setCreativeDeskMessage('正在上传图片...');
    const prepared: Array<{ url: string; title?: string; resourceId?: string; width?: number; height?: number }> = [];
    for (let i = 0; i < images.length; i += 1) {
      const file = images[i];
      try {
        const naturalSize = await readImageNaturalSize(file);
        const media = await uploadCanvasMediaFile(file, 'image', i);
        let resource: api.ResourceItem | null = null;
        try {
          const resourceResult = await api.addResourceItem({
            kind: 'image',
            url: media.url,
            title: media.name || file.name || '创作台图片',
            tags: ['创作台背景'],
            sourceCanvasId: activeId || undefined,
          });
          if (resourceResult.success) {
            resource = resourceResult.data;
          } else {
            console.warn('创作台图片入库失败，使用上传文件引用', resourceResult.error);
          }
        } catch (resourceErr) {
          console.warn('创作台图片入库失败，使用上传文件引用', resourceErr);
        }
        prepared.push({
          url: resource?.fileUrl || media.url,
          title: resource?.title || media.name || file.name,
          resourceId: resource?.id,
          width: naturalSize?.width || resource?.width,
          height: naturalSize?.height || resource?.height,
        });
      } catch (err: any) {
        console.warn('创作台图片上传失败', err);
      }
    }
    if (prepared.length === 0) {
      setCreativeDeskMessage('图片上传失败');
      setCreativeDeskResourceLoading(false);
      return;
    }
    const center = getCreativeDeskCenter();
    const preparedWithIds = prepared.map((item, index) => ({
      ...item,
      id: `desk-image-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    }));
    const lastItemId = preparedWithIds[preparedWithIds.length - 1]?.id || null;
    setCreativeDesk((prev) => {
      let next = prev;
      preparedWithIds.forEach((item, index) => {
        const created = createCreativeDeskImageItem(item, {
          x: center.x + index * 36,
          y: center.y + index * 36,
        }, next.items);
        next = appendCreativeDeskItem(next, created);
      });
      return next;
    });
    if (lastItemId) setCreativeDeskActiveItemId(lastItemId);
    setCreativeDeskMessage(`已添加 ${prepared.length} 张背景图`);
    setCreativeDeskResourceLoading(false);
    void loadCreativeDeskResources();
  }, [activeId, getCreativeDeskCenter, loadCreativeDeskResources]);

  const handleCreativeDeskResourceTouch = useCallback(async (item: api.ResourceItem) => {
    const result = await api.updateResourceItem(item.id, { touch: true });
    if (!result.success) console.warn('创作台资源使用时间更新失败', result.error);
  }, []);

  const handleFarmToggleEditing = useCallback((enabled: boolean) => {
    setFarmCanvasEditing(enabled);
    if (enabled) {
      setCreativeDeskEditing(false);
      setRadialSettingsOpen(false);
      setModelHelpOpen(false);
      setFarmCanvasFeedback('已进入牧场编辑，选择工具后点击画布空白处操作。');
      return;
    }
    setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'select' }));
    setFarmCanvasFeedback('已退出牧场编辑。');
  }, []);

  const showFarmToolSelectionFeedback = useCallback((feedback: FarmToolSelectionFeedback) => {
    flushFarmContinuousFeedback();
    setFarmCanvasFeedback(feedback.message);
    playFarmSound('select');
  }, [flushFarmContinuousFeedback, playFarmSound]);

  const handleFarmGrantDevMaterials = useCallback(() => {
    if (!import.meta.env.DEV) return;

    const cropIds = Object.keys(FARM_CROP_DEFINITIONS) as FarmCropId[];
    const animalProductIds = Object.keys(FARM_ANIMAL_PRODUCT_DEFINITIONS) as FarmAnimalProductId[];
    const decorIds = Object.keys(FARM_DECOR_DEFINITIONS);
    const seeds = Object.fromEntries(cropIds.map((cropId) => [cropId, FARM_DEV_TEST_MATERIAL_AMOUNT])) as Partial<Record<FarmCropId, number>>;
    const crops = Object.fromEntries(cropIds.map((cropId) => [cropId, FARM_DEV_TEST_MATERIAL_AMOUNT])) as Partial<Record<FarmCropId, number>>;
    const animalProducts = Object.fromEntries(animalProductIds.map((productId) => [productId, FARM_DEV_TEST_MATERIAL_AMOUNT])) as Partial<Record<FarmAnimalProductId, number>>;

    setFarmCanvas((prev) => sanitizeFarmCanvasState({
      ...prev,
      resources: {
        ...prev.resources,
        gold: FARM_DEV_TEST_MATERIAL_AMOUNT,
        wood: FARM_DEV_TEST_MATERIAL_AMOUNT,
        stone: FARM_DEV_TEST_MATERIAL_AMOUNT,
        water: FARM_DEV_TEST_WATER_AMOUNT,
        experience: FARM_DEV_TEST_MATERIAL_AMOUNT,
        seeds,
      },
      inventory: {
        ...prev.inventory,
        crops,
        animalProducts,
        decorIds,
      },
      discoveredCropIds: cropIds,
      unlockedDecorIds: decorIds,
    }));
    setFarmCanvasFeedback('开发环境测试材料已补齐：金币/木材/石头/种子/作物/动物产物 9999，水量 999，装饰全解锁。');
    playFarmSound('order');
  }, [playFarmSound]);

  const handleFarmSelectTool = useCallback((tool: FarmTool) => {
    const nextFarmCanvas = sanitizeFarmCanvasState({
      ...farmCanvas,
      selectedTool: tool,
      selectedResourceDecor: tool === 'decor' ? farmCanvas.selectedResourceDecor : undefined,
    });
    setFarmCanvas(nextFarmCanvas);
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    showFarmToolSelectionFeedback(buildFarmToolSelectionFeedback(tool, nextFarmCanvas));
  }, [farmCanvas, showFarmToolSelectionFeedback]);

  const handleFarmSelectBuilding = useCallback((buildingId: string) => {
    const building = FARM_BUILDING_DEFINITIONS[buildingId] || FARM_BUILDING_DEFINITIONS.hut;
    const nextFarmCanvas = sanitizeFarmCanvasState({
      ...farmCanvas,
      selectedTool: 'build',
      selectedBuildingId: building.id,
      selectedResourceDecor: undefined,
    });
    setFarmCanvas(nextFarmCanvas);
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    showFarmToolSelectionFeedback(buildFarmToolSelectionFeedback('build', nextFarmCanvas));
  }, [farmCanvas, showFarmToolSelectionFeedback]);

  const handleFarmSelectDecor = useCallback((decorId: string) => {
    const decor = FARM_DECOR_DEFINITIONS[decorId] || FARM_DECOR_DEFINITIONS[FARM_DEFAULT_DECOR_ID];
    const nextFarmCanvas = sanitizeFarmCanvasState({
      ...farmCanvas,
      selectedTool: 'decor',
      selectedDecorId: decor.id,
      selectedResourceDecor: undefined,
    });
    setFarmCanvas(nextFarmCanvas);
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    showFarmToolSelectionFeedback(buildFarmToolSelectionFeedback('decor', nextFarmCanvas));
  }, [farmCanvas, showFarmToolSelectionFeedback]);

  const handleFarmSelectResourceDecor = useCallback((resourceId: string, objectType: FarmDecorObjectType) => {
    const resource = farmResourceDecorItems.find((item) => item.id === resourceId);
    if (!resource) {
      setFarmCanvasFeedback('这张资源库图片暂不可用，请刷新资源库后重试。');
      void loadFarmResourceDecorItems();
      return;
    }
    const decorId = farmDecorIdForResourceObjectType(objectType);
    const decor = FARM_DECOR_DEFINITIONS[decorId] || FARM_DECOR_DEFINITIONS[FARM_DEFAULT_DECOR_ID];
    const typeLabel = objectType === 'banner'
      ? '旗帜'
      : objectType === 'poster-wall'
        ? '海报墙'
        : objectType === 'tile'
          ? '地砖'
          : '招牌';
    const nextFarmCanvas = sanitizeFarmCanvasState({
      ...farmCanvas,
      selectedTool: 'decor',
      selectedDecorId: decor.id,
      selectedResourceDecor: {
        resourceId: resource.id,
        skinId: `resource-${objectType}`,
        objectType,
      },
    });
    setFarmCanvas(nextFarmCanvas);
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    showFarmToolSelectionFeedback(buildFarmToolSelectionFeedback('decor', nextFarmCanvas, {
      resourceDecorLabel: `${resource.title || resource.id} -> ${typeLabel}`,
    }));
    void api.updateResourceItem(resource.id, { touch: true }).catch((err) => {
      console.warn('牧场资源装饰使用时间更新失败', err);
    });
  }, [farmCanvas, farmResourceDecorItems, loadFarmResourceDecorItems, showFarmToolSelectionFeedback]);

  const handleFarmCanvasAction = useCallback((action: FarmToolAction) => {
    setFarmCanvas((prev) => {
      const result = applyFarmTool(prev, action);
      setFarmCanvasFeedback(result.feedback);
      const gridSize = result.state.gridSize || 64;
      const tone = farmFeedbackToneForTool(action.tool, Boolean(result.error));
      const beautyGain = result.changed && !result.error
        ? farmBeautyGainForAction(prev, result.state, action.tool)
        : 0;
      const placementEcho = result.changed && !result.error
        ? farmPlacementEchoForAction(result.feedback, action.tool)
        : '';
      const beautyRewardUnlock = result.changed && !result.error
        ? farmBeautyRewardUnlockForAction(prev, result.state, action.tool)
        : null;
      const feedbackAnchor = farmActionFeedbackAnchor(prev, result.state, action);
      const continuousLabel = result.changed && !result.error && farmToolSupportsContinuousAction(action.tool)
        ? farmContinuousFeedbackLabel(action.tool)
        : '';
      if (continuousLabel) {
        queueFarmContinuousFeedback({
          tool: action.tool,
          label: continuousLabel,
          x: feedbackAnchor.x,
          y: feedbackAnchor.y,
          tone,
          placement: feedbackAnchor.placement,
          placementEcho,
          beautyGain,
          beautyRewardTitle: beautyRewardUnlock?.title,
          beautyRewardCount: beautyRewardUnlock?.count,
        });
      } else {
        flushFarmContinuousFeedback();
        pushFarmFloatingFeedback({
          x: feedbackAnchor.x,
          y: feedbackAnchor.y,
          placement: feedbackAnchor.placement,
          message: placementEcho || result.feedback,
          tone,
        });
      }
      playFarmSound(result.changed && !result.error
        ? farmSoundCueForEvent(result.state.eventLog[0]?.kind)
        : farmSoundCueForTool(action.tool, Boolean(result.error)));
      if (result.changed && !result.error) {
        const placedObjectId = findNewFarmPlacedObjectId(prev, result.state, action.tool);
        if (placedObjectId) flashFarmObject(placedObjectId);
        if (beautyGain > 0 && !continuousLabel) {
          pushFarmFloatingFeedback({
            x: feedbackAnchor.x,
            y: feedbackAnchor.placement === 'below'
              ? feedbackAnchor.y + gridSize * 0.2
              : feedbackAnchor.y - gridSize * 0.35,
            placement: feedbackAnchor.placement,
            message: `漂亮度 +${beautyGain}`,
            tone: 'reward',
          });
        }
        if (beautyRewardUnlock && !continuousLabel) {
          pushFarmFloatingFeedback({
            x: feedbackAnchor.x,
            y: feedbackAnchor.placement === 'below'
              ? feedbackAnchor.y + gridSize * 0.55
              : feedbackAnchor.y - gridSize * 0.7,
            placement: feedbackAnchor.placement,
            message: beautyRewardUnlock.count > 1
              ? `美化奖励 +${beautyRewardUnlock.count}`
              : `解锁美化奖励：${beautyRewardUnlock.title}`,
            tone: 'reward',
          });
        }
        trackFarmAchievementsFromEvents(result.state.eventLog, prev.eventLog[0]?.id);
      }
      return result.state;
    });
  }, [flashFarmObject, flushFarmContinuousFeedback, playFarmSound, pushFarmFloatingFeedback, queueFarmContinuousFeedback, trackFarmAchievementsFromEvents]);

  const handleFarmCancelContinuousAction = useCallback((reason: 'escape' | 'contextmenu' | 'blur') => {
    flushFarmContinuousFeedback();
    const center = getFarmViewportCenter();
    const message = reason === 'blur'
      ? '已暂停连续农活'
      : reason === 'contextmenu'
        ? '右键已取消连续农活'
        : '已取消连续农活';
    setFarmCanvasFeedback(message);
    pushFarmFloatingFeedback({
      x: center.x,
      y: center.y,
      message,
      tone: 'warning',
    });
    playFarmSound('select');
  }, [flushFarmContinuousFeedback, getFarmViewportCenter, playFarmSound, pushFarmFloatingFeedback]);

  const handleFarmFinishContinuousAction = useCallback(() => {
    flushFarmContinuousFeedback();
  }, [flushFarmContinuousFeedback]);

  const handleFarmAdvanceDay = useCallback(() => {
    setFarmCanvas((prev) => {
      const next = advanceFarmDay(prev);
      const message = next.lastDailySummary?.message || '新的一天开始了，已浇水的作物继续成长。';
      const center = getFarmViewportCenter();
      setFarmCanvasFeedback(message);
      pushFarmFloatingFeedback({
        x: center.x,
        y: center.y,
        message,
        tone: next.lastDailySummary?.newMatureCrops ? 'reward' : 'success',
      });
      playFarmSound(next.lastDailySummary?.newMatureCrops ? 'harvest' : 'day');
      return next;
    });
  }, [getFarmViewportCenter, playFarmSound, pushFarmFloatingFeedback]);

  const handleFarmCompleteOrder = useCallback((orderId: string) => {
    setFarmCanvas((prev) => {
      const result = completeFarmOrder(prev, orderId);
      const center = getFarmViewportCenter();
      setFarmCanvasFeedback(result.feedback);
      pushFarmFloatingFeedback({
        x: center.x,
        y: center.y,
        message: result.feedback,
        tone: result.error ? 'warning' : 'reward',
      });
      playFarmSound(result.error ? 'error' : 'order');
      if (result.changed && !result.error) {
        trackFarmAchievementsFromEvents(result.state.eventLog, prev.eventLog[0]?.id);
      }
      return result.state;
    });
  }, [getFarmViewportCenter, playFarmSound, pushFarmFloatingFeedback, trackFarmAchievementsFromEvents]);

  const handleFarmCompleteNpcVisit = useCallback((visitId: string) => {
    setFarmCanvas((prev) => {
      const result = completeFarmNpcVisit(prev, visitId);
      const center = getFarmViewportCenter();
      setFarmCanvasFeedback(result.feedback);
      pushFarmFloatingFeedback({
        x: center.x,
        y: center.y,
        message: result.feedback,
        tone: result.error ? 'warning' : 'reward',
      });
      playFarmSound(result.error ? 'error' : 'order');
      if (result.changed && !result.error) {
        trackFarmAchievementsFromEvents(result.state.eventLog, prev.eventLog[0]?.id);
      }
      return result.state;
    });
  }, [getFarmViewportCenter, playFarmSound, pushFarmFloatingFeedback, trackFarmAchievementsFromEvents]);

  const handleFarmJumpToMature = useCallback(() => {
    const state = sanitizeFarmCanvasState(farmCanvas);
    const matureObjects = state.objects.filter((object) => object.kind === 'plot' && object.crop?.stage === 'mature');
    if (matureObjects.length === 0) {
      setFarmCanvasFeedback('当前没有成熟作物。');
      const center = getFarmViewportCenter();
      flushFarmContinuousFeedback();
      setFarmJumpHighlightObjectId(null);
      pushFarmFloatingFeedback({
        x: center.x,
        y: center.y,
        message: '当前没有成熟作物',
        tone: 'warning',
      });
      playFarmSound('error');
      return;
    }
    const index = farmMatureJumpIndexRef.current % matureObjects.length;
    farmMatureJumpIndexRef.current = index + 1;
    const target = matureObjects[index];
    const targetCenterX = target.x + (target.widthCells * state.gridSize) / 2;
    const targetCenterY = target.y + (target.heightCells * state.gridSize) / 2;
    const { zoom } = getViewport();
    setCenter(
      targetCenterX,
      targetCenterY,
      { zoom, duration: 420 },
    );
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'harvest' }));
    setFarmCanvasFeedback(`已定位成熟作物 ${index + 1}/${matureObjects.length}，收获工具已就绪。`);
    flushFarmContinuousFeedback();
    flashFarmObject(target.id);
    pushFarmFloatingFeedback({
      x: targetCenterX,
      y: targetCenterY,
      message: `成熟作物 ${index + 1}/${matureObjects.length}`,
      tone: 'reward',
    });
    playFarmSound('harvest');
  }, [farmCanvas, flashFarmObject, flushFarmContinuousFeedback, getFarmViewportCenter, getViewport, playFarmSound, pushFarmFloatingFeedback, setCenter]);

  const handleFarmMiniMapMarkerClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, marker: FarmMiniMapRenderableMarker) => {
    event.preventDefault();
    event.stopPropagation();
    const centerX = marker.x + marker.width / 2;
    const centerY = marker.y + marker.height / 2;
    const { zoom } = getViewport();
    setCenter(centerX, centerY, { zoom, duration: 420 });
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    if (marker.kind === 'mature') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'harvest' }));
    } else if (marker.kind === 'dry') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'water' }));
    } else if (marker.kind === 'withered') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'shovel' }));
    }
    const message = farmMiniMapMarkerFeedback(marker);
    setFarmCanvasFeedback(message);
    flushFarmContinuousFeedback();
    if (marker.objectId) flashFarmObject(marker.objectId);
    pushFarmFloatingFeedback({
      x: centerX,
      y: centerY,
      message,
      tone: farmMiniMapMarkerTone(marker.kind),
    });
    playFarmSound(farmMiniMapMarkerSoundCue(marker.kind));
  }, [flashFarmObject, flushFarmContinuousFeedback, getViewport, playFarmSound, pushFarmFloatingFeedback, setCenter]);

  // 添加节点(供 Sidebar 调用) —— 默认落在当前视口中心
  // 可选 atScreen 传入屏幕坐标，节点会落在该点(用于右键画布空白区添加)
  // v1.2.10.5: 接入 placeSingleNode 防重叠解析器 ——
  //   期望落点冲突时按螺线 (右→下→左→上 step=80 maxTries=64) 自动避让,
  //   兜底走最右侧 + 写日志 + setCenter 飞镜。
  const addNode = useCallback(
    (type: NodeType, options?: AddNodeOptions) => {
      const atScreen = options?.atScreen;
      const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let cx: number;
      let cy: number;
      if (atScreen) {
        cx = atScreen.x;
        cy = atScreen.y;
      } else {
        // 以 ReactFlow 画布容器中心为默认插入点；拿不到则 fallback 到 window 中心
        const flowEl =
          document.querySelector('.react-flow') as HTMLElement | null;
        const rect = flowEl?.getBoundingClientRect();
        cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      }
      const center = screenToFlowPosition({ x: cx, y: cy });
      // 期望落点: 右键 = 左上角对准鼠标; Sidebar = 节点视觉中心对准视口中心
      const sz = defaultSizeOf(type);
      const desiredX = atScreen ? center.x : center.x - sz.w / 2;
      const desiredY = atScreen ? center.y : center.y - sz.h / 2;
      // 防重叠: 用现有节点矩形求螺线无重叠位置
      const finalPos = placeSingleNode(desiredX, desiredY, type, nodes, {
        source: 'placement:add',
        onFallback: (p) => {
          const { zoom } = getViewport();
          setCenter(p.x, p.y, { zoom, duration: 400 });
        },
      });
      const newNode: Node = {
        id,
        type,
        position: { x: finalPos.x, y: finalPos.y },
        data: { ...(INITIAL_DATA[type] || {}), ...(options?.data || {}) },
      };
      setNodes((prev) => [...prev, ...assignActiveNodeSerials([newNode], prev)]);
      trackAchievementEvent({ type: 'node.created', theme: visualStyle, nodeType: type });
      return id;
    },
    [screenToFlowPosition, nodes, getViewport, setCenter, assignActiveNodeSerials, visualStyle]
  );

  const handleCreateGenerationTarget = useCallback(() => {
    addNode(CREATIVE_TARGET_NODE_TYPE as NodeType);
  }, [addNode]);

  useEffect(() => {
    const onResourceCanvasDrop = (event: Event) => {
      const detail = (event as CustomEvent<MaterialCanvasDropEventDetail>).detail;
      const payload = detail?.payload;
      if (
        !payload ||
        payload.sourceNodeId !== 'resource-library' ||
        !payload.url ||
        payload.kind === 'text'
      ) {
        return;
      }
      addNode('upload', {
        atScreen: { x: detail.clientX, y: detail.clientY },
        data: createUploadDataFromItems(payload.kind, [{
          kind: payload.kind,
          url: payload.url,
          name: payload.name || fileNameFromUrl(payload.url),
          size: payload.size,
          mime: payload.mime,
        }]),
      });
      logBus.success(`已从资源库插入${payload.kind === 'image' ? '图像' : payload.kind === 'video' ? '视频' : '音频'}素材`, '资源库');
    };
    window.addEventListener(MATERIAL_CANVAS_DROP_EVENT, onResourceCanvasDrop);
    return () => window.removeEventListener(MATERIAL_CANVAS_DROP_EVENT, onResourceCanvasDrop);
  }, [addNode]);

  const handleOpenVibeXWorkbench = useCallback(() => {
    window.open(VIBEX_ONLINE_URL, '_blank', 'noopener,noreferrer');
  }, []);

  const handleCreateVibeXNode = useCallback(() => {
    addNode('vibex' as NodeType);
  }, [addNode]);

  const handleInsertSubflow = useCallback((definition: SubflowDefinition) => {
    addNode('subflow', {
      data: {
        definitionId: definition.id,
        definitionVersion: definition.version,
        definition,
        parameterOverrides: {},
      },
    });
    logBus.success(`已插入“${definition.name}” v${definition.version}`, '子工作流');
  }, [addNode]);

  const handleUpgradeSubflowInstances = useCallback((fromDefinition: SubflowDefinition, toDefinition: SubflowDefinition) => {
    try {
      const current = { nodes: nodesRef.current, edges: edgesRef.current };
      const result = upgradeSubflowInstances(current.nodes, current.edges, fromDefinition, toDefinition);
      if (!result.upgradedNodeIds.length) {
        logBus.warn(`画布中没有固定在 v${fromDefinition.version} 的实例`, '子工作流');
        return;
      }
      const next = { nodes: result.nodes, edges: result.edges };
      histCaptureTransition(current, next);
      setNodes(next.nodes);
      setEdges(next.edges);
      logBus.success(`已升级 ${result.upgradedNodeIds.length} 个实例到 v${toDefinition.version}${result.disconnectedEdges.length ? `，断开 ${result.disconnectedEdges.length} 条不兼容连线` : ''}`, '子工作流');
    } catch (error) {
      logBus.warn(error instanceof Error ? error.message : '升级子工作流失败', '子工作流');
    }
  }, [histCaptureTransition]);

  const handleInsertProjectAsset = useCallback((asset: import('../types/project').AssetRef) => {
    if (!asset.sourceUrl) {
      logBus.warn('该资产没有可用的受管访问地址', '资产中心');
      return;
    }
    if (asset.kind === 'text') {
      addNode('text', { data: { text: String((asset.metadata as any)?.preview || asset.filename), sourceAssetId: asset.id } });
      return;
    }
    if (!['image', 'video', 'audio', 'model3d'].includes(asset.kind)) {
      logBus.warn(`暂不支持把 ${asset.kind} 资产直接加入画布`, '资产中心');
      return;
    }
    const kind = asset.kind as MediaKind;
    addNode('upload', {
      data: {
        ...createUploadDataFromItems(kind, [{
          kind,
          url: asset.sourceUrl,
          name: asset.filename,
          size: Number((asset.metadata as any)?.size || 0),
          mime: asset.mimeType,
        }]),
        sourceAssetId: asset.id,
      },
    });
    logBus.success(`已把 ${asset.filename} 添加到画布`, '资产中心');
  }, [addNode]);

  const currentPersistableCanvas = useCallback(() => {
    const persistNodes = nodesRef.current.filter((node) => node.id !== BULK_PHANTOM_ID && !(node.data as any)?.__subflowRuntime);
    const transientSubflowIds = new Set(nodesRef.current.filter((node) => (node.data as any)?.__subflowRuntime).map((node) => node.id));
    const persistEdges = edgesRef.current.filter((edge) => edge.source !== BULK_PHANTOM_ID
      && edge.target !== BULK_PHANTOM_ID
      && !transientSubflowIds.has(edge.source)
      && !transientSubflowIds.has(edge.target)
      && !(edge.data as any)?.__subflowRuntime);
    const nextNodeSerialId = nextNodeSerialIdRef.current;
    const currentCreativeDesk = creativeDeskRef.current;
    const currentFarmCanvas = farmCanvasRef.current;
    const snapshot = JSON.stringify({ nodes: persistNodes, edges: persistEdges, creativeDesk: currentCreativeDesk, farmCanvas: currentFarmCanvas, nextNodeSerialId });
    return {
      nodes: persistNodes,
      edges: persistEdges,
      creativeDesk: currentCreativeDesk,
      farmCanvas: currentFarmCanvas,
      nextNodeSerialId,
      snapshot,
      payload: { nodes: persistNodes, edges: persistEdges, viewport: getViewport(), nextNodeSerialId, creativeDesk: currentCreativeDesk, farmCanvas: currentFarmCanvas },
    };
  }, [getViewport]);

  const ensureCanvasPatchBaseline = useCallback(async (canvasId: string) => {
    if (useCanvasStore.getState().activeId !== canvasId || !loaded || loadedCanvasId !== canvasId) {
      throw new Error('画布尚未完成加载，不能生成 Patch 预览');
    }
    const blockedPending = pendingSaveByCanvasRef.current.get(canvasId);
    if (blockedPending?.conflicted) {
      const conflict = new Error('本地画布与服务端存在未解决冲突；本地修改已保留，处理冲突前不能生成 Patch。') as Error & { code: string };
      conflict.code = 'CANVAS_BASELINE_CONFLICT';
      throw conflict;
    }
    const timer = saveTimersByCanvasRef.current.get(canvasId);
    if (timer) window.clearTimeout(timer);
    saveTimersByCanvasRef.current.delete(canvasId);
    pendingSaveFlushersByCanvasRef.current.delete(canvasId);

    const current = currentPersistableCanvas();
    const mutationEpoch = graphMutationEpochRef.current;
    const previousNodeCount = lastSavedNodeCountByCanvasRef.current.get(canvasId) || 0;
    const allowEmpty = allowEmptySaveCanvasIdsRef.current.has(canvasId);
    if (!current.nodes.length && previousNodeCount > 0 && !allowEmpty) {
      throw new Error('空画布保护尚未解除，不能用 Patch 基线覆盖已有节点');
    }
    let revision = canvasRevisionsRef.current.get(canvasId) || 0;
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('画布 revision 无效，请重新打开画布');
    if (lastSavedByCanvasRef.current.get(canvasId) !== current.snapshot) {
      const baseSnapshot = lastSavedByCanvasRef.current.get(canvasId) || '';
      pendingSaveByCanvasRef.current.set(canvasId, pendingCanvasSaveFromState(current, {
        baseSnapshot,
        baseRevision: revision,
      }));
      const previousRevision = revision;
      try {
        const saved = await api.saveCanvasData(canvasId, current.payload, {
          allowEmpty,
          baseRevision: revision,
        });
        revision = Number(saved.revision);
        if (!Number.isSafeInteger(revision) || revision <= previousRevision) {
          throw new Error('保存 Patch 基线后未获得递增的有效 revision');
        }
        setCanvasRevision(canvasId, revision);
        lastSavedByCanvasRef.current.set(canvasId, current.snapshot);
        lastSavedNodeCountByCanvasRef.current.set(canvasId, current.nodes.length);
        if (pendingSaveByCanvasRef.current.get(canvasId)?.snapshot === current.snapshot) {
          pendingSaveByCanvasRef.current.delete(canvasId);
        }
        if (allowEmpty) allowEmptySaveCanvasIdsRef.current.delete(canvasId);
        api.autoSaveCanvasData(canvasId, {
          ...current.payload,
          revision,
          updatedAt: saved.updatedAt,
        }).catch((error) => console.warn('Patch 基线自动保存镜像失败', error));
        useCanvasStore.setState((state) => ({
          canvases: state.canvases.map((canvas) => canvas.id === canvasId
            ? { ...canvas, nodeCount: current.nodes.length, updatedAt: Date.now() }
            : canvas),
        }));
      } catch (error) {
        if (useCanvasStore.getState().activeId === canvasId && loadedCanvasId === canvasId) {
          const latest = currentPersistableCanvas();
          const existing = pendingSaveByCanvasRef.current.get(canvasId);
          const revisionConflict = error instanceof api.ApiRequestError && error.status === 409;
          pendingSaveByCanvasRef.current.set(canvasId, pendingCanvasSaveFromState(latest, {
            baseSnapshot: existing?.baseSnapshot || baseSnapshot,
            baseRevision: existing?.baseRevision || previousRevision,
            conflicts: revisionConflict
              ? [...(existing?.conflicts || []), { kind: 'same-field', path: 'revision' }]
              : existing?.conflicts,
            conflicted: revisionConflict || existing?.conflicted,
          }));
        }
        if (error instanceof api.ApiRequestError && error.status === 409) {
          setCanvasPatchConflictMessage('远端画布已更新；本地未保存修改已保留并阻止自动覆盖，请先处理版本冲突。');
          const conflict = new Error('远端画布已更新，本地未保存修改已保留；为避免覆盖他人修改，请先处理版本冲突后再生成 Patch。') as Error & { code: string };
          conflict.code = 'CANVAS_BASELINE_CONFLICT';
          throw conflict;
        }
        setDragSaveTick((tick) => tick + 1);
        throw error;
      }
    }

    if (useCanvasStore.getState().activeId !== canvasId || loadedCanvasId !== canvasId
      || graphMutationEpochRef.current !== mutationEpoch
      || currentPersistableCanvas().snapshot !== current.snapshot) {
      if (useCanvasStore.getState().activeId === canvasId && loadedCanvasId === canvasId) {
        pendingSaveByCanvasRef.current.set(canvasId, pendingCanvasSaveFromState(currentPersistableCanvas(), {
          baseSnapshot: current.snapshot,
          baseRevision: revision,
        }));
        setDragSaveTick((tick) => tick + 1);
      }
      const stale = new Error('保存 Patch 基线期间画布已变化，请重新预览') as Error & { code: string };
      stale.code = 'PATCH_PREVIEW_STALE';
      throw stale;
    }
    return { ...current, revision, mutationEpoch };
  }, [currentPersistableCanvas, loaded, loadedCanvasId, setCanvasRevision]);

  const commitAuthoritativeCanvasPatchDocument = useCallback((
    canvasId: string,
    inputDocument: VersionedCanvasData,
    options?: { expectedLocalSnapshot?: string; historyMode?: 'transition' | 'reset'; patchId?: string },
  ) => {
    const document = requireVersionedCanvasPatchDocument(inputDocument, canvasId);
    const isActive = useCanvasStore.getState().activeId === canvasId
      && loadedRef.current && loadedCanvasIdRef.current === canvasId;
    const activeLocal = isActive ? currentPersistableCanvas() : null;
    const pendingLocal = pendingSaveByCanvasRef.current.get(canvasId) || null;
    const local = activeLocal || pendingLocal;
    const baseline = options?.expectedLocalSnapshot
      ? parsePersistableCanvasPatchSnapshot(options.expectedLocalSnapshot)
      : null;
    const authoritativeCreativeDesk = document.creativeDesk
      ? migrateCreativeDeskToViewportCoordinates(document.creativeDesk, document.viewport)
      : local?.creativeDesk || baseline?.creativeDesk || createDefaultCreativeDeskState();
    const authoritativeFarmCanvas = document.farmCanvas
      ? sanitizeFarmCanvasState(document.farmCanvas)
      : local?.farmCanvas || baseline?.farmCanvas || createFarmState();
    const authoritativeNodeSerialId = Math.max(
      1,
      Number(document.nextNodeSerialId) || Number(baseline?.nextNodeSerialId) || Number(local?.nextNodeSerialId) || 1,
    );
    const authoritativeState: PersistableCanvasPatchState = {
      nodes: document.nodes as Node[],
      edges: document.edges as Edge[],
      creativeDesk: authoritativeCreativeDesk,
      farmCanvas: authoritativeFarmCanvas,
      nextNodeSerialId: authoritativeNodeSerialId,
      snapshot: JSON.stringify({
        nodes: document.nodes,
        edges: document.edges,
        creativeDesk: authoritativeCreativeDesk,
        farmCanvas: authoritativeFarmCanvas,
        nextNodeSerialId: authoritativeNodeSerialId,
      }),
    };
    const hasConcurrentLocalChanges = Boolean(
      options?.expectedLocalSnapshot && local
      && local.snapshot !== options.expectedLocalSnapshot
      && local.snapshot !== authoritativeState.snapshot,
    );
    const mergeResult = hasConcurrentLocalChanges && local
      ? mergeConcurrentCanvasPatchState(options!.expectedLocalSnapshot!, local, authoritativeState)
      : { state: authoritativeState, conflicts: [] as CanvasPatchMergeConflict[] };
    const renderedState = mergeResult.state;
    autosaveGenerationByCanvasRef.current.set(
      canvasId,
      (autosaveGenerationByCanvasRef.current.get(canvasId) || 0) + 1,
    );
    const timer = saveTimersByCanvasRef.current.get(canvasId);
    if (timer) window.clearTimeout(timer);
    saveTimersByCanvasRef.current.delete(canvasId);
    pendingSaveFlushersByCanvasRef.current.delete(canvasId);
    lastSavedByCanvasRef.current.set(canvasId, authoritativeState.snapshot);
    lastSavedNodeCountByCanvasRef.current.set(canvasId, authoritativeState.nodes.length);
    if (hasConcurrentLocalChanges) {
      pendingSaveByCanvasRef.current.set(canvasId, pendingCanvasSaveFromState(renderedState, {
        baseSnapshot: authoritativeState.snapshot,
        baseRevision: document.revision,
        conflicts: mergeResult.conflicts,
      }));
    } else pendingSaveByCanvasRef.current.delete(canvasId);
    setCanvasRevision(canvasId, document.revision);
    useCanvasStore.setState((state) => ({
      canvases: state.canvases.map((canvas) => canvas.id === canvasId
        ? { ...canvas, nodeCount: renderedState.nodes.length, updatedAt: document.updatedAt || Date.now() }
        : canvas),
    }));
    api.autoSaveCanvasData(canvasId, document).catch((error) => console.warn('Patch 权威快照自动保存镜像失败', error));
    if (!isActive) {
      return {
        active: false,
        concurrentLocalChanges: hasConcurrentLocalChanges,
        conflicts: mergeResult.conflicts,
        state: renderedState,
      };
    }

    const current = { nodes: nodesRef.current, edges: edgesRef.current };
    const next = { nodes: renderedState.nodes, edges: renderedState.edges };
    cancelScheduledHistoryCapture();
    nextNodeSerialIdRef.current = renderedState.nextNodeSerialId;
    if (options?.patchId) {
      const barrier = canvasPatchHistoryBarrier(next, options.patchId);
      histReset(barrier.snapshot);
    } else if (options?.historyMode === 'reset') histReset(next);
    else histCaptureTransition(current, next);
    setNodes(next.nodes);
    setEdges(next.edges);
    setCreativeDesk(renderedState.creativeDesk);
    setFarmCanvas(renderedState.farmCanvas);
    // CanvasPatch/撤回不回放服务端旧摄像机；用户当前平移和缩放保持不变。
    if (mergeResult.conflicts.length > 0) {
      const conflictMessage = `Patch 已提交；${mergeResult.conflicts.length} 处并发本地冲突已保留，并已阻止自动覆盖。请先处理冲突。`;
      setCanvasPatchConflictMessage(conflictMessage);
      logBus.warn(conflictMessage, '工作流医生');
    } else if (hasConcurrentLocalChanges) {
      setCanvasPatchConflictMessage('');
      setDragSaveTick((tick) => tick + 1);
      logBus.warn('Patch 已提交；请求期间产生的本地修改已合并，并将保存为后续 revision。', '工作流医生');
    } else setCanvasPatchConflictMessage('');
    return {
      active: true,
      concurrentLocalChanges: hasConcurrentLocalChanges,
      conflicts: mergeResult.conflicts,
      state: renderedState,
    };
  }, [cancelScheduledHistoryCapture, currentPersistableCanvas, histCaptureTransition, histReset, setCanvasRevision]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBackgroundNodePatched = (event: Event) => {
      const detail = (event as CustomEvent<{
        canvasId?: unknown;
        nodeId?: unknown;
        entityUid?: unknown;
        revision?: unknown;
        dataPatch?: unknown;
        document?: unknown;
      }>).detail;
      if (
        typeof detail?.canvasId !== 'string'
        || typeof detail.nodeId !== 'string'
        || !isCanonicalEntityUid(detail.entityUid)
        || !detail.dataPatch
        || typeof detail.dataPatch !== 'object'
        || Array.isArray(detail.dataPatch)
        || !detail.document
        || typeof detail.document !== 'object'
        || useCanvasStore.getState().activeId !== detail.canvasId
        || loadedCanvasIdRef.current !== detail.canvasId
        || !loadedRef.current
      ) return;
      const canvasId = detail.canvasId;
      const nodeId = detail.nodeId;
      const entityUid = detail.entityUid.toLowerCase();
      const localTarget = nodesRef.current.find((node) => (
        isCanonicalEntityUid((node as { entityUid?: unknown }).entityUid)
        && String((node as { entityUid?: unknown }).entityUid).toLowerCase() === entityUid
      ));
      if (!localTarget) return;
      try {
        const document = requireVersionedCanvasPatchDocument(detail.document, canvasId);
        const authoritativeTarget = (document.nodes as Array<{ entityUid?: unknown }>).find((node) => (
          isCanonicalEntityUid(node?.entityUid)
          && String(node.entityUid).toLowerCase() === entityUid
        ));
        if (!authoritativeTarget) return;
        const knownRevision = canvasRevisionsRef.current.get(canvasId) || 0;
        if (document.revision < knownRevision) return;
        const baseline = lastSavedByCanvasRef.current.get(canvasId)
          || currentPersistableCanvas().snapshot;
        const committed = commitAuthoritativeCanvasPatchDocument(canvasId, document, {
          expectedLocalSnapshot: baseline,
        });
        consumeCommittedCanvasNodePatches(canvasId, document.revision);
        if (!committed.active) return;
        if (committed.conflicts.length > 0) {
          logBus.warn(
            `后台节点 ${nodeId} 已保存到画布 r${document.revision}；${committed.conflicts.length} 处同期编辑已保留，需确认后再保存。`,
            '画布同步',
          );
        } else {
          logBus.success(`后台节点 ${nodeId} 已同步到当前画布 r${document.revision}`, '画布同步');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知同步错误');
        setBackgroundSaveFailure({
          canvasId,
          nodeId,
          message: `结果已保存，但当前画布同步失败：${message}`,
          kind: 'active-sync-failed',
        });
        logBus.error(`后台节点结果已保存，但当前画布同步失败：${message}`, '画布同步');
      }
    };
    window.addEventListener('penguin:canvas-background-node-patched', handleBackgroundNodePatched);
    return () => window.removeEventListener('penguin:canvas-background-node-patched', handleBackgroundNodePatched);
  }, [commitAuthoritativeCanvasPatchDocument, currentPersistableCanvas]);

  const fetchAuthoritativeCanvasPatchDocument = useCallback(async (canvasId: string) => {
    const document = requireVersionedCanvasPatchDocument(await api.getCanvasData(canvasId), canvasId);
    const knownRevision = canvasRevisionsRef.current.get(canvasId) || 0;
    if (document.revision < knownRevision) throw new Error('服务端返回了倒退的画布 revision');
    return document;
  }, []);

  useEffect(() => {
    if (!activeId || !loaded || loadedCanvasId !== activeId) return;
    const pendingPatches = readCommittedCanvasNodePatches(activeId);
    if (pendingPatches.length === 0) return;
    const throughRevision = Math.max(...pendingPatches.map((entry) => entry.revision));
    const matchingPatches = pendingPatches.filter((entry) => nodesRef.current.some((node) => (
      isCanonicalEntityUid((node as { entityUid?: unknown }).entityUid)
      && String((node as { entityUid?: unknown }).entityUid).toLowerCase() === entry.entityUid
    )));
    if (matchingPatches.length === 0) {
      consumeCommittedCanvasNodePatches(activeId, throughRevision);
      return;
    }
    const canvasId = activeId;
    const baseline = lastSavedByCanvasRef.current.get(canvasId)
      || currentPersistableCanvas().snapshot;
    let cancelled = false;
    void fetchAuthoritativeCanvasPatchDocument(canvasId)
      .then((document) => {
        if (
          cancelled
          || useCanvasStore.getState().activeId !== canvasId
          || loadedCanvasIdRef.current !== canvasId
          || !loadedRef.current
        ) return;
        if (document.revision < throughRevision) {
          throw new Error('后台节点结果 revision 尚未进入权威画布读取');
        }
        const committed = commitAuthoritativeCanvasPatchDocument(canvasId, document, {
          expectedLocalSnapshot: baseline,
        });
        if (!committed.active) return;
        consumeCommittedCanvasNodePatches(canvasId, document.revision);
        logBus.success(
          `已从后台结果邮箱同步 ${matchingPatches.length} 个节点到当前画布 r${document.revision}`,
          '画布同步',
        );
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || '未知同步错误');
        setBackgroundSaveFailure({
          canvasId,
          nodeId: matchingPatches.map((entry) => entry.nodeId).join('、'),
          message: `结果已保存，但当前画布同步失败：${message}`,
          kind: 'active-sync-failed',
        });
        logBus.error(`后台节点结果邮箱同步失败：${message}`, '画布同步');
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeId,
    commitAuthoritativeCanvasPatchDocument,
    currentPersistableCanvas,
    fetchAuthoritativeCanvasPatchDocument,
    loaded,
    loadedCanvasId,
  ]);

  useEffect(() => {
    const subscribe = window.t8pc?.agentControl?.onCanvasMutation;
    if (!subscribe) return undefined;
    let disposed = false;
    let queue = Promise.resolve();
    const unsubscribe = subscribe((event) => {
      if (!event
        || event.schema !== 't8-agent-control-canvas-mutation-v1'
        || event.projectId !== activeProjectId
        || event.canvasId !== activeId) return;
      queue = queue.then(async () => {
        if (disposed
          || useCanvasStore.getState().activeId !== event.canvasId
          || loadedCanvasIdRef.current !== event.canvasId) return;
        const knownRevision = canvasRevisionsRef.current.get(event.canvasId) || 0;
        if (knownRevision >= event.revision) return;
        const baseline = lastSavedByCanvasRef.current.get(event.canvasId)
          || currentPersistableCanvas().snapshot;
        try {
          const document = await fetchAuthoritativeCanvasPatchDocument(event.canvasId);
          if (disposed
            || useCanvasStore.getState().activeId !== event.canvasId
            || loadedCanvasIdRef.current !== event.canvasId) return;
          const committed = commitAuthoritativeCanvasPatchDocument(event.canvasId, document, {
            expectedLocalSnapshot: baseline,
            patchId: event.patchId,
          });
          if (committed.conflicts.length > 0) {
            logBus.warn(
              `Agent 修改已同步到 r${document.revision}；${committed.conflicts.length} 处本地并发编辑已保留，需确认后再保存。`,
              'Agent Control',
            );
          } else {
            logBus.success(
              `${event.action === 'patch.revert' ? 'Agent 撤销' : 'Agent 修改'}已同步到画布 r${document.revision}`,
              'Agent Control',
            );
          }
          if (event.warningCodes.length > 0) {
            logBus.warn('权威画布已提交，但兼容镜像需要在下次读取时修复。', 'Agent Control');
          }
        } catch (error) {
          logBus.error(
            `Agent 已提交画布 r${event.revision}，但当前界面同步失败：${error instanceof Error ? error.message : '请重新打开画布'}`,
            'Agent Control',
          );
        }
      }).catch(() => {});
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    activeId,
    activeProjectId,
    commitAuthoritativeCanvasPatchDocument,
    currentPersistableCanvas,
    fetchAuthoritativeCanvasPatchDocument,
  ]);

  const refreshCleanCanvasPatchBaseline = useCallback(async (
    canvasId: string,
    expectedSnapshot: string,
    expectedMutationEpoch: number,
  ) => {
    if (useCanvasStore.getState().activeId !== canvasId || !loaded || loadedCanvasId !== canvasId
      || lastSavedByCanvasRef.current.get(canvasId) !== expectedSnapshot
      || graphMutationEpochRef.current !== expectedMutationEpoch
      || currentPersistableCanvas().snapshot !== expectedSnapshot) {
      const conflict = new Error('本地画布含未保存修改，不能自动同步覆盖') as Error & { code: string };
      conflict.code = 'CANVAS_BASELINE_CONFLICT';
      throw conflict;
    }
    const document = await fetchAuthoritativeCanvasPatchDocument(canvasId);
    if (useCanvasStore.getState().activeId !== canvasId || loadedCanvasId !== canvasId
      || graphMutationEpochRef.current !== expectedMutationEpoch
      || currentPersistableCanvas().snapshot !== expectedSnapshot) {
      const stale = new Error('同步画布期间本地状态已变化，请重新预览') as Error & { code: string };
      stale.code = 'PATCH_PREVIEW_STALE';
      throw stale;
    }
    const committed = commitAuthoritativeCanvasPatchDocument(canvasId, document, {
      expectedLocalSnapshot: expectedSnapshot,
      historyMode: 'reset',
    });
    return { document, state: committed.state, mutationEpoch: graphMutationEpochRef.current };
  }, [commitAuthoritativeCanvasPatchDocument, currentPersistableCanvas, fetchAuthoritativeCanvasPatchDocument, loaded, loadedCanvasId]);

  const handlePreviewCanvasPatch = useCallback(async (draft: CanvasPatchDraft | CanvasPatch) => {
    const canvasId = activeId;
    const projectId = activeProjectId;
    if (!canvasId || !projectId) throw new Error('当前画布缺少项目身份');
    return enqueueCanvasMutation(canvasId, async () => {
      let baseline = await ensureCanvasPatchBaseline(canvasId);
      const isPreparedPatch = 'schema' in draft && draft.schema === 't8-canvas-patch-v1';
      let patch: CanvasPatch = isPreparedPatch
        ? draft as CanvasPatch
        : materializeCanvasPatchDraft(draft as CanvasPatchDraft, {
          projectId,
          canvasId,
          baseRevision: baseline.revision,
        });
      if (isPreparedPatch && patch.baseRevision !== baseline.revision) {
        const stale = new Error(
          `创作计划基于画布 r${patch.baseRevision}，当前已是 r${baseline.revision}，请让 Agent 重新规划`,
        ) as Error & { code: string };
        stale.code = 'CREATIVE_CANVAS_STALE';
        throw stale;
      }
      let preview: CanvasPatchPreview;
      try {
        preview = await api.previewCanvasPatch(canvasId, patch);
      } catch (error) {
        if (isPreparedPatch) throw error;
        if (!(error instanceof api.ApiRequestError) || error.status !== 409) throw error;
        const refreshed = await refreshCleanCanvasPatchBaseline(canvasId, baseline.snapshot, baseline.mutationEpoch);
        baseline = {
          ...refreshed.state,
          revision: refreshed.document.revision,
          payload: baseline.payload,
          mutationEpoch: refreshed.mutationEpoch,
        };
        patch = materializeCanvasPatchDraft(draft as CanvasPatchDraft, {
          projectId: refreshed.document.projectId,
          canvasId,
          baseRevision: refreshed.document.revision,
        });
        preview = await api.previewCanvasPatch(canvasId, patch);
      }
      if (preview.patchId !== patch.id || preview.baseRevision !== patch.baseRevision || preview.currentRevision !== patch.baseRevision) {
        throw new Error('服务端 Patch 预览身份或 revision 不一致');
      }
      if (useCanvasStore.getState().activeId === canvasId && loadedCanvasId === canvasId
        && canvasRevisionsRef.current.get(canvasId) === patch.baseRevision
        && graphMutationEpochRef.current === baseline.mutationEpoch
        && currentPersistableCanvas().snapshot === baseline.snapshot) {
        patchPreviewBaselinesRef.current.set(`${canvasId}\u001f${patch.id}\u001f${preview.previewDigest}`, {
          canvasId,
          revision: patch.baseRevision,
          snapshot: baseline.snapshot,
          mutationEpoch: baseline.mutationEpoch,
        });
      } else {
        const stale = new Error('Patch 预览期间画布已变化，请重新预览') as Error & { code: string };
        stale.code = 'PATCH_PREVIEW_STALE';
        throw stale;
      }
      return { patch, preview };
    });
  }, [activeId, activeProjectId, enqueueCanvasMutation, ensureCanvasPatchBaseline, loadedCanvasId, refreshCleanCanvasPatchBaseline]);

  const handleApplyCanvasPatch = useCallback(async (patch: CanvasPatch, preview: CanvasPatchPreview) => {
    const canvasId = activeId;
    if (!canvasId || patch.id !== preview.patchId) throw new Error('CanvasPatch 预览身份不一致');
    return enqueueCanvasMutation(canvasId, async () => {
      const previewKey = `${canvasId}\u001f${patch.id}\u001f${preview.previewDigest}`;
      const baseline = patchPreviewBaselinesRef.current.get(previewKey);
      const current = currentPersistableCanvas();
      const revision = canvasRevisionsRef.current.get(canvasId) || 0;
      if (!baseline || baseline.canvasId !== canvasId || baseline.revision !== revision
        || baseline.revision !== patch.baseRevision || baseline.snapshot !== current.snapshot
        || baseline.mutationEpoch !== graphMutationEpochRef.current) {
        const staleError = new Error('Patch 预览后画布已变化，请重新预览并确认') as Error & { code: string };
        staleError.code = 'PATCH_PREVIEW_STALE';
        throw staleError;
      }
      const result = await api.applyCanvasPatch(canvasId, patch, preview.previewDigest);
      const authoritativeDocument = result.duplicate
        ? await fetchAuthoritativeCanvasPatchDocument(canvasId)
        : result.document;
      commitAuthoritativeCanvasPatchDocument(canvasId, authoritativeDocument, {
        expectedLocalSnapshot: baseline.snapshot,
        patchId: patch.id,
      });
      for (const key of patchPreviewBaselinesRef.current.keys()) {
        if (key.startsWith(`${canvasId}\u001f`)) patchPreviewBaselinesRef.current.delete(key);
      }
      logBus.success(`${result.duplicate ? '已确认' : '已应用'}修复：${patch.summary}`, '工作流医生');
      return result;
    });
  }, [activeId, commitAuthoritativeCanvasPatchDocument, currentPersistableCanvas, enqueueCanvasMutation, fetchAuthoritativeCanvasPatchDocument]);

  useEffect(() => {
    const handleScriptMasterPatchRequest = (event: Event) => {
      const detail = (event as CustomEvent<ScriptMasterCanvasPatchRequestDetail>).detail;
      if (!detail || (detail.action !== 'preview' && detail.action !== 'apply')) return;
      if (detail.action === 'preview') {
        void handlePreviewCanvasPatch(detail.draft).then(detail.resolve).catch((error) => {
          detail.reject(error instanceof Error ? error : new Error(String(error)));
        });
        return;
      }
      void handleApplyCanvasPatch(detail.patch, detail.preview).then(detail.resolve).catch((error) => {
        detail.reject(error instanceof Error ? error : new Error(String(error)));
      });
    };
    window.addEventListener(SCRIPT_MASTER_CANVAS_PATCH_REQUEST_EVENT, handleScriptMasterPatchRequest);
    return () => window.removeEventListener(SCRIPT_MASTER_CANVAS_PATCH_REQUEST_EVENT, handleScriptMasterPatchRequest);
  }, [handleApplyCanvasPatch, handlePreviewCanvasPatch]);

  const handleRevertCanvasPatch = useCallback(async (patchId: string, _baseRevision: number) => {
    const canvasId = activeId;
    if (!canvasId) throw new Error('当前没有可撤回 Patch 的画布');
    return enqueueCanvasMutation(canvasId, async () => {
      let baseline = await ensureCanvasPatchBaseline(canvasId);
      let result: Awaited<ReturnType<typeof api.revertCanvasPatch>>;
      try {
        result = await api.revertCanvasPatch(canvasId, patchId, baseline.revision);
      } catch (error) {
        const code = error instanceof api.ApiRequestError && error.data && typeof error.data === 'object'
          ? String((error.data as { code?: unknown }).code || '')
          : '';
        if (!(error instanceof api.ApiRequestError) || error.status !== 409 || code !== 'revision_conflict') throw error;
        const refreshed = await refreshCleanCanvasPatchBaseline(canvasId, baseline.snapshot, baseline.mutationEpoch);
        baseline = {
          ...refreshed.state,
          revision: refreshed.document.revision,
          payload: baseline.payload,
          mutationEpoch: refreshed.mutationEpoch,
        };
        result = await api.revertCanvasPatch(canvasId, patchId, refreshed.document.revision);
      }
      const authoritativeDocument = result.duplicate
        ? await fetchAuthoritativeCanvasPatchDocument(canvasId)
        : result.document;
      commitAuthoritativeCanvasPatchDocument(canvasId, authoritativeDocument, {
        expectedLocalSnapshot: baseline.snapshot,
        patchId,
      });
      for (const key of patchPreviewBaselinesRef.current.keys()) {
        if (key.startsWith(`${canvasId}\u001f`)) patchPreviewBaselinesRef.current.delete(key);
      }
      logBus.success(`已撤回我的 Patch：${patchId}`, '工作流医生');
      return result;
    });
  }, [activeId, commitAuthoritativeCanvasPatchDocument, enqueueCanvasMutation, ensureCanvasPatchBaseline, fetchAuthoritativeCanvasPatchDocument, refreshCleanCanvasPatchBaseline]);

  const handleResolveCanvasPatchConflict = useCallback(async (resolution: 'keep-local' | 'use-authoritative') => {
    const canvasId = activeId;
    if (!canvasId) throw new Error('当前没有可处理冲突的画布');
    await enqueueCanvasMutation(canvasId, async () => {
      const pending = pendingSaveByCanvasRef.current.get(canvasId);
      if (!pending?.conflicted) {
        setCanvasPatchConflictMessage('');
        return;
      }
      if (useCanvasStore.getState().activeId !== canvasId
        || !loadedRef.current || loadedCanvasIdRef.current !== canvasId) {
        throw new Error('画布作用域已变化，请回到原画布后重试');
      }
      const localAtConfirmation = currentPersistableCanvas();
      const authoritativeDocument = await fetchAuthoritativeCanvasPatchDocument(canvasId);
      if (resolution === 'keep-local') {
        const authoritativeCreativeDesk = authoritativeDocument.creativeDesk
          ? migrateCreativeDeskToViewportCoordinates(authoritativeDocument.creativeDesk, authoritativeDocument.viewport)
          : pending.creativeDesk;
        const authoritativeFarmCanvas = authoritativeDocument.farmCanvas
          ? sanitizeFarmCanvasState(authoritativeDocument.farmCanvas)
          : pending.farmCanvas;
        const authoritativeNextNodeSerialId = Math.max(
          1,
          Number(authoritativeDocument.nextNodeSerialId) || pending.nextNodeSerialId,
        );
        const authoritativeState: PersistableCanvasPatchState = {
          nodes: authoritativeDocument.nodes as Node[],
          edges: authoritativeDocument.edges as Edge[],
          creativeDesk: authoritativeCreativeDesk,
          farmCanvas: authoritativeFarmCanvas,
          nextNodeSerialId: authoritativeNextNodeSerialId,
          snapshot: JSON.stringify({
            nodes: authoritativeDocument.nodes,
            edges: authoritativeDocument.edges,
            creativeDesk: authoritativeCreativeDesk,
            farmCanvas: authoritativeFarmCanvas,
            nextNodeSerialId: authoritativeNextNodeSerialId,
          }),
        };
        // The user explicitly selected local-wins for existing conflicts. Remote
        // disjoint changes are still merged, and graph repair prevents dangling edges.
        const resolved = mergeConcurrentCanvasPatchState(
          pending.baseSnapshot,
          localAtConfirmation,
          authoritativeState,
        ).state;
        const previousNodeCount = lastSavedNodeCountByCanvasRef.current.get(canvasId) || 0;
        const allowEmpty = allowEmptySaveCanvasIdsRef.current.has(canvasId);
        if (!resolved.nodes.length && previousNodeCount > 0 && !allowEmpty) {
          throw new Error('空画布保护尚未解除，不能用本地冲突版本覆盖已有节点');
        }
        const saved = await api.saveCanvasData(canvasId, {
          nodes: resolved.nodes,
          edges: resolved.edges,
          viewport: getViewport(),
          nextNodeSerialId: resolved.nextNodeSerialId,
          creativeDesk: resolved.creativeDesk,
          farmCanvas: resolved.farmCanvas,
        }, {
          allowEmpty,
          baseRevision: authoritativeDocument.revision,
        });
        const savedRevision = Number(saved.revision);
        if (!Number.isSafeInteger(savedRevision) || savedRevision <= authoritativeDocument.revision) {
          throw new Error('冲突合并保存后未获得递增的有效 revision');
        }
        setCanvasRevision(canvasId, savedRevision);
        if (allowEmpty) allowEmptySaveCanvasIdsRef.current.delete(canvasId);
        const savedDocument = await fetchAuthoritativeCanvasPatchDocument(canvasId);
        commitAuthoritativeCanvasPatchDocument(canvasId, savedDocument, {
          expectedLocalSnapshot: localAtConfirmation.snapshot,
          historyMode: 'reset',
        });
        logBus.success('本地修改已与最新服务端版本合并，并保存为新的 revision。', '画布同步');
        return;
      }

      commitAuthoritativeCanvasPatchDocument(canvasId, authoritativeDocument, {
        expectedLocalSnapshot: localAtConfirmation.snapshot,
        historyMode: 'reset',
      });
      logBus.success('已显式采用最新服务端版本；点击确认后的新增本地编辑仍会保留。', '画布同步');
    });
  }, [activeId, commitAuthoritativeCanvasPatchDocument, currentPersistableCanvas, enqueueCanvasMutation, fetchAuthoritativeCanvasPatchDocument, getViewport, setCanvasRevision]);

  const handleOpenNestedSubflow = useCallback(async (node: Node) => {
    if (node.type !== 'subflow') return;
    const data = (node.data || {}) as Record<string, unknown>;
    const definitionId = String(data.definitionId || (data.definition as SubflowDefinition | undefined)?.id || '').trim();
    const version = Math.max(1, Number(data.definitionVersion || (data.definition as SubflowDefinition | undefined)?.version) || 1);
    if (!definitionId) {
      logBus.warn('嵌套子工作流缺少固定定义 ID', '子工作流');
      return;
    }
    try {
      const embedded = data.definition as SubflowDefinition | undefined;
      const definition = embedded && embedded.id === definitionId && Number(embedded.version) === version
        ? embedded
        : await api.getSubflow(definitionId, version, String(data.definitionProjectId || activeId || '') || undefined);
      setSubflowInspector((current) => current ? {
        ...current,
        stack: [...current.stack, definition],
        pathNodeIds: [...current.pathNodeIds, node.id],
        error: undefined,
      } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开嵌套子工作流';
      setSubflowInspector((current) => current ? { ...current, error: message } : current);
      logBus.warn(message, '子工作流');
    }
  }, [activeId]);

  const handleStartSubflowRevisionEdit = useCallback(() => {
    setSubflowInspector((current) => {
      if (!current || current.edit) return current;
      const depth = current.stack.length - 1;
      return {
        ...current,
        error: undefined,
        edit: {
          depth,
          baseRevision: Math.max(1, Number(current.stack[depth].revision || current.stack[depth].version) || 1),
          changeSummary: '',
          ...createSubflowDraftHistory(current.stack[depth]),
          selectedNodeId: null,
          nodeDataText: '',
          nodeDataError: '',
          saving: false,
        },
      };
    });
  }, []);

  const handleCancelSubflowRevisionEdit = useCallback(() => {
    setSubflowInspector((current) => current?.edit?.saving ? current : current ? { ...current, edit: undefined } : current);
  }, []);

  const handleSubflowRevisionNodesChange = useCallback((changes: NodeChange[]) => {
    setSubflowInspector((current) => {
      if (!current?.edit) return current;
      const nodes = applyNodeChanges(changes, current.edit.draft.nodes);
      const retainedIds = new Set(nodes.map((node) => node.id));
      const selectedNodeId = current.edit.selectedNodeId && retainedIds.has(current.edit.selectedNodeId)
        ? current.edit.selectedNodeId
        : null;
      const nextDraft = {
        ...current.edit.draft,
        nodes,
        edges: current.edit.draft.edges.filter((edge) => retainedIds.has(edge.source) && retainedIds.has(edge.target)),
      };
      const recordsStructuralChange = changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace');
      const history = recordsStructuralChange
        ? commitSubflowDraftHistory(current.edit, nextDraft)
        : { draft: nextDraft, undoStack: current.edit.undoStack, redoStack: current.edit.redoStack };
      return {
        ...current,
        edit: {
          ...current.edit,
          ...history,
          selectedNodeId,
          nodeDataText: selectedNodeId ? current.edit.nodeDataText : '',
          nodeDataError: selectedNodeId ? current.edit.nodeDataError : '',
        },
      };
    });
  }, []);

  const handleSubflowRevisionEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSubflowInspector((current) => {
      if (!current?.edit) return current;
      const nextDraft = {
        ...current.edit.draft,
        edges: applyEdgeChanges(changes, current.edit.draft.edges),
      };
      const recordsStructuralChange = changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace');
      const history = recordsStructuralChange
        ? commitSubflowDraftHistory(current.edit, nextDraft)
        : { draft: nextDraft, undoStack: current.edit.undoStack, redoStack: current.edit.redoStack };
      return { ...current, edit: { ...current.edit, ...history } };
    });
  }, []);

  const handleConnectSubflowRevision = useCallback((connection: Connection) => {
    setSubflowInspector((current) => {
      if (!current?.edit || !connection.source || !connection.target) return current;
      const edge: Edge = {
        id: `subflow-edge-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle === SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE ? null : connection.sourceHandle,
        targetHandle: connection.targetHandle === SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE ? null : connection.targetHandle,
      };
      const nextDraft = {
        ...current.edit.draft,
        edges: addEdge(edge, current.edit.draft.edges),
      };
      return {
        ...current,
        edit: {
          ...current.edit,
          ...commitSubflowDraftHistory(current.edit, nextDraft),
        },
      };
    });
  }, []);

  const handleSelectSubflowRevisionNode = useCallback((nodeId: string) => {
    setSubflowInspector((current) => {
      if (!current?.edit) return current;
      const selected = current.edit.draft.nodes.find((node) => node.id === nodeId);
      if (!selected) return current;
      return {
        ...current,
        edit: {
          ...current.edit,
          selectedNodeId: nodeId,
          nodeDataText: JSON.stringify(selected.data || {}, null, 2),
          nodeDataError: '',
          draft: {
            ...current.edit.draft,
            nodes: current.edit.draft.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
            edges: current.edit.draft.edges.map((edge) => ({ ...edge, selected: false })),
          },
        },
      };
    });
  }, []);

  const handleSelectSubflowRevisionEdge = useCallback((edgeId: string) => {
    setSubflowInspector((current) => current?.edit ? {
      ...current,
      edit: {
        ...current.edit,
        selectedNodeId: null,
        nodeDataText: '',
        nodeDataError: '',
        draft: {
          ...current.edit.draft,
          nodes: current.edit.draft.nodes.map((node) => ({ ...node, selected: false })),
          edges: current.edit.draft.edges.map((edge) => ({ ...edge, selected: edge.id === edgeId })),
        },
      },
    } : current);
  }, []);

  const handleClearSubflowRevisionSelection = useCallback(() => {
    setSubflowInspector((current) => current?.edit ? {
      ...current,
      edit: {
        ...current.edit,
        selectedNodeId: null,
        nodeDataText: '',
        nodeDataError: '',
        draft: {
          ...current.edit.draft,
          nodes: current.edit.draft.nodes.map((node) => ({ ...node, selected: false })),
          edges: current.edit.draft.edges.map((edge) => ({ ...edge, selected: false })),
        },
      },
    } : current);
  }, []);

  const handleSubflowRevisionNodeDragStart = useCallback(() => {
    setSubflowInspector((current) => {
      if (current?.edit && !current.edit.saving) {
        subflowEditDragStartRef.current = cloneSubflowDefinition(current.edit.draft);
      }
      return current;
    });
  }, []);

  const handleSubflowRevisionNodeDragStop = useCallback(() => {
    const dragStart = subflowEditDragStartRef.current;
    subflowEditDragStartRef.current = null;
    if (!dragStart) return;
    setSubflowInspector((current) => {
      if (!current?.edit || current.edit.saving) return current;
      const history = commitSubflowDraftHistory(
        { draft: dragStart, undoStack: current.edit.undoStack, redoStack: current.edit.redoStack },
        current.edit.draft,
      );
      return { ...current, edit: { ...current.edit, ...history } };
    });
  }, []);

  const handleUndoSubflowRevision = useCallback(() => {
    setSubflowInspector((current) => {
      if (!current?.edit || current.edit.saving || current.edit.undoStack.length === 0) return current;
      const history = undoSubflowDraftHistory(current.edit);
      return {
        ...current,
        edit: {
          ...current.edit,
          ...history,
          selectedNodeId: null,
          nodeDataText: '',
          nodeDataError: '',
        },
      };
    });
  }, []);

  const handleRedoSubflowRevision = useCallback(() => {
    setSubflowInspector((current) => {
      if (!current?.edit || current.edit.saving || current.edit.redoStack.length === 0) return current;
      const history = redoSubflowDraftHistory(current.edit);
      return {
        ...current,
        edit: {
          ...current.edit,
          ...history,
          selectedNodeId: null,
          nodeDataText: '',
          nodeDataError: '',
        },
      };
    });
  }, []);

  const handleUpdateSubflowRevisionNodeData = useCallback((text: string) => {
    setSubflowInspector((current) => {
      if (!current?.edit?.selectedNodeId) return current;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('节点配置必须是 JSON 对象');
        const nextDraft = {
          ...current.edit.draft,
          nodes: current.edit.draft.nodes.map((node) => node.id === current.edit?.selectedNodeId ? { ...node, data: parsed } : node),
        };
        return {
          ...current,
          edit: {
            ...current.edit,
            ...commitSubflowDraftHistory(current.edit, nextDraft),
            nodeDataText: text,
            nodeDataError: '',
          },
        };
      } catch (error) {
        return {
          ...current,
          edit: {
            ...current.edit,
            nodeDataText: text,
            nodeDataError: error instanceof Error ? error.message : 'JSON 格式无效',
          },
        };
      }
    });
  }, []);

  const handleUpdateSubflowRevisionMetadata = useCallback((field: 'name' | 'description', value: string) => {
    setSubflowInspector((current) => {
      if (!current?.edit) return current;
      const nextDraft = { ...current.edit.draft, [field]: value };
      return { ...current, edit: { ...current.edit, ...commitSubflowDraftHistory(current.edit, nextDraft) } };
    });
  }, []);

  const handleUpdateSubflowRevisionChangeSummary = useCallback((value: string) => {
    setSubflowInspector((current) => current?.edit ? {
      ...current,
      edit: { ...current.edit, changeSummary: value },
    } : current);
  }, []);

  const handleLoadLatestSubflowRevision = useCallback(() => {
    setSubflowInspector((current) => {
      const conflict = current?.edit?.conflict;
      if (!current?.edit || !conflict?.definition) return current;
      const stack = [...current.stack];
      stack[current.edit.depth] = conflict.definition;
      return {
        ...current,
        stack,
        error: undefined,
        edit: {
          depth: current.edit.depth,
          baseRevision: conflict.revision,
          changeSummary: '',
          ...createSubflowDraftHistory(conflict.definition),
          selectedNodeId: null,
          nodeDataText: '',
          nodeDataError: '',
          saving: false,
        },
      };
    });
  }, []);

  const handleDeleteSubflowRevisionSelection = useCallback(() => {
    setSubflowInspector((current) => {
      if (!current?.edit) return current;
      const removedNodeIds = new Set(current.edit.draft.nodes.filter((node) => node.selected).map((node) => node.id));
      const removedEdgeIds = new Set(current.edit.draft.edges.filter((edge) => edge.selected).map((edge) => edge.id));
      if (removedNodeIds.size === 0 && removedEdgeIds.size === 0) return current;
      const nextDraft = {
        ...current.edit.draft,
        nodes: current.edit.draft.nodes.filter((node) => !removedNodeIds.has(node.id)),
        edges: current.edit.draft.edges.filter((edge) => !removedEdgeIds.has(edge.id) && !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)),
      };
      return {
        ...current,
        edit: {
          ...current.edit,
          ...commitSubflowDraftHistory(current.edit, nextDraft),
          selectedNodeId: null,
          nodeDataText: '',
          nodeDataError: '',
        },
      };
    });
  }, []);

  const handlePublishSubflowRevision = useCallback(async () => {
    const edit = subflowInspector?.edit;
    if (!edit || edit.saving) return;
    if (!edit.draft.name.trim()) {
      logBus.warn('子工作流名称不能为空', '子工作流');
      return;
    }
    if (edit.nodeDataError) {
      logBus.warn('请先修正节点配置 JSON', '子工作流');
      return;
    }
    if (!edit.changeSummary.trim()) {
      logBus.warn('发布新版本必须填写变更说明', '子工作流');
      return;
    }
    setSubflowInspector((current) => current?.edit ? { ...current, edit: { ...current.edit, saving: true } } : current);
    try {
      const dependencies = new Map<string, NonNullable<SubflowDefinition['dependencies']>[number]>();
      for (const node of edit.draft.nodes) {
        if (node.type !== 'subflow') continue;
        const data = (node.data || {}) as Record<string, unknown>;
        const embedded = data.definition as SubflowDefinition | undefined;
        const definitionId = String(data.definitionId || embedded?.id || '').trim();
        const version = Math.max(0, Math.trunc(Number(data.definitionVersion || embedded?.version || 0)));
        const projectId = String(data.definitionProjectId || embedded?.projectId || edit.draft.projectId || '').trim() || undefined;
        if (!definitionId || version < 1) throw new Error(`嵌套节点 ${node.id} 缺少固定定义或版本`);
        dependencies.set(`${projectId || ''}:${definitionId}:${version}`, { definitionId, version, projectId });
      }
      const cleanDraft: SubflowDefinition = {
        ...edit.draft,
        name: edit.draft.name.trim(),
        description: edit.draft.description.trim(),
        nodes: edit.draft.nodes.map(({ selected: _selected, ...node }) => node),
        edges: edit.draft.edges.map(({ selected: _selected, ...edge }) => edge),
        dependencies: [...dependencies.values()],
      };
      const { version: _version, revision: _revision, changeSummary: _changeSummary, publishedBy: _publishedBy, publishedAt: _publishedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...publishable } = cleanDraft;
      const saved = await api.saveSubflow({
        ...publishable,
        baseRevision: edit.baseRevision,
        changeSummary: edit.changeSummary.trim(),
      });
      setSubflowInspector(null);
      logBus.success(`已发布“${saved.name}” v${saved.version} / revision ${saved.revision}；现有实例仍固定旧版本，可在子工作流库预览差异后升级`, '子工作流');
    } catch (error) {
      const message = error instanceof Error ? error.message : '发布子工作流新版本失败';
      const conflictData = error instanceof api.ApiRequestError && error.status === 409
        ? (error.data as { data?: { revision?: unknown; latestVersion?: unknown; definition?: unknown } } | null)?.data
        : null;
      const conflict = conflictData?.definition && typeof conflictData.definition === 'object'
        ? {
            revision: Math.max(1, Number(conflictData.revision) || 1),
            latestVersion: Math.max(1, Number(conflictData.latestVersion) || 1),
            definition: conflictData.definition as SubflowDefinition,
          }
        : undefined;
      setSubflowInspector((current) => current?.edit ? {
        ...current,
        error: message,
        edit: { ...current.edit, saving: false, conflict },
      } : current);
      logBus.warn(message, '子工作流');
    }
  }, [subflowInspector]);

  const handleReturnSubflowInspectorLevel = useCallback(() => {
    setSubflowInspector((current) => {
      if (!current || current.edit || current.stack.length <= 1) return current;
      return {
        ...current,
        stack: current.stack.slice(0, -1),
        pathNodeIds: current.pathNodeIds.slice(0, -1),
      };
    });
  }, []);

  const handleDetachSubflow = useCallback(async () => {
    if (!subflowInspector || subflowInspector.edit || subflowInspector.detaching || subflowInspector.stack.length !== 1) return;
    const inspectorSnapshot = subflowInspector;
    const inspectedDefinition = inspectorSnapshot.stack[0];
    setSubflowInspector((current) => current?.instanceNodeId === inspectorSnapshot.instanceNodeId
      ? { ...current, detaching: true, error: undefined }
      : current);
    try {
      const startingInstance = nodesRef.current.find((node) => node.id === inspectorSnapshot.instanceNodeId && node.type === 'subflow');
      const startingData = (startingInstance?.data || {}) as Record<string, unknown>;
      const embeddedDefinition = startingData.definition as SubflowDefinition | undefined;
      if (!embeddedDefinition) throw new Error('子工作流定义缺失，无法脱离');
      const rootProjectId = String(startingData.definitionProjectId || embeddedDefinition.projectId || inspectedDefinition.projectId || '').trim() || undefined;
      const rootDefinition = embeddedDefinition.projectId || !rootProjectId
        ? embeddedDefinition
        : { ...embeddedDefinition, projectId: rootProjectId };
      const inspectedKey = subflowDependencyMapKey({
        definitionId: inspectedDefinition.id,
        version: inspectedDefinition.version,
        projectId: inspectedDefinition.projectId || rootProjectId,
      });
      const rootKey = subflowDependencyMapKey({ definitionId: rootDefinition.id, version: rootDefinition.version, projectId: rootDefinition.projectId });
      if (rootKey !== inspectedKey) throw new Error('当前查看内容与主画布固定版本不一致，请重新打开后再脱离');
      const dependencyDefinitions = await loadSubflowDependencyDefinitions(
        rootDefinition,
        (reference) => api.getSubflow(reference.definitionId, reference.version, reference.projectId),
      );
      const current = { nodes: nodesRef.current, edges: edgesRef.current };
      const liveInstance = current.nodes.find((node) => node.id === inspectorSnapshot.instanceNodeId && node.type === 'subflow');
      const liveData = (liveInstance?.data || {}) as Record<string, unknown>;
      const liveDefinition = liveData.definition as SubflowDefinition | undefined;
      if (!liveDefinition) throw new Error('子工作流定义缺失，无法脱离');
      const liveKey = subflowDependencyMapKey({
        definitionId: String(liveData.definitionId || liveDefinition.id),
        version: Number(liveData.definitionVersion || liveDefinition.version),
        projectId: String(liveData.definitionProjectId || liveDefinition.projectId || rootDefinition.projectId || '').trim() || undefined,
      });
      if (liveKey !== rootKey) throw new Error('加载依赖期间子工作流固定版本已变化，请重新打开后再脱离');
      const result = detachSubflowInstance(current.nodes, current.edges, inspectorSnapshot.instanceNodeId, {
        resolveDefinition: (reference) => dependencyDefinitions.get(subflowDependencyMapKey(reference))
          || (!reference.projectId && rootDefinition.projectId
            ? dependencyDefinitions.get(subflowDependencyMapKey({ ...reference, projectId: rootDefinition.projectId }))
            : undefined),
      });
      const detachedIds = new Set(result.detachedNodeIds);
      const retained = result.nodes.filter((node) => !detachedIds.has(node.id));
      const detached = assignActiveNodeSerials(result.nodes.filter((node) => detachedIds.has(node.id)), retained);
      const next = { nodes: [...retained, ...detached], edges: result.edges };
      histCaptureTransition(current, next);
      setNodes(next.nodes);
      setEdges(next.edges);
      setSubflowInspector(null);
      logBus.success(`已脱离定义并展开 ${detached.length} 个节点，可使用撤销恢复`, '子工作流');
    } catch (error) {
      const message = error instanceof Error ? error.message : '脱离子工作流失败';
      setSubflowInspector((current) => current?.instanceNodeId === inspectorSnapshot.instanceNodeId
        ? { ...current, detaching: false, error: message }
        : current);
      logBus.warn(message, '子工作流');
    }
  }, [assignActiveNodeSerials, histCaptureTransition, subflowInspector]);

  const handleCreateImageFromSelection = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const summaryNodes = nodesRef.current.map((node) => ({ ...node, selected: idSet.has(node.id) }));
    const summary = collectCanvasSelectionSummary(summaryNodes, { canvasId: activeId || undefined });
    const prompt = summary.texts.map((item) => item.text).join('\n\n').trim();
    const referenceImages = summary.images.map((item) => item.url);
    if (!prompt && referenceImages.length === 0) {
      logBus.warn('选区里没有可用于生成的提示词或图片', '选区生成');
      return;
    }
    const newNode: Node = {
      id: `image-selection-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'image',
      position: placeSingleNode(
        summary.defaultResultPosition.x,
        summary.defaultResultPosition.y,
        'image',
        nodesRef.current,
        { source: 'placement:selection-ai' },
      ),
      selected: true,
      data: {
        ...(INITIAL_DATA.image || {}),
        prompt,
        referenceImages,
        creativeSourceNodeIds: summary.selectedNodeIds,
        creativeSelectionBounds: summary.bounds,
      },
    };
    const assigned = assignActiveNodeSerials([newNode], nodesRef.current);
    setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...assigned]);
    registerPlacementShelfNodes(assigned, '生成');
    logBus.success('已在选区右侧创建图像生成节点', '选区生成');
  }, [activeId, assignActiveNodeSerials, registerPlacementShelfNodes]);

  const prepareSubflowFromSelection = useCallback((ids: string[]) => {
    const selectedIds = [...new Set(ids)].filter((id) => id && id !== BULK_PHANTOM_ID);
    const selected = nodesRef.current.filter((node) => selectedIds.includes(node.id) && node.type !== 'groupBox');
    if (selected.length === 0) {
      logBus.warn('请选择至少一个普通节点；组框本身不会封装进子工作流', '子工作流');
      return;
    }
    try {
      const analysis = analyzeSubflowBoundary(selected, edgesRef.current, {
        name: `子工作流 ${selected.length} 节点`,
      });
      setSubflowDraft({
        analysis,
        selectedIds: selected.map((node) => node.id),
        name: analysis.definition.name,
        description: '',
        saving: false,
      });
    } catch (error) {
      logBus.warn(error instanceof Error ? error.message : '无法分析所选节点', '子工作流');
    }
  }, []);

  const commitSubflowDraft = useCallback(async () => {
    const draft = subflowDraft;
    if (!draft || draft.saving) return;
    const name = draft.name.trim();
    if (!name) {
      logBus.warn('请输入子工作流名称', '子工作流');
      return;
    }
    const selectedSet = new Set(draft.selectedIds);
    if (draft.selectedIds.some((nodeId) => !nodesRef.current.some((node) => node.id === nodeId))) {
      logBus.warn('选区在封装期间已发生变化，请关闭后重新选择', '子工作流');
      return;
    }
    setSubflowDraft((current) => current ? { ...current, saving: true } : current);
    try {
      const id = `subflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const saved = await api.saveSubflow({
        ...draft.analysis.definition,
        id,
        projectId: activeId || undefined,
        name,
        description: draft.description.trim(),
        baseRevision: 0,
        changeSummary: '封装画布选区创建子工作流',
      });
      const instanceId = `subflow-instance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const instance: Node = {
        id: instanceId,
        type: 'subflow',
        position: { x: draft.analysis.bounds.x, y: draft.analysis.bounds.y },
        selected: true,
        data: {
          definitionId: saved.id,
          definitionVersion: saved.version,
          definition: saved,
          parameterOverrides: {},
        },
      };
      const inputPortByEdge = new Map(saved.inputs.map((port) => [port.boundaryEdgeId, port]));
      const outputPortByEdge = new Map(saved.outputs.map((port) => [port.boundaryEdgeId, port]));
      const remappedIncoming = draft.analysis.incomingEdges.flatMap((edge) => {
        const port = inputPortByEdge.get(edge.id);
        if (!port) return [];
        return [{
          ...edge,
          id: `${edge.id}::${instanceId}`,
          target: instanceId,
          targetHandle: port.id,
        }];
      });
      const remappedOutgoing = draft.analysis.outgoingEdges.flatMap((edge) => {
        const port = outputPortByEdge.get(edge.id);
        if (!port) return [];
        return [{
          ...edge,
          id: `${edge.id}::${instanceId}`,
          source: instanceId,
          sourceHandle: port.id,
        }];
      });
      const current = { nodes: nodesRef.current, edges: edgesRef.current };
      if (draft.selectedIds.some((nodeId) => !current.nodes.some((node) => node.id === nodeId))) {
        throw new Error(`“${saved.name}” v${saved.version} 已保存到本地库，但画布选区已变化，未替换当前节点`);
      }
      const retainedNodes = current.nodes.filter((node) => !selectedSet.has(node.id));
      const assigned = assignActiveNodeSerials([instance], retainedNodes);
      const next = {
        nodes: [
          ...retainedNodes.map((node) => ({ ...node, selected: false })),
          ...assigned,
        ],
        edges: [
          ...current.edges.filter((edge) => !selectedSet.has(edge.source) && !selectedSet.has(edge.target)),
          ...remappedIncoming,
          ...remappedOutgoing,
        ],
      };
      histCaptureTransition(current, next);
      setNodes(next.nodes);
      setEdges(next.edges);
      setSubflowDraft(null);
      logBus.success(`已封装“${saved.name}” v${saved.version}，外部连线已重接`, '子工作流');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存子工作流失败';
      setSubflowDraft((current) => current ? { ...current, saving: false } : current);
      logBus.warn(message, '子工作流');
    }
  }, [activeId, assignActiveNodeSerials, histCaptureTransition, subflowDraft]);

  const updateSubflowDraftPort = useCallback((direction: 'inputs' | 'outputs', portId: string, patch: Record<string, unknown>) => {
    setSubflowDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        analysis: {
          ...current.analysis,
          definition: {
            ...current.analysis.definition,
            [direction]: current.analysis.definition[direction].map((port) => port.id === portId ? { ...port, ...patch } : port),
          },
        },
      };
    });
  }, []);

  const toggleSubflowDraftParameter = useCallback((parameter: SubflowParameter, enabled: boolean) => {
    setSubflowDraft((current) => {
      if (!current) return current;
      const existing = current.analysis.definition.exposedParameters || [];
      return {
        ...current,
        analysis: {
          ...current.analysis,
          definition: {
            ...current.analysis.definition,
            exposedParameters: enabled
              ? [...existing.filter((item) => item.id !== parameter.id), parameter]
              : existing.filter((item) => item.id !== parameter.id),
          },
        },
      };
    });
  }, []);

  const updateSubflowDraftParameter = useCallback((parameterId: string, patch: Partial<SubflowParameter>) => {
    setSubflowDraft((current) => current ? {
      ...current,
      analysis: {
        ...current.analysis,
        definition: {
          ...current.analysis.definition,
          exposedParameters: (current.analysis.definition.exposedParameters || []).map((parameter) => parameter.id === parameterId ? { ...parameter, ...patch } : parameter),
        },
      },
    } : current);
  }, []);

  const importWebImagePayload = useCallback((input: unknown, sourceLabel = '网页图片反推') => {
      const data = input && typeof input === 'object' ? input as Record<string, any> : {};
      const payload = (data.payload || data || {}) as WebImageExtensionPayload;
      const messageId = cleanWebImageText(payload.messageId || data.messageId, 160);
      if (messageId) {
        if (webImageImportMessageIdsRef.current.has(messageId)) return false;
        webImageImportMessageIdsRef.current.add(messageId);
        if (webImageImportMessageIdsRef.current.size > 80) {
          webImageImportMessageIdsRef.current = new Set([...webImageImportMessageIdsRef.current].slice(-40));
        }
      }
      const specs = buildWebImageSendNodeSpecs(payload);
      if (specs.length === 0) {
        logBus.warn(`${sourceLabel} 没有可发送的提示词或生成图片`, '网页反推');
        return false;
      }

      const incomingMode = normalizeWebImageSendMode(payload.mode);
      const selectedTarget = incomingMode === 'reference'
        ? undefined
        : nodesRef.current.find((node) => node.selected && node.type === CREATIVE_TARGET_NODE_TYPE);
      if (selectedTarget) {
        const mode = incomingMode;
        const prompt = cleanWebImageText(payload.prompt);
        const imageItems = webImagePayloadImages(payload);
        if ((mode === 'image' || mode === 'both') && imageItems.length > 0) {
          const built = buildCreativeTargetResult(
            selectedTarget,
            imageItems.map((item) => item.url),
            {
              mode: 'replace',
              sourceNodeIds: [],
              prompt,
            },
          );
          setNodes(nodesRef.current.map((node) =>
            node.id === selectedTarget.id
              ? { ...node, data: { ...(node.data as any), ...built.targetPatch }, selected: true }
              : { ...node, selected: false },
          ));
          logBus.success(`${sourceLabel}结果已填入选中的生成目标框`, '网页反推');
          return true;
        }
        if (prompt) {
          setNodes(nodesRef.current.map((node) =>
            node.id === selectedTarget.id
              ? { ...node, data: { ...(node.data as any), prompt, status: 'idle', error: '' }, selected: true }
              : { ...node, selected: false },
          ));
          logBus.success(`${sourceLabel}提示词已写入选中的生成目标框`, '网页反推');
          return true;
        }
      }

      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = flowEl?.getBoundingClientRect();
      const base = screenToFlowPosition(
        rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
      const stamp = `${cleanWebImageText(payload.pageUrl, 120)}|${cleanWebImageText(payload.sourceImageUrl, 120)}|${Date.now()}`;
      const newNodes = materialNodesFromSpecs(specs, nodesRef.current, base, {
        signature: `web-image-reverse:${stamp}`,
        mode: 'output',
        sourceCanvasId: activeId,
        sourceNodeIds: [],
      });
      const assignedNewNodes = assignActiveNodeSerials(newNodes, nodesRef.current);
      const focusCenter = centerOfMaterialNodes(assignedNewNodes);
      if (activeId && focusCenter) {
        const { zoom } = getViewport();
        pendingSendFocusRef.current = {
          canvasId: activeId,
          center: focusCenter,
          zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
        };
      }
      setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...assignedNewNodes]);
      registerPlacementShelfNodes(assignedNewNodes, '发送');
      logBus.success(`已从${sourceLabel}发送 ${assignedNewNodes.length} 个节点到当前画布`, '网页反推');
      return true;
  }, [activeId, assignActiveNodeSerials, getViewport, registerPlacementShelfNodes, screenToFlowPosition]);

  useEffect(() => {
    const handleWebImageMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data || {};
      if (
        data.type !== WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT.type ||
        data.source !== WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT.source
      ) return;
      importWebImagePayload(data);
    };

    window.addEventListener('message', handleWebImageMessage);
    return () => window.removeEventListener('message', handleWebImageMessage);
  }, [importWebImagePayload]);

  const importVibeXPayload = useCallback((input: unknown, sourceLabel = 'VibeX') => {
      const data = input && typeof input === 'object' ? input as Record<string, any> : {};
      const payload = normalizeVibeXResultPayload(data.payload || data);
      if (!payload) {
        logBus.warn(`${sourceLabel} 没有发送可识别的视频、图片、音频或提示词`, 'VibeX');
        return false;
      }
      const messageId = String(payload.messageId || data.messageId || '').trim().slice(0, 180);
      if (messageId) {
        if (vibeXImportMessageIdsRef.current.has(messageId)) return false;
        vibeXImportMessageIdsRef.current.add(messageId);
        if (vibeXImportMessageIdsRef.current.size > 80) {
          vibeXImportMessageIdsRef.current = new Set([...vibeXImportMessageIdsRef.current].slice(-40));
        }
      }

      const specs = buildVibeXSendNodeSpecs(payload);
      if (specs.length === 0) {
        logBus.warn(`${sourceLabel} 回传没有可创建的素材节点`, 'VibeX');
        return false;
      }

      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = flowEl?.getBoundingClientRect();
      const base = screenToFlowPosition(
        rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
      const newNodes = materialNodesFromSpecs(specs, nodesRef.current, base, {
        signature: `vibex:${messageId || Date.now()}`,
        mode: 'output',
        sourceCanvasId: activeId,
        sourceNodeIds: [],
      });
      const assignedNewNodes = assignActiveNodeSerials(newNodes, nodesRef.current);
      const focusCenter = centerOfMaterialNodes(assignedNewNodes);
      if (activeId && focusCenter) {
        const { zoom } = getViewport();
        pendingSendFocusRef.current = {
          canvasId: activeId,
          center: focusCenter,
          zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
        };
      }
      setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...assignedNewNodes]);
      registerPlacementShelfNodes(assignedNewNodes, '发送');
      logBus.success(`已从 ${sourceLabel} 发送 ${assignedNewNodes.length} 个节点到当前画布`, 'VibeX');
      return true;
  }, [activeId, assignActiveNodeSerials, getViewport, registerPlacementShelfNodes, screenToFlowPosition]);

  useEffect(() => {
    const handleVibeXMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (
        data.type !== VIBEX_MESSAGE_CONTRACT.type ||
        data.source !== VIBEX_MESSAGE_CONTRACT.source
      ) return;
      importVibeXPayload(data, 'VibeX');
    };

    window.addEventListener('message', handleVibeXMessage);
    return () => window.removeEventListener('message', handleVibeXMessage);
  }, [importVibeXPayload]);

  const importPhotoshopPayload = useCallback((input: unknown, sourceLabel = 'Photoshop') => {
      const data = input && typeof input === 'object' ? input as Record<string, any> : {};
      const payload = normalizePhotoshopResultPayload(data.payload || data);
      if (!payload) {
        logBus.warn(`${sourceLabel} 没有发送可识别的图像或提示词`, 'Photoshop');
        return false;
      }
      const messageId = String(payload.messageId || data.messageId || '').trim().slice(0, 180);
      if (messageId) {
        if (photoshopImportMessageIdsRef.current.has(messageId)) return false;
      }

      const specs = buildPhotoshopSendNodeSpecs(payload);
      if (specs.length === 0) {
        logBus.warn(`${sourceLabel} 回传没有可创建的素材节点`, 'Photoshop');
        return false;
      }

      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = flowEl?.getBoundingClientRect();
      const base = screenToFlowPosition(
        rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
      const newNodes = materialNodesFromSpecs(specs, nodesRef.current, base, {
        signature: `photoshop:${messageId || Date.now()}`,
        mode: 'output',
        sourceCanvasId: activeId,
        sourceNodeIds: [],
      });
      const assignedNewNodes = assignActiveNodeSerials(newNodes, nodesRef.current);
      const focusCenter = centerOfMaterialNodes(assignedNewNodes);
      if (activeId && focusCenter) {
        const { zoom } = getViewport();
        pendingSendFocusRef.current = {
          canvasId: activeId,
          center: focusCenter,
          zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
        };
      }
      setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...assignedNewNodes]);
      registerPlacementShelfNodes(assignedNewNodes, '发送');
      if (messageId) {
        photoshopImportMessageIdsRef.current.add(messageId);
        if (photoshopImportMessageIdsRef.current.size > 80) {
          photoshopImportMessageIdsRef.current = new Set([...photoshopImportMessageIdsRef.current].slice(-40));
        }
      }
      logBus.success(`已从 ${sourceLabel} 发送 ${assignedNewNodes.length} 个节点到当前画布`, 'Photoshop');
      return true;
  }, [activeId, assignActiveNodeSerials, getViewport, registerPlacementShelfNodes, screenToFlowPosition]);

  useEffect(() => {
    const handlePhotoshopMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (
        data.type !== PHOTOSHOP_MESSAGE_CONTRACT.type ||
        data.source !== PHOTOSHOP_MESSAGE_CONTRACT.source
      ) return;
      importPhotoshopPayload(data, 'Photoshop');
    };

    window.addEventListener('message', handlePhotoshopMessage);
    return () => window.removeEventListener('message', handlePhotoshopMessage);
  }, [importPhotoshopPayload]);

  useEffect(() => {
    let disposed = false;
    let timerId: number | null = null;

    let inFlight = false;
    let idleStreak = 0;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (timerId != null) window.clearTimeout(timerId);
      timerId = window.setTimeout(drain, Math.max(0, delayMs));
    };

    const wake = () => {
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      if (disposed || document.visibilityState !== 'visible') return;
      idleStreak = 0;
      schedule(0);
    };

    const drain = async () => {
      timerId = null;
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      let hadActivity = false;
      let failed = false;
      try {
        const res = await fetch('/api/vibex-bridge/pending?limit=12', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          const messages = Array.isArray(json?.data?.messages) ? json.data.messages : [];
          hadActivity = messages.length > 0;
          messages.forEach((message: any) => {
            if (
              message?.type === VIBEX_MESSAGE_CONTRACT.type &&
              message?.source === VIBEX_MESSAGE_CONTRACT.source
            ) {
              importVibeXPayload(message, '网页版 VibeX');
              return;
            }
            if (
              message?.type === WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT.type &&
              message?.source === WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT.source
            ) {
              importWebImagePayload(message, '网页反推');
            }
          });
        } else {
          failed = true;
        }
      } catch {
        // 本地桥接不是所有运行形态都可用，失败时静默等待下一轮。
        failed = true;
      } finally {
        inFlight = false;
        if (!disposed && document.visibilityState === 'visible') {
          const decision = nextAdaptivePollDecision({
            baseMs: 1_800,
            maxMs: 15_000,
            idleStreak,
            hadActivity,
            failed,
          });
          idleStreak = decision.idleStreak;
          schedule(decision.delayMs);
        }
      }
    };

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      disposed = true;
      if (timerId != null) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [importVibeXPayload, importWebImagePayload]);

  useEffect(() => {
    let disposed = false;
    let timerId: number | null = null;

    let inFlight = false;
    let idleStreak = 0;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (timerId != null) window.clearTimeout(timerId);
      timerId = window.setTimeout(drain, Math.max(0, delayMs));
    };

    const wake = () => {
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      if (disposed || document.visibilityState !== 'visible') return;
      idleStreak = 0;
      schedule(0);
    };

    const settleMessage = async (message: any, imported: boolean, error?: unknown) => {
      const messageId = String(message?.payload?.messageId || message?.messageId || '').trim();
      if (!messageId) return;
      const endpoint = error ? 'fail' : 'complete';
      await fetch(`/api/photoshop-bridge/messages/${encodeURIComponent(messageId)}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(error ? { error: error instanceof Error ? error.message : String(error) } : { imported }),
      }).catch(() => undefined);
    };

    const drain = async () => {
      timerId = null;
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      let hadActivity = false;
      let failed = false;
      try {
        const res = await fetch('/api/photoshop-bridge/pending?limit=12', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          const messages = Array.isArray(json?.data?.messages) ? json.data.messages : [];
          hadActivity = messages.length > 0;
          for (const message of messages) {
            if (
              message?.type === PHOTOSHOP_MESSAGE_CONTRACT.type &&
              message?.source === PHOTOSHOP_MESSAGE_CONTRACT.source
            ) {
              try {
                const imported = importPhotoshopPayload(message, 'Photoshop');
                await settleMessage(message, imported);
              } catch (err) {
                await settleMessage(message, false, err);
              }
            }
          }
        } else {
          failed = true;
        }
      } catch {
        // Photoshop UXP bridge is optional; retry quietly when it is unavailable.
        failed = true;
      } finally {
        inFlight = false;
        if (!disposed && document.visibilityState === 'visible') {
          const decision = nextAdaptivePollDecision({
            baseMs: 2_200,
            maxMs: 15_000,
            idleStreak,
            hadActivity,
            failed,
          });
          idleStreak = decision.idleStreak;
          schedule(decision.delayMs);
        }
      }
    };

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      disposed = true;
      if (timerId != null) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [importPhotoshopPayload]);

  useEffect(() => {
    const stopRadialPointerEvent = (event: PointerEvent | MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const clearPress = () => {
      const press = radialPressRef.current;
      if (press?.timer) window.clearTimeout(press.timer);
      radialPressRef.current = null;
      if (!radialMenuRef.current) {
        radialViewportLockRef.current = null;
      }
    };

    const closeRadial = () => {
      clearPress();
      restoreRadialViewportLock();
      radialViewportLockRef.current = null;
      radialMenuRef.current = null;
      setRadialMenu(null);
    };

    const openRadialFromPress = (press: RadialPressState) => {
      const center = clampRadialMenuCenter(press.start, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      press.open = true;
      suppressRadialContextMenu();
      if (!radialViewportLockRef.current) {
        radialViewportLockRef.current = getViewport();
      }
      setPaneMenu(null);
      setContextMenu(null);
      setSelectionContextSubmenu(null);
      const next = {
        anchor: press.start,
        center,
        cursor: press.start,
        activeIndex: null,
      };
      radialMenuRef.current = next;
      setRadialMenu(next);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.defaultPrevented || event.button !== RADIAL_MENU_MOUSE_BUTTON) return;
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (!isRadialMenuPaneTarget(event.target)) return;
      clearPress();
      radialViewportLockRef.current = getViewport();
      const start = { x: event.clientX, y: event.clientY };
      const press: RadialPressState = {
        pointerId: event.pointerId,
        start,
        open: false,
        timer: window.setTimeout(() => {
          if (radialPressRef.current === press) openRadialFromPress(press);
        }, radialLongPressMs),
      };
      radialPressRef.current = press;
    };

    const onPointerMove = (event: PointerEvent) => {
      const press = radialPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!press.open) {
        if (distanceBetween(press.start, point) > RADIAL_MENU_MOVE_TOLERANCE) clearPress();
        return;
      }
      stopRadialPointerEvent(event);
      restoreRadialViewportLock();
      const current = radialMenuRef.current;
      if (!current) return;
      const index = radialSlotIndexFromPointer(current.center, point);
      const activeIndex = index !== null && radialSlots[index]?.enabled ? index : null;
      const next = { ...current, cursor: point, activeIndex };
      radialMenuRef.current = next;
      setRadialMenu(next);
    };

    const onPointerUp = (event: PointerEvent) => {
      const press = radialPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (!press.open) {
        clearPress();
        return;
      }
      stopRadialPointerEvent(event);
      suppressRadialContextMenu();
      const current = radialMenuRef.current;
      const slot = current?.activeIndex === null || current?.activeIndex === undefined
        ? null
        : radialSlots[current.activeIndex];
      closeRadial();
      if (slot?.enabled) {
        addNode(slot.nodeType, { atScreen: current?.anchor || press.start });
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      const press = radialPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (press.open) {
        stopRadialPointerEvent(event);
        suppressRadialContextMenu();
      }
      closeRadial();
    };

    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== RADIAL_MENU_MOUSE_BUTTON) return;
      if (!radialMenuRef.current && !radialPressRef.current?.open) return;
      stopRadialPointerEvent(event);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== RADIAL_MENU_MOUSE_BUTTON) return;
      if (!radialMenuRef.current && !radialPressRef.current?.open) return;
      stopRadialPointerEvent(event);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!radialMenuRef.current && !radialPressRef.current?.open) return;
      stopRadialPointerEvent(event);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== RADIAL_MENU_MOUSE_BUTTON) return;
      if (!radialMenuRef.current && !radialPressRef.current?.open) return;
      stopRadialPointerEvent(event);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!isRadialMenuContextMenuSuppressed()) return;
      stopRadialPointerEvent(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && radialMenuRef.current) {
        event.preventDefault();
        closeRadial();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('auxclick', onAuxClick, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', closeRadial);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('auxclick', onAuxClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', closeRadial);
      closeRadial();
    };
  }, [
    addNode,
    getViewport,
    isRadialMenuContextMenuSuppressed,
    radialLongPressMs,
    radialSlots,
    restoreRadialViewportLock,
    suppressRadialContextMenu,
  ]);

  const createUploadNodesFromFiles = useCallback(
    async (rawFiles: File[], atScreen?: { x: number; y: number }) => {
      const seenFiles = new Set<string>();
      const dedupedFiles = rawFiles.filter((file) => {
        const kind = inferCanvasMediaKind(file);
        if (!kind) return true;
        const key = canvasMediaFileKey(file);
        if (seenFiles.has(key)) return false;
        seenFiles.add(key);
        return true;
      });
      const buckets: Record<MediaKind, File[]> = { image: [], video: [], audio: [], model3d: [] };
      let skipped = 0;
      dedupedFiles.forEach((file) => {
        const kind = inferCanvasMediaKind(file);
        if (!kind) {
          skipped += 1;
          return;
        }
        buckets[kind].push(file);
      });

      const kinds = (['image', 'video', 'audio', 'model3d'] as MediaKind[]).filter((kind) => buckets[kind].length > 0);
      if (kinds.length === 0) return false;

      const payloads: Array<{ kind: MediaKind; items: MediaItem[] }> = [];
      const failures: string[] = [];
      for (const kind of kinds) {
        const items: MediaItem[] = [];
        for (let i = 0; i < buckets[kind].length; i += 1) {
          const file = buckets[kind][i];
          try {
            items.push(await uploadCanvasMediaFile(file, kind, i));
          } catch (err: any) {
            failures.push(`${file.name || kind}: ${err?.message || '上传失败'}`);
          }
        }
        if (items.length > 0) payloads.push({ kind, items });
      }

      if (payloads.length === 0) {
        if (failures.length > 0) alert(`素材导入失败:\n${failures.slice(0, 5).join('\n')}`);
        return true;
      }

      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = flowEl?.getBoundingClientRect();
      const screenPoint =
        atScreen ||
        lastCanvasPointerRef.current ||
        (rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const base = screenToFlowPosition(screenPoint);
      const desired = payloads.map((payload, index) => {
        const nodeType = payload.kind === 'model3d' ? 'model-3d-upload' : 'upload';
        const size = defaultSizeOf(nodeType);
        return {
          x: base.x - size.w / 2 + (index % 3) * 300,
          y: base.y - size.h / 2 + Math.floor(index / 3) * 300,
          w: size.w,
          h: size.h,
        };
      });
      const offset = placeBatchNodes(desired, nodesRef.current, {
        source: 'placement:canvas-media-upload',
      });
      const stamp = Date.now();
      const newNodes = payloads.map((payload, index) => ({
        id: `upload-canvas-${payload.kind}-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        type: payload.kind === 'model3d' ? 'model-3d-upload' : 'upload',
        position: {
          x: desired[index].x + offset.dx,
          y: desired[index].y + offset.dy,
        },
        selected: true,
        data: {
          ...createUploadDataFromItems(payload.kind, payload.items),
          ...(payload.kind === 'model3d' ? { lockedUploadType: 'model3d' } : {}),
        },
      })) as Node[];

      const assignedNewNodes = assignActiveNodeSerials(newNodes, nodesRef.current);
      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        ...assignedNewNodes,
      ]);
      registerPlacementShelfNodes(assignedNewNodes, '粘贴');
      if (skipped > 0) {
        console.warn(`画布导入素材时跳过 ${skipped} 个不支持的文件`);
      }
      if (failures.length > 0) {
        alert(`部分素材上传失败:\n${failures.slice(0, 5).join('\n')}`);
      }
      return true;
    },
    [screenToFlowPosition, assignActiveNodeSerials, registerPlacementShelfNodes]
  );

  const replaceUploadNodeFromFiles = useCallback(
    async (nodeId: string, rawFiles: File[]) => {
      const target = nodesRef.current.find((node) => node.id === nodeId && (node.type === 'upload' || node.type === 'model-3d-upload'));
      if (!target) return false;

      const seenFiles = new Set<string>();
      const buckets: Record<MediaKind, File[]> = { image: [], video: [], audio: [], model3d: [] };
      let firstKind: MediaKind | null = null;
      let skipped = 0;
      rawFiles.forEach((file) => {
        const kind = inferCanvasMediaKind(file);
        if (!kind) {
          skipped += 1;
          return;
        }
        const key = canvasMediaFileKey(file);
        if (seenFiles.has(key)) return;
        seenFiles.add(key);
        if (!firstKind) firstKind = kind;
        buckets[kind].push(file);
      });

      const existingKind = target.type === 'model-3d-upload' ? 'model3d' : (target.data as any)?.uploadType;
      const kind = chooseUploadReplacementKind(existingKind, buckets, firstKind);
      if (!kind) return false;
      const accepted = buckets[kind];
      if (accepted.length === 0) return false;
      const supportedCount = buckets.image.length + buckets.video.length + buckets.audio.length + buckets.model3d.length;
      const skippedDifferentKind = Math.max(0, supportedCount - accepted.length);

      const items: MediaItem[] = [];
      const failures: string[] = [];
      for (let i = 0; i < accepted.length; i += 1) {
        const file = accepted[i];
        try {
          items.push(await uploadCanvasMediaFile(file, kind, i));
        } catch (err: any) {
          failures.push(`${file.name || kind}: ${err?.message || '上传失败'}`);
        }
      }

      if (items.length === 0) {
        if (failures.length > 0) alert(`素材覆盖失败:\n${failures.slice(0, 5).join('\n')}`);
        return true;
      }

      const replacement = createUploadReplacementData(kind, items);
      setNodes((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId) return { ...node, selected: false };
          return {
            ...node,
            selected: true,
            data: {
              ...(node.data || {}),
              ...replacement,
            },
          };
        })
      );
      const notices: string[] = [];
      const kindLabel = kind === 'image' ? '图像' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '3D模型';
      if (skippedDifferentKind > 0 || skipped > 0) notices.push(`跳过 ${skippedDifferentKind + skipped} 个非${kindLabel}素材`);
      if (failures.length > 0) notices.push(...failures.slice(0, 4));
      if (notices.length > 0) {
        alert(`已覆盖上传素材节点，但有部分素材未使用:\n${notices.join('\n')}`);
      }
      return true;
    },
    []
  );

  const getMaterialSetMergeCandidate = useCallback((ids: string[]): { kind: MaterialSetKind; items: MaterialSetItem[] } | null => {
    const selectedNodes = nodesRef.current
      .filter((node) => ids.includes(node.id) && node.type !== 'groupBox')
      .sort((a, b) => {
        const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
        if (Math.abs(dy) > 24) return dy;
        return (a.position?.x ?? 0) - (b.position?.x ?? 0);
      });
    if (selectedNodes.length === 0) return null;

    const buckets: Record<MaterialSetKind, MaterialSetItem[]> = {
      text: [],
      image: [],
      video: [],
      audio: [],
    };
    for (const node of selectedNodes) {
      const nodeBuckets = collectMaterialSetBucketsFromData(node.data);
      for (const kind of ['text', 'image', 'video', 'audio'] as MaterialSetKind[]) {
        if (kind === 'text' && !shouldCollectNodeTextOutput(node.type, node.data)) continue;
        buckets[kind].push(...nodeBuckets[kind]);
      }
    }
    const kinds = nonEmptyMaterialSetKinds(buckets);
    if (kinds.length !== 1) return null;
    const kind = kinds[0];
    if (buckets[kind].length < 2) return null;
    return { kind, items: buckets[kind] };
  }, []);

  const handleMergeToMaterialSet = useCallback(
    (ids: string[], atScreen?: { x: number; y: number }) => {
      const candidate = getMaterialSetMergeCandidate(ids);
      if (!candidate) return;
      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = flowEl?.getBoundingClientRect();
      const screenPoint =
        atScreen ||
        (rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const base = screenToFlowPosition(screenPoint);
      const size = defaultSizeOf('material-set');
      const desiredX = base.x - size.w / 2;
      const desiredY = base.y - size.h / 2;
      const finalPos = placeSingleNode(desiredX, desiredY, 'material-set', nodesRef.current, {
        source: 'placement:merge-material-set',
      });
      const newNode: Node = {
        id: `material-set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'material-set',
        position: finalPos,
        selected: true,
        data: materialSetItemsToData(candidate.kind, candidate.items),
      } as Node;
      setNodes((prev) => [
        ...prev.map((node) => ({ ...node, selected: false })),
        ...assignActiveNodeSerials([newNode], prev),
      ]);
    },
    [getMaterialSetMergeCandidate, screenToFlowPosition, assignActiveNodeSerials],
  );

  const getDownloadableItemsFromNodes = useCallback((ids: string[]): MediaItem[] => {
    const out: MediaItem[] = [];
    const seen = new Set<string>();
    const push = (item: MediaItem) => {
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({
        ...item,
        url,
        name: item.name || fileNameFromUrl(url),
      });
    };

    for (const node of nodesRef.current) {
      if (!ids.includes(node.id) || node.type === 'groupBox') continue;
      for (const kind of ['image', 'video', 'audio', 'model3d'] as MediaKind[]) {
        getMediaItemsFromData(node.data, kind).forEach(push);
      }
      const buckets = collectMaterialSetBucketsFromData(node.data);
      for (const kind of ['image', 'video', 'audio'] as Array<Exclude<MediaKind, 'model3d'>>) {
        buckets[kind].forEach((item) => {
          if (!item.url) return;
          push({
            kind,
            url: item.url,
            name: item.name,
            size: item.size,
            mime: item.mime,
          });
        });
      }
    }

    return out;
  }, []);

  const downloadMaterialItem = useCallback(async (item: MediaItem, index: number) => {
    const fallbackName = `${item.kind}-${index + 1}`;
    const fileName = item.name || fileNameFromUrl(item.url) || fallbackName;
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = fileName;
      a.target = '_blank';
      a.rel = 'noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, []);

  const handleBatchDownloadSelected = useCallback(
    async (ids: string[]) => {
      const items = getDownloadableItemsFromNodes(ids);
      if (items.length === 0) {
        logBus.warn('所选节点没有可下载素材', '批量下载');
        return;
      }
      for (let i = 0; i < items.length; i += 1) {
        await downloadMaterialItem(items[i], i);
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      logBus.success(`已触发 ${items.length} 个素材下载`, '批量下载');
    },
    [downloadMaterialItem, getDownloadableItemsFromNodes],
  );

  const openSendMaterials = useCallback(
    (ids: string[], atScreen?: { x: number; y: number }) => {
      const selectedNodes = nodesRef.current.filter((node) => ids.includes(node.id) && node.id !== BULK_PHANTOM_ID);
      const materials = collectSendableMaterialsFromNodes(selectedNodes, activeId);
      const nodeFragment = buildSendNodeFragment(selectedNodes, edgesRef.current, activeId);
      if (materials.length === 0 && nodeFragment.nodes.length === 0) {
        logBus.warn('所选内容没有可发送的节点或素材', '发送');
        return;
      }
      const defaultMode = chooseDefaultSendMode({
        selectedNodeTypes: selectedNodes.map((node) => String(node.type || '')),
        nodeCount: nodeFragment.nodes.length,
        edgeCount: nodeFragment.edges.length,
        materialCount: materials.length,
      });
      setSendModal({
        materials,
        nodeFragment,
        sourceLabel: `选中 ${nodeFragment.nodes.length} 个节点${nodeFragment.edges.length > 0 ? ` · ${nodeFragment.edges.length} 条连线` : ''}`,
        defaultMode,
        atScreen,
      });
    },
    [activeId],
  );

  const resolveSendMode = useCallback((mode: SendTargetMode): SendTargetMode => {
    return resolveEffectiveSendMode({
      requestedMode: mode,
      defaultMode: sendModal?.defaultMode || 'auto',
      nodeCount: sendModal?.nodeFragment?.nodes.length || 0,
      edgeCount: sendModal?.nodeFragment?.edges.length || 0,
      materialCount: sendModal?.materials.length || 0,
    });
  }, [sendModal?.defaultMode, sendModal?.materials.length, sendModal?.nodeFragment?.edges.length, sendModal?.nodeFragment?.nodes.length]);

  const basePositionForActiveSend = useCallback(() => {
    const atScreen = sendModal?.atScreen;
    if (atScreen) return screenToFlowPosition(atScreen);
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = flowEl?.getBoundingClientRect();
    return screenToFlowPosition(
      rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );
  }, [screenToFlowPosition, sendModal?.atScreen]);

  const insertWorkflowFragment = useCallback(
    (fragment: SendNodeFragment, options: InsertWorkflowOptions = {}) => {
      if (!fragment?.nodes?.length) {
        logBus.warn('工作流资源没有可插入节点', '资源库');
        return;
      }
      const base = options.atScreen ? screenToFlowPosition(options.atScreen) : basePositionForActiveSend();
      const placedInstance = placeInstantiatedNodeFragment(
        instantiateSendNodeFragment(fragment, nodesRef.current, base),
        nodesRef.current,
      );
      const instance = {
        ...placedInstance,
        nodes: assignActiveNodeSerials(placedInstance.nodes, nodesRef.current),
      };
      const focusCenter = centerOfMaterialNodes(instance.nodes);
      if (activeId && focusCenter) {
        const { zoom } = getViewport();
        pendingSendFocusRef.current = {
          canvasId: activeId,
          center: focusCenter,
          zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
        };
      }
      setEdges([...edgesRef.current.map((edge) => ({ ...edge, selected: false })), ...instance.edges]);
      setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...instance.nodes]);
      logBus.success(`已插入 ${options.title || summarizeSendNodeFragment(fragment)}`, '资源库');
    },
    [activeId, assignActiveNodeSerials, basePositionForActiveSend, getViewport, screenToFlowPosition],
  );

  const loadVideoEditTargets = useCallback(async (targetCanvasId: string) => {
    const sourceNodes = targetCanvasId === activeId
      ? nodesRef.current
      : normalizeCanvasNodeSerials(
          ((await api.getCanvasData(targetCanvasId)).nodes || []) as Node[],
        ).nodes;
    return sourceNodes
      .filter((node) => node.type === 'video-edit')
      .map((node) => ({
        id: node.id,
        label: videoEditTargetLabel(node),
        clipCount: normalizeVideoEditClips((node.data as any)?.clips).length,
      }));
  }, [activeId]);

  const appendMaterialsToVideoEditNode = useCallback(
    async (
      targetCanvasId: string,
      incomingClips: VideoEditClip[],
      switchAfter: boolean,
      targetNodeId?: string | null,
    ) => {
      if (incomingClips.length === 0) {
        logBus.warn('没有可追加到视频剪辑的视频素材', '视频剪辑');
        return;
      }

      const createVideoEditNode = (existingNodes: Node[], base: { x: number; y: number }): Node => {
        const size = defaultSizeOf('video-edit');
        const offset = placeBatchNodes([{ x: base.x, y: base.y, w: size.w, h: size.h }], existingNodes, {
          source: 'placement:video-edit-send',
        });
        return {
          id: `video-edit-send-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'video-edit',
          position: { x: base.x + offset.dx, y: base.y + offset.dy },
          selected: true,
          data: {
            ...(INITIAL_DATA['video-edit'] || {}),
            ...videoEditPatchFromIncomingClips({}, incomingClips),
            sentFromMaterialBridge: true,
            sendBridgeMode: 'video-edit',
            sendBridgeSourceCanvasId: activeId || undefined,
            sendBridgeSourceNodeIds: incomingClips
              .map((clip) => clip.sourceNodeId)
              .filter((value): value is string => typeof value === 'string' && Boolean(value)),
            sendBridgeCreatedAt: Date.now(),
          },
        } as Node;
      };

      if (targetCanvasId === activeId) {
        const target = selectVideoEditTargetNode(nodesRef.current, targetNodeId);
        if (target) {
          setNodes((prev) => prev.map((node) => {
            if (node.id !== target.id) return { ...node, selected: false };
            return {
              ...node,
              selected: true,
              data: {
                ...(node.data || {}),
                ...videoEditPatchFromIncomingClips(node.data, incomingClips),
              },
            };
          }));
          setSendModal(null);
          logBus.success(`已追加 ${incomingClips.length} 段视频到 ${videoEditTargetLabel(target)}`, '视频剪辑');
          return;
        }

        const newNode = createVideoEditNode(nodesRef.current, basePositionForActiveSend());
        const assigned = assignActiveNodeSerials([newNode], nodesRef.current);
        const focusCenter = centerOfMaterialNodes(assigned);
        if (activeId && focusCenter) {
          const { zoom } = getViewport();
          pendingSendFocusRef.current = {
            canvasId: activeId,
            center: focusCenter,
            zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
          };
        }
        setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...assigned]);
        registerPlacementShelfNodes(assigned, '发送');
        setSendModal(null);
        logBus.success(`已新建视频剪辑并追加 ${incomingClips.length} 段视频`, '视频剪辑');
        return;
      }

      const data = await api.getCanvasData(targetCanvasId);
      const targetRevision = requireAuthoritativeCanvasRevision(data.revision);
      const normalizedTarget = normalizeCanvasNodeSerials(
        (Array.isArray(data.nodes) ? data.nodes : []) as Node[],
        data.nextNodeSerialId,
      );
      let targetNodes = normalizedTarget.nodes;
      const targetEdges = (Array.isArray(data.edges) ? data.edges : []) as Edge[];
      let nextNodeSerialId = normalizedTarget.nextNodeSerialId;
      let focusCenter: { x: number; y: number } | null = null;
      const target = selectVideoEditTargetNode(targetNodes, targetNodeId);
      if (target) {
        targetNodes = targetNodes.map((node) => node.id === target.id
          ? {
              ...node,
              selected: true,
              data: {
                ...(node.data || {}),
                ...videoEditPatchFromIncomingClips(node.data, incomingClips),
                videoEditCrossCanvasReceivedAt: Date.now(),
              },
            }
          : { ...node, selected: false });
        focusCenter = centerOfMaterialNodes(targetNodes.filter((node) => node.id === target.id));
      } else {
        const draft = createVideoEditNode(targetNodes, basePositionForAppend(targetNodes));
        const fresh = assignFreshNodeSerials([draft], targetNodes, nextNodeSerialId);
        targetNodes = [...targetNodes.map((node) => ({ ...node, selected: false })), ...fresh.nodes];
        nextNodeSerialId = fresh.nextNodeSerialId;
        focusCenter = centerOfMaterialNodes(fresh.nodes);
      }
      if (switchAfter && focusCenter) {
        pendingSendFocusRef.current = {
          canvasId: targetCanvasId,
          center: focusCenter,
          zoom: 0.88,
        };
      }
      const payload = {
        nodes: targetNodes,
        edges: targetEdges,
        viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
        nextNodeSerialId,
        creativeDesk: data.creativeDesk,
        farmCanvas: sanitizeFarmCanvasState(data.farmCanvas),
      };
      await api.saveCanvasData(targetCanvasId, payload, { baseRevision: targetRevision });
      api.autoSaveCanvasData(targetCanvasId, payload).catch(() => {});
      await refreshCanvasMetadata(targetCanvasId);
      if (switchAfter) setActive(targetCanvasId);
      setSendModal(null);
      logBus.success(`跨画布视频剪辑：已追加 ${incomingClips.length} 段视频到目标画布`, '视频剪辑');
    },
    [activeId, assignActiveNodeSerials, basePositionForActiveSend, getViewport, refreshCanvasMetadata, registerPlacementShelfNodes, setActive],
  );

  const handleSendMaterialsToCanvas = useCallback(
    async (
      targetCanvasId: string,
      mode: SendTargetMode,
      switchAfter: boolean,
      options?: { videoEditTargetNodeId?: string | null },
    ) => {
      if (!sendModal) return;
      const currentSend = {
        ...sendModal,
        materials: sendModal.materials.map((item) => ({ ...item })),
      };
      const effectiveMode = resolveSendMode(mode);
      if (effectiveMode === 'node-fragment') {
        const fragment = currentSend.nodeFragment;
        if (!fragment || fragment.nodes.length === 0) {
          logBus.warn('没有可发送到画布的节点片段', '发送节点');
          return;
        }

        if (targetCanvasId === activeId) {
          const base = basePositionForActiveSend();
          const placedInstance = placeInstantiatedNodeFragment(
            instantiateSendNodeFragment(fragment, nodesRef.current, base),
            nodesRef.current,
          );
          const instance = {
            ...placedInstance,
            nodes: assignActiveNodeSerials(placedInstance.nodes, nodesRef.current),
          };
          const focusCenter = centerOfMaterialNodes(instance.nodes);
          if (activeId && focusCenter) {
            const { zoom } = getViewport();
            pendingSendFocusRef.current = {
              canvasId: activeId,
              center: focusCenter,
              zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
            };
          }
          setEdges([...edgesRef.current.map((edge) => ({ ...edge, selected: false })), ...instance.edges]);
          setNodes([...nodesRef.current.map((node) => ({ ...node, selected: false })), ...instance.nodes]);
          registerPlacementShelfNodes(instance.nodes, '发送');
          setSendModal(null);
          logBus.success(`已发送 ${summarizeSendNodeFragment(fragment)} 到当前画布`, '发送节点');
          return;
        }

        const data = await api.getCanvasData(targetCanvasId);
        const targetNodesRaw = (Array.isArray(data.nodes) ? data.nodes : []) as Node[];
        const targetRevision = requireAuthoritativeCanvasRevision(data.revision);
        const normalizedTarget = normalizeCanvasNodeSerials(targetNodesRaw, data.nextNodeSerialId);
        const targetNodes = normalizedTarget.nodes;
        const targetEdges = (Array.isArray(data.edges) ? data.edges : []) as Edge[];
        const placedInstance = placeInstantiatedNodeFragment(
          instantiateSendNodeFragment(fragment, targetNodes, basePositionForAppend(targetNodes)),
          targetNodes,
        );
        const freshSerials = assignFreshNodeSerials(placedInstance.nodes, targetNodes, normalizedTarget.nextNodeSerialId);
        const instance = { ...placedInstance, nodes: freshSerials.nodes };
        const focusCenter = centerOfMaterialNodes(instance.nodes);
        if (switchAfter && focusCenter) {
          pendingSendFocusRef.current = {
            canvasId: targetCanvasId,
            center: focusCenter,
            zoom: 0.88,
          };
        }
        const payload = {
          nodes: [...targetNodes, ...instance.nodes],
          edges: [...targetEdges, ...instance.edges],
          viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
          nextNodeSerialId: freshSerials.nextNodeSerialId,
          creativeDesk: data.creativeDesk,
          farmCanvas: sanitizeFarmCanvasState(data.farmCanvas),
        };
        await api.saveCanvasData(targetCanvasId, payload, { baseRevision: targetRevision });
        api.autoSaveCanvasData(targetCanvasId, payload).catch(() => {});
        await refreshCanvasMetadata(targetCanvasId);
        if (switchAfter) setActive(targetCanvasId);
        setSendModal(null);
        logBus.success(`已发送 ${summarizeSendNodeFragment(fragment)} 到目标画布`, '发送节点');
        return;
      }

      if (currentSend.materials.length === 0) {
        logBus.warn('当前发送方式需要素材；请选择“节点片段”发送选中节点和连线', '发送素材');
        return;
      }
      if (effectiveMode === 'video-edit') {
        const incomingClips = currentSend.materials
          .map((item) => createVideoEditClipFromSendable(item))
          .filter((clip): clip is VideoEditClip => Boolean(clip));
        await appendMaterialsToVideoEditNode(
          targetCanvasId,
          incomingClips,
          switchAfter,
          options?.videoEditTargetNodeId ?? null,
        );
        return;
      }
      const specs = buildSendNodeSpecs(currentSend.materials, effectiveMode);
      if (specs.length === 0) {
        logBus.warn('没有可发送到画布的素材', '发送素材');
        return;
      }
      const bridgeSignature = sendableMaterialSignature(currentSend.materials);
      const bridgeSourceNodeIds = sourceNodeIdsFromMaterials(currentSend.materials);

      if (targetCanvasId === activeId) {
        const base = basePositionForActiveSend();
        const cleaned = removeDuplicateSendBridgeNodes(
          nodesRef.current,
          edgesRef.current,
          currentSend.materials,
          bridgeSignature,
          activeId,
        );
        const newNodes = materialNodesFromSpecs(specs, cleaned.nodes, base, {
          signature: bridgeSignature,
          mode: effectiveMode,
          sourceCanvasId: activeId,
          sourceNodeIds: bridgeSourceNodeIds,
        });
        const assignedNewNodes = assignActiveNodeSerials(newNodes, cleaned.nodes);
        const focusCenter = centerOfMaterialNodes(assignedNewNodes);
        if (activeId && focusCenter) {
          const { zoom } = getViewport();
          pendingSendFocusRef.current = {
            canvasId: activeId,
            center: focusCenter,
            zoom: Math.min(Math.max(zoom || 0.9, 0.72), 1.05),
          };
        }
        setEdges(cleaned.edges);
        setNodes([...cleaned.nodes.map((node) => ({ ...node, selected: false })), ...assignedNewNodes]);
        registerPlacementShelfNodes(assignedNewNodes, '发送');
        setSendModal(null);
        logBus.success(
          `已发送 ${summarizeSendableMaterials(currentSend.materials)} 到当前画布${cleaned.removed ? `，已替换旧批次 ${cleaned.removed} 个节点` : ''}`,
          '发送素材',
        );
        return;
      }

      const data = await api.getCanvasData(targetCanvasId);
      const targetNodesRaw = Array.isArray(data.nodes) ? data.nodes : [];
      const normalizedTarget = normalizeCanvasNodeSerials(targetNodesRaw as Node[], data.nextNodeSerialId);
      const targetRevision = requireAuthoritativeCanvasRevision(data.revision);
      const targetNodes = normalizedTarget.nodes;
      const targetEdges = Array.isArray(data.edges) ? data.edges : [];
      const cleaned = removeDuplicateSendBridgeNodes(
        targetNodes as Node[],
        targetEdges as Edge[],
        currentSend.materials,
        bridgeSignature,
        activeId,
      );
      const newNodes = materialNodesFromSpecs(specs, cleaned.nodes as Node[], basePositionForAppend(cleaned.nodes as Node[]), {
        signature: bridgeSignature,
        mode: effectiveMode,
        sourceCanvasId: activeId,
        sourceNodeIds: bridgeSourceNodeIds,
      });
      const freshSerials = assignFreshNodeSerials(newNodes, cleaned.nodes as Node[], normalizedTarget.nextNodeSerialId);
      const focusCenter = centerOfMaterialNodes(freshSerials.nodes);
      if (switchAfter && focusCenter) {
        pendingSendFocusRef.current = {
          canvasId: targetCanvasId,
          center: focusCenter,
          zoom: 0.88,
        };
      }
      const payload = {
        nodes: [...cleaned.nodes, ...freshSerials.nodes],
        edges: cleaned.edges,
        viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
        nextNodeSerialId: freshSerials.nextNodeSerialId,
        creativeDesk: data.creativeDesk,
        farmCanvas: sanitizeFarmCanvasState(data.farmCanvas),
      };
      await api.saveCanvasData(targetCanvasId, payload, { baseRevision: targetRevision });
      api.autoSaveCanvasData(targetCanvasId, payload).catch(() => {});
      await refreshCanvasMetadata(targetCanvasId);
      if (switchAfter) setActive(targetCanvasId);
      setSendModal(null);
      logBus.success(
        `已发送 ${summarizeSendableMaterials(currentSend.materials)} 到目标画布${cleaned.removed ? `，已替换旧批次 ${cleaned.removed} 个节点` : ''}`,
        '发送素材',
      );
    },
    [activeId, appendMaterialsToVideoEditNode, assignActiveNodeSerials, basePositionForActiveSend, getViewport, refreshCanvasMetadata, registerPlacementShelfNodes, resolveSendMode, sendModal, setActive],
  );

  const saveWorkflowFragmentToResource = useCallback(
    async (fragment: SendNodeFragment | undefined, defaultTitle = '未命名工作流') => {
      if (!fragment?.nodes?.length) {
        logBus.warn('至少选择 1 个节点才能保存工作流', '资源库');
        return false;
      }
      const title = window.prompt('工作流名称', defaultTitle);
      if (!title?.trim()) return false;
      try {
        const manifest = createWorkflowResourceManifest(fragment, { title: title.trim() });
        const result = await api.addResourceWorkflow({
          workflowFragment: manifest,
          title: manifest.title,
          tags: ['工作流'],
          sourceCanvasId: activeId || fragment.sourceCanvasId,
        });
        if (!result.success) throw new Error(result.error || '保存工作流失败');
        window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
        const duplicate = Boolean((result as any).duplicate || (result.data as any)?.duplicate);
        if (!duplicate) trackAchievementEvent({ type: 'workflow.saved', kind: 'workflow', category: 'workflow' });
        logBus.success(duplicate ? `资源库已有相同工作流：${manifest.title}` : `已保存工作流：${manifest.title}`, '资源库');
        return true;
      } catch (e: any) {
        logBus.warn(e?.message || '保存工作流失败', '资源库');
        return false;
      }
    },
    [activeId],
  );

  const handleSaveSendMaterialsToResource = useCallback(async (mode?: SendTargetMode) => {
    if (!sendModal) return;
    const effectiveMode = resolveSendMode(mode || sendModal.defaultMode || 'auto');
    if (effectiveMode === 'node-fragment') {
      const fallbackTitle = sendModal.nodeFragment?.nodes.length
        ? `${sendModal.nodeFragment.nodes.length}节点工作流`
        : '未命名工作流';
      await saveWorkflowFragmentToResource(sendModal.nodeFragment, fallbackTitle);
      return;
    }
    if (sendModal.materials.length === 0) return;
    const buckets = bucketSendableMaterials(sendModal.materials);
    let saved = 0;
    const failures: string[] = [];
    for (const kind of ['image', 'video', 'audio', 'text'] as MaterialSetKind[]) {
      const items = buckets[kind];
      if (items.length === 0) continue;
      if (kind !== 'text' && items.length === 1 && items[0].url) {
        const result = await api.addResourceItem({
          kind: kind as api.ResourceMediaKind,
          url: items[0].url,
          title: items[0].name || `${PORT_LABEL[kind]}素材`,
          tags: ['跨画布发送'],
          sourceNodeId: items[0].sourceNodeId,
          sourceCanvasId: items[0].sourceCanvasId || activeId || undefined,
        });
        if (result.success) {
          saved += 1;
          const duplicate = Boolean((result as any).duplicate || (result.data as any)?.duplicate);
          if (!duplicate) trackAchievementEvent({ type: 'resource.saved', kind, category: 'send-material' });
        }
        else failures.push(result.error || `${PORT_LABEL[kind]}入库失败`);
        continue;
      }
      const result = await api.addResourceSet({
        materialSetKind: kind,
        materialSetItems: items,
        title: `${PORT_LABEL[kind]}素材集 · ${items.length}项`,
        tags: ['跨画布发送'],
        sourceNodeId: items[0]?.sourceNodeId,
        sourceCanvasId: items[0]?.sourceCanvasId || activeId || undefined,
      });
      if (result.success) {
        saved += 1;
        const duplicate = Boolean((result as any).duplicate || (result.data as any)?.duplicate);
        if (!duplicate) trackAchievementEvent({ type: 'resource.saved', kind: `${kind}-set`, category: 'send-material-set' });
      }
      else failures.push(result.error || `${PORT_LABEL[kind]}素材集入库失败`);
    }
    window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
    if (saved > 0) logBus.success(`已保存 ${saved} 项到资源库`, '发送素材');
    if (failures.length > 0) logBus.warn(failures.slice(0, 2).join('；'), '发送素材');
  }, [activeId, resolveSendMode, saveWorkflowFragmentToResource, sendModal]);

  const handleSendMaterialsToEagle = useCallback(async () => {
    if (!sendModal || sendModal.materials.length === 0) return;
    const result = await api.sendToEagle({
      materials: sendModal.materials.map((item) => ({
        id: item.id,
        kind: item.kind,
        url: item.url,
        text: item.text,
        name: item.name,
      })),
      tags: ['T8', '贞贞画布'],
    });
    if (!result.success) {
      logBus.warn(result.error || '发送到 Eagle 失败，请确认 Eagle 已启动并开启本地 API', 'Eagle');
      return;
    }
    const imported = result.data.imported.length;
    const failed = result.data.failures.length;
    if (imported > 0) logBus.success(`已发送 ${imported} 项到 Eagle`, 'Eagle');
    if (failed > 0) logBus.warn(`${failed} 项发送失败，可检查 Eagle 是否支持该素材类型`, 'Eagle');
  }, [sendModal]);

  const handleSendMaterialsToFigma = useCallback(async () => {
    if (!sendModal || sendModal.materials.length === 0) throw new Error('没有可发送到 Figma 的素材');
    const result = await api.sendToFigma({
      materials: sendModal.materials.map((item) => ({
        id: item.id,
        kind: item.kind,
        url: item.url,
        text: item.text,
        name: item.name,
      })),
      tags: ['T8', '贞贞画布'],
    });
    if (!result.success) {
      const message = result.error || '发送到 Figma 失败：画布会自动启动本机 bridge，请确认 Figma 插件窗口已打开';
      logBus.warn(message, 'Figma');
      throw new Error(message);
    }
    const bridgeResult = (result.data as any)?.result;
    const bridgeData = bridgeResult?.data || bridgeResult || {};
    const bridgeJobId = bridgeData.jobId || bridgeResult?.jobId || '';
    const bridgeQueued = !!(bridgeData.queued || bridgeResult?.queued);
    const message = bridgeQueued
      ? `已发送 ${result.data.sent || sendModal.materials.length} 项到 Figma Bridge 队列，保持 Figma 插件窗口打开会自动导入${bridgeJobId ? `（任务 ${bridgeJobId}）` : ''}`
      : `已发送 ${result.data.sent || sendModal.materials.length} 项到 Figma`;
    logBus.success(message, 'Figma');
    return message;
  }, [sendModal]);

  const handleSendMaterialsToPhotoshop = useCallback(async () => {
    if (!sendModal || sendModal.materials.length === 0) throw new Error('没有可发送到 Photoshop 的素材');
    const imageMaterials = sendModal.materials.filter((item) => item.kind === 'image' && item.url);
    if (imageMaterials.length === 0) throw new Error('Photoshop 只接收图像素材，请先选择图像输出或上传素材');
    const result = await api.sendToPhotoshop({
      materials: imageMaterials.map((item) => ({
        id: item.id,
        kind: item.kind,
        url: item.url,
        text: item.text,
        name: item.name,
      })),
      tags: ['T8', '贞贞画布', 'Photoshop'],
      sourceCanvasId: activeId || undefined,
      sourceLabel: sendModal.sourceLabel || 'T8 画布',
    });
    if (!result.success) {
      const message = result.error || '发送到 Photoshop 失败，请确认 T8 Photoshop Link 面板已连接';
      logBus.warn(message, 'Photoshop');
      throw new Error(message);
    }
    const message = `已发送 ${result.data.sent || imageMaterials.length} 张图像到 Photoshop 队列，请保持 T8 Photoshop Link 面板连接${result.data.commandId ? `（任务 ${result.data.commandId}）` : ''}`;
    logBus.success(message, 'Photoshop');
    return message;
  }, [activeId, sendModal]);

  const handleCanvasPointerMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastCanvasPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const resolveClipboardPasteAnchor = useCallback(() => {
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = flowEl?.getBoundingClientRect();
    const pointer = lastCanvasPointerRef.current;
    const pointerInsideCanvas =
      !!pointer &&
      !!rect &&
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom;
    const screenPoint = pointerInsideCanvas
      ? pointer
      : rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return screenToFlowPosition(screenPoint);
  }, [screenToFlowPosition]);

  const onCanvasFileDragOver = useCallback((e: ReactDragEvent) => {
    if (!hasFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onCanvasFileDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!hasFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = collectCanvasMediaFiles(e.dataTransfer);
      if (files.length === 0) return;
      void createUploadNodesFromFiles(files, { x: e.clientX, y: e.clientY });
    },
    [createUploadNodesFromFiles]
  );

  // ===== 复制 / 粘贴 / 删除 =====
  const handleCopy = useCallback(() => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const selectedNodes = currentNodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) {
      logBus.warn('没有检测到选中的节点，请重新点选节点后再复制', '画布剪贴板');
      return false;
    }
    const sel = expandClipboardNodesForGroups(selectedNodes, currentNodes) as Node[];
    const ids = new Set(sel.map((n) => n.id));
    // 内部边: source/target 都在选中集合 —— 普通粘贴/快速复制会使用
    const selEdges = currentEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    // 外部入边: target 在选中集合,source 不在 —— Ctrl+Shift+V 连边粘贴使用
    const incomingEdges = currentEdges.filter((e) => !ids.has(e.source) && ids.has(e.target));
    // 外部出边: source 在选中集合,target 不在
    const outgoingEdges = currentEdges.filter((e) => ids.has(e.source) && !ids.has(e.target));
    clipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(sel)),
      edges: JSON.parse(JSON.stringify(selEdges)),
      incomingEdges: JSON.parse(JSON.stringify(incomingEdges)),
      outgoingEdges: JSON.parse(JSON.stringify(outgoingEdges)),
    };
    internalClipboardCopiedAtRef.current = Date.now();
    setClipboardCount(sel.length);
    void markSystemClipboardAsCanvasNodes(sel.length);
    logBus.success(`已复制 ${sel.length} 个节点，可直接按 Ctrl+V 粘贴`, '画布剪贴板');
    return true;
  }, []);

  // 普通粘贴: 仅复制选中节点 + 其内部边(与原逻辑一致)
  // withLinks=true: Ctrl+Shift+V 额外复制原节点的外部入边/出边 —— 将新节点与原画布上还存在的邻居连接
  const handlePaste = useCallback((withLinks = false, placementMode: ClipboardPastePlacementMode = 'pointer') => {
    const cb = clipboardRef.current as (typeof clipboardRef.current & {
      incomingEdges?: Edge[];
      outgoingEdges?: Edge[];
    }) | null;
    if (!cb || cb.nodes.length === 0) {
      logBus.warn('节点剪贴板为空，请先选择节点并复制', '画布剪贴板');
      return false;
    }
    const currentNodes = nodesRef.current;
    // 运行时字段黑名单(复制/粘贴时必须重置,避免新节点显示为进行中/携带旧 taskId)
    const RUNTIME_KEYS = [
      'status', 'taskId', 'progress', 'error',
      'isRunning', 'isPolling', 'pollingTimer',
    ];
    const sanitize = (data: any) => {
      const next: any = { ...(data || {}) };
      for (const k of RUNTIME_KEYS) delete next[k];
      next.status = 'idle';
      return next;
    };
    const idMap = new Map<string, string>();
    const stamp = Date.now();
    const newNodes = cb.nodes.map((n, idx) => {
      const newId = `${n.type}-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
      idMap.set(n.id, newId);
      return cloneCanvasEntityAsNew({
        ...n,
        id: newId,
        selected: true,
        data: sanitize(n.data),
      } as Node, 'node');
    });
    const remappedGroupNodes = remapPastedGroupMemberIds(newNodes, idMap) as Node[];
    const positionedNodes =
      placementMode === 'offset'
        ? offsetClipboardNodes(remappedGroupNodes, QUICK_DUPLICATE_OFFSET)
        : positionClipboardNodesAtAnchor(remappedGroupNodes, resolveClipboardPasteAnchor());
    const assignedNewNodes = assignActiveNodeSerials(positionedNodes, currentNodes);
    // 内部边: source/target 都映射到新节点
    const newInternalEdges = cb.edges
      .map((e, idx) => {
        const s = idMap.get(e.source);
        const t = idMap.get(e.target);
        if (!s || !t) return null;
        return cloneCanvasEntityAsNew({
          ...e,
          id: `e-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          source: s,
          target: t,
        } as Edge, 'edge');
      })
      .filter(Boolean) as Edge[];
    let extraEdges: Edge[] = [];
    if (withLinks) {
      // 外部入边: source 保留(原节点须仍在画布), target 映射为新节点
      const incoming = (cb.incomingEdges || [])
        .map((e, idx) => {
          const sourceStillExists = currentNodes.some((n) => n.id === e.source);
          const t = idMap.get(e.target);
          if (!sourceStillExists || !t) return null;
          return cloneCanvasEntityAsNew({
            ...e,
            id: `e-in-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            source: e.source,
            target: t,
          } as Edge, 'edge');
        })
        .filter(Boolean) as Edge[];
      // 外部出边: source 映射为新节点, target 保留
      const outgoing = (cb.outgoingEdges || [])
        .map((e, idx) => {
          const targetStillExists = currentNodes.some((n) => n.id === e.target);
          const s = idMap.get(e.source);
          if (!targetStillExists || !s) return null;
          return cloneCanvasEntityAsNew({
            ...e,
            id: `e-out-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            source: s,
            target: e.target,
          } as Edge, 'edge');
        })
        .filter(Boolean) as Edge[];
      extraEdges = [...incoming, ...outgoing];
    }
    // 取消其他节点的选中,新粘贴节点设为选中
    setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), ...assignedNewNodes]);
    setEdges((prev) => [...prev, ...newInternalEdges, ...extraEdges]);
    logBus.success(`已粘贴 ${assignedNewNodes.length} 个节点`, '画布剪贴板');
    return true;
  }, [assignActiveNodeSerials, resolveClipboardPasteAnchor]);

  const handleDuplicate = useCallback(() => {
    if (!handleCopy()) return;
    // 在 copy 完成后下一帧执行 paste(由于上面的 setClipboardCount 是异步)
    setTimeout(() => handlePaste(false, 'offset'), 0);
  }, [handleCopy, handlePaste]);

  const handleDeleteSelected = useCallback(() => {
    setNodes((prev) => {
      const removeIds = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      if (removeIds.size === 0) return prev;
      markManualNodeDeletion(removeIds, prev);
      setEdges((eds) =>
        eds.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target) && !e.selected)
      );
      return prev.filter((n) => !removeIds.has(n.id));
    });
    setEdges((prev) => prev.filter((e) => !e.selected));
  }, [markManualNodeDeletion]);

  // ===== 导入 / 导出 =====
  const handleExport = useCallback(() => {
    const data = {
      schema: 't8-penguin-canvas-export',
      version: 2,
      exportedAt: new Date().toISOString(),
      canvas: { id: activeId || 'export' },
      nodes,
      edges,
      viewport: getViewport(),
      nextNodeSerialId: nextNodeSerialIdRef.current,
      creativeDesk,
      farmCanvas,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${activeId || 'export'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [nodes, edges, activeId, getViewport, creativeDesk, farmCanvas]);

  const handleExportResourcePackage = useCallback(async () => {
    const title = canvases.find((canvas) => canvas.id === activeId)?.name || `画布 ${activeId || ''}`.trim() || '当前画布';
    const resourceLibrarySnapshot = await loadResourcePackageLibrarySnapshot();
    const generationHistoryForExport = collectGenerationHistory(nodesRef.current);
    const manifest = createCanvasResourcePackageManifest({
      canvasId: activeId || 'export',
      title,
      canvas: {
        nodes,
        edges,
        viewport: getViewport(),
        creativeDesk,
        farmCanvas,
        nextNodeSerialId: nextNodeSerialIdRef.current,
      },
      portable: false,
      resourceLibrary: resourceLibrarySnapshot,
      thumbnails: buildResourcePackageThumbnailRefs(generationHistoryForExport),
      generationHistory: generationHistoryForExport,
    });
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-resource-package-${activeId || 'export'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const missing = manifest.missingFiles.length;
    logBus.success(
      missing > 0
        ? `资源包清单已导出：${manifest.resources.length} 个资源，${missing} 个疑似缺失，历史 ${manifest.generationHistorySummary.total} 条`
        : `资源包清单已导出：${manifest.resources.length} 个资源，历史 ${manifest.generationHistorySummary.total} 条`,
      '资源包',
    );
  }, [activeId, canvases, nodes, edges, getViewport, creativeDesk, farmCanvas]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const txt = String(reader.result || '');
          const json = JSON.parse(txt);
          const resourcePackagePlan =
            json?.schema === 't8-canvas-resource-package'
              ? prepareCanvasResourcePackageImport(json)
              : null;
          const source = resourcePackagePlan
            ? resourcePackagePlan.canvas
            : json?.canvasData && typeof json.canvasData === 'object'
              ? json.canvasData
              : json;
          const importedNodes = Array.isArray(source.nodes) ? source.nodes : [];
          const importedEdges = Array.isArray(source.edges) ? source.edges : [];
          if (!confirm(`导入将替换当前画布(${importedNodes.length} 个节点 / ${importedEdges.length} 条连线),是否继续?`)) {
            return;
          }
          const normalized = normalizeCanvasNodeSerials(importedNodes, source.nextNodeSerialId);
          nextNodeSerialIdRef.current = normalized.nextNodeSerialId;
          setNodes(normalized.nodes);
          setEdges(importedEdges);
          setCreativeDesk(migrateCreativeDeskToViewportCoordinates(source.creativeDesk, source.viewport));
          setFarmCanvas(sanitizeFarmCanvasState(source.farmCanvas));
          if (resourcePackagePlan) {
            window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
            logBus.success(
              `资源包已导入：${resourcePackagePlan.resources.length} 个资源引用，资源库 ${resourcePackagePlan.resourceLibrary.items.length} 项，缩略图 ${resourcePackagePlan.thumbnailRefs.length} 项，历史 ${resourcePackagePlan.generationHistorySummary.total} 条`,
              '资源包',
            );
          }
        } catch (err) {
          alert('导入失败:JSON 解析错误');
          console.error(err);
        }
      };
      reader.readAsText(file);
      // 允许重复选同一文件
      e.target.value = '';
    },
    []
  );

  // ===== 应用模板 =====
  const handleApplyTemplate = useCallback((tpl: CanvasTemplate) => {
    const built = tpl.build();
    // 偏移现有 nodes 数量,避免重叠
    setNodes((prev) => [
      ...prev.map((n) => ({ ...n, selected: false })),
      ...assignActiveNodeSerials(built.nodes.map((n) => ({ ...n, selected: true })), prev),
    ]);
    setEdges((prev) => [...prev, ...built.edges]);
  }, [assignActiveNodeSerials]);

  const settleRunPreflightDecision = useCallback((confirmed: boolean) => {
    const resolve = runPreflightDecisionRef.current;
    runPreflightDecisionRef.current = null;
    runPreflightPresentedDigestRef.current = null;
    setRunPreflightModal(null);
    resolve?.(confirmed);
  }, []);

  const toggleWorkflowDoctor = useCallback(() => {
    const next = !workflowDoctorEnabled;
    writeWorkflowDoctorEnabled(next);
    if (!next) {
      runPreflightAbortRef.current?.abort();
      settleRunPreflightDecision(false);
    }
    setWorkflowDoctorEnabled(next);
    logBus.info(
      next
        ? '工作流医生已开启：运行前会检查配置、素材、策略与费用风险。'
        : '工作流医生已关闭：运行时不再执行医生诊断或弹出医生阻断。',
      '工作流医生',
    );
  }, [settleRunPreflightDecision, workflowDoctorEnabled]);

  const handleCancelRunPreflight = useCallback(() => {
    runPreflightAbortRef.current?.abort();
    settleRunPreflightDecision(false);
  }, [settleRunPreflightDecision]);

  const handleConfirmRunPreflight = useCallback((preview: RunActionPreview) => {
    settleRunPreflightDecision(preview.digest === runPreflightPresentedDigestRef.current);
  }, [settleRunPreflightDecision]);

  const presentRunPreflightPreview = useCallback((preview: RunActionPreview) => new Promise<boolean>((resolve) => {
    if (runPreflightAbortRef.current?.signal.aborted) {
      resolve(false);
      return;
    }
    runPreflightDecisionRef.current?.(false);
    runPreflightDecisionRef.current = resolve;
    runPreflightPresentedDigestRef.current = preview.digest;
    setRunPreflightModal({ loading: false, preview });
  }), []);

  const captureRunPreflightSnapshot = useCallback((): RunPreflightExecutionSnapshot | null => {
    const canvasId = useCanvasStore.getState().activeId;
    const projectId = activeProjectIdRef.current;
    if (!canvasId || !projectId || loadedCanvasIdRef.current !== canvasId || !loadedRef.current) return null;
    return {
      projectId,
      canvasId,
      revision: canvasRevisionsRef.current.get(canvasId) || 0,
      graphMutationEpoch: graphMutationEpochRef.current,
    };
  }, []);

  const captureRunExecutionSnapshot = useCallback((
    runIntent: RunIntent | null | undefined,
  ): RunPreflightExecutionSnapshot | null => {
    const current = captureRunPreflightSnapshot();
    if (!runIntent) return current;
    const revision = Number(runIntent.canvasRevision);
    if (!current
      || current.projectId !== runIntent.projectId
      || current.canvasId !== runIntent.canvasId
      || !Number.isSafeInteger(revision)
      || revision < 1) return null;
    // A remote intent executes an immutable historical runtime. Visible rN+1
    // edits must not invalidate rN, while an active project/canvas switch still
    // fails every subsequent preflight/persistence/Provider guard closed.
    return {
      projectId: runIntent.projectId,
      canvasId: runIntent.canvasId,
      revision,
      graphMutationEpoch: 0,
    };
  }, [captureRunPreflightSnapshot]);

  useEffect(() => {
    runPreflightAbortRef.current?.abort();
    settleRunPreflightDecision(false);
  }, [activeId, activeProjectId, settleRunPreflightDecision]);

  useEffect(() => () => {
    runPreflightAbortRef.current?.abort();
    runPreflightDecisionRef.current?.(false);
    runPreflightDecisionRef.current = null;
  }, []);

  const authorizeRunNodes = useCallback(async (
    preflightNodes: Node[],
    preflightEdges: Edge[],
    selectedNodeIds: string[],
    options: RunNodesByOrderOptions,
  ): Promise<PossibleDerivedExecutionScope | null> => {
    const captureExecutionSnapshot = () => captureRunExecutionSnapshot(options.runIntentSnapshot);
    const snapshot = captureExecutionSnapshot();
    if (!snapshot) {
      logBus.warn('当前项目或画布身份尚未稳定，已停止运行', '运行');
      return null;
    }

    const abortError = () => {
      const error = new Error('run preflight aborted');
      error.name = 'AbortError';
      return error;
    };
    const buildDerivedScope = async (signal?: AbortSignal) => {
      const throwIfAborted = () => {
        if (signal?.aborted) throw abortError();
      };
      throwIfAborted();
      const dependencyDefinitions = new Map<string, SubflowDefinition>();
      const rootDefinitions = preflightNodes
        .filter((node) => node.type === 'subflow')
        .map((node) => (node.data as Record<string, unknown> | undefined)?.definition)
        .filter((definition): definition is SubflowDefinition => Boolean(
          definition
          && typeof definition === 'object'
          && typeof (definition as SubflowDefinition).id === 'string'
          && Number.isInteger(Number((definition as SubflowDefinition).version)),
        ));
      for (const rootDefinition of rootDefinitions) {
        throwIfAborted();
        try {
          const loaded = await loadSubflowDependencyDefinitions(
            rootDefinition,
            (reference) => api.getSubflow(
              reference.definitionId,
              reference.version,
              reference.projectId || snapshot.projectId,
              { signal },
            ),
          );
          loaded.forEach((definition, key) => dependencyDefinitions.set(key, definition));
        } catch (error) {
          if (signal?.aborted) throw abortError();
          // The pure scope builder turns a missing fixed dependency into a
          // stable structural blocker without guessing a different version.
        }
      }
      throwIfAborted();
      return buildPossibleDerivedExecutionScope({
        nodes: preflightNodes,
        edges: preflightEdges,
        executionNodeIds: selectedNodeIds,
        requestId: options.requestId,
        resolveSubflowDefinition: (reference: SubflowDependencyRef) => (
          dependencyDefinitions.get(subflowDependencyMapKey(reference)) || null
        ),
      });
    };

    if (!workflowDoctorEnabled) {
      try {
        const derivedScope = await buildDerivedScope();
        if (!isSameRunPreflightExecutionSnapshot(snapshot, captureExecutionSnapshot())) {
          logBus.warn('准备运行期间画布已变化，请重新运行', '运行');
          return null;
        }
        if (!derivedScope.coverageComplete) {
          logBus.warn(
            derivedScope.blockers[0]?.title || '执行图无法完整解析，请检查连线或节点后重试',
            '运行',
          );
          return null;
        }
        return derivedScope;
      } catch (error) {
        console.warn('[run-scope] failed:', error);
        logBus.warn('执行图准备失败，请检查工作流后重试', '运行');
        return null;
      }
    }

    if (runPreflightPendingRef.current) {
      logBus.warn('已有运行体检正在进行，请先完成或取消当前预览', '运行体检');
      return null;
    }

    runPreflightPendingRef.current = true;
    const controller = new AbortController();
    runPreflightAbortRef.current = controller;
    const throwIfAborted = () => {
      if (controller.signal.aborted) throw abortError();
    };

    try {
      const actionKind = options.actionKind || (selectedNodeIds.length === 1 ? 'run-single' : 'run-group');
      const expectedRevision = options.expectedRevision ?? snapshot.revision;
      const latestDerivedScopeRef: { current: PossibleDerivedExecutionScope | null } = { current: null };
      const preparePreview = async () => {
        throwIfAborted();
        const derivedScope = await buildDerivedScope(controller.signal);
        latestDerivedScopeRef.current = derivedScope;
        const diagnosticScope = buildRunPreflightDiagnosticScope({
          nodes: derivedScope.nodes,
          edges: derivedScope.edges,
          executionNodeIds: derivedScope.requiredAuthorizationNodeIds,
          mode: 'exact-plan',
        });
        const assetIds = collectRunPreflightAssetIds(diagnosticScope.nodes);
        let assetCoverage = assetIds.length <= RUN_PREFLIGHT_ASSET_LIMIT;
        let policyCoverage = true;
        let capabilityCoverage = true;
        const assetRecords = new Map<string, import('../types/project').AssetRef | 'missing'>();
        const boundedAssetIds = assetIds.slice(0, RUN_PREFLIGHT_ASSET_LIMIT);
        let nextAssetIndex = 0;
        const assetWorkers = Array.from(
          { length: Math.min(RUN_PREFLIGHT_ASSET_CONCURRENCY, boundedAssetIds.length) },
          async () => {
            while (nextAssetIndex < boundedAssetIds.length) {
              const assetId = boundedAssetIds[nextAssetIndex++];
              throwIfAborted();
              try {
                const asset = await api.getProjectAsset(assetId, { signal: controller.signal });
                assetRecords.set(assetId, asset);
              } catch (error) {
                if (controller.signal.aborted) throw abortError();
                if (error instanceof api.ApiRequestError && error.status === 404) assetRecords.set(assetId, 'missing');
                else assetCoverage = false;
              }
            }
          },
        );

        const settingsPromise = api.getSettings({ signal: controller.signal })
          .catch((error) => {
            if (controller.signal.aborted) throw abortError();
            capabilityCoverage = false;
            return useApiKeysStore.getState().settings;
          });
        const policyPromise = api.getCollaborationExecutionPolicy(snapshot.projectId, {
          signal: controller.signal,
          excludeIntentId: options.runIntentSnapshot?.id,
        })
          .catch((error) => {
            if (controller.signal.aborted) throw abortError();
            policyCoverage = false;
            return null;
          });

        const [settings, policy] = await Promise.all([
          settingsPromise,
          policyPromise,
          Promise.all(assetWorkers),
        ]).then(([settingsResult, policyResult]) => [settingsResult, policyResult] as const);
        throwIfAborted();

        let diagnostics: RunPreflightDiagnosticsInput = {
          structure: [], capability: [], asset: [], policy: [],
        };
        let structureCoverage = derivedScope.coverageComplete;
        let hostContextDigest = '';
        try {
          hostContextDigest = createRunPreflightHostContextDigest({
            settings,
            assetIds,
            assetRecords,
            policy,
            runIntent: options.runIntentSnapshot || null,
          });
        } catch {
          structureCoverage = false;
        }
        try {
          diagnostics = buildRunPreflightDiagnostics({
            nodes: diagnosticScope.nodes,
            edges: diagnosticScope.edges,
            executionNodeIds: derivedScope.requiredAuthorizationNodeIds,
            scopeMode: 'exact-plan',
            projectId: snapshot.projectId,
            settings,
            providersComplete: capabilityCoverage,
            assets: workflowAssetsFromRecords(assetIds, assetRecords),
            policy,
            estimatedCost: options.cost?.known ? options.cost.amount : undefined,
          });
          diagnostics = {
            ...diagnostics,
            structure: [
              ...derivedScope.blockers.map((blocker) => ({
                ruleId: `derived-scope.${blocker.code}`,
                severity: 'error',
                title: blocker.title,
                detail: blocker.dependency
                  ? `${blocker.title} ${subflowDependencyMapKey(blocker.dependency)}`
                  : blocker.title,
                nodeIds: blocker.nodeIds,
              })),
              ...diagnostics.structure,
            ],
          };
        } catch {
          structureCoverage = false;
        }

        const current = captureExecutionSnapshot();
        return prepareRunAction({
          actionKind,
          projectId: snapshot.projectId,
          canvasId: snapshot.canvasId,
          currentRevision: current?.revision ?? null,
          expectedRevision,
          nodes: diagnosticScope.nodes,
          edges: diagnosticScope.edges,
          selectedNodeIds,
          diagnostics,
          diagnosticCoverage: {
            structure: structureCoverage,
            capability: capabilityCoverage,
            asset: assetCoverage,
            policy: policyCoverage,
          },
          cost: options.cost || { known: false },
          evidenceRefs: options.evidenceRefs,
          requestId: options.requestId,
          hostContextDigest,
        });
      };

      const authorization = await authorizeRunPreflight({
        snapshot,
        signal: controller.signal,
        prepare: preparePreview,
        captureCurrent: captureExecutionSnapshot,
        present: options.suppressBlockedPreflightPresentation
          ? async () => false
          : presentRunPreflightPreview,
        revalidate: preparePreview,
      });
      if (!authorization.authorized && authorization.reason === 'stale') {
        logBus.warn('体检期间画布、revision 或执行图已经变化，请重新运行', '运行体检');
      }
      const authorizedScope = latestDerivedScopeRef.current as PossibleDerivedExecutionScope | null;
      return authorization.authorized && authorizedScope?.coverageComplete
        ? authorizedScope
        : null;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return null;
      console.warn('[run-preflight] failed closed:', error);
      logBus.warn('运行体检上下文不可用，已停止调用 Provider', '运行体检');
      return null;
    } finally {
      if (runPreflightAbortRef.current === controller) runPreflightAbortRef.current = null;
      runPreflightPendingRef.current = false;
      runPreflightDecisionRef.current = null;
      runPreflightPresentedDigestRef.current = null;
      setRunPreflightModal(null);
    }
  }, [captureRunExecutionSnapshot, presentRunPreflightPreview, workflowDoctorEnabled]);

  // ===== 批量运行 =====
  // 通用: 在指定节点子集上拓扑排序 + 串行调 runBus
  const runNodesByOrder = useCallback(
    async (subNodes: Node[], subEdges: Edge[], options: RunNodesByOrderOptions = {}) => {
      const launchCanvasId = loadedCanvasIdRef.current;
      if (!launchCanvasId) {
        logBus.warn('当前画布尚未加载完成，未启动运行', '运行体检');
        return -1;
      }
      const runControl: ActiveCanvasRunControl = {
        cancelled: false,
        cancelPersistence: Promise.resolve(),
      };
      activeCanvasRunsRef.current.add(runControl);
      setIsRunning(true);
      const releaseLaunchLock = await runLaunchQueueRef.current.acquire();
      let launchLockReleased = false;
      const releaseLaunch = () => {
        if (launchLockReleased) return;
        launchLockReleased = true;
        releaseLaunchLock();
      };
      const runReservationToken = Symbol('run-plan-reservation');
      let planReserved = false;
      try {
      if (runControl.cancelled) return -1;
      options = {
        ...options,
        requestId: options.requestId || createCanvasNodeRunRequestId('canvas', options.actionKind || 'run'),
      };
      const captureExecutionSnapshot = () => captureRunExecutionSnapshot(options.runIntentSnapshot);
      const plannedSubgraph = options.executionOrder
        ? { nodes: subNodes, edges: subEdges }
        : excludeRandomRouteBranchDescendants(subNodes, subEdges);
      const availableNodeIds = new Set(plannedSubgraph.nodes.map((node) => node.id));
      const requestedOrder = options.executionOrder
        ? [...new Set(options.executionOrder.map(String).filter(Boolean))]
        : null;
      if (requestedOrder?.some((nodeId) => !availableNodeIds.has(nodeId))) {
        throw new Error('原输入运行图未完整挂载，已停止重放');
      }
      const order = requestedOrder || topologicalSort(plannedSubgraph.nodes, plannedSubgraph.edges, EXECUTABLE_NODE_TYPES);
      if (order.length === 0) return 0;
      const scopedOrder = order.map((nodeId) => createCanvasNodeExecutionKey(launchCanvasId, nodeId));
      const reservedNodeIds = new Set(Array.from(activeRunPlansRef.current.values()).flatMap((ids) => [...ids]));
      const conflictingNodeIds = order.filter((_, index) => reservedNodeIds.has(scopedOrder[index]));
      if (conflictingNodeIds.length > 0) {
        logBus.warn(
          `以下节点已有任务在运行，未重复提交：${conflictingNodeIds.join('、')}`,
          '并发运行',
        );
        return -1;
      }
      activeRunPlansRef.current.set(runReservationToken, new Set(scopedOrder));
      planReserved = true;
      const authorizedScope = await authorizeRunNodes(
        options.preflightContextNodes || plannedSubgraph.nodes,
        options.preflightContextEdges || plannedSubgraph.edges,
        order,
        options,
      );
      if (!authorizedScope) return -1;
      const authorizedNodeIds = [...authorizedScope.requiredAuthorizationNodeIds];
      const authorizedNodeIdSet = new Set(authorizedNodeIds);
      if (order.some((nodeId) => !authorizedNodeIdSet.has(nodeId))) {
        throw new Error('最终体检授权范围缺少根执行节点，已停止运行');
      }
      const secondaryProviderAction = options.secondaryProviderAction
        ? validateSecondaryProviderAction(options.secondaryProviderAction)
        : null;
      if (options.secondaryProviderAction && !secondaryProviderAction) {
        throw new Error('次级 Provider action 已损坏，已停止运行');
      }
      if (secondaryProviderAction) {
        const authorizedNode = authorizedScope.nodes.find((node) => node.id === secondaryProviderAction.nodeId);
        const currentAction = secondaryProviderActionFromNodeData(authorizedNode?.data);
        if (options.requestId !== secondaryProviderAction.requestId
          || order.length !== 1
          || order[0] !== secondaryProviderAction.nodeId
          || authorizedNodeIds.length !== 1
          || authorizedNodeIds[0] !== secondaryProviderAction.nodeId
          || authorizedNode?.type !== secondaryProviderAction.nodeType
          || currentAction?.requestId !== secondaryProviderAction.requestId
          || currentAction.digest !== secondaryProviderAction.digest) {
          throw new Error('次级 Provider action 与最终体检授权范围不一致，已停止运行');
        }
      }
      const persistenceSnapshot = captureExecutionSnapshot();
      if (!persistenceSnapshot) return -1;
      if (persistenceSnapshot.canvasId !== launchCanvasId) {
        throw new Error('运行请求所属画布已切换，未启动错误画布上的节点');
      }
      if (!isSameRunPreflightExecutionSnapshot(persistenceSnapshot, captureExecutionSnapshot())) {
        throw new Error('确认后画布、revision 或执行图发生变化，已停止创建 Run');
      }
      const plannedNodeIds = new Set(order);
      const recordedNodeId = (nodeId: string) => options.originalNodeIdByRuntimeId?.[nodeId] || nodeId;
      const recordedOrder = order.map(recordedNodeId);
      const plannedEdges = plannedSubgraph.edges
        .filter((edge) => plannedNodeIds.has(edge.source) && plannedNodeIds.has(edge.target))
        .map((edge) => ({ source: recordedNodeId(edge.source), target: recordedNodeId(edge.target) }));
      const authorizedEdges = authorizedScope.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      }));
      let runIntentLease: api.CollaborationRunIntentDispatchLease | null = null;
      if (options.runIntentId) {
        const intent = options.runIntentSnapshot;
        const queueRevision = Number(intent?.queueRevision);
        if (!intent
          || intent.id !== options.runIntentId
          || intent.projectId !== persistenceSnapshot.projectId
          || intent.canvasId !== persistenceSnapshot.canvasId
          || intent.canvasRevision !== persistenceSnapshot.revision
          || intent.status !== 'accepted'
          || !Number.isSafeInteger(queueRevision)
          || queueRevision < 1) {
          throw new Error('远程运行请求缺少精确 accepted 队列快照，已停止领取租约');
        }
        runIntentLease = await api.leaseCollaborationRunIntent({
          projectId: intent.projectId,
          canvasId: intent.canvasId,
          workerId: runIntentWorkerIdRef.current,
          expectedIntentId: intent.id,
          leaseDurationMs: 60_000,
        });
        if (!runIntentLease) {
          logBus.info('该请求尚未轮到执行，主机将继续按队列顺序处理', '协作运行');
          return -1;
        }
        const leasedRevision = Number(runIntentLease.intent.queueRevision);
        if (runIntentLease.intent.id !== intent.id
          || runIntentLease.intent.projectId !== intent.projectId
          || runIntentLease.intent.canvasId !== intent.canvasId
          || runIntentLease.intent.status !== 'dispatching'
          || runIntentLease.lease.owner !== runIntentWorkerIdRef.current
          || !runIntentLease.lease.token
          || !Number.isSafeInteger(leasedRevision)
          || leasedRevision < 1) {
          throw new Error('主机返回了不匹配的运行租约，已停止执行');
        }
      }
      const {
        triggerRun,
        setBatchProgress,
        cancelRun,
        setActiveRunContext,
        clearActiveRunContext,
      } = useRunBusStore.getState();
      let unregisterExecutionContexts: () => void = () => undefined;
      let unregisterPreparedExecutionContexts: () => void = () => undefined;
      let stopRunIntentCancellationMonitor: () => void = () => undefined;
      let preparedRunExecution: PreparedRunExecution | null = null;
      let runContext: RunContext | null = null;
      let runId: string | null = null;
      let failedCount = 0;
      let executionStarted = false;
      const proposedRunId = `run-${typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      const recoverOrReleaseRunIntentClaim = async () => {
        if (!runIntentLease) {
          try {
            return await api.getProjectRun(proposedRunId);
          } catch {
            // The Run create outcome is unknown. Do not start any provider work
            // unless this exact pre-generated Run can be proven durable.
            return null;
          }
        }
        if (!runIntentLease || !proposedRunId) return null;
        const readIntent = async () => api.getCollaborationRunIntent(
          runIntentLease!.intent.id,
          runIntentLease!.intent.projectId,
          runIntentLease!.intent.canvasId,
        );
        let current: RunIntent;
        try {
          current = await readIntent();
        } catch {
          // Unknown state: leave the private lease to expire. Releasing without
          // proving the exact current revision could race a committed claim.
          return null;
        }
        if (current.runId === proposedRunId) {
          try {
            return await api.getProjectRun(proposedRunId);
          } catch {
            return null;
          }
        }
        if (current.runId) return null;
        const currentRevision = Number(current.queueRevision);
        if (current.status !== 'dispatching'
          || !Number.isSafeInteger(currentRevision)
          || currentRevision < 1) return null;
        try {
          await api.releaseCollaborationRunIntentLease(current.id, {
            projectId: current.projectId,
            canvasId: current.canvasId,
            expectedQueueRevision: currentRevision,
            workerId: runIntentLease.lease.owner,
            leaseToken: runIntentLease.lease.token,
            retryable: true,
            errorCode: 'run_create_unconfirmed',
            errorMessage: '主机未确认 Run 创建结果，已安全释放租约等待重试',
          });
          return null;
        } catch {
          // A claim and a release may race. Re-read once and resume only when
          // the durable intent is bound to this renderer's pre-generated ID.
          try {
            const latest = await readIntent();
            if (latest.runId === proposedRunId) return await api.getProjectRun(proposedRunId);
          } catch {
            // The lease will expire if neither durable mutation can be proven.
          }
          return null;
        }
      };
      try {
        try {
          let run: Awaited<ReturnType<typeof api.createProjectRun>>;
          try {
            run = await api.createProjectRun({
              id: proposedRunId,
              canvasId: persistenceSnapshot.canvasId,
              canvasRevision: persistenceSnapshot.revision,
              status: 'queued',
              parentRunId: options.parentRunId,
              ...(runIntentLease ? {
                runIntentClaim: {
                  intentId: runIntentLease.intent.id,
                  expectedQueueRevision: Number(runIntentLease.intent.queueRevision),
                  leaseToken: runIntentLease.lease.token,
                  leaseOwner: runIntentLease.lease.owner,
                },
              } : {}),
              summary: {
                plannedNodeIds: recordedOrder,
                plannedEdges,
                authorizedNodeIds,
                authorizedEdges,
                nodeCount: order.length,
                authorizedNodeCount: authorizedNodeIds.length,
                replayMode: options.replayMode || null,
                replaySourceRunId: options.replaySourceRunId || null,
                replaySourceAttemptId: options.replaySourceAttemptId || null,
                runIntentId: options.runIntentId || null,
                runRequestId: options.requestId || null,
                secondaryProviderActionSchema: secondaryProviderAction?.schema || null,
                secondaryProviderActionId: secondaryProviderAction?.actionId || null,
                secondaryProviderActionTarget: secondaryProviderAction?.target || null,
                secondaryProviderActionDigest: secondaryProviderAction?.digest || null,
                secondaryProviderActionInputDigest: secondaryProviderAction && 'inputDigest' in secondaryProviderAction.params
                  ? secondaryProviderAction.params.inputDigest
                  : null,
              },
            });
          } catch (createError) {
            const recovered = await recoverOrReleaseRunIntentClaim();
            if (!recovered) throw createError;
            run = recovered;
          }
          runId = run.id;
          if (!isSameRunPreflightExecutionSnapshot(persistenceSnapshot, captureExecutionSnapshot())) {
            failedCount += 1;
            throw new Error('创建 Run 期间画布或执行输入发生变化，已停止调用 Provider');
          }
          runContext = {
            contextId: `run-context-${run.id}`,
            runId: run.id,
            projectId: run.projectId,
            canvasId: run.canvasId,
            canvasRevision: run.canvasRevision,
            mode: options.replayMode ? 'replay' : order.length === 1 ? 'single' : 'batch',
            plannedNodeIds: [...recordedOrder],
            authorizedNodeIds,
            parentRunId: options.parentRunId || null,
            replayMode: options.replayMode || null,
            replaySourceRunId: options.replaySourceRunId || null,
            replaySourceAttemptId: options.replaySourceAttemptId || null,
            requestId: options.requestId || null,
            secondaryProviderActionSchema: secondaryProviderAction?.schema || null,
            secondaryProviderActionId: secondaryProviderAction?.actionId || null,
            secondaryProviderActionTarget: secondaryProviderAction?.target || null,
            secondaryProviderActionDigest: secondaryProviderAction?.digest || null,
            secondaryProviderActionInputDigest: secondaryProviderAction && 'inputDigest' in secondaryProviderAction.params
              ? secondaryProviderAction.params.inputDigest
              : null,
            createdAt: Date.now(),
          };
          await api.updateProjectRun(run.id, {
            status: 'running',
            startedAt: Date.now(),
            summary: { runContextId: runContext.contextId, executionMode: runContext.mode },
          });
          if (!isSameRunPreflightExecutionSnapshot(persistenceSnapshot, captureExecutionSnapshot())) {
            failedCount += 1;
            throw new Error('启动 Run 期间画布或执行输入发生变化，已停止调用 Provider');
          }
        } catch (error) {
          // E4 的诊断与受控重试依赖持久化的 Run/NodeRun/Attempt 作为权威证据。
          // 若 Run 无法创建，继续调用 Provider 会留下不可诊断、不可审计的“幽灵运行”，
          // 因此所有执行入口统一 fail-closed。
          failedCount += 1;
          throw new Error(`无法创建持久化 Run，已停止执行：${error instanceof Error ? error.message : String(error)}`);
        }
        if (runId && options.prepareRunExecution) {
          try {
            preparedRunExecution = await options.prepareRunExecution(runId);
          } catch (error) {
            failedCount += 1;
            throw error;
          }
        }
        if (!isSameRunPreflightExecutionSnapshot(persistenceSnapshot, captureExecutionSnapshot())) {
          failedCount += 1;
          throw new Error('准备运行期间画布或执行输入发生变化，已停止调用 Provider');
        }
        unregisterExecutionContexts = options.executionContexts
          ? registerRunNodeExecutionContexts(options.executionContexts)
          : () => undefined;
        if (preparedRunExecution) {
          unregisterPreparedExecutionContexts = registerRunNodeExecutionContexts(preparedRunExecution.executionContexts);
        }
        setActiveRunContext(runContext);
        executionStarted = true;
        if (order.length > 1) setBatchProgress(order.length, 0);
        if (options.runIntentId && options.runIntentSnapshot) {
          const monitorAbort = new AbortController();
          let monitorTimer: number | null = null;
          let monitorStopped = false;
          const checkCancellation = async () => {
            if (monitorStopped || monitorAbort.signal.aborted) return;
            try {
              const current = await api.getCollaborationRunIntent(
                options.runIntentId!,
                options.runIntentSnapshot!.projectId,
                options.runIntentSnapshot!.canvasId,
                { signal: monitorAbort.signal },
              );
              if (current.cancelRequestedAt || current.status === 'cancelled') {
                runControl.cancelled = true;
                runControl.cancelPersistence = cancelRun(runContext!.runId);
                await runControl.cancelPersistence;
                return;
              }
            } catch (error) {
              if (monitorAbort.signal.aborted) return;
              console.warn('[run-intent] cancellation check failed:', error);
            }
            if (!monitorStopped) monitorTimer = window.setTimeout(checkCancellation, 1500);
          };
          stopRunIntentCancellationMonitor = () => {
            monitorStopped = true;
            monitorAbort.abort();
            if (monitorTimer !== null) window.clearTimeout(monitorTimer);
          };
          void checkCancellation();
        }
        for (let i = 0; i < order.length; i++) {
          if (runControl.cancelled) break;
          const id = order[i];
          const executionNodeId = createCanvasNodeExecutionKey(runContext?.canvasId || launchCanvasId, id);
          const doneResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
            let done = false;
            let executionToken: string | null = null;
            const finish = (result: { ok: boolean; error?: string }) => {
              if (done) return;
              done = true;
              unsub();
              window.clearTimeout(timer);
              resolve(result);
            };
            const unsub = useRunBusStore.subscribe((state) => {
              if (runControl.cancelled) finish({ ok: false, error: 'stopped' });
              else if (matchesRunCompletion(state.lastDone, executionNodeId, executionToken)) finish({ ok: state.lastDone.ok, error: state.lastDone.error });
              else if (executionToken && state.executionTokens[executionNodeId] !== executionToken) finish({ ok: false, error: 'superseded' });
            });
            // 安全超时 60 分钟，避免图像/视频/SD2.0/音频长轮询被批量运行提前截断。
            const timer = window.setTimeout(() => finish({ ok: false, error: 'timeout' }), 60 * 60 * 1000);
            executionToken = triggerRun(
              id,
              order.length === 1 && !options.replayMode ? 'single' : 'batch',
              runContext,
            );
            releaseLaunch();
            const current = useRunBusStore.getState();
            if (runControl.cancelled) finish({ ok: false, error: 'stopped' });
            else if (matchesRunCompletion(current.lastDone, executionNodeId, executionToken)) finish({ ok: current.lastDone.ok, error: current.lastDone.error });
            else if (current.executionTokens[executionNodeId] !== executionToken) finish({ ok: false, error: 'superseded' });
          });
          if (!doneResult.ok) failedCount += 1;
          if (order.length > 1) setBatchProgress(order.length, i + 1);
        }
        return order.length;
      } catch (error) {
        if (failedCount === 0) failedCount = 1;
        throw error;
      } finally {
        stopRunIntentCancellationMonitor();
        let status: ProjectRunTerminalStatus = runControl.cancelled ? 'stopped' : failedCount > 0 ? 'failed' : 'succeeded';
        let finalizationError: unknown = null;
        if (runControl.cancelled) {
          try {
            await runControl.cancelPersistence;
          } catch (error) {
            failedCount += 1;
            finalizationError = error;
            console.error('[run-center] failed to persist cancelled node runs:', error);
          }
        }
        if (preparedRunExecution) {
          try {
            await preparedRunExecution.finalize(status);
          } catch (error) {
            failedCount += 1;
            if (status !== 'stopped') status = 'failed';
            finalizationError ||= error;
            console.error('[run-center] failed to finish prepared run hierarchy:', error);
          }
        }
        if (runId) {
          try {
            await api.updateProjectRun(runId, {
              status,
              summary: {
                plannedNodeIds: recordedOrder,
                plannedEdges,
                authorizedNodeIds,
                authorizedEdges,
                nodeCount: order.length,
                authorizedNodeCount: authorizedNodeIds.length,
                failedCount,
                replayMode: options.replayMode || null,
                replaySourceRunId: options.replaySourceRunId || null,
                replaySourceAttemptId: options.replaySourceAttemptId || null,
                runIntentId: options.runIntentId || null,
                runRequestId: options.requestId || null,
                secondaryProviderActionSchema: secondaryProviderAction?.schema || null,
                secondaryProviderActionId: secondaryProviderAction?.actionId || null,
                secondaryProviderActionTarget: secondaryProviderAction?.target || null,
                secondaryProviderActionDigest: secondaryProviderAction?.digest || null,
                secondaryProviderActionInputDigest: secondaryProviderAction && 'inputDigest' in secondaryProviderAction.params
                  ? secondaryProviderAction.params.inputDigest
                  : null,
                terminalEvidencePersistenceFailed: Boolean(finalizationError),
              },
            });
          } catch (error) {
            finalizationError ||= error;
            console.error('[run-center] failed to finish run:', error);
          }
        }
        unregisterPreparedExecutionContexts();
        unregisterExecutionContexts();
        if (executionStarted) {
          if (runId) clearActiveRunContext(runId);
        }
        if (finalizationError) {
          throw new Error(
            `运行终态证据持久化失败：${finalizationError instanceof Error ? finalizationError.message : String(finalizationError)}`,
          );
        }
      }
      } finally {
        releaseLaunch();
        if (planReserved) activeRunPlansRef.current.delete(runReservationToken);
        activeCanvasRunsRef.current.delete(runControl);
        const hasActiveRuns = activeCanvasRunsRef.current.size > 0;
        setIsRunning(hasActiveRuns);
        if (!hasActiveRuns) useRunBusStore.getState().setBatchProgress(0, 0);
      }
    },
    [authorizeRunNodes, captureRunExecutionSnapshot]
  );

  const handleRunAll = useCallback(async () => {
    if (isRunning) return;
    const plannedSubgraph = excludeRandomRouteBranchDescendants(nodes, edges);
    const order = topologicalSort(plannedSubgraph.nodes, plannedSubgraph.edges, EXECUTABLE_NODE_TYPES);
    if (order.length === 0) {
      alert('画布上没有可执行节点');
      return;
    }
    await runNodesByOrder(nodes, edges, { actionKind: 'run-all' });
  }, [isRunning, nodes, edges, runNodesByOrder]);

  // 组执行: 仅在选中的节点子集上运行(仅保留子集内部边作为依赖)
  const handleRunGroup = useCallback(
    async (ids: string[], options: RunNodesByOrderOptions = {}) => {
      const idSet = new Set(ids);
      const subNodes = nodes.filter((n) => idSet.has(n.id));
      const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
      const executable = subNodes.filter((n) => n.type && EXECUTABLE_NODE_TYPES.has(n.type));
      if (executable.length === 0) {
        alert('所选节点中没有可执行节点');
        return 0;
      }
      return runNodesByOrder(subNodes, subEdges, {
        ...options,
        preflightContextNodes: options.preflightContextNodes || nodes,
        preflightContextEdges: options.preflightContextEdges || edges,
        preflightScopeMode: options.preflightScopeMode || 'selection-input-context',
        actionKind: options.actionKind || (executable.length === 1 ? 'run-single' : 'run-group'),
      });
    },
    [nodes, edges, runNodesByOrder]
  );

  useEffect(() => {
    const handleCanvasNodeRunRequest = (event: Event) => {
      const detail = (event as CustomEvent<CanvasNodeRunRequestDetail>).detail;
      const nodeId = String(detail?.nodeId || '').trim();
      const requestId = String(detail?.requestId || '').trim();
      if (!nodeId) return;
      const requestKey = `${loadedCanvasIdRef.current || 'canvas'}:${nodeId}`;
      const retryAfter = Number(canvasNodeRunRetryAfterRef.current.get(requestKey) || 0);
      if (pendingCanvasNodeRunRequestsRef.current.has(requestKey) || retryAfter > Date.now()) {
        detail?.onSettled?.({
          accepted: false,
          error: '相同节点的运行请求正在处理，请勿重复提交。',
        });
        return;
      }
      canvasNodeRunRetryAfterRef.current.delete(requestKey);
      pendingCanvasNodeRunRequestsRef.current.add(requestKey);
      void handleRunGroup([nodeId], {
        actionKind: 'run-single',
        ...(requestId ? { requestId } : {}),
      }).then((count) => {
        if (count > 0) {
          canvasNodeRunRetryAfterRef.current.delete(requestKey);
          detail?.onSettled?.({ accepted: true });
          return;
        }
        canvasNodeRunRetryAfterRef.current.set(requestKey, Date.now() + 2_000);
        detail?.onSettled?.({
          accepted: false,
          error: count === 0
            ? '当前节点不是可执行节点，未启动运行。'
            : '本次运行未启动；请检查运行体检提示，或等待同一节点的现有任务结束后重试。',
        });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        canvasNodeRunRetryAfterRef.current.set(requestKey, Date.now() + 2_000);
        logBus.error(`运行请求未启动：${message}`, '运行');
        detail?.onSettled?.({ accepted: false, error: message });
      }).finally(() => {
        pendingCanvasNodeRunRequestsRef.current.delete(requestKey);
      });
    };
    window.addEventListener(CANVAS_NODE_RUN_REQUEST_EVENT, handleCanvasNodeRunRequest);
    return () => window.removeEventListener(CANVAS_NODE_RUN_REQUEST_EVENT, handleCanvasNodeRunRequest);
  }, [handleRunGroup]);

  useEffect(() => {
    const handleSecondaryProviderActionRequest = (event: Event) => {
      const detail = (event as CustomEvent<CanvasSecondaryProviderActionRequestDetail>).detail;
      const action = validateSecondaryProviderAction(detail?.action);
      if (!action) {
        logBus.warn('次级 Provider action 请求无效，已拒绝运行', '运行体检');
        return;
      }
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const node = currentNodes.find((candidate) => candidate.id === action.nodeId);
      const storedAction = secondaryProviderActionFromNodeData(node?.data);
      if (!node
        || node.type !== action.nodeType
        || storedAction?.requestId !== action.requestId
        || storedAction.digest !== action.digest) {
        logBus.warn('次级 Provider action 已过期或被修改，已拒绝运行', '运行体检');
        return;
      }

      const clearPendingAction = () => {
        setNodes((current) => current.map((candidate) => {
          if (candidate.id !== action.nodeId) return candidate;
          const latestAction = secondaryProviderActionFromNodeData(candidate.data);
          if (latestAction?.requestId !== action.requestId || latestAction.digest !== action.digest) return candidate;
          return {
            ...candidate,
            data: {
              ...(candidate.data as Record<string, unknown>),
              ...secondaryProviderActionNodePatch(null),
            },
          };
        }));
      };

      void runNodesByOrder([node], [], {
        executionOrder: [node.id],
        actionKind: 'run-single',
        requestId: action.requestId,
        preflightContextNodes: currentNodes,
        preflightContextEdges: currentEdges,
        preflightScopeMode: 'selection-input-context',
        secondaryProviderAction: action,
      }).catch((error) => {
        logBus.error(
          `次级 Provider action 运行失败：${error instanceof Error ? error.message : String(error)}`,
          '运行体检',
        );
      }).finally(clearPendingAction);
    };
    window.addEventListener(CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT, handleSecondaryProviderActionRequest);
    return () => window.removeEventListener(CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT, handleSecondaryProviderActionRequest);
  }, [runNodesByOrder, setNodes]);

  const handleRetryProjectRun = useCallback(async (run: import('../types/project').RunDetail, mode: ProjectRunReplayMode) => {
    if (isRunning || !activeId || run.canvasId !== activeId) return 0;
    if (isSecondaryProviderActionRun(run)) {
      logBus.warn('次级 Provider action 不支持普通重试或重放，请从节点原操作重新发起并确认体检', '运行中心');
      return 0;
    }
    const plannedIds = getRunPlannedNodeIds(run);
    const storedPlanEdges = getRunPlannedEdges(run);
    if (mode === 'full-current') {
      const currentIds = new Set(nodes.map((node) => node.id));
      const runnableIds = plannedIds.filter((id) => currentIds.has(id));
      if (!runnableIds.length) return 0;
      const runnableSet = new Set(runnableIds);
      return runNodesByOrder(
        nodes.filter((node) => runnableSet.has(node.id)),
        edges.filter((edge) => runnableSet.has(edge.source) && runnableSet.has(edge.target)),
        {
          parentRunId: run.id,
          replayMode: mode,
          replaySourceRunId: run.id,
          actionKind: 'retry-run',
          evidenceRefs: [{ runId: run.id }],
          preflightContextNodes: nodes,
          preflightContextEdges: edges,
          preflightScopeMode: 'selection-input-context',
        },
      );
    }
    const failedAndDownstream = mode === 'failed-original'
      ? new Set(collectFailedDownstreamNodeIds(run, storedPlanEdges))
      : null;
    const requestedIds = failedAndDownstream
      ? plannedIds.filter((nodeId) => failedAndDownstream.has(nodeId))
      : plannedIds;
    const runtime = buildRunOriginalReplayRuntime(
      run,
      requestedIds,
      `${run.id}-${Date.now()}`,
      nodesRef.current.map((node) => node.id),
    );
    setRunReplayRuntime({ nodes: runtime.nodes, edges: runtime.edges });
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      return await runNodesByOrder(runtime.nodes, runtime.edges, {
        parentRunId: run.id,
        replayMode: mode,
        replaySourceRunId: run.id,
        executionOrder: runtime.executionNodeIds,
        originalNodeIdByRuntimeId: runtime.originalNodeIdByRuntimeId,
        executionContexts: runtime.executionContexts,
        actionKind: mode === 'full-original' ? 'replay-run' : 'retry-run',
        evidenceRefs: [{ runId: run.id }],
      });
    } finally {
      setRunReplayRuntime(null);
    }
  }, [activeId, edges, isRunning, nodes, runNodesByOrder]);

  const executeSubflowNodeReplay = useCallback(async (
    run: import('../types/project').RunDetail,
    nodeRun: import('../types/project').NodeRunSummary,
    sourceAttempt?: import('../types/project').RunAttemptSummary,
  ) => {
    if (isRunning || !activeId || run.canvasId !== activeId) return 0;
    if (isSecondaryProviderActionRun(run)) {
      logBus.warn('次级 Provider action 不支持内部节点重放，请从原操作重新发起', '运行中心');
      return 0;
    }
    const runtime = sourceAttempt
      ? buildRunAttemptOriginalReplayRuntime(
        run,
        nodeRun.id,
        sourceAttempt.id,
        `${run.id}-${sourceAttempt.id}-${Date.now()}`,
        nodesRef.current.map((node) => node.id),
      )
      : buildSubflowNodeRunOriginalReplayRuntime(
        run,
        nodeRun.id,
        `${run.id}-${nodeRun.id}-${Date.now()}`,
        nodesRef.current.map((node) => node.id),
      );
    if (!runtime.parentNodeRun) throw new Error('内部节点重试缺少外层实例记录');
    setRunReplayRuntime({ nodes: runtime.nodes, edges: runtime.edges });
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      return await runNodesByOrder(runtime.nodes, runtime.edges, {
        parentRunId: run.id,
        replayMode: sourceAttempt ? 'attempt-original' : 'subflow-node-original',
        replaySourceRunId: run.id,
        replaySourceAttemptId: sourceAttempt?.id,
        executionOrder: runtime.executionNodeIds,
        originalNodeIdByRuntimeId: runtime.originalNodeIdByRuntimeId,
        actionKind: sourceAttempt ? 'retry-attempt' : 'retry-subflow',
        evidenceRefs: [sourceAttempt
          ? { runId: run.id, nodeRunId: nodeRun.id, attemptId: sourceAttempt.id }
          : { runId: run.id, nodeRunId: nodeRun.id }],
        prepareRunExecution: async (runId) => {
          const sourceParent = runtime.parentNodeRun!;
          const parent = await api.createProjectNodeRun(runId, {
            nodeId: sourceParent.nodeId,
            originalNodeId: sourceParent.originalNodeId || undefined,
            definitionId: sourceParent.definitionId || undefined,
            definitionVersion: sourceParent.definitionVersion || undefined,
            subflowPath: [...sourceParent.subflowPath],
            status: 'running',
            inputSnapshot: sourceParent.inputSnapshot,
          });
          const startedAt = Date.now();
          const attempt = await api.createProjectRunAttempt(runId, parent.id, {
            provider: 'subflow',
            model: sourceParent.definitionId
              ? `${sourceParent.definitionId}@${sourceParent.definitionVersion || 'unknown'}`
              : undefined,
            status: 'running',
            timestamps: { queuedAt: startedAt, startedAt },
          });
          return {
            executionContexts: Object.fromEntries(Object.entries(runtime.executionContexts).map(([runtimeNodeId, context]) => [runtimeNodeId, {
              ...context,
              parentNodeRunId: parent.id,
            }])),
            finalize: async (status) => {
              const finishedAt = Date.now();
              await api.finalizeProjectNodeRunAttempt(runId, parent.id, attempt.id, {
                status,
                timestamps: { finishedAt },
                error: status === 'succeeded'
                  ? null
                  : {
                    kind: status === 'stopped' ? 'cancelled' : 'protocol',
                    message: status === 'stopped'
                      ? `内部节点重试已停止: ${runtime.sourceNodeRun.originalNodeId || runtime.sourceNodeRun.nodeId}`
                      : `内部节点重试失败: ${runtime.sourceNodeRun.originalNodeId || runtime.sourceNodeRun.nodeId}`,
                    code: status === 'stopped' ? 'SUBFLOW_RETRY_STOPPED' : 'SUBFLOW_RETRY_FAILED',
                    retryable: status !== 'stopped',
                  },
              });
            },
          };
        },
      });
    } finally {
      setRunReplayRuntime(null);
    }
  }, [activeId, isRunning, runNodesByOrder]);

  const handleRetrySubflowNodeRun = useCallback(async (
    run: import('../types/project').RunDetail,
    nodeRun: import('../types/project').NodeRunSummary,
  ) => executeSubflowNodeReplay(run, nodeRun), [executeSubflowNodeReplay]);

  const handleRetryProjectRunAttempt = useCallback(async (
    run: import('../types/project').RunDetail,
    nodeRun: import('../types/project').NodeRunSummary,
    attempt: import('../types/project').RunAttemptSummary,
  ) => {
    if (isSecondaryProviderActionRun(run)) {
      logBus.warn('次级 Provider action 不支持 Attempt 重放，请从节点原操作重新发起', '运行中心');
      return 0;
    }
    if (nodeRun.parentNodeRunId) return executeSubflowNodeReplay(run, nodeRun, attempt);
    if (isRunning || !activeId || run.canvasId !== activeId) return 0;
    const runtime = buildRunAttemptOriginalReplayRuntime(
      run,
      nodeRun.id,
      attempt.id,
      `${run.id}-${attempt.id}-${Date.now()}`,
      nodesRef.current.map((node) => node.id),
    );
    setRunReplayRuntime({ nodes: runtime.nodes, edges: runtime.edges });
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      return await runNodesByOrder(runtime.nodes, runtime.edges, {
        parentRunId: run.id,
        replayMode: 'attempt-original',
        replaySourceRunId: run.id,
        replaySourceAttemptId: attempt.id,
        executionOrder: runtime.executionNodeIds,
        originalNodeIdByRuntimeId: runtime.originalNodeIdByRuntimeId,
        executionContexts: runtime.executionContexts,
        actionKind: 'retry-attempt',
        evidenceRefs: [{ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id }],
      });
    } finally {
      setRunReplayRuntime(null);
    }
  }, [activeId, executeSubflowNodeReplay, isRunning, runNodesByOrder]);

  const handleAcceptRunIntent = useCallback(async (sourceIntent: import('../types/project').RunIntent) => {
    let intent = sourceIntent;
    const markStale = async (reason: string) => {
      const expectedQueueRevision = Number(intent.queueRevision);
      if (!['pending', 'accepted'].includes(intent.status)
        || !Number.isSafeInteger(expectedQueueRevision)
        || expectedQueueRevision < 1) {
        logBus.warn(`${reason}；权威队列 revision 不可用，未执行盲写`, '协作运行');
        return;
      }
      try {
        intent = await api.updateCollaborationRunIntent(intent.id, intent.projectId, intent.canvasId, {
          status: 'stale',
          expectedQueueRevision,
        });
      } catch (error) {
        console.warn('[run-intent] exact stale transition lost a queue race:', error);
      }
      logBus.warn(reason, '协作运行');
    };

    try {
      if (intent.status === 'pending') {
        const expectedQueueRevision = Number(intent.queueRevision);
        if (!Number.isSafeInteger(expectedQueueRevision) || expectedQueueRevision < 1) {
          logBus.warn('运行请求缺少权威队列 revision，不能确认', '协作运行');
          return false;
        }
        intent = await api.acceptCollaborationRunIntent(intent.id, intent.projectId, intent.canvasId, {
          expectedQueueRevision,
        });
      }
      if (intent.status !== 'accepted') return false;

      if (!activeId
        || activeProjectIdRef.current !== intent.projectId
        || intent.canvasId !== activeId) {
        await markStale('远程运行请求对应的项目或画布已经变化，已标记为过期');
        return false;
      }

      // Read only the host-authorized, pinned historical document that created
      // the intent. The visible canvas may already be rN+1; neither it nor a
      // missing history row may be substituted for the confirmed rN input.
      let authoritative: Awaited<ReturnType<typeof api.getCollaborationRunIntentSnapshot>>;
      try {
        authoritative = await api.getCollaborationRunIntentSnapshot(
          intent.id,
          intent.projectId,
          intent.canvasId,
          intent.canvasRevision,
        );
      } catch (error) {
        if (error instanceof api.ApiRequestError && [404, 409].includes(error.status)) {
          await markStale('远程运行请求的精确历史画布快照不可用，已标记为过期');
          return false;
        }
        throw error;
      }
      if (authoritative.projectId !== intent.projectId
        || authoritative.canvasId !== intent.canvasId
        || Number(authoritative.revision) !== intent.canvasRevision) {
        await markStale('远程运行请求的精确历史画布快照不匹配，已标记为过期');
        return false;
      }
      const authoritativeNodes = Array.isArray(authoritative.nodes) ? authoritative.nodes as Node[] : [];
      const authoritativeEdges = Array.isArray(authoritative.edges) ? authoritative.edges as Edge[] : [];
      const planned = excludeRandomRouteBranchDescendants(authoritativeNodes, authoritativeEdges);
      const requestedIds = intent.nodeIds.filter((id) => planned.nodes.some((node) => node.id === id));
      if (intent.nodeIds.length > 0 && requestedIds.length !== intent.nodeIds.length) {
        await markStale('远程运行请求包含权威快照中已不存在的节点，已标记为过期');
        return false;
      }
      const requestedSet = new Set(requestedIds.length ? requestedIds : planned.nodes.map((node) => node.id));
      const requestedNodes = planned.nodes.filter((node) => requestedSet.has(node.id));
      const requestedEdges = planned.edges.filter((edge) => requestedSet.has(edge.source) && requestedSet.has(edge.target));
      const executionOrder = topologicalSort(requestedNodes, requestedEdges, EXECUTABLE_NODE_TYPES);
      if (!executionOrder.length) {
        await markStale('远程运行请求没有可执行节点，已标记为过期');
        return false;
      }

      const runtime = buildFrozenRunIntentRuntime(
        authoritativeNodes,
        authoritativeEdges,
        executionOrder,
        `${intent.id}-${intent.queueRevision || 0}`,
        nodesRef.current.map((node) => node.id),
      );
      setRunReplayRuntime({ nodes: runtime.nodes, edges: runtime.edges });
      try {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        const autoApproved = intent.confirmationRequired === false;
        const count = await runNodesByOrder(runtime.nodes, runtime.edges, {
          runIntentId: intent.id,
          actionKind: autoApproved ? 'run-intent-auto-approved' : 'run-intent',
          requestId: intent.id,
          runIntentSnapshot: intent,
          suppressBlockedPreflightPresentation: autoApproved,
          executionOrder: runtime.executionNodeIds,
          originalNodeIdByRuntimeId: runtime.originalNodeIdByRuntimeId,
          executionContexts: runtime.executionContexts,
          cost: intent.estimatedCostKnown === true && intent.estimatedCost != null
            ? { known: true, amount: Math.max(0, Number(intent.estimatedCost) || 0), currency: 'USD' }
            : { known: false },
          expectedRevision: intent.canvasRevision,
          preflightContextNodes: runtime.nodes,
          preflightContextEdges: runtime.edges,
          preflightScopeMode: 'exact-plan',
        });
        return count > 0;
      } finally {
        setRunReplayRuntime(null);
      }
    } catch (error) {
      console.warn('[run-intent] host execution failed closed:', error);
      logBus.warn(`远程运行请求未执行：${error instanceof Error ? error.message : String(error)}`, '协作运行');
      return false;
    }
  }, [activeId, runNodesByOrder]);

  useEffect(() => {
    if (!activeId
      || !activeProjectId
      || !loaded
      || loadedCanvasId !== activeId) return undefined;
    let stopped = false;
    let timer: number | null = null;
    let idleStreak = 0;

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(poll, Math.max(0, delayMs));
    };

    const wake = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (stopped || document.visibilityState !== 'visible') return;
      idleStreak = 0;
      schedule(0);
    };

    const poll = async () => {
      timer = null;
      if (stopped || document.visibilityState !== 'visible') return;
      let hadActivity = false;
      let failed = false;
      try {
        if (!runIntentWorkerBusyRef.current && !runLaunchQueueRef.current.busy) {
          const now = Date.now();
          const intents = await api.listCollaborationRunIntents('accepted', activeProjectId, activeId);
          const candidate = intents
            .filter((item) => item.confirmationRequired === false
              && (!item.nextAttemptAt || item.nextAttemptAt <= now)
              && (runIntentRetryAfterRef.current.get(item.id) || 0) <= now)
            .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0];
          if (candidate) {
            hadActivity = true;
            runIntentWorkerBusyRef.current = true;
            try {
              const completed = await handleAcceptRunIntent(candidate);
              if (completed) runIntentRetryAfterRef.current.delete(candidate.id);
              else runIntentRetryAfterRef.current.set(candidate.id, Date.now() + 30_000);
            } finally {
              runIntentWorkerBusyRef.current = false;
            }
          }
        }
      } catch (error) {
        console.warn('[run-intent] automatic worker poll failed:', error);
        failed = true;
      } finally {
        if (!stopped && document.visibilityState === 'visible') {
          const decision = nextAdaptivePollDecision({
            baseMs: 2_500,
            maxMs: 15_000,
            idleStreak,
            hadActivity,
            failed,
          });
          idleStreak = decision.idleStreak;
          schedule(decision.delayMs);
        }
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [activeId, activeProjectId, handleAcceptRunIntent, loaded, loadedCanvasId]);

  // ===== ALT+拖动复制节点 =====
  // 思路: dragStart 时在原位插入占位克隆(临时ID),用户拖动过程中原位看起来有节点不动;
  // dragStop 时做 ID 互换: 占位克隆 → 恢复原始ID(保留连线), 被拖走的原节点 → 分配新ID(sanitize)
  // 最终效果: 原节点留在原位(保留连线和数据), 新复制节点在拖放位置
  const onNodeDragStart = useCallback(
    (e: React.MouseEvent | MouseEvent, node: Node) => {
      clearEdgeMotionReleaseTimer();
      isDraggingRef.current = true;
      setNodeDragging(true);
      altDragCloneRef.current = null;
      if (!isAltModifierActive(e, altNodeDragIntentRef.current || altKeyPressedRef.current)) return;
      // ALT 按下: 确定被拖动的节点集合
      const selected = nodes.filter((n) => n.selected);
      const targets = selected.length > 0 && selected.some((n) => n.id === node.id)
        ? selected
        : [node];
      // 在原位创建占位克隆(临时 ID, 同样外观 / 数据, 但不选中)
      const stamp = Date.now();
      const placeholderIds = new Map<string, string>();
      const copyIds = new Set<string>();
      const placeholders: Node[] = [];
      targets.forEach((n, idx) => {
        const phId = `_alt-ph-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
        placeholderIds.set(n.id, phId);
        copyIds.add(n.id);
        placeholders.push({
          ...n,
          id: phId,
          selected: false,
          position: { ...n.position },
          data: JSON.parse(JSON.stringify(n.data || {})),
        } as Node);
      });
      // 占位节点代表留在原位的原实体，继续保留原 entityUid；被拖走的节点
      // 从这一刻起就是新副本，必须在二者同时进入状态前获得全新的 entityUid。
      setNodes((prev) => [
        ...prev.map((existing) => (
          copyIds.has(existing.id) ? cloneCanvasEntityAsNew(existing, 'node') : existing
        )),
        ...placeholders,
      ]);
      // 立即将连接原节点的边转移到占位克隆上,这样拖动过程中连线留在原位不动
      setEdges((prev) => prev.map((e2) => {
        let s = e2.source;
        let t = e2.target;
        const phS = placeholderIds.get(s);
        const phT = placeholderIds.get(t);
        if (!phS && !phT) return e2;
        return { ...e2, source: phS || s, target: phT || t };
      }));
      altDragCloneRef.current = { placeholderIds };
    },
    [clearEdgeMotionReleaseTimer, nodes]
  );

  // ===== 节点组(GroupBox) =====
  // 拖动组节点时使用,记录上一帧位置以计算 delta 同步偏移成员节点
  // memberIds 在拖动开始时根据当前几何关系动态计算(不依赖创组时快照)
  const groupDragRef = useRef<{
    groupId: string;
    lastX: number;
    lastY: number;
    memberIds: string[];
  } | null>(null);

  // 创建节点组: 计算 bounding box, 生成 type='groupBox' 节点装进 nodes
  const handleCreateGroup = useCallback(
    (ids: string[]) => {
      // 排除 groupBox 自身(不允许嵌套组)
      const targets = nodes.filter((n) => ids.includes(n.id) && n.type !== 'groupBox');
      if (targets.length < 1) {
        alert('请先选中要打组的节点');
        return;
      }
      const PAD = 30;
      const HEADER = 40;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of targets) {
        const w = (n as any).width || (n as any).measured?.width || 200;
        const h = (n as any).height || (n as any).measured?.height || 100;
        const x = n.position.x;
        const y = n.position.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
      }
      const groupX = minX - PAD;
      const groupY = minY - PAD - HEADER;
      const groupW = (maxX - minX) + PAD * 2;
      const groupH = (maxY - minY) + PAD * 2 + HEADER;
      const newId = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // 随机选一个颜色
      const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      const groupNode: Node = {
        id: newId,
        type: 'groupBox',
        position: { x: groupX, y: groupY },
        data: {
          name: DEFAULT_GROUP_NAME,
          color,
          memberIds: targets.map((n) => n.id),
          width: groupW,
          height: groupH,
        },
        // 置于普通节点之下(负 1000 避免选中时 zIndex 被括号调高)
        zIndex: -1000,
        draggable: true,
        selectable: true,
        deletable: true,
        // 可连接: 右侧 source handle 能把「组内所有节点的聚合输出」传给组外
        connectable: true,
      } as Node;
      // 插入到最前面,确保渲染顺序在底(配合 zIndex 负值)
      setNodes((prev) => [
        ...assignActiveNodeSerials([groupNode], prev),
        ...prev.map((n) => ({ ...n, selected: false })),
      ]);
    },
    [nodes, assignActiveNodeSerials]
  );

  const getGroupMemberIds = useCallback((groupId: string, sourceNodes: Node[] = nodesRef.current): string[] => {
    const groupNode = sourceNodes.find((node) => node.id === groupId && node.type === 'groupBox');
    if (!groupNode) return [];
    const memberIds = new Set<string>(
      Array.isArray((groupNode.data as any)?.memberIds)
        ? (groupNode.data as any).memberIds.filter((value: unknown): value is string => typeof value === 'string' && !!value)
        : [],
    );
    const groupRect = rectOf(groupNode);
    for (const node of sourceNodes) {
      if (node.id === groupId || node.type === 'groupBox' || node.id === BULK_PHANTOM_ID) continue;
      const rect = rectOf(node);
      const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      if (
        center.x >= groupRect.x &&
        center.x <= groupRect.x + groupRect.w &&
        center.y >= groupRect.y &&
        center.y <= groupRect.y + groupRect.h
      ) {
        memberIds.add(node.id);
      }
    }
    return Array.from(memberIds);
  }, []);

  const handleDeleteGroupsWithContents = useCallback((groupIds: string[]) => {
    const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
    if (uniqueGroupIds.length === 0) return;
    setNodes((prev) => {
      const removeIds = new Set<string>(uniqueGroupIds);
      uniqueGroupIds.forEach((groupId) => {
        getGroupMemberIds(groupId, prev).forEach((memberId) => removeIds.add(memberId));
      });
      const idsToRemove = Array.from(removeIds);
      if (idsToRemove.length === 0) return prev;
      markManualNodeDeletion(idsToRemove, prev);
      setEdges((eds) =>
        eds.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target))
      );
      logBus.success(`已删除 ${uniqueGroupIds.length} 个组及 ${Math.max(0, idsToRemove.length - uniqueGroupIds.length)} 个组内节点`, '节点组');
      return prev.filter((node) => !removeIds.has(node.id));
    });
  }, [getGroupMemberIds, markManualNodeDeletion]);

  // 监听 GroupBox 的执行请求 / 删除请求
  const executeReq = useGroupBusStore((s) => s.executeReq);
  const deleteReq = useGroupBusStore((s) => s.deleteReq);
  const clearExecuteReq = useGroupBusStore((s) => s.clearExecute);
  const clearDeleteReq = useGroupBusStore((s) => s.clearDelete);

  useEffect(() => {
    if (!executeReq) return;
    handleRunGroup(executeReq.memberIds);
    clearExecuteReq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeReq?.ts]);

  useEffect(() => {
    if (!deleteReq) return;
    setNodes((prev) => {
      if (prev.some((n) => n.id === deleteReq.groupId)) {
        markManualNodeDeletion([deleteReq.groupId], prev);
      }
      return prev.filter((n) => n.id !== deleteReq.groupId);
    });
    clearDeleteReq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteReq?.ts]);

  const handleCancelRun = useCallback(() => {
    if (activeCanvasRunsRef.current.size === 0) return;
    for (const runControl of activeCanvasRunsRef.current) runControl.cancelled = true;
    const cancellation = useRunBusStore.getState().cancelAll();
    for (const runControl of activeCanvasRunsRef.current) runControl.cancelPersistence = cancellation;
  }, []);

  const handleAlignSelection = useCallback((action: NodeAlignAction, ids?: string[]) => {
    const targetIds = (ids && ids.length > 0)
      ? ids
      : nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    if (targetIds.length === 0) {
      logBus.warn('请先选择要对齐的节点', '对齐');
      return;
    }
    const result = applyNodeAlignment(nodesRef.current, targetIds, action, {
      grid: SNAP_GRID,
      gridGap: 48,
      alignGap: 32,
      edges: edgesRef.current,
    });
    if (!result.changed) {
      logBus.info('选区已经足够整齐，未移动节点', '对齐');
      return;
    }
    setGuides({ vertical: [], horizontal: [] });
    setNodes(result.nodes);
    logBus.success(`已整理 ${result.movedIds.length} 个节点`, '对齐');
  }, []);

  // ===== 智能对齐辅助线 =====
  const onNodeDrag = useCallback(
    (_e: any, node: Node) => {
      // 拖动 GroupBox 节点: 联动所有成员节点同步偏移
      if (node.type === 'groupBox') {
        const ref = groupDragRef.current;
        if (!ref || ref.groupId !== node.id) {
          // 首帧: 根据当前几何位置重新计算哪些节点在组矩形内
          // (节点中心点在组 bbox 内则视为成员,不再依赖创组时的静态 memberIds)
          const gx = node.position.x;
          const gy = node.position.y;
          const gw =
            (node.data as any)?.width ||
            (node as any).width ||
            (node as any).measured?.width ||
            0;
          const gh =
            (node.data as any)?.height ||
            (node as any).height ||
            (node as any).measured?.height ||
            0;
          const liveMembers: string[] = [];
          for (const n of nodes) {
            if (n.id === node.id) continue;
            if (n.type === 'groupBox') continue; // 不嵌套组
            const nw =
              (n as any).width || (n as any).measured?.width || 200;
            const nh =
              (n as any).height || (n as any).measured?.height || 100;
            const cx = n.position.x + nw / 2;
            const cy = n.position.y + nh / 2;
            if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
              liveMembers.push(n.id);
            }
          }
          groupDragRef.current = {
            groupId: node.id,
            lastX: node.position.x,
            lastY: node.position.y,
            memberIds: liveMembers,
          };
          return;
        }
        const dx = node.position.x - ref.lastX;
        const dy = node.position.y - ref.lastY;
        if (dx === 0 && dy === 0) return;
        ref.lastX = node.position.x;
        ref.lastY = node.position.y;
        if (ref.memberIds.length === 0) return;
        const idSet = new Set(ref.memberIds);
        setNodes((prev) =>
          prev.map((n) =>
            idSet.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n
          )
        );
        return;
      }
      if (!snapEnabled) return;
      const w = (node as any).width || (node as any).measured?.width || 200;
      const h = (node as any).height || (node as any).measured?.height || 100;
      const tx = node.position.x;
      const ty = node.position.y;
      const targets = { L: tx, C: tx + w / 2, R: tx + w, T: ty, M: ty + h / 2, B: ty + h };
      const vGuides = new Set<number>();
      const hGuides = new Set<number>();
      let snapDX: number | null = null;
      let snapDY: number | null = null;
      let bestVDiff = ALIGN_THRESHOLD;
      let bestHDiff = ALIGN_THRESHOLD;
      for (const other of nodes) {
        if (other.id === node.id) continue;
        const ow = (other as any).width || (other as any).measured?.width || 200;
        const oh = (other as any).height || (other as any).measured?.height || 100;
        const ox = other.position.x;
        const oy = other.position.y;
        const oVals = { L: ox, C: ox + ow / 2, R: ox + ow, T: oy, M: oy + oh / 2, B: oy + oh };
        // 垂直辅助线(列对齐): L/C/R 对 L/C/R
        for (const tk of ['L', 'C', 'R'] as const) {
          for (const ok of ['L', 'C', 'R'] as const) {
            const diff = Math.abs(targets[tk] - oVals[ok]);
            if (diff < ALIGN_THRESHOLD) {
              vGuides.add(oVals[ok]);
              if (diff < bestVDiff) {
                bestVDiff = diff;
                snapDX = oVals[ok] - targets[tk];
              }
            }
          }
        }
        // 水平辅助线(行对齐): T/M/B 对 T/M/B
        for (const tk of ['T', 'M', 'B'] as const) {
          for (const ok of ['T', 'M', 'B'] as const) {
            const diff = Math.abs(targets[tk] - oVals[ok]);
            if (diff < ALIGN_THRESHOLD) {
              hGuides.add(oVals[ok]);
              if (diff < bestHDiff) {
                bestHDiff = diff;
                snapDY = oVals[ok] - targets[tk];
              }
            }
          }
        }
      }
      setGuides({ vertical: Array.from(vGuides), horizontal: Array.from(hGuides) });
      // 弱吸附:调整当前拖拽节点位置
      if (snapDX !== null || snapDY !== null) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === node.id
              ? {
                  ...n,
                  position: {
                    x: tx + (snapDX ?? 0),
                    y: ty + (snapDY ?? 0),
                  },
                }
              : n
          )
        );
      }
    },
    [nodes, snapEnabled]
  );

  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    isDraggingRef.current = false;
    altNodeDragIntentRef.current = false;
    setDragSaveTick((tick) => tick + 1);
    releaseEdgeMotionSoon(setNodeDragging);
    setGuides({ vertical: [], horizontal: [] });

    // ===== ALT+拖动结束: ID 互换 =====
    // 占位克隆(临时ID,在原位) → 恢复为原始ID(边自动留在原位)
    // 原节点(原始ID,已拖到新位置) → 分配新ID + sanitize(变成干净副本)
    if (altDragCloneRef.current) {
      const { placeholderIds } = altDragCloneRef.current;
      altDragCloneRef.current = null;
      const origIds = new Set(placeholderIds.keys());
      // phId → origId 反查表
      const phToOrig = new Map<string, string>();
      placeholderIds.forEach((phId, origId) => phToOrig.set(phId, origId));
      // 运行时字段黑名单
      const RUNTIME_KEYS = ['status', 'taskId', 'progress', 'error', 'isRunning', 'isPolling', 'pollingTimer'];
      const sanitize = (data: any) => {
        const next: any = { ...(data || {}) };
        for (const k of RUNTIME_KEYS) delete next[k];
        next.status = 'idle';
        return next;
      };
      const stamp = Date.now();
      const newIdMap = new Map<string, string>(); // origId -> newCopyId

      setNodes((prev) => {
        const copyDrafts: Node[] = [];
        const copyIds = new Set<string>();
        const mapped = prev.map((n) => {
          // 占位克隆 → 恢复原始ID
          const restoreId = phToOrig.get(n.id);
          if (restoreId) {
            return { ...n, id: restoreId };
          }
          // 被拖走的原节点 → 新ID + sanitize
          if (origIds.has(n.id)) {
            const newId = `${n.type}-${stamp}-${newIdMap.size}-${Math.random().toString(36).slice(2, 5)}`;
            newIdMap.set(n.id, newId);
            const copyNode = { ...n, id: newId, selected: true, data: sanitize(n.data) } as Node;
            copyDrafts.push(copyNode);
            copyIds.add(newId);
            return copyNode;
          }
          return n;
        });
        if (copyDrafts.length === 0) return mapped;
        const baseNodes = mapped.filter((n) => !copyIds.has(n.id));
        const assignedCopies = assignActiveNodeSerials(copyDrafts, baseNodes);
        const assignedById = new Map(assignedCopies.map((copy) => [copy.id, copy]));
        return mapped.map((n) => assignedById.get(n.id) || n);
      });

      // 边处理: dragStart 时边已从 origId 转移到 phId,现在需恢复为 origId + 复制内部边给新节点
      setEdges((prev) => {
        // 1. phId → origId 恢复
        const restored = prev.map((e2) => {
          const origS = phToOrig.get(e2.source);
          const origT = phToOrig.get(e2.target);
          if (!origS && !origT) return e2;
          return { ...e2, source: origS || e2.source, target: origT || e2.target };
        });
        // 2. 复制内部边(原节点之间的边 → 新节点之间)
        const cloneEdges = restored
          .filter((e2) => origIds.has(e2.source) && origIds.has(e2.target))
          .map((e2, idx) => {
            const s = newIdMap.get(e2.source);
            const t = newIdMap.get(e2.target);
            if (!s || !t) return null;
            return cloneCanvasEntityAsNew({
              ...e2,
              id: `e-alt-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
              source: s,
              target: t,
            } as Edge, 'edge');
          })
          .filter(Boolean) as Edge[];
        return cloneEdges.length > 0 ? [...restored, ...cloneEdges] : restored;
      });
      groupDragRef.current = null;
      return;
    }

    // 拖动组结束: 将最新的几何成员同步到 data.memberIds(供GroupBoxNode显示节点数/执行使用)
    if (node?.type === 'groupBox' && groupDragRef.current?.groupId === node.id) {
      const latestIds = groupDragRef.current.memberIds;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...((n.data as any) || {}), memberIds: latestIds } }
            : n
        )
      );
    }
  
    // 标记被用户手动拖动过的自动外挂 OutputNode (id 以 'output-auto-' 开头),
    // 后续「网格重排」useEffect 会检测 data.userMoved 跳过这些节点, 保留用户位置。
    // 多选拖动场景: xyflow 只传主拖 node, 本函数连同所有 selected 且带该前缀的节点都打上标记。
    setNodes((prev) => {
      const selectedAutoOutputIds = new Set<string>();
      for (const n of prev) {
        if (n.selected && typeof n.id === 'string' && n.id.startsWith('output-auto-')) {
          selectedAutoOutputIds.add(n.id);
        }
      }
      if (typeof node?.id === 'string' && node.id.startsWith('output-auto-')) {
        selectedAutoOutputIds.add(node.id);
      }
      if (selectedAutoOutputIds.size === 0) return prev;
      return prev.map((n) =>
        selectedAutoOutputIds.has(n.id)
          ? { ...n, data: { ...((n.data as any) || {}), userMoved: true } }
          : n
      );
    });
  
    groupDragRef.current = null;
  }, []);

  // ===== 右键菜单 =====
  const clearSelectionContextSubmenuCloseTimer = useCallback(() => {
    if (selectionContextSubmenuCloseTimerRef.current) {
      window.clearTimeout(selectionContextSubmenuCloseTimerRef.current);
      selectionContextSubmenuCloseTimerRef.current = null;
    }
  }, []);

  const openSelectionContextSubmenu = useCallback((submenu: 'align') => {
    clearSelectionContextSubmenuCloseTimer();
    setSelectionContextSubmenu(submenu);
  }, [clearSelectionContextSubmenuCloseTimer]);

  const scheduleSelectionContextSubmenuClose = useCallback(() => {
    clearSelectionContextSubmenuCloseTimer();
    selectionContextSubmenuCloseTimerRef.current = window.setTimeout(() => {
      selectionContextSubmenuCloseTimerRef.current = null;
      setSelectionContextSubmenu(null);
    }, 120);
  }, [clearSelectionContextSubmenuCloseTimer]);

  useEffect(() => () => clearSelectionContextSubmenuCloseTimer(), [clearSelectionContextSubmenuCloseTimer]);

  const closeContextMenu = useCallback(() => {
    clearSelectionContextSubmenuCloseTimer();
    setSelectionContextSubmenu(null);
    setContextMenu(null);
  }, [clearSelectionContextSubmenuCloseTimer]);
  const closePaneMenu = useCallback(() => setPaneMenu(null), []);

  const openNodeContextMenuAt = useCallback(
    (clientX: number, clientY: number, nodeId: string) => {
      const currentNodes = nodesRef.current;
      let ids: string[];
      const currentSelected = currentNodes.filter((n) => n.selected).map((n) => n.id);
      if (currentSelected.includes(nodeId) && currentSelected.length > 1) {
        ids = currentSelected;
      } else {
        setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === nodeId })));
        ids = [nodeId];
      }
      setPaneMenu(null);
      setSelectionContextSubmenu(null);
      setContextMenu({ x: clientX, y: clientY, ids });
    },
    []
  );

  // 选区右键(框选 ≥ 1 个节点后右键)
  const onSelectionContextMenu = useCallback(
    (e: React.MouseEvent, sels: Node[]) => {
      e.preventDefault();
      const ids = sels.map((n) => n.id);
      if (ids.length === 0) return;
      setSelectionContextSubmenu(null);
      setContextMenu({ x: e.clientX, y: e.clientY, ids });
    },
    []
  );

  // 节点上右键: 若未选中则仅选中此节点
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      openNodeContextMenuAt(e.clientX, e.clientY, node.id);
    },
    [openNodeContextMenuAt]
  );

  // ReactFlow 的 onNodeContextMenu 在 input/select/button 等 nodrag 控件上可能不会触发。
  // 用画布根节点捕获阶段兜底：只要右键落在节点内且不是素材预览，就打开原节点菜单。
  const onCanvasContextMenuCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      if (target.closest('[data-resource-context-menu]')) return;
      if (target.closest('[data-drag-source]')) return;
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute('data-id') || '';
      if (!nodeId || nodeId === BULK_PHANTOM_ID) return;
      if (!nodesRef.current.some((n) => n.id === nodeId)) return;
      e.preventDefault();
      e.stopPropagation();
      openNodeContextMenuAt(e.clientX, e.clientY, nodeId);
    },
    [openNodeContextMenuAt]
  );

  // 空白处右键: 弹出快速添加节点菜单(同时关闭选区菜单)
  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (isRadialMenuContextMenuSuppressed()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      setSelectionContextSubmenu(null);
      setContextMenu(null);
      const x = (e as MouseEvent).clientX;
      const y = (e as MouseEvent).clientY;
      setPaneMenu({ x, y });
    },
    [isRadialMenuContextMenuSuppressed]
  );

  // 记录最新选中的节点 id 列表(以便 onSelectionEnd 读取)
  const lastSelectedIdsRef = useRef<string[]>([]);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const onSelectionChange = useCallback(
    ({ nodes: ns }: { nodes: Node[]; edges: Edge[] }) => {
      lastSelectedIdsRef.current = ns.map((n) => n.id);
    },
    []
  );

  const onSelectionStart = useCallback((e: React.MouseEvent) => {
    selectionStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const auditSelectionByDragRect = useCallback((e: React.MouseEvent): string[] | null => {
    const start = selectionStartRef.current;
    if (!start) return null;
    const end = { x: e.clientX, y: e.clientY };
    const screenDx = Math.abs(end.x - start.x);
    const screenDy = Math.abs(end.y - start.y);
    if (screenDx < 6 && screenDy < 6) return null;
    const a = screenToFlowPosition(start);
    const b = screenToFlowPosition(end);
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
    if (rect.w < 2 && rect.h < 2) return null;
    return nodesRef.current
      .filter((node) => node.id !== BULK_PHANTOM_ID)
      .filter((node) => rectsIntersect(rectOf(node), rect, 0))
      .map((node) => node.id);
  }, [screenToFlowPosition]);

  // 框选结束: 若选中 ≥ 2 个节点则自动弹出菜单
  const onSelectionEnd = useCallback((e: React.MouseEvent) => {
    const auditedIds = auditSelectionByDragRect(e);
    selectionStartRef.current = null;
    const ids = auditedIds || lastSelectedIdsRef.current;
    if (!ids || ids.length < 2) return;
    if (auditedIds) {
      const auditedSet = new Set(auditedIds);
      lastSelectedIdsRef.current = auditedIds;
      setNodes((prev) => prev.map((node) => ({ ...node, selected: auditedSet.has(node.id) })));
    }
    const x = (e as any)?.clientX ?? 0;
    const y = (e as any)?.clientY ?? 0;
    if (!x && !y) return;
    setSelectionContextSubmenu(null);
    setContextMenu({ x, y, ids });
  }, [auditSelectionByDragRect]);

  // 暴露 addNode 给父组件
  useEffect(() => {
    if (onAddNodeRef) {
      onAddNodeRef.current = addNode;
    }
    return () => {
      if (onAddNodeRef) onAddNodeRef.current = null;
    };
  }, [onAddNodeRef, addNode]);

  useEffect(() => {
    if (onInsertWorkflowRef) {
      onInsertWorkflowRef.current = insertWorkflowFragment;
    }
    return () => {
      if (onInsertWorkflowRef) onInsertWorkflowRef.current = null;
    };
  }, [onInsertWorkflowRef, insertWorkflowFragment]);

  useEffect(() => {
    const findSourceFromElement = (target: EventTarget | null) => (
      target instanceof Element ? target.closest('[data-drag-source]') as HTMLElement | null : null
    );
    const findDragOutSourceAtPoint = (target: EventTarget | null, point?: DragOutPoint | null) => {
      const direct = findSourceFromElement(target);
      if (direct) return direct;
      const x = Number(point?.clientX ?? point?.x);
      const y = Number(point?.clientY ?? point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.hasAttribute('data-drag-source')) return el;
        const closest = el.closest('[data-drag-source]') as HTMLElement | null;
        if (closest) return closest;
      }
      return null;
    };
    type DragOutPoint = { clientX?: number; clientY?: number; x?: number; y?: number };
    type DragOutCandidate = {
      source: HTMLElement;
      kind: string;
      url: string;
      filename: string;
      startX: number;
      startY: number;
      started: boolean;
      sawChord: boolean;
    };
    let candidate: DragOutCandidate | null = null;
    let suppressContextMenuUntil = 0;
    let dragOutRequestSeq = 0;
    let lastFeedbackPoint = {
      x: typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : 0,
      y: typeof window !== 'undefined' ? Math.round(window.innerHeight / 2) : 0,
    };
    const pendingRequestIds = new Set<string>();

    const clearFeedbackTimer = () => {
      if (fileDragOutFeedbackTimerRef.current) {
        window.clearTimeout(fileDragOutFeedbackTimerRef.current);
        fileDragOutFeedbackTimerRef.current = null;
      }
    };
    const showDragOutFeedback = (
      point: DragOutPoint | null | undefined,
      tone: FileDragOutFeedback['tone'],
      title: string,
      detail: string,
      duration = 2600,
    ) => {
      const x = Number(point?.clientX ?? point?.x ?? lastFeedbackPoint.x);
      const y = Number(point?.clientY ?? point?.y ?? lastFeedbackPoint.y);
      lastFeedbackPoint = {
        x: Number.isFinite(x) ? x : lastFeedbackPoint.x,
        y: Number.isFinite(y) ? y : lastFeedbackPoint.y,
      };
      setFileDragOutFeedback({
        ...lastFeedbackPoint,
        tone,
        title,
        detail,
      });
      clearFeedbackTimer();
      fileDragOutFeedbackTimerRef.current = window.setTimeout(() => {
        setFileDragOutFeedback(null);
        fileDragOutFeedbackTimerRef.current = null;
      }, duration);
    };

    const stopPointer = (event: PointerEvent | DragEvent | MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      (event as any).stopImmediatePropagation?.();
    };
    const materialInfoFromSource = (source: HTMLElement | null) => {
      if (!source) return null;
      const kind = source.getAttribute('data-drag-kind') || '';
      const url = source.getAttribute('data-drag-url') || '';
      if (!['image', 'video', 'audio'].includes(kind) || !url) return null;
      const filename = source.getAttribute('data-resource-title') || fileNameFromUrl(url) || `${kind}-${Date.now()}`;
      return { kind, url, filename };
    };
    const armSource = (source: HTMLElement) => {
      source.setAttribute('draggable', 'true');
      source.classList.add('nodrag', 'nopan');
    };
    const clearCandidate = () => {
      candidate = null;
      setFileDragOutActive(false);
      document.body.classList.remove('t8-file-drag-out-active');
    };
    const setChordSeen = (event?: DragOutPoint | null) => {
      if (!candidate) return;
      const firstChord = !candidate.sawChord;
      candidate.sawChord = true;
      suppressContextMenuUntil = Date.now() + 900;
      setFileDragOutActive(true);
      document.body.classList.add('t8-file-drag-out-active');
      if (firstChord) {
        showDragOutFeedback(
          event,
          'info',
          '检测到左键+右键',
          '继续拖动，会尝试把素材拖到系统文件夹。',
          1400,
        );
      }
    };
    const startNativeDragOut = (event: PointerEvent | DragEvent) => {
      if (!candidate || candidate.started) return false;
      setChordSeen(event);
      if (!window.t8pc?.dragFileOut) {
        candidate.started = true;
        showDragOutFeedback(
          event,
          'warning',
          '普通浏览器限制',
          '当前没有 Electron 原生拖出桥接，左键+右键无法主动发起系统文件拖出；请用桌面版或 npm run electron:dev 测试。',
          4200,
        );
        return false;
      }
      if (!canUseNativeDragOut(candidate.url)) {
        candidate.started = true;
        showDragOutFeedback(
          event,
          'warning',
          '不是本地素材',
          '只支持本机 input/output/thumbnails 里的图片、视频和音频直接拖到文件夹。',
          3600,
        );
        return false;
      }
      stopPointer(event);
      candidate.started = true;
      const requestId = `drag-out-${Date.now()}-${++dragOutRequestSeq}`;
      pendingRequestIds.add(requestId);
      window.t8pc.dragFileOut({
        url: candidate.url,
        filename: candidate.filename,
        kind: candidate.kind,
        requestId,
      });
      showDragOutFeedback(
        event,
        'info',
        '正在交给系统拖出',
        '拖到系统文件夹后松开鼠标；如果失败会在这里显示原因。',
        1800,
      );
      return true;
    };
    const onPointerDown = (event: PointerEvent) => {
      const source = findDragOutSourceAtPoint(event.target, event);
      const info = materialInfoFromSource(source);
      if (!source || !info) return;
      if (event.ctrlKey || event.metaKey) return;
      if (event.button !== 0 && event.button !== 2) return;
      armSource(source);
      candidate = {
        source,
        ...info,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        sawChord: false,
      };
      if (isLeftRightMouseChord(event.buttons)) {
        setChordSeen(event);
        stopPointer(event);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!candidate) return;
      if (event.buttons === 0) {
        clearCandidate();
        return;
      }
      if (!isLeftRightMouseChord(event.buttons)) {
        return;
      }
      setChordSeen(event);
      stopPointer(event);
      const moved = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
      if (moved >= FILE_DRAG_OUT_MOVE_TOLERANCE) {
        startNativeDragOut(event);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!candidate) return;
      if (candidate.sawChord) {
        stopPointer(event);
      }
      clearCandidate();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (candidate?.sawChord) {
        stopPointer(event);
      }
      clearCandidate();
    };
    const onDragStart = (event: DragEvent) => {
      const source = findDragOutSourceAtPoint(event.target, event);
      if (!source || !event.dataTransfer) return;
      const info = materialInfoFromSource(source);
      if (!info) return;
      if (event.ctrlKey || event.metaKey) return;
      const chord = isLeftRightMouseChord((event as any).buttons) || (candidate?.source === source && candidate.sawChord);
      if (!chord) {
        event.preventDefault();
        return;
      }
      if (!candidate || candidate.source !== source) {
        armSource(source);
        candidate = {
          source,
          ...info,
          startX: event.clientX,
          startY: event.clientY,
          started: false,
          sawChord: true,
        };
        setFileDragOutActive(true);
      }
      if (startNativeDragOut(event)) return;
      const absoluteUrl = absoluteMaterialUrl(info.url);
      const mime = mimeForExternalDrag(info.kind, info.url);
      try {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('DownloadURL', `${mime}:${info.filename}:${absoluteUrl}`);
        event.dataTransfer.setData('text/uri-list', absoluteUrl);
        event.dataTransfer.setData('text/plain', absoluteUrl);
      } catch {
        // Some browser shells restrict custom drag formats.
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      const source = findDragOutSourceAtPoint(event.target, event);
      if (!source) return;
      if (candidate?.sawChord || Date.now() < suppressContextMenuUntil) {
        stopPointer(event);
      }
    };
    const offDragOutStatus = window.t8pc?.onDragFileOutStatus?.((status) => {
      if (!status) return;
      if (status.requestId) {
        if (!pendingRequestIds.has(status.requestId)) return;
        pendingRequestIds.delete(status.requestId);
      }
      showDragOutFeedback(
        lastFeedbackPoint,
        status.success ? 'success' : 'error',
        status.success ? '系统拖出已启动' : '系统拖出失败',
        status.message || (status.success ? '拖到文件夹后松开鼠标。' : '请检查素材文件是否还存在。'),
        status.success ? 1800 : 4200,
      );
    });
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('blur', clearCandidate);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('dragstart', onDragStart, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('blur', clearCandidate);
      offDragOutStatus?.();
      clearFeedbackTimer();
      document.body.classList.remove('t8-file-drag-out-active');
      clearCandidate();
    };
  }, []);

  // xyflow 事件
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const { runtimeChanges, visibleChanges } = partitionRunReplayRuntimeNodeChanges(
        changes,
        runReplayRuntimeRef.current?.nodes || [],
        nodesRef.current,
      );
      if (runtimeChanges.length > 0) {
        setRunReplayRuntime((current) => {
          if (!current) return current;
          // Match the mounted runtime by exact node ID. A delayed update from a
          // cleared runtime must be dropped instead of entering the next intent.
          const currentChanges = currentRunReplayRuntimeNodeChanges(current.nodes, runtimeChanges);
          if (currentChanges.length === 0) return current;
          return {
            ...current,
            nodes: applyNodeChanges(currentChanges, current.nodes),
          };
        });
      }
      if (visibleChanges.length === 0) return;
      const removedIds = visibleChanges
        .filter((c) => c.type === 'remove' && typeof (c as any).id === 'string')
        .map((c) => (c as any).id as string);
      if (removedIds.length > 0) {
        markManualNodeDeletion(removedIds, nodesRef.current);
      }
      // 检测拖拽状态,避免拖拽中频繁压栈
      for (const c of visibleChanges) {
        if (c.type === 'position') {
          if ((c as any).dragging === true) {
            isDraggingRef.current = true;
          } else if ((c as any).dragging === false) {
            isDraggingRef.current = false;
          }
        }
      }
      setNodes((nds) => {
        const next = applyNodeChanges(visibleChanges, nds);
        return next;
      });
    },
    [markManualNodeDeletion]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      resetConnectionPanMode();
      // 批量移线过程中禁止普通连接逻辑(不然会多一条重复边)
      if (bulkReconnectRef.current) return;
      const curNodes = nodesRef.current;
      const curEdges = edgesRef.current;
      // 连接有效性校验(防止绕过 isValidConnection 的底层调用)
      const src = curNodes.find((n) => n.id === params.source);
      let tgt = curNodes.find((n) => n.id === params.target);
      if (!isConnectionValid(src, tgt, params, curEdges)) return;

      // ⚡ 组容器连出去重: 如果 source 是 groupBox, 并且组内成员已经独立连到同一个下游 target,
      // 则自动断开那些「成员→target」的重复边, 只保留 group→target
      // (避免同一源头重复传输 + 防止潜在循环依赖)
      if (src && src.type === 'groupBox' && tgt && params.target) {
        const memberIds: string[] = Array.isArray((src.data as any)?.memberIds)
          ? ((src.data as any).memberIds as string[])
          : [];
        if (memberIds.length > 0) {
          const memberSet = new Set(memberIds);
          const dupEdges = curEdges.filter(
            (e) => memberSet.has(e.source) && e.target === params.target,
          );
          if (dupEdges.length > 0) {
            const dupIds = new Set(dupEdges.map((e) => e.id));
            setEdges((eds) => eds.filter((e) => !dupIds.has(e.id)));
          }
        }
      }

      // ⚡ 输出素材节点单输入约束:若目标是 output 且已有连入,
      // 自动派生一个新的 output 节点并把本次连接转向它。
      if (tgt && tgt.type === 'output') {
        const targetHasConn = curEdges.some((e) => e.target === tgt!.id);
        if (targetHasConn) {
          const newId = `output-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          // v1.2.10.5-hotfix3: 使用 placeSingleNode 防重叠（之前硬编码 +360 会重叠）
          const _tgtW = (tgt as any).measured?.width || 320;
          const _desX = (tgt.position?.x ?? 0) + _tgtW + 40;
          const _desY = tgt.position?.y ?? 0;
          const _finalPos = placeSingleNode(_desX, _desY, 'output', curNodes, { source: 'placement:onConnect-dup-output' });
          const newNode: Node = {
            id: newId,
            type: 'output',
            position: { x: _finalPos.x, y: _finalPos.y },
            data: { ...(INITIAL_DATA['output'] || {}) },
          };
          setNodes((prev) => [...prev, ...assignActiveNodeSerials([newNode], prev)]);
          // 后续边连到新节点
          tgt = newNode;
          params = { ...params, target: newId };
        }
      }

      // 根据上游输出类型染色连线
      const matched = getConnectionPortType(src, tgt, params);
      const matchedPortType = matched ?? 'any';
      const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
            data: { portType: matchedPortType },
          },
          eds
        )
      );
      if (isFarmStory) {
        pushEdgeConnectFeedback({ portType: matchedPortType });
        playFarmSound(farmConnectionKindFromPortType(matchedPortType) === 'water' ? 'water' : 'select');
      }
    },
    [resetConnectionPanMode, assignActiveNodeSerials, isFarmStory, playFarmSound, pushEdgeConnectFeedback]
  );

  // ReactFlow 拖线连接时的实时校验(在连线处于“预览”阶段就拦截不兼容连接)
  const onIsValidConnection = useCallback(
    (params: Connection | Edge) => {
      const curNodes = nodesRef.current;
      const src = curNodes.find((n) => n.id === (params as Connection).source);
      const tgt = curNodes.find((n) => n.id === (params as Connection).target);
      return isConnectionValid(src, tgt, params, edgesRef.current);
    },
    []
  );

  // ===== 拖线到空白处 → 弹出候选节点菜单 =====
  const onConnectStart = useCallback(
    (_e: any, params: { nodeId: string | null; handleType: 'source' | 'target' | null }) => {
      if (!params.nodeId || !params.handleType) return;
      connectingFromRef.current = { nodeId: params.nodeId, handleType: params.handleType };
      isConnectionDraggingRef.current = true;
      setConnectionPanMode(false);

      // SHIFT + target handle → 批量移动所有入边
      const evt = _e as MouseEvent;
      if (evt.shiftKey) {
        if (params.handleType === 'target') {
          const incoming = edges.filter((e) => e.target === params.nodeId);
          if (incoming.length > 0) {
            bulkReconnectRef.current = {
              fromNodeId: params.nodeId,
              handleType: 'target',
              edges: JSON.parse(JSON.stringify(incoming)),
            };
          }
        } else if (params.handleType === 'source') {
          const outgoing = edges.filter((e) => e.source === params.nodeId);
          if (outgoing.length > 0) {
            bulkReconnectRef.current = {
              fromNodeId: params.nodeId,
              handleType: 'source',
              edges: JSON.parse(JSON.stringify(outgoing)),
            };
          }
        }
      }
    },
    [edges, setConnectionPanMode]
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectingFromRef.current;
      const target = event.target as HTMLElement | null;
      const droppedOnHandle = getReactFlowHandleInfo(target);
      if (connectionPanModeRef.current && from && !droppedOnHandle && !bulkReconnectRef.current) {
        // Space 导航模式下，松开鼠标只是结束本次拖动画布；保留起点，
        // 用户可以继续平移画布，随后点击目标接口完成连接。
        connectionPanPointerRef.current = null;
        return;
      }
      connectingFromRef.current = null;
      resetConnectionPanMode();

      // ===== SHIFT+批量移线处理 =====
      if (bulkReconnectRef.current) {
        const bulk = bulkReconnectRef.current;
        bulkReconnectRef.current = null;

        const targetEl = event.target as HTMLElement | null;
        if (!targetEl) return;
        // 检测是否释放在一个 Handle 上
        const handleEl = targetEl.closest('.react-flow__handle') as HTMLElement | null;
        if (handleEl) {
          const newNodeId =
            handleEl.getAttribute('data-nodeid') ||
            handleEl.closest('.react-flow__node')?.getAttribute('data-id') ||
            '';
          const dropHandleType = handleEl.getAttribute('data-handletype'); // 'source' | 'target'

          if (newNodeId && newNodeId !== bulk.fromNodeId) {
            // 入口→入口: 所有入边的 target 改为新节点
            if (bulk.handleType === 'target' && dropHandleType === 'target') {
              const bulkIds = new Set(bulk.edges.map((e) => e.id));
              setEdges((eds) => {
                const filtered = eds.filter((e) => !bulkIds.has(e.id));
                const newTarget = nodes.find((n) => n.id === newNodeId);
                const newEdges = bulk.edges.map((old) => {
                  const srcNode = nodes.find((n) => n.id === old.source);
                  const outs = srcNode ? getNodeOutputs(srcNode) : [];
                  const ins = newTarget ? getNodeInputs(newTarget) : [];
                  const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
                  const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
                  return {
                    ...old,
                    id: `e-${old.source}-${newNodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    target: newNodeId,
                    targetHandle: null,
                    ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
                    data: { ...((old.data as any) || {}), portType: matched ?? 'any' },
                  };
                });
                return [...filtered, ...newEdges];
              });
              return;
            }
            // 出口→出口: 所有出边的 source 改为新节点
            if (bulk.handleType === 'source' && dropHandleType === 'source') {
              const bulkIds = new Set(bulk.edges.map((e) => e.id));
              setEdges((eds) => {
                const filtered = eds.filter((e) => !bulkIds.has(e.id));
                const newSource = nodes.find((n) => n.id === newNodeId);
                const newEdges = bulk.edges.map((old) => {
                  const tgtNode = nodes.find((n) => n.id === old.target);
                  const outs = newSource ? getNodeOutputs(newSource) : [];
                  const ins = tgtNode ? getNodeInputs(tgtNode) : [];
                  const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
                  const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
                  return {
                    ...old,
                    id: `e-${newNodeId}-${old.target}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: newNodeId,
                    sourceHandle: null,
                    ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
                    data: { ...((old.data as any) || {}), portType: matched ?? 'any' },
                  };
                });
                return [...filtered, ...newEdges];
              });
              return;
            }
          }
        }
        // 释放在其他位置 → 取消，边不变
        return;
      }

      // ===== 普通拖线逻辑 =====
      if (!from) return;
      // 终点是否落在 Handle / 节点 / 连线上:任何一项命中都交给 ReactFlow 默认连接逻辑处理,不弹出候选菜单
      // 仅当鼠标释放在“空白画布”(pane / background 本体或其隔层子)时才弹菜单
      // 例外: 拖到 GroupBox(节点组)的内部空白区域也应该被视作“空白” → 弹菜单
      if (!target) return;
      const onHandle = !!target.closest('.react-flow__handle');
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      const onEdge = !!target.closest('.react-flow__edge');
      // 判断是否落在真实节点上 (排除 groupBox 类型: groupBox 本身应被当作“区域容器” 而非可连接节点)
      let onNode = false;
      if (nodeEl) {
        const hitId = nodeEl.getAttribute('data-id');
        const hitNode = hitId ? nodes.find((n) => n.id === hitId) : null;
        // groupBox 节点 不作为“节点”处理 → 允许弹出候选菜单
        if (hitNode && hitNode.type !== 'groupBox') onNode = true;
      }
      // 如果落在 Handle/真实节点/连线 上,让 ReactFlow 自己处理(已连 / 不连),则不弹菜单
      if (onHandle || onNode || onEdge) return;
      // 获取坐标
      const clientX =
        (event as MouseEvent).clientX ?? (event as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
      const clientY =
        (event as MouseEvent).clientY ?? (event as TouchEvent).changedTouches?.[0]?.clientY ?? 0;
      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
      setPicker({
        fromNodeId: from.nodeId,
        fromHandleType: from.handleType,
        flowPos,
        screenPos: { x: clientX, y: clientY },
      });
    },
    [resetConnectionPanMode, screenToFlowPosition, nodes]
  );

  // 拉线时按 Space 进入“连线导航”模式，适合远距离连线。
  // 鼠标可松开；起点会保留到点击目标接口、再次按 Space 取消，或窗口失焦。
  useEffect(() => {
    const stopNativePointer = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      (event as any).stopImmediatePropagation?.();
    };

    const connectPendingToHandle = (handle: ReturnType<typeof getReactFlowHandleInfo>) => {
      const from = connectingFromRef.current;
      if (!from || !handle || from.nodeId === handle.nodeId || from.handleType === handle.handleType) return false;
      const params: Connection =
        from.handleType === 'source'
          ? {
              source: from.nodeId,
              sourceHandle: null,
              target: handle.nodeId,
              targetHandle: handle.handleId,
            }
          : {
              source: handle.nodeId,
              sourceHandle: handle.handleId,
              target: from.nodeId,
              targetHandle: null,
            };
      connectingFromRef.current = null;
      onConnect(params);
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isConnectionDraggingRef.current) return;
      if (!matchesAnyShortcut(shortcuts['connection.pan-mode'], event)) return;
      if (isTextEditingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (connectionPanModeRef.current) {
        connectingFromRef.current = null;
        resetConnectionPanMode();
        return;
      }
      setConnectionPanMode(true);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isConnectionDraggingRef.current || !connectionPanModeRef.current) return;
      const target = event.target as Element | null;
      if (target?.closest('[data-canvas-floating-ui], .t8-context-menu, input, textarea, select, [contenteditable="true"]')) return;

      const handle = getReactFlowHandleInfo(event.target);
      if (handle) {
        stopNativePointer(event);
        connectPendingToHandle(handle);
        return;
      }

      if (event.button !== 0) return;
      connectionPanPointerRef.current = { x: event.clientX, y: event.clientY };
      stopNativePointer(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isConnectionDraggingRef.current || !connectionPanModeRef.current) return;
      if (event.buttons === 0) {
        connectionPanPointerRef.current = null;
        return;
      }
      const current = { x: event.clientX, y: event.clientY };
      const last = connectionPanPointerRef.current;
      connectionPanPointerRef.current = current;
      if (!last) return;
      const dx = current.x - last.x;
      const dy = current.y - last.y;
      if (dx === 0 && dy === 0) return;
      const viewport = getViewport();
      void setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, { duration: 0 });
      stopNativePointer(event);
    };

    const onPointerUp = () => {
      connectionPanPointerRef.current = null;
    };
    const onBlur = () => resetConnectionPanMode();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('connection-pan-mode');
    };
  }, [getViewport, onConnect, resetConnectionPanMode, setConnectionPanMode, setViewport, shortcuts]);

  useEffect(() => {
    if (!modelHelpOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.t8-canvas-shell')) return;
      if (target.closest('[data-canvas-floating-ui="model-help-panel"], [data-canvas-floating-ui="model-help-toggle"]')) {
        return;
      }
      setModelHelpOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [modelHelpOpen]);

  // ===== 全局 SHIFT+Handle 批量移线拦截器 =====
  // 原因: ReactFlow 的 multiSelectionKeyCode 包含 'Shift'，导致按住 SHIFT 在 handle 上 mousedown
  // 会被 ReactFlow 拦截为多选事件，onConnectStart 可能不会触发。
  // 这里使用 capture 阶段全局拦截 + stopImmediatePropagation 完全接管该交互。
  // 交互升级: 拖拽期间使用 phantom 节点作为边的临时锐点,让所有连线跟随鼠标移动。
  useEffect(() => {
    // SHIFT 键状态 → body.shift-mode (光标提示)
    const onShiftDown = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift' && !document.body.classList.contains('shift-mode')) {
        document.body.classList.add('shift-mode');
      }
    };
    const onShiftUp = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift') {
        document.body.classList.remove('shift-mode');
      }
    };
    window.addEventListener('keydown', onShiftDown);
    window.addEventListener('keyup', onShiftUp);
    // 失焦时也清除
    const onBlur = () => document.body.classList.remove('shift-mode');
    window.addEventListener('blur', onBlur);

    // ===== 剩刀划线断连模式 =====
    // 触发条件: SHIFT + 空白区域(.react-flow__pane 或 GroupBoxNode 内部空白) 左键按下
    // 交互: mousemove 实时探测鼠标下的 .react-flow__edge 并标记为待切, mouseup 批量删除
    // 视觉: body.cut-mode (剩刀光标) + 临时 SVG overlay 画出鼠标轨迹 + 待切 edge 高亮
    let cutSvg: SVGSVGElement | null = null;
    let cutPath: SVGPolylineElement | null = null;
    let cutPoints: number[][] = [];
    let cutSet: Set<string> = new Set();
    let cutting = false;

    const getDominantCutKind = (): EdgeCutFeedbackKind => {
      const counts: Record<EdgeCutFeedbackKind, number> = {
        rope: 0,
        water: 0,
        path: 0,
        generic: 0,
      };
      document.querySelectorAll('.react-flow__edge.cut-marked').forEach((edgeEl) => {
        const kindAttr =
          edgeEl.getAttribute('data-t8-edge-kind') ||
          edgeEl.querySelector('[data-t8-edge-kind]')?.getAttribute('data-t8-edge-kind');
        counts[normalizeEdgeCutKind(kindAttr)] += 1;
      });
      return (Object.keys(counts) as EdgeCutFeedbackKind[]).reduce((best, kind) =>
        counts[kind] > counts[best] ? kind : best
      , 'generic');
    };

    const finishCut = () => {
      if (!cutting) return;
      cutting = false;
      // 提交删除
      if (cutSet.size > 0) {
        const lastPoint = cutPoints[cutPoints.length - 1];
        pushEdgeCutFeedback({
          x: lastPoint?.[0],
          y: lastPoint?.[1],
          count: cutSet.size,
          edgeKind: getDominantCutKind(),
          source: 'slash',
        });
        const idsToCut = new Set(cutSet);
        setEdges((prev) => prev.filter((ed) => !idsToCut.has(ed.id)));
      }
      // 清理 DOM
      document.body.classList.remove('cut-mode');
      if (cutSvg && cutSvg.parentNode) cutSvg.parentNode.removeChild(cutSvg);
      cutSvg = null;
      cutPath = null;
      cutPoints = [];
      // 清除高亮 class
      document
        .querySelectorAll('.react-flow__edge.cut-marked')
        .forEach((el) => el.classList.remove('cut-marked'));
      cutSet = new Set();
      window.removeEventListener('mousemove', onCutMove, true);
      window.removeEventListener('mouseup', onCutUp, true);
    };

    const onCutMove = (mv: MouseEvent) => {
      if (!cutting) return;
      // 上一个鼠标点 → 当前点 之间插值采样，避免快速拖动时跳过细 stroke 线(像素主题黑色 edge 仅 2.5px,
      // 鼠标快速拖动时 mousemove 間距可达 ≥20px,只看当前点会完全跳过该 edge)。
      const lastPt = cutPoints.length > 0 ? cutPoints[cutPoints.length - 1] : [mv.clientX, mv.clientY];
      cutPoints.push([mv.clientX, mv.clientY]);
      // 最多保留近 200 个点, 避免 polyline 过长
      if (cutPoints.length > 200) cutPoints = cutPoints.slice(-200);
      if (cutPath) {
        cutPath.setAttribute('points', cutPoints.map((p) => p.join(',')).join(' '));
      }
      // 插值采样: 每 4px 一个采样点, 上限 60 点 避免单次 mousemove 量过大
      const dx = mv.clientX - lastPt[0];
      const dy = mv.clientY - lastPt[1];
      const dist = Math.hypot(dx, dy);
      const steps = Math.min(60, Math.max(1, Math.ceil(dist / 4)));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 1 : s / steps;
        const px = lastPt[0] + dx * t;
        const py = lastPt[1] + dy * t;
        // 命中检测: 采样点下所有元素
        const els = document.elementsFromPoint(px, py);
        for (const el of els) {
          const edgeEl = (el as Element).closest?.('.react-flow__edge') as Element | null;
          if (!edgeEl) continue;
          const id = edgeEl.getAttribute('data-id') || '';
          if (!id) continue;
          if (!cutSet.has(id)) {
            cutSet.add(id);
            edgeEl.classList.add('cut-marked');
          }
        }
      }
    };

    const onCutUp = () => finishCut();

    const onCutMouseDownCapture = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      if (e.button !== 0) return;
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      // 排除: handle / button / input / textarea / [contenteditable] / edge 本体
      if (
        targetEl.closest('.react-flow__handle') ||
        targetEl.closest('button') ||
        targetEl.closest('input') ||
        targetEl.closest('textarea') ||
        targetEl.closest('[contenteditable="true"]') ||
        targetEl.closest('.react-flow__edge')
      ) {
        return;
      }
      // 只在: react-flow pane(画布空白) 或 GroupBoxNode 内部空白 触发
      const onPane = !!targetEl.closest('.react-flow__pane');
      const groupNode = targetEl.closest('.react-flow__node-groupBox') as HTMLElement | null;
      // 如果在普通节点内部(非 GroupBox) 不触发, 避免与节点拖动冲突
      const inOtherNode =
        !!targetEl.closest('.react-flow__node') && !groupNode;
      if (!onPane && !groupNode) return;
      if (inOtherNode) return;

      // 拦截 ReactFlow 默认 panning
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      cutting = true;
      cutSet = new Set();
      cutPoints = [[e.clientX, e.clientY]];
      document.body.classList.add('cut-mode');

      // 创建临时 SVG overlay (fixed, pointer-events:none)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.position = 'fixed';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.right = '0';
      svg.style.bottom = '0';
      svg.style.width = '100vw';
      svg.style.height = '100vh';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '99999';
      svg.setAttribute('class', 'cut-overlay-svg');
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('points', `${e.clientX},${e.clientY}`);
      polyline.setAttribute('class', 'cut-overlay-path');
      svg.appendChild(polyline);
      document.body.appendChild(svg);
      cutSvg = svg;
      cutPath = polyline;

      window.addEventListener('mousemove', onCutMove, true);
      window.addEventListener('mouseup', onCutUp, true);
    };

    // SHIFT 释放期间中途中断: 也收尾
    const onCutKeyUp = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift' && cutting) finishCut();
    };
    window.addEventListener('keyup', onCutKeyUp);
    window.addEventListener('mousedown', onCutMouseDownCapture, true);

    const onMouseDownCapture = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      if (e.button !== 0) return; // 仅左键
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      const handleEl = targetEl.closest('.react-flow__handle') as HTMLElement | null;
      if (!handleEl) return;

      // 获取节点 ID
      const nodeEl = handleEl.closest('.react-flow__node') as HTMLElement | null;
      const nodeId =
        handleEl.getAttribute('data-nodeid') || nodeEl?.getAttribute('data-id') || '';
      if (!nodeId) return;

      // 判断 handle 类型：data-handlepos / class / data-handletype 多重兑底
      const detectHandleType = (el: HTMLElement): 'source' | 'target' | null => {
        const dt = el.getAttribute('data-handletype');
        if (dt === 'target' || dt === 'source') return dt;
        if (el.classList.contains('react-flow__handle-left')) return 'target';
        if (el.classList.contains('react-flow__handle-right')) return 'source';
        const pos = el.getAttribute('data-handlepos');
        if (pos === 'left' || pos === 'top') return 'target';
        if (pos === 'right' || pos === 'bottom') return 'source';
        return null;
      };
      const handleType = detectHandleType(handleEl);
      if (!handleType) return;

      // 收集相关边
      const relatedEdges =
        handleType === 'target'
          ? edgesRef.current.filter((ed) => ed.target === nodeId)
          : edgesRef.current.filter((ed) => ed.source === nodeId);
      if (relatedEdges.length === 0) return;

      // 拦截 ReactFlow 默认处理(多选/连接启动)
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const startNodeId = nodeId;
      const startHandleType = handleType;
      const stashed: Edge[] = JSON.parse(JSON.stringify(relatedEdges));
      const stashedIds = new Set(stashed.map((ed) => ed.id));

      // 初始 phantom 位置 (flow 坐标)
      const initFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      // 1) 创建 phantom 节点
      setNodes((ns) => {
        // 避免重复创建
        if (ns.some((n) => n.id === BULK_PHANTOM_ID)) return ns;
        return [
          ...ns,
          {
            id: BULK_PHANTOM_ID,
            type: 'bulkPhantom',
            position: initFlowPos,
            data: {},
            draggable: false,
            selectable: false,
            deletable: false,
            zIndex: 9999,
            // ⚠️ 关键：phantom wrapper 必须 pointerEvents:none，否则它会盖在目标 handle 之上拦截 mouseup.target，
            //         导致 SHIFT 多线平移到目标节点时 target.closest('.react-flow__handle') = null，平移直接失效。
            //         详见 skill.md §43。
            style: { pointerEvents: 'none' },
          } as Node,
        ];
      });

      // 2) 重定向 stashed 边的 target/source 到 phantom，让边实时跟随 phantom 移动
      setEdges((eds) =>
        eds.map((ed) => {
          if (!stashedIds.has(ed.id)) return ed;
          if (startHandleType === 'target') {
            return { ...ed, target: BULK_PHANTOM_ID, targetHandle: null };
          } else {
            return { ...ed, source: BULK_PHANTOM_ID, sourceHandle: null };
          }
        })
      );

      // 光标反馈
      document.body.classList.add('bulk-reconnecting');

      // 高亮 hover 到的同类型可接收 handle
      let lastHoverEl: HTMLElement | null = null;
      const setHoverHL = (el: HTMLElement | null) => {
        if (lastHoverEl && lastHoverEl !== el) {
          lastHoverEl.style.boxShadow = '';
          lastHoverEl.style.transform = '';
        }
        if (el && el !== lastHoverEl) {
          el.style.boxShadow = '0 0 0 4px rgba(34, 197, 94, 0.6)';
          el.style.transform = 'scale(1.4)';
        }
        lastHoverEl = el;
      };

      const cleanup = () => {
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('keydown', onKeyDown, true);
        document.body.classList.remove('bulk-reconnecting');
        setHoverHL(null);
        // 移除 phantom 节点
        setNodes((ns) => ns.filter((n) => n.id !== BULK_PHANTOM_ID));
      };

      const restoreOriginal = () => {
        // 取消: 边 target/source 还原为 stashed 里的原始值
        const origMap = new Map(stashed.map((s) => [s.id, s]));
        setEdges((eds) =>
          eds.map((ed) => {
            const orig = origMap.get(ed.id);
            if (!orig) return ed;
            return {
              ...ed,
              source: orig.source,
              target: orig.target,
              sourceHandle: orig.sourceHandle,
              targetHandle: orig.targetHandle,
            };
          })
        );
      };

      const onKeyDown = (kev: KeyboardEvent) => {
        if (kev.key === 'Escape') {
          cleanup();
          restoreOriginal();
        }
      };

      // ⚠️ 双层兜底：跳过 phantom 节点自身，从坐标下命中所有元素中找出真正的 handle
      //         详见 skill.md §43
      const findHandleAt = (cx: number, cy: number): HTMLElement | null => {
        const els = document.elementsFromPoint(cx, cy);
        for (const el of els) {
          const h = (el as Element).closest?.('.react-flow__handle') as HTMLElement | null;
          if (!h) continue;
          const wrap = h.closest('.react-flow__node') as HTMLElement | null;
          const nid = h.getAttribute('data-nodeid') || wrap?.getAttribute('data-id') || '';
          if (nid === BULK_PHANTOM_ID) continue;
          return h;
        }
        return null;
      };

      const onMouseMove = (mv: MouseEvent) => {
        // 更新 phantom 节点位置 → 边跟随鼠标移动
        const fp = screenToFlowPosition({ x: mv.clientX, y: mv.clientY });
        setNodes((ns) =>
          ns.map((n) =>
            n.id === BULK_PHANTOM_ID ? { ...n, position: fp } : n
          )
        );
        // 高亮 hover 到的同类型 handle（用 elementsFromPoint 复数遍历，跳过 phantom 自身）
        const hoverHandle = findHandleAt(mv.clientX, mv.clientY);
        if (hoverHandle) {
          // 排除自身起点节点的 handle 以及 phantom 自身
          const hoverNodeEl = hoverHandle.closest('.react-flow__node') as HTMLElement | null;
          const hoverNodeId =
            hoverHandle.getAttribute('data-nodeid') ||
            hoverNodeEl?.getAttribute('data-id') ||
            '';
          const hoverType = detectHandleType(hoverHandle);
          if (
            hoverNodeId &&
            hoverNodeId !== startNodeId &&
            hoverNodeId !== BULK_PHANTOM_ID &&
            hoverType === startHandleType
          ) {
            setHoverHL(hoverHandle);
            return;
          }
        }
        setHoverHL(null);
      };

      const onMouseUp = (upEv: MouseEvent) => {
        // 双层路径：先尝试 event.target 快路径，命中 phantom 时用 elementsFromPoint 兜底（详见 skill.md §43）
        const upTargetEl = upEv.target as HTMLElement | null;
        let upHandleEl = upTargetEl?.closest('.react-flow__handle') as HTMLElement | null;
        if (upHandleEl) {
          const wrap = upHandleEl.closest('.react-flow__node') as HTMLElement | null;
          const nid =
            upHandleEl.getAttribute('data-nodeid') ||
            wrap?.getAttribute('data-id') ||
            '';
          if (nid === BULK_PHANTOM_ID) upHandleEl = null;
        }
        if (!upHandleEl) upHandleEl = findHandleAt(upEv.clientX, upEv.clientY);
        cleanup();

        if (!upHandleEl) {
          restoreOriginal();
          return;
        }
        const upNodeEl = upHandleEl.closest('.react-flow__node') as HTMLElement | null;
        const upNodeId =
          upHandleEl.getAttribute('data-nodeid') ||
          upNodeEl?.getAttribute('data-id') ||
          '';
        if (!upNodeId || upNodeId === startNodeId || upNodeId === BULK_PHANTOM_ID) {
          restoreOriginal();
          return;
        }
        const upHandleType = detectHandleType(upHandleEl);
        if (upHandleType !== startHandleType) {
          restoreOriginal();
          return;
        }

        // 执行批量重连: 生成新边替换 stashed 中被重定向到 phantom 的边
        setEdges((eds) => {
          const filtered = eds.filter((ed) => !stashedIds.has(ed.id));
          const ts = Date.now();
          const newEdges: Edge[] = stashed.map((old) => {
            const sourceId =
              startHandleType === 'target' ? old.source : upNodeId;
            const targetId =
              startHandleType === 'target' ? upNodeId : old.target;
            const srcN = nodesRef.current.find((n) => n.id === sourceId);
            const tgtN = nodesRef.current.find((n) => n.id === targetId);
            const outs = srcN ? getNodeOutputs(srcN) : [];
            const ins = tgtN ? getNodeInputs(tgtN) : [];
            const matched = outs.find(
              (o) => ins.includes(o) || o === 'any' || ins.includes('any')
            );
            const color =
              matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
            return {
              ...old,
              id: `e-${sourceId}-${targetId}-${ts}-${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              source: sourceId,
              target: targetId,
              sourceHandle: startHandleType === 'target' ? old.sourceHandle : null,
              targetHandle: startHandleType === 'source' ? old.targetHandle : null,
              ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
              data: {
                ...((old.data as any) || {}),
                portType: matched ?? 'any',
              },
            };
          });
          return [...filtered, ...newEdges];
        });
      };

      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('keydown', onKeyDown, true);
    };

    window.addEventListener('mousedown', onMouseDownCapture, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDownCapture, true);
      window.removeEventListener('mousedown', onCutMouseDownCapture, true);
      window.removeEventListener('keyup', onCutKeyUp);
      window.removeEventListener('mousemove', onCutMove, true);
      window.removeEventListener('mouseup', onCutUp, true);
      window.removeEventListener('keydown', onShiftDown);
      window.removeEventListener('keyup', onShiftUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('shift-mode');
      document.body.classList.remove('bulk-reconnecting');
      document.body.classList.remove('cut-mode');
      if (cutSvg && cutSvg.parentNode) cutSvg.parentNode.removeChild(cutSvg);
      document
        .querySelectorAll('.react-flow__edge.cut-marked')
        .forEach((el) => el.classList.remove('cut-marked'));
    };
  }, [pushEdgeCutFeedback, screenToFlowPosition]);

  // 计算候选节点列表(根据起始节点输出/输入类型过滤)
  const pickerCandidates = useMemo<Array<NodeMeta & { matchedTypes: PortType[] }>>(() => {
    if (!picker) return [];
    const fromNode = nodes.find((n) => n.id === picker.fromNodeId);
    if (!fromNode) return [];
    // 从 source handle 拉出: 源节点输出 → 候选节点需要有能收这些输出的输入
    // 从 target handle 拉出: 源节点输入 → 候选节点需要有能被其接受的输出
    const isFromSource = picker.fromHandleType === 'source';
    const fromOuts = isFromSource ? getNodeOutputs(fromNode) : [];
    const fromIns = !isFromSource ? getNodeInputs(fromNode) : [];

    return NODE_REGISTRY.flatMap((meta) => {
      // 隐藏节点不作为候选项出现(仅从主动添加入口中移除,不影响已存在节点连边)
      if (meta.hidden) return [];
      // 不推荐带动态输出的 upload 作为候选 source⚡但允许它作为 target(upload 本身不受输入,实际最后会被过滤)
      const ports = NODE_PORTS[meta.type];
      if (!ports) return [];
      let matched: PortType[] = [];
      if (isFromSource) {
        // 需要 meta.inputs 与 fromOuts 有交集
        if (!arePortsCompatible(fromOuts, ports.inputs)) return [];
        matched = fromOuts.filter((t) => ports.inputs.includes(t) || ports.inputs.includes('any') || t === 'any');
      } else {
        // 拖出 target handle⚡需要 meta.outputs 与 fromIns 有交集
        // upload 节点 outputs 动态为 [],在此考虑 image/video/audio 均可作为潜在输出源
        const candidateOuts = meta.type === 'upload' ? (['image', 'video', 'audio'] as PortType[]) : ports.outputs;
        if (!arePortsCompatible(candidateOuts, fromIns)) return [];
        matched = candidateOuts.filter((t) => fromIns.includes(t) || fromIns.includes('any') || t === 'any');
      }
      return [{ ...meta, matchedTypes: matched }];
    }).sort((a, b) => {
      // 中继节点(relay)永远置顶,作为最常用的透传/分发节点入口
      if (a.type === 'relay' && b.type !== 'relay') return -1;
      if (b.type === 'relay' && a.type !== 'relay') return 1;
      return 0;
    });
  }, [picker, nodes]);

  // 点击候选项→ 在拖落位置创建节点并自动连线
  const handlePickCandidate = useCallback(
    (meta: NodeMeta) => {
      if (!picker) return;
      const id = `${meta.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newNode: Node = {
        id,
        type: meta.type,
        position: picker.flowPos,
        data: { ...(INITIAL_DATA[meta.type] || {}) },
      };
      const [nodeWithSerial] = assignActiveNodeSerials([newNode], nodes);
      setNodes((prev) => [...prev, nodeWithSerial]);

      // 创建连线:根据 source/target 方向
      const isFromSource = picker.fromHandleType === 'source';
      const params: Connection = isFromSource
        ? { source: picker.fromNodeId, target: id, sourceHandle: null, targetHandle: null }
        : { source: id, target: picker.fromNodeId, sourceHandle: null, targetHandle: null };

      // 染色(使用 nodes + 新节点计算)
      const fromNode = nodes.find((n) => n.id === picker.fromNodeId);
      const tempNewNode = nodeWithSerial || newNode;
      const src = isFromSource ? fromNode : tempNewNode;
      const tgt = isFromSource ? tempNewNode : fromNode;
      const outs = src ? getNodeOutputs(src) : [];
      const ins = tgt ? getNodeInputs(tgt) : [];
      const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
      const matchedPortType = matched ?? 'any';
      const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
            data: { portType: matchedPortType },
          },
          eds
        )
      );
      if (isFarmStory) {
        pushEdgeConnectFeedback({ portType: matchedPortType });
        playFarmSound(farmConnectionKindFromPortType(matchedPortType) === 'water' ? 'water' : 'select');
      }
      setPicker(null);
    },
    [picker, nodes, assignActiveNodeSerials, isFarmStory, playFarmSound, pushEdgeConnectFeedback]
  );

  const handleConnectPickerToNodeId = useCallback(() => {
    if (!picker) return;
    setNodeIdDialog({
      mode: 'connect',
      value: '',
      fromNodeId: picker.fromNodeId,
      fromHandleType: picker.fromHandleType,
      title: picker.fromHandleType === 'source' ? '发送到 NodeID' : '从 NodeID 输入',
      description:
        picker.fromHandleType === 'source'
          ? '输入目标节点编号，会从当前输出口自动连接到该节点。'
          : '输入来源节点编号，会从该节点自动连接到当前输入口。',
      placeholder: '#12 或 12',
    });
    setPicker(null);
  }, [picker]);

  const submitNodeIdDialog = useCallback(() => {
    if (!nodeIdDialog) return;
    const raw = nodeIdDialog.value.trim();
    if (!raw) {
      logBus.warn('请输入有效的 NodeID 数字', nodeIdDialog.mode === 'connect' ? '发送到ID' : '查找 NodeID');
      return;
    }
    if (nodeIdDialog.mode === 'connect') {
      const result = resolveConnectionByNodeSerialId({
        nodes: nodesRef.current,
        edges: edgesRef.current,
        fromNodeId: nodeIdDialog.fromNodeId,
        fromHandleType: nodeIdDialog.fromHandleType,
        nodeSerialInput: raw,
      });
      if (!result.ok) {
        logBus.warn(result.message, '发送到ID');
        return;
      }
      onConnect(result.connection);
      setNodeIdDialog(null);
      const serialId = parseNodeSerialInput(raw);
      logBus.success(`已连接 NodeID #${serialId ?? raw}`, '发送到ID');
      return;
    }
    const serialId = parseNodeSerialInput(raw);
    if (!serialId) {
      logBus.warn('请输入有效的 NodeID 数字', '查找 NodeID');
      return;
    }
    const target = findNodeBySerialId(nodesRef.current, serialId);
    if (!target) {
      logBus.warn(`没有找到 NodeID #${serialId}`, '查找 NodeID');
      return;
    }
    const rect = rectOf(target);
    const currentZoom = getViewport().zoom || 1;
    const zoom = Math.min(Math.max(currentZoom, 0.55), 1.15);
    setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom, duration: 450 });
    pulseNearestNode(target.id);
    setNodeIdDialog(null);
  }, [getViewport, nodeIdDialog, onConnect, setCenter]);

  // ===== 自动创建输出素材节点 =====
  // 生成类节点 (image/video/audio/seedance/llm/runninghub 等) 输出字段有值后,
  // 自动创建对应数量的 OutputNode 并连线。
  // 防循环: 以 nodeId -> sig(输出项列表哈希) 记忆已处理状态,
  // 同 sig 不重复创建; 且跳过本身就是 OutputNode 的节点避免链式爆炸.
  const autoOutputProcessedRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!loaded) return;
    // v1.2.8.2: 'pick-from-set' 是中转节点 (从合集取一个供下游), 不应被自动挂 OutputNode
    // v1.2.9.9: 'loop' 也加入 — 循环器自身不产出最终结果 (累积已由下游 EXEC→OutputNode 链路接管),
    //          autoOutput 若给 LoopNode 自动建 OutputNode 会让用户看到 “循环器自己生了 N 个素材” 的错误体验。
    // PoseMaster 自己负责写入单张/合集 OutputNode；通用 autoOutput 再处理会把批量合集拆出重复单体。
    // random-route 写入 imageUrl/prompt 等字段只是为了透传给命中的下游分支，不代表它自己生成了输出素材。
    // Story 的 outputText/videoUrls 是制片进度与最终状态快照；真实下游由导演分镜台和视频编辑节点承接，
    // 不能在新建或中途生产时把每次进度变化自动物化成独立的“输出素材”节点。
    const SKIP_TYPES = new Set(['output', 'groupBox', 'bulkPhantom', 'upload', 'material-set', 'pick-from-set', 'loop', 'random-route', 'story', 'pose-master', 'volcengine-assets']);

    const toAddNodes: Node[] = [];
    const toAddEdges: Edge[] = [];
    const toRemoveNodeIds = new Set<string>();
    const toRemoveEdgeIds = new Set<string>();
    const newSigPatches: Array<[string, string]> = [];
    // v1.2.10.5-hotfix: 同一次 effect 内多个源节点补建的 OutputNode 之间互不可见 (nodes 快照不包含本轮刚 push 的节点),
    // 会导致多源场景下新 OutputNode 之间重叠。累积到 pendingPlacedNodes, 每次避让合并进 existing。
    const pendingPlacedNodes: Node[] = [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    // Clean up bad chains created by older builds where a 3D preview was treated
    // as a fresh model source and auto-spawned another preview forever.
    for (const edge of edges) {
      if (!edge.id.startsWith('e-auto-')) continue;
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (
        source?.type === 'model-3d-preview' &&
        target?.type === 'model-3d-preview' &&
        target.id.startsWith('model-3d-preview-auto-')
      ) {
        toRemoveNodeIds.add(target.id);
      }
    }

    // Clean up stale auto outputs created by older builds for pass-through and
    // orchestration nodes. Keep anything the user moved, connected onward, or
    // merged with another input so this migration never removes user work.
    for (const edge of edges) {
      if (!edge.id.startsWith('e-auto-')) continue;
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      const td: any = target?.data || {};
      const totalIncoming = edges.filter((item) => item.target === edge.target).length;
      const hasOutgoing = edges.some((item) => item.source === edge.target);
      if (
        (source?.type === 'random-route' || source?.type === 'story' || source?.type === 'volcengine-assets') &&
        target?.type === 'output' &&
        target.id.startsWith('output-auto-') &&
        totalIncoming === 1 &&
        !hasOutgoing &&
        td.userMoved !== true
      ) {
        toRemoveNodeIds.add(target.id);
      }
    }

    for (const n of nodes) {
      const t = n.type as string;
      if (!t || SKIP_TYPES.has(t)) continue;
      const d = (n.data as any) || {};
      // URL-only performance fixtures exercise the real node tree without
      // materializing generated outputs or mutating the diagnostic graph.
      if (d.__performanceFixture === true) continue;
      const directorOutputItems = t === 'director-storyboard' && Array.isArray(d.directorOutputItems)
        ? d.directorOutputItems
        : [];
      // v1.2.9.10: 正在被 LoopNode 累积跑路的 EXEC 节点 (带 __loopAccumulate 标记) 跳过,
      //          避免 autoOutput 把下游的 OutputNode 升级为 pickKind+pickIndex (会误将累积全集切为单项)。
      //          OutputNode 侧的 v1.2.9.10 修复 (hasAnyDirectAccumulated 跳过 pickKind) 是主双保险,
      //          本处跳过是避免不必要的 store write 和数据污染。
      if (d.__loopAccumulate) continue;
      // v1.2.10.5-hotfix2: 跟過源节点尚未被 DOM 测量时跳过，下一轮 nodes 更新（带上 measured）会重新触发 effect。
      // 避免用不准确的字典尺寸计算 baseX 导致 desired position 落在源节点可视范围内。
      if (!(n as any).measured?.width) continue;
      // model-3d-preview keeps modelUrl/modelUrls in its own data for download/switching.
      // Only ignore those model fields; its snapshot image still needs normal auto output.
      const shouldCollectModelOutputs = t !== 'model-3d-preview';
      // v1.2.8.2: 循环器仅在完成后才让 autoOutput 处理, 避免运行中注入 items[i] 时被误认为
      // “已生产产物” 并创建个空的 OutputNode。在 status='success' 时 d.imageUrls/videoUrls/audioUrls
      // 数组才是最终聚合产物, 交给 autoOutput 判并拆为 N 个 OutputNode (每行 3 个网格)。
      if (t === 'loop' && d?.status !== 'success') continue;

      // === v1.2.8.3: FramePair 双端口专属路径 ===
      // 不走通用 imageUrls 聚合 (FramePair 已不再写 imageUrl/imageUrls), 按 first/last
      // 各创建一个带 sourceHandle 的 OutputNode, useUpstreamMaterials 按 handle 正确过滤到对应帧。
      if (t === 'frame-pair') {
        const first = typeof d.firstFrameUrl === 'string' ? d.firstFrameUrl : '';
        const last = typeof d.lastFrameUrl === 'string' ? d.lastFrameUrl : '';
        if (!first || !last) continue;
        const sig = `frame-pair:${first}|${last}`;
        if (autoOutputProcessedRef.current.get(n.id) === sig) continue;
        // 已被连接的 sourceHandle 集合
        const usedHandles = new Set<string | null>();
        for (const e of edges) {
          if (e.source !== n.id) continue;
          usedHandles.add((e as any).sourceHandle ?? null);
        }
        // null/默认 handle 也能充当任意一边（兼容旧连接）——只要这边有一个 OutputNode 进来, 就不重复补
        const _srcRectFP = rectOf(n);
        const baseX = (n.position?.x ?? 0) + _srcRectFP.w + 80;
        const need: Array<'first' | 'last'> = [];
        if (!usedHandles.has('first') && !usedHandles.has(null)) need.push('first');
        if (!usedHandles.has('last')) need.push('last');
        // 若 null 已占位, 仅备份 'last' 偶尔多补一个 (使用者手动拖一根默认就应默认 first)
        newSigPatches.push([n.id, sig]);
        if (need.length === 0) continue; // v1.2.10.5-hotfix3: 无需创建则跳过，避免无用的 placeBatchNodes 调用 + 诊断噪音
        // v1.2.10.5: 整组防重叠 —— 先算期望单列矩形, 再求公共偏移
        const _szFP = defaultSizeOf('output');
        // v1.2.10.7: baseY 对齐源节点垂直中心（handle 位置），避免输出偏上
        const _groupHFP = (need.length - 1) * 360 + _szFP.h;
        const baseY = (n.position?.y ?? 0) + _srcRectFP.h / 2 - _groupHFP / 2;
        const _desiredFP: PlacementRect[] = need.map((_, i) => ({
          x: baseX, y: baseY + i * 360, w: _szFP.w, h: _szFP.h,
        }));
        const _offFP = placeBatchNodes(_desiredFP, [...nodes, ...pendingPlacedNodes], { source: 'placement:auto-frame-pair', gap: 0 });
        for (let i = 0; i < need.length; i++) {
          const h = need[i];
          const newId = `output-auto-${n.id}-${Date.now()}-${h}-${Math.random().toString(36).slice(2, 6)}`;
          const _newNode: Node = {
            id: newId,
            type: 'output',
            position: { x: baseX + _offFP.dx, y: baseY + i * 360 + _offFP.dy },
            data: outputMaterialPersistenceEnabled
              ? buildPersistentOutputSnapshotData({ kind: 'image', url: h === 'first' ? first : last })
              : {}, // 不带 pickKind/pickIndex, 让 useUpstreamMaterials 按 sourceHandle 过滤
            selected: false,
          } as Node;
          toAddNodes.push(_newNode);
          pendingPlacedNodes.push(_newNode);
          toAddEdges.push({
            id: `e-auto-${newId}`,
            source: n.id,
            target: newId,
            sourceHandle: h,
            type: 'deletable',
          } as Edge);
        }
        continue;
      }

      // === v1.2.9.14: Suno (audio) 双轨专属路径 ===
      // AudioNode (type='audio') 双输出口 audio-0 (主轨 audioUrl) + audio-1 (副轨 audioUrl_1),
      // 与 FramePair 同模式: 按轨创建带 sourceHandle 的 OutputNode, 不走通用 pickKind/pickIndex 路径,
      // useUpstreamMaterials / OutputNode collected 会按 handle 过滤到对应轨 (循环中各轨独立累积 N 首，不会集中到出口 1)。
      if (t === 'audio') {
        const a0 = typeof d.audioUrl === 'string' ? d.audioUrl : '';
        const a1 = typeof d.audioUrl_1 === 'string' ? d.audioUrl_1 : '';
        if (!a0 && !a1) continue;
        const sig = `suno:${a0}|${a1}`;
        if (autoOutputProcessedRef.current.get(n.id) === sig) continue;
        const usedHandles = new Set<string | null>();
        for (const e of edges) {
          if (e.source !== n.id) continue;
          usedHandles.add((e as any).sourceHandle ?? null);
        }
        const _srcRectSU = rectOf(n);
        const baseX = (n.position?.x ?? 0) + _srcRectSU.w + 80;
        const need: Array<'audio-0' | 'audio-1'> = [];
        // null 默认占位则 audio-0 不重复创建（老连接兼容）
        if (a0 && !usedHandles.has('audio-0') && !usedHandles.has(null)) need.push('audio-0');
        if (a1 && !usedHandles.has('audio-1')) need.push('audio-1');
        if (need.length === 0) { newSigPatches.push([n.id, sig]); continue; }
        newSigPatches.push([n.id, sig]);
        // v1.2.10.5: 整组防重叠
        const _szSU = defaultSizeOf('output');
        // v1.2.10.7: baseY 对齐源节点垂直中心（handle 位置），避免输出偏上
        const _groupHSU = (need.length - 1) * 360 + _szSU.h;
        const baseY = (n.position?.y ?? 0) + _srcRectSU.h / 2 - _groupHSU / 2;
        const _desiredSU: PlacementRect[] = need.map((_, i) => ({
          x: baseX, y: baseY + i * 360, w: _szSU.w, h: _szSU.h,
        }));
        const _offSU = placeBatchNodes(_desiredSU, [...nodes, ...pendingPlacedNodes], { source: 'placement:auto-suno', gap: 0 });
        for (let i = 0; i < need.length; i++) {
          const h = need[i];
          const newId = `output-auto-${n.id}-${Date.now()}-${h}-${Math.random().toString(36).slice(2, 6)}`;
          const _newNode: Node = {
            id: newId,
            type: 'output',
            position: { x: baseX + _offSU.dx, y: baseY + i * 360 + _offSU.dy },
            data: outputMaterialPersistenceEnabled
              ? buildPersistentOutputSnapshotData({ kind: 'audio', url: h === 'audio-0' ? a0 : a1 })
              : {}, // 不带 pickKind/pickIndex。由 useUpstreamMaterials/OutputNode collected 按 sourceHandle 滤
            selected: false,
          } as Node;
          toAddNodes.push(_newNode);
          pendingPlacedNodes.push(_newNode);
          toAddEdges.push({
            id: `e-auto-${newId}`,
            source: n.id,
            target: newId,
            sourceHandle: h,
            type: 'deletable',
          } as Edge);
        }
        continue;
      }

      // 提取输出项 (去重 + 过滤 + 同类型内序号)
      const seen = new Set<string>();
      const seenTexts = new Set<string>();
      const texts: string[] = [];
      const imgs: string[] = [];
      const vids: string[] = [];
      const auds: string[] = [];
      const mods: string[] = [];
      const pushTxt = (value: any) => {
        if (typeof value !== 'string') return;
        const text = value.trim();
        if (!text || seenTexts.has(text)) return;
        seenTexts.add(text);
        texts.push(text);
      };
      const pushImg = (u: any) => {
        if (typeof u !== 'string' || !u || seen.has(u)) return;
        seen.add(u);
        imgs.push(u);
      };
      const pushVid = (u: any) => {
        if (typeof u !== 'string' || !u || seen.has(u)) return;
        seen.add(u);
        vids.push(u);
      };
      const pushAud = (u: any) => {
        if (typeof u !== 'string' || !u || seen.has(u)) return;
        seen.add(u);
        auds.push(u);
      };
      const pushMod = (u: any) => {
        if (typeof u !== 'string' || !u || seen.has(u)) return;
        seen.add(u);
        mods.push(u);
      };
      const suppressStandaloneTextOutputs = t === 'director-storyboard' || !shouldCollectNodeTextOutput(t, d);
      if (!suppressStandaloneTextOutputs) {
        pushTxt(d.outputText);
        pushTxt(d.reply);
        if (Array.isArray(d.textSegments)) d.textSegments.forEach(pushTxt);
        if (Array.isArray(d.segments)) d.segments.forEach(pushTxt);
        if (Array.isArray(d.texts)) d.texts.forEach(pushTxt);
      }
      pushImg(d.imageUrl);
      if (Array.isArray(d.imageUrls)) d.imageUrls.forEach(pushImg);
      // d.urls 是通用产物数组（RH/FAL 使用），可能同时含图/视频/音频/3D 模型。
      // 按扩展名分流，避免 mp4/glb url 被当 image 加入 imgs 后下游 OutputNode 误用 pickKind='image' 过滤。
      if (Array.isArray(d.urls)) {
        const isModExt = (u: string) => /\.(glb|gltf|obj|fbx|stl|usdz|zip)(\?.*)?$/i.test(u);
        const isVidExt = (u: string) => /\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/i.test(u);
        const isAudExt = (u: string) => /\.(mp3|wav|ogg|m4a|flac|aac)(\?.*)?$/i.test(u);
        d.urls.forEach((u: any) => {
          if (typeof u !== 'string' || !u) return;
          if (isModExt(u)) {
            if (shouldCollectModelOutputs) pushMod(u);
          }
          else if (isVidExt(u)) pushVid(u);
          else if (isAudExt(u)) pushAud(u);
          else pushImg(u);
        });
      }
      if (Array.isArray(d.generatedImages)) d.generatedImages.forEach(pushImg);
      if (shouldCollectModelOutputs) {
        pushMod(d.modelUrl);
        pushMod(d.directModelUrl);
        if (Array.isArray(d.modelUrls)) d.modelUrls.forEach(pushMod);
        if (Array.isArray(d.directModelUrls)) d.directModelUrls.forEach(pushMod);
      }
      if (t === 'director-storyboard') {
        if (directorOutputItems.length > 0) {
          directorOutputItems.forEach((item: any) => pushVid(item.videoUrl));
        } else if (Array.isArray(d.videoUrls)) d.videoUrls.forEach(pushVid);
        else pushVid(d.videoUrl);
      } else {
        pushVid(d.videoUrl);
        // v1.2.8.2: 支持 videoUrls 数组 (LoopNode 聚合多个视频产物)
        if (Array.isArray(d.videoUrls)) d.videoUrls.forEach(pushVid);
      }
      pushAud(d.audioUrl);
      // Suno / AudioNode 双轨输出口: audioUrl=轨1, audioUrl_1=轨2
      // 不取 audioUrl_1 会导致 autoOutput 只创建 1 个 OutputNode
      pushAud(d.audioUrl_1);
      // v1.2.8.2: 支持 audioUrls 数组 (LoopNode 聚合多个音频产物)
      if (Array.isArray(d.audioUrls)) d.audioUrls.forEach(pushAud);
      // 合成 items: 靠 kindIndex 让下游 OutputNode 能准确拾取对应索引的那一项
      const items: Array<{ kind: 'text' | 'image' | 'video' | 'audio'; url: string; kindIndex: number }> = [
        ...texts.map((url, i) => ({ kind: 'text' as const, url, kindIndex: i })),
        ...imgs.map((url, i) => ({ kind: 'image' as const, url, kindIndex: i })),
        ...vids.map((url, i) => ({ kind: 'video' as const, url, kindIndex: i })),
        ...auds.map((url, i) => ({ kind: 'audio' as const, url, kindIndex: i })),
      ];
      const modelItems = mods.map((url, i) => ({ kind: 'model3d' as const, url, kindIndex: i }));
      if (items.length === 0 && modelItems.length === 0) continue;

      const outputDataForItem = (item: { kind: 'text' | 'image' | 'video' | 'audio'; url: string; kindIndex: number }) => {
        const base = { pickKind: item.kind, pickIndex: item.kindIndex };
        if (t === 'director-storyboard' && item.kind === 'video') {
          const directorItem = directorOutputItems[item.kindIndex];
          if (directorItem && typeof directorItem.videoUrl === 'string' && directorItem.videoUrl.trim()) {
            return { ...base, ...buildDirectorStoryboardOutputNodeData(directorItem) };
          }
        }
        return outputMaterialPersistenceEnabled
          ? { ...base, ...buildPersistentOutputSnapshotData(item) }
          : base;
      };

      const outputPatchChanged = (current: any, patch: Record<string, any>) => (
        Object.entries(patch).some(([key, value]) => JSON.stringify(current?.[key]) !== JSON.stringify(value))
      );

      const sig = [...items, ...modelItems].map((x) => {
        if (t === 'director-storyboard' && x.kind === 'video') {
          const directorItem = directorOutputItems[x.kindIndex];
          return `${x.kind}:${x.url}:${directorItem?.shotId || ''}:${directorItem?.text || ''}`;
        }
        return `${x.kind}:${x.url}`;
      }).join('|');
      const directorOutputRefreshNonce = t === 'director-storyboard' ? String(d.directorOutputRefreshNonce || '') : '';
      const outputSig = directorOutputRefreshNonce ? `${sig}|refresh:${directorOutputRefreshNonce}` : sig;
      const lastSig = autoOutputProcessedRef.current.get(n.id);
      if (lastSig === outputSig) continue;

      if (modelItems.length > 0) {
        const modelUrlSet = new Set(modelItems.map((item) => item.url));
        const downstreamModelPreviews = edges
          .filter((e) => e.source === n.id)
          .map((e) => {
            const t = nodes.find((x) => x.id === e.target);
            if (!t || t.type !== 'model-3d-preview') return null;
            const td: any = t.data || {};
            const url = String(td.directModelUrl || td.modelUrl || '').trim();
            const totalIncoming = edges.filter((x) => x.target === t.id).length;
            const hasOutgoing = edges.some((x) => x.source === t.id);
            const auto = t.id.startsWith('model-3d-preview-auto-') && e.id.startsWith('e-auto-');
            const removable = auto && totalIncoming === 1 && !hasOutgoing && td.userMoved !== true;
            return { id: t.id, url, auto, removable };
          })
          .filter(Boolean) as Array<{ id: string; url: string; auto: boolean; removable: boolean }>;
        const hasManualModelPreview = downstreamModelPreviews.some((item) => !item.auto);
        for (const preview of downstreamModelPreviews) {
          if (preview.removable && preview.url && !modelUrlSet.has(preview.url)) {
            toRemoveNodeIds.add(preview.id);
            for (const edge of edges) {
              if (edge.source === preview.id || edge.target === preview.id) toRemoveEdgeIds.add(edge.id);
            }
          }
        }
        if (!hasManualModelPreview) {
          const occupiedModelUrls = new Set(downstreamModelPreviews.map((item) => item.url).filter(Boolean));
          const remainingModels = modelItems.filter((item) => !occupiedModelUrls.has(item.url));
          if (remainingModels.length > 0) {
            const _srcRectModel = rectOf(n);
            const _szModel = defaultSizeOf('model-3d-preview');
            const baseXModel = (n.position?.x ?? 0) + _srcRectModel.w + 80;
            const baseYModel = (n.position?.y ?? 0) + _srcRectModel.h / 2 - _szModel.h / 2;
            const desiredModel: PlacementRect[] = remainingModels.map((_, i) => ({
              x: baseXModel + (i % 2) * (_szModel.w + 40),
              y: baseYModel + Math.floor(i / 2) * (_szModel.h + 40),
              w: _szModel.w,
              h: _szModel.h,
            }));
            const offModel = placeBatchNodes(desiredModel, [...nodes, ...pendingPlacedNodes], { source: 'placement:auto-model3d-output', gap: 0 });
            remainingModels.forEach((item, i) => {
              const newId = `model-3d-preview-auto-${n.id}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
              const newNode: Node = {
                id: newId,
                type: 'model-3d-preview',
                position: {
                  x: desiredModel[i].x + offModel.dx,
                  y: desiredModel[i].y + offModel.dy,
                },
                data: {
                  modelUrl: item.url,
                  modelUrls: [item.url],
                  directModelUrl: item.url,
                  directModelUrls: [item.url],
                  pickKind: item.kind,
                  pickIndex: item.kindIndex,
                  status: 'idle',
                  error: '',
                },
                selected: false,
              } as Node;
              toAddNodes.push(newNode);
              pendingPlacedNodes.push(newNode);
              toAddEdges.push({
                id: `e-auto-${newId}`,
                source: n.id,
                target: newId,
                type: 'deletable',
              } as Edge);
            });
          }
        }
      }

      if (items.length === 0) {
        newSigPatches.push([n.id, outputSig]);
        continue;
      }

      // ComfyUI 应用可以在一次运行中同时返回多种媒体。自动输出保持一个聚合节点，
      // 让图片 / 视频 / 音频 / 文本继续作为同一组工作流结果传递；用户手动连接的
      // 其他 OutputNode 不做删除或拆分。
      if (t === 'comfyui-store') {
        const downstream = edges
          .filter((edge) => edge.source === n.id)
          .map((edge) => {
            const target = nodes.find((node) => node.id === edge.target);
            if (!target || target.type !== 'output') return null;
            const incoming = edges.filter((candidate) => candidate.target === target.id).length;
            const hasOutgoing = edges.some((candidate) => candidate.source === target.id);
            const auto = target.id.startsWith('output-auto-') && edge.id.startsWith('e-auto-');
            return { target, edge, auto, removable: auto && incoming === 1 && !hasOutgoing && (target.data as any)?.userMoved !== true };
          })
          .filter(Boolean) as Array<{ target: Node; edge: Edge; auto: boolean; removable: boolean }>;
        const keeper = downstream.find((item) => !item.auto) || downstream[0];
        const aggregateData = {
          pickKind: undefined,
          pickIndex: undefined,
          aggregateSource: 'comfyui-store',
          imageUrl: imgs[0] || '',
          imageUrls: imgs,
          videoUrl: vids[0] || '',
          videoUrls: vids,
          audioUrl: auds[0] || '',
          audioUrls: auds,
          outputText: texts.join('\n'),
          text: texts.join('\n'),
          outputKinds: Array.isArray(d.outputKinds) ? d.outputKinds : [],
          primaryKind: d.primaryKind || items[0]?.kind || 'image',
        };
        if (keeper) {
          setNodes((prev) => prev.map((node) => node.id === keeper.target.id
            ? { ...node, data: { ...(node.data as any), ...aggregateData } }
            : node));
        } else {
          const sourceRect = rectOf(n);
          const outputSize = defaultSizeOf('output');
          const desired = [{
            x: (n.position?.x ?? 0) + sourceRect.w + 80,
            y: (n.position?.y ?? 0) + sourceRect.h / 2 - outputSize.h / 2,
            w: outputSize.w,
            h: outputSize.h,
          }];
          const offset = placeBatchNodes(desired, [...nodes, ...pendingPlacedNodes], { source: 'placement:auto-comfyui-output', gap: 0 });
          const newId = `output-auto-${n.id}-${Date.now()}-aggregate-${Math.random().toString(36).slice(2, 6)}`;
          const aggregateNode: Node = {
            id: newId,
            type: 'output',
            position: { x: desired[0].x + offset.dx, y: desired[0].y + offset.dy },
            data: aggregateData,
            selected: false,
          } as Node;
          toAddNodes.push(aggregateNode);
          pendingPlacedNodes.push(aggregateNode);
          toAddEdges.push({ id: `e-auto-${newId}`, source: n.id, target: newId, type: 'deletable' } as Edge);
        }
        newSigPatches.push([n.id, outputSig]);
        continue;
      }

      // 收集当前下游 OutputNode（手动 + 自动）
      // 意图：N 个产物 → N 个独立 OutputNode。只要某个 OutputNode 仅从本节点连入且未带 pickKind，
      // 就给它“升级”为 pickKind+pickIndex（按 items 排序中未被占用的下一个），让它只显示一项；
      // 不够再补建 autoOutput 节点。
      const downstreamOutputs: Array<{
        id: string;
        pickKind?: string;
        pickIndex?: number;
        data?: any;
        incomingFromMe: number;
        auto: boolean;
        removable: boolean;
      }> = [];
      for (const e of edges) {
        if (e.source !== n.id) continue;
        const t = nodes.find((x) => x.id === e.target);
        if (!t || t.type !== 'output') continue;
        const td: any = t.data || {};
        // 限仅封闭: 如果该 OutputNode 还连了别的上游, 不能随便修改它的 pickKind
        const incomingFromMe = edges.filter((x) => x.target === t.id && x.source === n.id).length;
        const totalIncoming = edges.filter((x) => x.target === t.id).length;
        const hasOutgoing = edges.some((x) => x.source === t.id);
        const auto = t.id.startsWith('output-auto-') && e.id.startsWith('e-auto-');
        const removable = auto && totalIncoming === 1 && !hasOutgoing && td.userMoved !== true;
        if (totalIncoming > 1) {
          // 多上游合并节点 → 不动 data, 但计数占位
          downstreamOutputs.push({ id: t.id, pickKind: td.pickKind, pickIndex: td.pickIndex, data: td, incomingFromMe, auto, removable: false });
          continue;
        }
        downstreamOutputs.push({ id: t.id, pickKind: td.pickKind, pickIndex: td.pickIndex, data: td, incomingFromMe, auto, removable });
      }

      const itemKey = (it: { kind: string; kindIndex: number }) => {
        if (t === 'director-storyboard' && it.kind === 'video') {
          const directorItem = directorOutputItems[it.kindIndex];
          if (directorItem) return `director:${getDirectorStoryboardOutputItemBindingKey(directorItem)}`;
        }
        return `${it.kind}:${it.kindIndex}`;
      };
      const outputNodeItemKey = (data: any) => {
        if (t === 'director-storyboard') {
          const matched = findDirectorStoryboardOutputItemForNodeData(
            directorOutputItems,
            data,
            typeof data?.pickIndex === 'number' ? data.pickIndex : undefined,
          );
          if (matched) return `director:${getDirectorStoryboardOutputItemBindingKey(matched)}`;
        }
        const pickKind = typeof data?.pickKind === 'string' ? data.pickKind : '';
        const pickIndex = typeof data?.pickIndex === 'number' && Number.isInteger(data.pickIndex) ? data.pickIndex : -1;
        return pickKind && pickIndex >= 0 ? `${pickKind}:${pickIndex}` : '';
      };
      const validItemKeys = new Set(items.map(itemKey));
      const activeDownstreamOutputs = downstreamOutputs.filter((o) => {
        const existingKey = outputNodeItemKey(o.data);
        if (
          o.removable &&
          existingKey &&
          !validItemKeys.has(existingKey)
        ) {
          if (t !== 'director-storyboard' && shouldPreserveAutoOutputMaterialNode(nodeById.get(o.id), outputMaterialPersistenceEnabled)) {
            return true;
          }
          toRemoveNodeIds.add(o.id);
          for (const edge of edges) {
            if (edge.source === o.id || edge.target === o.id) toRemoveEdgeIds.add(edge.id);
          }
          return false;
        }
        return true;
      });

      if (activeDownstreamOutputs.length !== downstreamOutputs.length) {
        console.warn('[autoOutput] 清理过期自动输出节点', downstreamOutputs.length - activeDownstreamOutputs.length);
      }

      // 差异化处理:
      //   1) 已带 pickKind+pickIndex 的 → 计作“已占用该项”
      //   2) 未带 pickKind 的 → 依次升级为 items 中还未被占用的项
      const occupied = new Set<string>(); // key=`${kind}:${kindIndex}`
      for (const o of activeDownstreamOutputs) {
        const existingKey = outputNodeItemKey(o.data);
        if (existingKey) occupied.add(existingKey);
      }
      const upgradePatches: Array<[string, Record<string, any>]> = [];
      if (t === 'director-storyboard') {
        for (const o of activeDownstreamOutputs) {
          const existingKey = outputNodeItemKey(o.data);
          if (!existingKey) continue;
          const item = items.find((it) => itemKey(it) === existingKey);
          if (!item) continue;
          const patch = outputDataForItem(item);
          if (outputPatchChanged(o.data, patch)) upgradePatches.push([o.id, patch]);
        }
      }
      for (const o of activeDownstreamOutputs) {
        if (o.pickKind || outputNodeItemKey(o.data)) continue;
        // 指定下一个未占用项
        const next = items.find((it) => !occupied.has(itemKey(it)));
        if (!next) break;
        occupied.add(itemKey(next));
        upgradePatches.push([o.id, outputDataForItem(next)]);
      }

      // 仍然未被占用的 items 数量 = 需要补建的 OutputNode 个数
      const remainingItems = items.filter((it) => !occupied.has(itemKey(it)));
      const needCount = remainingItems.length;
      newSigPatches.push([n.id, outputSig]);

      // 接下来先应用 upgradePatches 再补建节点
      if (upgradePatches.length > 0) {
        const patchMap = new Map(upgradePatches);
        setNodes((prev) => {
          let changed = false;
          const next = prev.map((nd) => {
            const p = patchMap.get(nd.id);
            if (!p) return nd;
            if (!outputPatchChanged(nd.data, p)) return nd;
            changed = true;
            return { ...nd, data: { ...(nd.data as any), ...p } };
          });
          return changed ? next : prev;
        });
      }
      if (needCount <= 0) continue;

      const _srcRectGen = rectOf(n);
      const baseX = (n.position?.x ?? 0) + _srcRectGen.w + 80;

      // v1.2.10.5: 整组防重叠 —— 先算期望网格矩形, 再求公共偏移
      const _szGen = defaultSizeOf('output');
      // v1.2.10.7: baseY 让输出组垂直中心对齐源节点中心（handle 位置），避免输出偏上
      const _gridRows = Math.ceil(needCount / 3);
      const _groupHGen = (_gridRows - 1) * 360 + _szGen.h;
      const baseY = (n.position?.y ?? 0) + _srcRectGen.h / 2 - _groupHGen / 2;
      const _desiredGen: PlacementRect[] = remainingItems.slice(0, needCount).map((item) => {
        const idx = items.findIndex((it) => it.kind === item.kind && it.kindIndex === item.kindIndex);
        return {
          x: baseX + (idx % 3) * 350,
          y: baseY + Math.floor(idx / 3) * 360,
          w: _szGen.w, h: _szGen.h,
        };
      });
      const _offGen = placeBatchNodes(_desiredGen, [...nodes, ...pendingPlacedNodes], { source: 'placement:auto-output', gap: 0 });

      for (let i = 0; i < needCount; i++) {
        const item = remainingItems[i];
        if (!item) break;
        // 排列 offsetIndex 以 items 中 item 的全局位置为准，保证不同 kind 不会重叠
        const offsetIndex = items.findIndex((it) => it.kind === item.kind && it.kindIndex === item.kindIndex);
        const newId = `output-auto-${n.id}-${Date.now()}-${offsetIndex}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const _newNodeGen: Node = {
          id: newId,
          type: 'output',
          // 网格排列: 每行 3 个, 超过换行。
          // OutputNode 宽 320 + 横间距 30 = 列宽 350; 行高 360 (包含图像预览).
          // v1.2.10.5: 掠上 _offGen 避让现有节点。
          position: {
            x: baseX + (offsetIndex % 3) * 350 + _offGen.dx,
            y: baseY + Math.floor(offsetIndex / 3) * 360 + _offGen.dy,
          },
          // pickKind/pickIndex: 下游 OutputNode 只拾上游对应 kind 的第 kindIndex 项,
          // 避免多图场景下所有 OutputNode 都重复显示全部输出
          data: outputDataForItem(item),
          selected: false,
        } as Node;
        toAddNodes.push(_newNodeGen);
        // v1.2.10.5-hotfix3: 通用路径也必须累积到 pendingPlacedNodes，
        // 否则同一 effect 周期内后续源节点看不到本轮已创建的 OutputNode → 重叠
        pendingPlacedNodes.push(_newNodeGen);
        toAddEdges.push({
          id: `e-auto-${newId}`,
          source: n.id,
          target: newId,
          type: 'deletable',
        } as Edge);
      }
    }

    if (toRemoveNodeIds.size > 0) {
      for (const edge of edges) {
        if (toRemoveNodeIds.has(edge.source) || toRemoveNodeIds.has(edge.target)) {
          toRemoveEdgeIds.add(edge.id);
        }
      }
    }

    // 先写 ref 避免下次 useEffect 重进入重复创建
    for (const [id, sig] of newSigPatches) autoOutputProcessedRef.current.set(id, sig);
    if (toRemoveNodeIds.size > 0 || toAddNodes.length > 0) {
      if (toAddNodes.length > 0) {
        console.warn('[autoOutput] 创建', toAddNodes.length, '个节点, pending累积:', pendingPlacedNodes.length,
        '\n  positions:', toAddNodes.map(n => `${n.id.slice(0,20)}.. (${Math.round(n.position.x)},${Math.round(n.position.y)})`));
      }
      const baseNodes = nodes.filter((node) => !toRemoveNodeIds.has(node.id));
      const assignedToAdd = assignActiveNodeSerials(toAddNodes, baseNodes);
      if (assignedToAdd.length > 0) registerPlacementShelfNodes(assignedToAdd, '生成');
      setNodes((prev) => [
        ...prev.filter((node) => !toRemoveNodeIds.has(node.id)),
        ...assignedToAdd,
      ]);
    }
    if (toRemoveEdgeIds.size > 0 || toAddEdges.length > 0) {
      setEdges((prev) => [
        ...prev.filter((edge) => !toRemoveEdgeIds.has(edge.id)),
        ...toAddEdges,
      ]);
    }
  }, [nodes, edges, loaded, assignActiveNodeSerials, registerPlacementShelfNodes, outputMaterialPersistenceEnabled]);

  // ===== 自动外挂 OutputNode 的网格重排 =====
  // 创建时使用了固定占位坐标 (350x360), 但节点实际宽高取决于
  // 里面的图片/视频 measured 尺寸, 会造成节点互相遮挡。
  // 本 useEffect 以 e-auto- 开头的 edge 定位出同一上游下的所有自动 OutputNode,
  // 按 pickIndex 排序, 取各列 max(width)、各行 max(height) 作为列宽/行高,
  // 重新计算 position 使节点沿边对齐且互不遮挡。
  // 只动 id 以 'output-auto-' 开头的节点, 避免影响手动创建的 OutputNode。
  const REORDER_GAP = 30;
  const REORDER_COLS = 3;
  useEffect(() => {
    if (!loaded) return;
    // 按 source 分组收集自动外挂的 OutputNode
    const groups = new Map<string, Node[]>();
    for (const e of edges) {
      if (!e.id.startsWith('e-auto-')) continue;
      const target = nodes.find((n) => n.id === e.target);
      if (!target || target.type !== 'output') continue;
      if (!target.id.startsWith('output-auto-')) continue;
      let g = groups.get(e.source);
      if (!g) {
        g = [];
        groups.set(e.source, g);
      }
      g.push(target);
    }
    if (groups.size === 0) return;

    const updates = new Map<string, { x: number; y: number }>();
    for (const [srcId, list] of groups) {
      const src = nodes.find((n) => n.id === srcId);
      if (!src) continue;
      // 按 pickIndex 排序, 保证顺序与上游输出一致
      list.sort((a, b) => {
        const ai = (a.data as any)?.pickIndex ?? 0;
        const bi = (b.data as any)?.pickIndex ?? 0;
        return ai - bi;
      });
      // measured 优先, 未渲染出来前回退到占位尺寸
      const dims = list.map((n) => ({
        w: (n as any).measured?.width || (n as any).width || 320,
        h: (n as any).measured?.height || (n as any).height || 360,
      }));
      const rowsCount = Math.ceil(list.length / REORDER_COLS);
      const colMaxW = new Array(REORDER_COLS).fill(0);
      const rowMaxH = new Array(rowsCount).fill(0);
      list.forEach((_, i) => {
        const c = i % REORDER_COLS;
        const r = Math.floor(i / REORDER_COLS);
        if (dims[i].w > colMaxW[c]) colMaxW[c] = dims[i].w;
        if (dims[i].h > rowMaxH[r]) rowMaxH[r] = dims[i].h;
      });
      // 累加出各列 / 各行 的起点偏移
      const colX = new Array(REORDER_COLS).fill(0);
      for (let c = 1; c < REORDER_COLS; c++) {
        colX[c] = colX[c - 1] + colMaxW[c - 1] + REORDER_GAP;
      }
      const rowY = new Array(rowsCount).fill(0);
      for (let r = 1; r < rowsCount; r++) {
        rowY[r] = rowY[r - 1] + rowMaxH[r - 1] + REORDER_GAP;
      }
      const srcW = (src as any).measured?.width || (src as any).width || 320;
      const srcH = (src as any).measured?.height || (src as any).height || 360;
      // v1.2.10.5-hotfix4: reorder 只负责内部网格对齐，不做碰撞避让（避让是 autoOutput 的职责）。
      // 用第一个节点的当前位置作为锚点，保留 autoOutput 算好的偏移，避免无限循环。
      const naturalBaseX = (src.position?.x ?? 0) + srcW + 80;
      // v1.2.10.7: naturalBaseY 对齐源节点垂直中心
      const _totalGridH = rowY[rowsCount - 1] + rowMaxH[rowsCount - 1];
      const naturalBaseY = (src.position?.y ?? 0) + srcH / 2 - _totalGridH / 2;
      const firstNode = list[0];
      const baseX = firstNode.position?.x ?? naturalBaseX;
      const baseY = firstNode.position?.y ?? naturalBaseY;
      // 内部网格布局：直接用 baseX + colX/rowY 对齐，不做外部碰撞检测（避免无限循环）
      list.forEach((n, i) => {
        const c = i % REORDER_COLS;
        const r = Math.floor(i / REORDER_COLS);
        const newX = baseX + colX[c];
        const newY = baseY + rowY[r];
        const cx = n.position?.x ?? 0;
        const cy = n.position?.y ?? 0;
        // 用户手动拖动过的节点 (data.userMoved=true) 跳过, 保留位置
        if ((n.data as any)?.userMoved === true) return;
        // 误差大于 1px 才修正, 避免微量抖动触发无限重渲染
        if (Math.abs(cx - newX) > 1 || Math.abs(cy - newY) > 1) {
          updates.set(n.id, { x: newX, y: newY });
        }
      });
    }
    if (updates.size > 0) {
      setNodes((prev) =>
        prev.map((n) => {
          const p = updates.get(n.id);
          return p ? { ...n, position: p } : n;
        })
      );
    }
  }, [nodes, edges, loaded]);

  // ===== 外部素材粘贴: Ctrl+V 图像/视频/音频直接生成上传素材节点 =====
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!activeId || isTextEditingTarget(e.target)) return;
      if (document.querySelector('.img-edit-overlay')) return;
      const files = collectCanvasMediaFiles(e.clipboardData);
      if (files.length === 0) return;
      const mediaSignature = files
        .map(canvasMediaFileKey)
        .join('||');
      const now = Date.now();
      const last = lastExternalMediaPasteRef.current;
      const shouldReleaseConsumedExternalMedia = shouldPreferInternalNodeClipboardPaste({
        hasInternalNodes: Boolean(clipboardRef.current?.nodes?.length),
        internalCopiedAt: internalClipboardCopiedAtRef.current,
        now,
        mediaSignature,
        lastExternalMediaSignature: last?.mediaSignature,
        lastExternalPasteAt: last?.at,
      });
      if (shouldReleaseConsumedExternalMedia) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const pointerTarget = lastCanvasPointerRef.current
        ? document.elementFromPoint(lastCanvasPointerRef.current.x, lastCanvasPointerRef.current.y)
        : null;
      const uploadTargetNodeId =
        findUploadNodeIdFromTarget(e.target) ||
        findUploadNodeIdFromTarget(pointerTarget);
      if (internalPasteTimerRef.current) {
        window.clearTimeout(internalPasteTimerRef.current);
        internalPasteTimerRef.current = null;
      }
      const actionSignature = `${uploadTargetNodeId || 'new-upload-node'}::${mediaSignature}`;
      e.preventDefault();
      e.stopPropagation();
      if (last?.signature === actionSignature && now - last.at < EXTERNAL_MEDIA_PASTE_DEDUPE_MS) return;
      lastExternalMediaPasteRef.current = { signature: actionSignature, mediaSignature, at: now };
      if (uploadTargetNodeId) {
        void replaceUploadNodeFromFiles(uploadTargetNodeId, files);
        return;
      }
      void createUploadNodesFromFiles(files);
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [activeId, createUploadNodesFromFiles, replaceUploadNodeFromFiles]);

  const focusNearestNodeToViewport = useCallback(() => {
    if (!loaded || loadedCanvasId !== activeId) return;
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    if (!flowEl) return;
    const bounds = flowEl.getBoundingClientRect();
    const viewportCenter = screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    const nearest = findNearestNavigableNode(nodes, viewportCenter);
    if (!nearest) {
      logBus.warn('当前画布没有可定位节点', '快捷键 G');
      return;
    }
    const rect = rectOf(nearest);
    const currentZoom = getViewport().zoom || 1;
    const zoom = Math.min(Math.max(currentZoom, 0.55), 1.15);
    setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom, duration: 450 });
    pulseNearestNode(nearest.id);
  }, [activeId, getViewport, loaded, loadedCanvasId, nodes, screenToFlowPosition, setCenter]);

  const focusCanvasCenter = useCallback(() => {
    if (!loaded || loadedCanvasId !== activeId) return;
    const center = centerOfNavigableNodes(nodesRef.current);
    const { zoom } = getViewport();
    setCenter(center.x, center.y, { zoom, duration: 420 });
  }, [activeId, getViewport, loaded, loadedCanvasId, setCenter]);

  const focusNodeBySerialId = useCallback(() => {
    if (!loaded || loadedCanvasId !== activeId) return;
    setNodeIdDialog({
      mode: 'find',
      value: '',
      title: '查找 NodeID',
      description: '输入节点编号后，画布会定位到该节点并高亮提示。',
      placeholder: '#12 或 12',
    });
  }, [activeId, loaded, loadedCanvasId]);

  const focusGenerationHistoryNode = useCallback((nodeId: string) => {
    if (!loaded || loadedCanvasId !== activeId) return;
    const target = nodesRef.current.find((node) => node.id === nodeId);
    if (!target) {
      logBus.warn('历史记录的来源节点已经不存在', '历史记录');
      return;
    }
    setNodes((prev) => prev.map((node) => ({ ...node, selected: node.id === nodeId })));
    const rect = rectOf(target);
    const currentZoom = getViewport().zoom || 1;
    const zoom = Math.min(Math.max(currentZoom, 0.55), 1.15);
    setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom, duration: 450 });
    pulseNearestNode(target.id);
  }, [activeId, getViewport, loaded, loadedCanvasId, setCenter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoffId = String(params.get('zcanvasHandoff') || '').trim();
    const action = String(params.get('zcanvasAction') || '').trim();
    const canvasId = String(params.get('zcanvasCanvasId') || '').trim();
    const nodeId = String(params.get('zcanvasNodeId') || '').trim();
    if (!handoffId || handledBrowserHandoffsRef.current.has(handoffId) || action !== 'highlight') return;
    if (!loaded || loadedCanvasId !== activeId || canvasId !== activeId || !nodeId) return;
    const target = nodesRef.current.find((node) => node.id === nodeId);
    if (!target) {
      logBus.warn('Agent 请求高亮的节点已不存在，未修改画布', 'Canvas Agent');
      return;
    }
    handledBrowserHandoffsRef.current.add(handoffId);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    const rect = rectOf(target);
    const currentZoom = getViewport().zoom || 1;
    const zoom = Math.min(Math.max(currentZoom, 0.55), 1.15);
    setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, { zoom, duration: 450 });
    pulseNearestNode(nodeId);
    params.delete('zcanvasHandoff');
    params.delete('zcanvasAction');
    params.delete('zcanvasCanvasId');
    params.delete('zcanvasNodeId');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [activeId, getViewport, loaded, loadedCanvasId, setCenter]);

  // ===== 全局快捷键 =====
  useEffect(() => {
    const clipboardHandledEvents = new WeakSet<KeyboardEvent>();
    const isEditingEvent = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      return tag === 'input'
        || tag === 'textarea'
        || tag === 'select'
        || (event.target as HTMLElement | null)?.isContentEditable;
    };
    const scheduleInternalNodePaste = () => {
      if (!clipboardRef.current?.nodes?.length) return false;
      // Let the real paste event fire first. A fresh node copy wins over stale
      // system media; otherwise genuine screenshots/files can still be pasted.
      if (internalPasteTimerRef.current) window.clearTimeout(internalPasteTimerRef.current);
      internalPasteTimerRef.current = window.setTimeout(() => {
        internalPasteTimerRef.current = null;
        const lastExternalPaste = lastExternalMediaPasteRef.current;
        if (
          lastExternalPaste
          && Date.now() - lastExternalPaste.at < EXTERNAL_MEDIA_PASTE_DEDUPE_MS
          && internalClipboardCopiedAtRef.current <= lastExternalPaste.at
        ) return;
        handlePaste(false);
      }, INTERNAL_NODE_PASTE_DELAY_MS);
      return true;
    };
    const onClipboardKeyCapture = (e: KeyboardEvent) => {
      if (document.querySelector('[data-canvas-floating-ui="image-detail-viewer"]')) return;
      if (isEditingEvent(e)) return;
      if (matchesAnyShortcut(shortcuts['canvas.copy'], e)) {
        clipboardHandledEvents.add(e);
        e.preventDefault();
        handleCopy();
        return;
      }
      if (matchesAnyShortcut(shortcuts['canvas.paste-links'], e)) {
        clipboardHandledEvents.add(e);
        e.preventDefault();
        handlePaste(true);
        return;
      }
      if (matchesAnyShortcut(shortcuts['canvas.paste'], e) && scheduleInternalNodePaste()) {
        clipboardHandledEvents.add(e);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-canvas-floating-ui="image-detail-viewer"]')) return;
      if (clipboardHandledEvents.has(e)) return;
      // 当焦点在表单元素中时不拦截
      const isEditing = isEditingEvent(e);
      // Undo / Redo 全局拦截(即使在输入框,Ctrl+Z 也属于画布,但更友好的是输入框内不抢占)
      if (matchesAnyShortcut(shortcuts['canvas.undo'], e)) {
        if (isEditing) return;
        e.preventDefault();
        histUndo();
        return;
      }
      if (matchesAnyShortcut(shortcuts['canvas.redo'], e)) {
        if (isEditing) return;
        e.preventDefault();
        histRedo();
        return;
      }
      if (isEditing) return;
      if (matchesAnyShortcut(shortcuts['canvas.copy'], e)) {
        e.preventDefault();
        handleCopy();
      } else if (matchesAnyShortcut(shortcuts['canvas.paste-links'], e)) {
        // Ctrl+Shift+V: 连边粘贴 — 新节点与原画布邻居保持连接
        e.preventDefault();
        handlePaste(true);
      } else if (matchesAnyShortcut(shortcuts['canvas.paste'], e)) {
        scheduleInternalNodePaste();
      } else if (matchesAnyShortcut(shortcuts['canvas.duplicate'], e)) {
        e.preventDefault();
        handleDuplicate();
      } else if (matchesAnyShortcut(shortcuts['canvas.group'], e)) {
        // Ctrl+G: 快捷打组 (默认浏览器会拦截为「查找下一个」，必须 preventDefault)
        e.preventDefault();
        const selIds = nodes
          .filter((n) => n.selected && n.type !== 'groupBox')
          .map((n) => n.id);
        if (selIds.length >= 1) handleCreateGroup(selIds);
      } else if (matchesAnyShortcut(shortcuts['canvas.center-view'], e)) {
        if (selectedCount > 0) return;
        const activeEl = document.activeElement as HTMLElement | null;
        if (
          isCanvasOverviewShortcutBlocked(e.target) ||
          isCanvasOverviewShortcutBlocked(activeEl) ||
          document.querySelector(
            [
              '[data-canvas-floating-ui="image-compare-modal"]',
              '[data-canvas-floating-ui="image-detail-viewer"]',
              '[data-canvas-floating-ui="portrait-master-editor"]',
              '[data-canvas-floating-ui="send-materials-modal"]',
              '[data-canvas-floating-ui="picker-menu"]',
              '[data-canvas-floating-ui="node-menu"]',
              '[data-canvas-floating-ui="pane-menu"]',
            ].join(','),
          )
        ) {
          return;
        }
        e.preventDefault();
        focusCanvasCenter();
      } else if (matchesAnyShortcut(shortcuts['canvas.overview'], e) || matchesAnyShortcut(shortcuts['canvas.nearest-node'], e)) {
        const isNearestShortcut = matchesAnyShortcut(shortcuts['canvas.nearest-node'], e);
        if (isNearestShortcut && selectedCount > 0) return;
        const activeEl = document.activeElement as HTMLElement | null;
        if (
          isCanvasOverviewShortcutBlocked(e.target) ||
          isCanvasOverviewShortcutBlocked(activeEl) ||
          document.querySelector(
            [
              '[data-canvas-floating-ui="image-compare-modal"]',
              '[data-canvas-floating-ui="image-detail-viewer"]',
              '[data-canvas-floating-ui="portrait-master-editor"]',
              '[data-canvas-floating-ui="send-materials-modal"]',
              '[data-canvas-floating-ui="picker-menu"]',
              '[data-canvas-floating-ui="node-menu"]',
              '[data-canvas-floating-ui="pane-menu"]',
            ].join(','),
          )
        ) {
          return;
        }
        e.preventDefault();
        if (!isNearestShortcut) {
          fitView({ ...CANVAS_OVERVIEW_FIT_OPTIONS, duration: 420 });
        } else {
          focusNearestNodeToViewport();
        }
      } else if (matchesAnyShortcut(shortcuts['canvas.delete'], e)) {
        // xyflow 内置 Backspace 删除,但在节点未选中时仍可能删除连线;
        // 我们手动处理仅删除选中,避免输入边缘情况
        if (selectedCount > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (matchesAnyShortcut(shortcuts['canvas.select-all'], e)) {
        e.preventDefault();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
      }
    };
    window.addEventListener('keydown', onClipboardKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onClipboardKeyCapture, true);
      window.removeEventListener('keydown', onKey);
      if (internalPasteTimerRef.current) {
        window.clearTimeout(internalPasteTimerRef.current);
        internalPasteTimerRef.current = null;
      }
    };
  }, [histUndo, histRedo, handleCopy, handlePaste, handleDuplicate, handleDeleteSelected, handleCreateGroup, nodes, selectedCount, fitView, focusCanvasCenter, focusNearestNodeToViewport, shortcuts]);

  // 全局滚轮拦截 —— 自动给所有节点内的 input / textarea / select / contenteditable
  // 挂上 wheel.stopPropagation()，让用户在文本框内可用鼠标滚轮滚动文字而不触发画布缩放。
  // 通过 MutationObserver 自动覆盖未来动态新增的节点（如右键添加 / 模板插入等）。
  useEffect(() => {
    const root = (document.querySelector('.react-flow') as HTMLElement | null) || document.body;
    const dispose = installGlobalWheelBlockObserver(root);
    return dispose;
  }, []);

  // ReactFlow 会在 pointerdown capture 阶段启动节点选中/拖拽。
  // 节点内按钮（尤其运行按钮）必须先挡住 down 事件，否则未选中节点的首次点击可能只激活节点。
  useEffect(() => {
    const isNodeButtonDown = (event: PointerEvent | MouseEvent) => {
      if (event.button !== 0) return false;
      if ('isPrimary' in event && event.isPrimary === false) return false;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return false;
      if (target.closest('[data-director-timeline-resize-handle]')) return false;
      const button = target.closest('button, [role="button"]') as HTMLElement | null;
      if (!button) return false;
      if (button.closest('[data-node-action-bar]')) return false;
      return !!button.closest('.react-flow__node, [data-node-action-bar]');
    };

    const stopNodeButtonDown = (event: PointerEvent | MouseEvent) => {
      if (!isNodeButtonDown(event)) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener('pointerdown', stopNodeButtonDown, true);
    document.addEventListener('mousedown', stopNodeButtonDown, true);
    return () => {
      document.removeEventListener('pointerdown', stopNodeButtonDown, true);
      document.removeEventListener('mousedown', stopNodeButtonDown, true);
    };
  }, []);

  const requestedPerformanceMode = useCanvasPerformanceStore((state) => state.mode);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const heavyMediaCount = useMemo(() => estimateCanvasHeavyMediaCount(nodes), [nodes]);
  const performanceDecision = useMemo(() => {
    const nav = typeof navigator === 'undefined'
      ? undefined
      : navigator as Navigator & { deviceMemory?: number };
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    return resolveCanvasPerformanceDecision(requestedPerformanceMode, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      heavyMediaCount,
      hardwareConcurrency: nav?.hardwareConcurrency,
      deviceMemoryGb: nav?.deviceMemory,
      prefersReducedMotion,
    });
  }, [edges.length, heavyMediaCount, nodes.length, requestedPerformanceMode]);

  useEffect(() => {
    if (performanceDecision.effective !== 'performance') return undefined;
    const shell = canvasShellRef.current;
    if (!shell) return undefined;
    return installCanvasNodeVisibilityObserver(shell);
  }, [loadedCanvasId, performanceDecision.effective]);

  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const isDecorativeEdgeVisual = isSlamdunk || isSoccer || isDragonBall || isTetris || isFarmStory || isGardenDefense;
  const heavyEdgeMotion = isDecorativeEdgeVisual && edges.length >= EDGE_MOTION_HEAVY_EDGE_COUNT;
  const edgeMotionReduced = isDecorativeEdgeVisual && (viewportMoving || nodeDragging);
  const edgeMotionMode = isDecorativeEdgeVisual ? (edgeMotionReduced ? 'reduced' : 'scoped') : undefined;
  const heavyCanvasSurface = performanceDecision.effective === 'performance'
    || nodes.length >= 96
    || edges.length >= EDGE_MOTION_HEAVY_EDGE_COUNT;
  const farmStoryToolbarHint = useMemo(
    () => (isFarmStory ? buildFarmToolbarConsoleHint(farmCanvas, farmStoryPanelOpen) : undefined),
    [farmCanvas, farmStoryPanelOpen, isFarmStory],
  );
  const farmTopNotice = useMemo<FarmFollowupNotice | null>(() => {
    if (!isFarmStory) return null;
    if (farmFollowupNotice) return farmFollowupNotice;
    return {
      id: 'farm-feedback-current',
      createdAt: 0,
      message: farmCanvasFeedback || '点击工具后，在画布空白处开始经营。',
      tone: 'success',
      routeTitle: '当前提示',
    };
  }, [farmCanvasFeedback, farmFollowupNotice, isFarmStory]);
  const farmMiniMapMarkers = useMemo(
    () => (isFarmStory ? buildFarmMiniMapMarkers(farmCanvas, { maxMarkers: FARM_MINIMAP_MARKER_LIMIT }) : []),
    [farmCanvas, isFarmStory],
  );
  const farmMiniMapRenderableMarkers = useMemo(
    () => (isFarmStory ? layoutFarmMiniMapMarkers(farmMiniMapMarkers, nodes) : []),
    [farmMiniMapMarkers, isFarmStory, nodes],
  );
  const farmMiniMapRouteHintMarkers = useMemo(
    () => (
      farmMiniMapRouteHint
        ? farmMiniMapRenderableMarkers.filter((marker) => farmMiniMapMarkerMatchesRouteTarget(marker, farmMiniMapRouteHint.target))
        : []
    ),
    [farmMiniMapRenderableMarkers, farmMiniMapRouteHint],
  );
  const farmMiniMapRouteHintMarker = useMemo(() => {
    return findNearestFarmMiniMapRouteHintMarker(farmMiniMapRouteHintMarkers, farmMiniMapRouteHint?.anchor);
  }, [farmMiniMapRouteHint?.anchor, farmMiniMapRouteHintMarkers]);
  const farmMiniMapRouteHintCountLabel = useMemo(() => {
    if (!farmMiniMapRouteHint) return '';
    const routeHitCount = farmMiniMapRouteHintMarkers.reduce((total, marker) => total + (marker.clusterCount || 1), 0);
    if (routeHitCount <= 0) return '暂无目标';
    const unit = farmMiniMapRouteHint.target === 'ready-order'
      ? '单'
      : farmMiniMapRouteHint.target === 'building-yield-summary'
        ? '项'
        : '处';
    return `${routeHitCount}${unit}`;
  }, [farmMiniMapRouteHint, farmMiniMapRouteHintMarkers]);
  useEffect(() => {
    if (!farmMiniMapRouteHint) return;
    if (!farmMiniMapRouteHintMarker) {
      const center = getFarmViewportCenter();
      pushFarmFloatingFeedback({
        x: center.x,
        y: center.y,
        message: `路线暂无目标：${farmMiniMapRouteHint.label}`,
        tone: 'warning',
      });
      return;
    }
    const centerX = farmMiniMapRouteHintMarker.x + farmMiniMapRouteHintMarker.width / 2;
    const centerY = farmMiniMapRouteHintMarker.y + farmMiniMapRouteHintMarker.height / 2;
    const { zoom } = getViewport();
    setCenter(centerX, centerY, { zoom, duration: 420 });
    setFarmCanvasEditing(true);
    setCreativeDeskEditing(false);
    setRadialSettingsOpen(false);
    setModelHelpOpen(false);
    if (farmMiniMapRouteHint.target === 'mature-crop' || farmMiniMapRouteHintMarker.kind === 'mature') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'harvest' }));
    } else if (farmMiniMapRouteHint.target === 'water' || farmMiniMapRouteHintMarker.kind === 'dry') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'water' }));
    } else if (farmMiniMapRouteHint.target === 'withered-crop' || farmMiniMapRouteHintMarker.kind === 'withered') {
      setFarmCanvas((prev) => sanitizeFarmCanvasState({ ...prev, selectedTool: 'shovel' }));
    }
    if (farmMiniMapRouteHintMarker.objectId) {
      flashFarmObject(farmMiniMapRouteHintMarker.objectId);
    }
    pushFarmFloatingFeedback({
      x: centerX,
      y: centerY,
      message: `已点亮路线：${farmMiniMapRouteHint.label || farmMiniMapRouteHintMarker.label} · ${farmMiniMapRouteHintCountLabel}`,
      tone: farmMiniMapMarkerTone(farmMiniMapRouteHintMarker.kind),
    });
  }, [farmMiniMapRouteHint, farmMiniMapRouteHintCountLabel, farmMiniMapRouteHintMarker, flashFarmObject, getFarmViewportCenter, getViewport, pushFarmFloatingFeedback, setCenter]);
  const renderedNodes = useMemo(
    () => {
      const themedNodes = isFarmStory
        ? nodes.map(withFarmNodeVisualState)
        : isGardenDefense
          ? nodes.map(withGardenDefenseNodeVisualState)
          : nodes;
      const collapsedMemberIds = new Set<string>();
      themedNodes.forEach((node) => {
        if (node.type !== 'groupBox' || (node.data as any)?.performanceCollapsed !== true) return;
        const memberIds = Array.isArray((node.data as any)?.memberIds) ? (node.data as any).memberIds : [];
        memberIds.forEach((memberId: unknown) => {
          if (typeof memberId === 'string' && memberId) collapsedMemberIds.add(memberId);
        });
      });
      const proxiedNodes = themedNodes.map((node) => {
        const pinned = isPerformancePinnedNode(node);
        const className = [
          typeof node.className === 'string' ? node.className : '',
          performanceDecision.effective === 'performance' && pinned ? 't8-performance-pinned' : '',
          collapsedMemberIds.has(node.id) && !pinned ? 't8-group-proxy-member' : '',
        ].filter(Boolean).join(' ');
        return className === node.className ? node : { ...node, className };
      });
      return runReplayRuntime ? [...proxiedNodes, ...runReplayRuntime.nodes] : proxiedNodes;
    },
    [isFarmStory, isGardenDefense, nodes, performanceDecision.effective, runReplayRuntime],
  );
  const renderedEdges = useMemo(
    () => runReplayRuntime ? [...edges, ...runReplayRuntime.edges] : edges,
    [edges, runReplayRuntime],
  );
  const farmMiniMapHeavySurface = isFarmStory
    && ((farmCanvas.objects.length + farmCanvas.animals.length) >= FARM_MINIMAP_HEAVY_OBJECT_COUNT
      || farmMiniMapMarkers.length >= FARM_MINIMAP_MARKER_LIMIT);
  const farmMiniMapVisible = isFarmStory
    && farmMiniMapRenderableMarkers.length > 0
    && !((viewportMoving || nodeDragging) && (heavyCanvasSurface || farmMiniMapHeavySurface));
  const guideColor = themeTokens.edgeSelected;
  const edgeStroke = themeTokens.edge;
  const dotColor = themeTokens.gridDot;
  const bgColor = themeTokens.canvasBg;

  const memoNodeTypes = useMemo(() => nodeTypes, []);
  const memoEdgeTypes = useMemo(
    () => performanceDecision.effective === 'performance' ? performanceEdgeTypes : edgeTypes,
    [performanceDecision.effective],
  );
  const memoConnectionLineComponent = useMemo(
    () => (isFarmStory ? FarmStoryConnectionLine : undefined),
    [isFarmStory],
  );

  // ⚠️ 以下几个在 ReactFlow 的 fieldsToTrack 列表中, 必须稳定引用,
  // 否则每次父组件 render 都会让 StoreUpdater 重复 store.setState 反复触发订阅者,
  // 在某些节点拓扑下会退化为 Maximum update depth exceeded。
  const memoSelectionKeyCode = useMemo(() => ['Control', 'Meta'] as string[], []);
  const memoMultiSelectionKeyCode = useMemo(
    () => ['Control', 'Meta', 'Shift'] as string[],
    []
  );
  const memoProOptions = useMemo(() => ({ hideAttribution: true }), []);
  const memoDefaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: edgeStroke, strokeWidth: isPixel ? 2.5 : 2 },
      animated: false,
    }),
    [edgeStroke, isPixel]
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!isDecorativeEdgeVisual) {
      root.removeAttribute('data-t8-edge-motion');
      root.removeAttribute('data-t8-edge-load');
      return;
    }
    root.setAttribute('data-t8-edge-motion', edgeMotionMode || 'scoped');
    root.setAttribute('data-t8-edge-load', heavyEdgeMotion ? 'heavy' : 'normal');
    return () => {
      root.removeAttribute('data-t8-edge-motion');
      root.removeAttribute('data-t8-edge-load');
    };
  }, [edgeMotionMode, heavyEdgeMotion, isDecorativeEdgeVisual]);

  // Creator performs project/canvas-scoped reads as soon as it opens. Do not
  // mount it from transport readiness alone: the authoritative document,
  // revision, and ReactFlow viewport must all belong to the rendered canvas.
  const creatorAgentCanvasReady = loaded
    && loadedCanvasId === renderedCanvasId
    && initializedFlowCanvasId === renderedCanvasId
    && activeProjectId != null
    && Number.isSafeInteger(activeCanvasRevision)
    && activeCanvasRevision > 0;

  const surfaceReadiness = useMemo<CanvasSurfaceReadiness>(() => {
    const loadFailure = canvasLoadFailure?.canvasId === renderedCanvasId ? canvasLoadFailure : null;
    if (!renderedCanvasId) {
      return {
        phase: 'empty',
        canvasId: null,
        loadedCanvasId,
        revision: activeCanvasRevision,
        flowCanvasId: initializedFlowCanvasId,
        error: null,
      };
    }
    if (loadFailure) {
      return {
        phase: 'failed',
        canvasId: renderedCanvasId,
        loadedCanvasId,
        revision: activeCanvasRevision,
        flowCanvasId: initializedFlowCanvasId,
        error: loadFailure.message,
      };
    }
    if (!loaded
      || loadedCanvasId !== renderedCanvasId
      || activeProjectId == null
      || !Number.isSafeInteger(activeCanvasRevision)
      || activeCanvasRevision < 1) {
      return {
        phase: 'document',
        canvasId: renderedCanvasId,
        loadedCanvasId,
        revision: activeCanvasRevision,
        flowCanvasId: initializedFlowCanvasId,
        error: null,
      };
    }
    if (initializedFlowCanvasId !== renderedCanvasId) {
      return {
        phase: 'flow',
        canvasId: renderedCanvasId,
        loadedCanvasId,
        revision: activeCanvasRevision,
        flowCanvasId: initializedFlowCanvasId,
        error: null,
      };
    }
    return {
      phase: 'ready',
      canvasId: renderedCanvasId,
      loadedCanvasId,
      revision: activeCanvasRevision,
      flowCanvasId: initializedFlowCanvasId,
      error: null,
    };
  }, [
    activeCanvasRevision,
    activeProjectId,
    canvasLoadFailure,
    initializedFlowCanvasId,
    loaded,
    loadedCanvasId,
    renderedCanvasId,
  ]);

  useEffect(() => {
    onReadinessChange?.(surfaceReadiness);
  }, [onReadinessChange, surfaceReadiness]);

  useEffect(() => {
    if (!onRetryLoadRef) return undefined;
    onRetryLoadRef.current = () => setCanvasLoadAttempt((attempt) => attempt + 1);
    return () => {
      onRetryLoadRef.current = null;
    };
  }, [onRetryLoadRef]);

  if (!renderedCanvasId) {
    return (
      <div
        className="t8-canvas-shell flex-1 flex items-center justify-center"
        data-theme-visual={visualStyle}
        data-theme-mode={theme}
        style={{ background: bgColor, color: themeTokens.textMuted }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2 font-bold tracking-wide">{t('canvas:state.noCanvasTitle')}</div>
          <p>{t('canvas:state.noCanvas')}</p>
        </div>
      </div>
    );
  }
  if (!loaded || loadedCanvasId !== renderedCanvasId) {
    const loadFailure = canvasLoadFailure?.canvasId === renderedCanvasId ? canvasLoadFailure : null;
    return (
      <div
        className="t8-canvas-shell flex-1 flex items-center justify-center px-6"
        data-theme-visual={visualStyle}
        data-theme-mode={theme}
        data-canvas-load-state={loadFailure ? 'failed' : 'loading'}
        aria-busy={!loadFailure}
        style={{ background: bgColor, color: themeTokens.textMuted }}
      >
        {loadFailure ? (
          <div role="alert" className="max-w-lg rounded-2xl border border-red-500/40 bg-[var(--bg-secondary)]/95 p-6 text-center shadow-2xl">
            <LucideIcons.AlertTriangle className="mx-auto mb-3 text-red-500" size={30} aria-hidden="true" />
            <h2 className="text-base font-bold text-[var(--text-primary)]">{t('canvas:state.loadFailed')}</h2>
            <p className="mt-2 break-words text-sm leading-6 text-[var(--text-secondary)]">{loadFailure.message}</p>
            <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">{t('canvas:state.readOnlyUntilLoaded')}</p>
            <button
              type="button"
              className="mx-auto mt-5 flex h-10 items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-5 text-sm font-bold text-white"
              onClick={() => setCanvasLoadAttempt((attempt) => attempt + 1)}
            >
              <LucideIcons.RefreshCw size={16} aria-hidden="true" />
              {t('canvas:state.retryLoad')}
            </button>
          </div>
        ) : (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/90 px-5 py-4 text-sm">
            <LucideIcons.LoaderCircle className="animate-spin text-[var(--accent-primary)]" size={20} aria-hidden="true" />
            {t('canvas:state.loadingAuthoritative')}
          </div>
        )}
      </div>
    );
  }


  const floatingControlRail = (
    <>
      <div className="t8-control-rail nodrag nopan" data-canvas-floating-ui="control-rail">
        <div className="t8-control-stack">
          <div
            className="t8-control-rail-creator-slot"
            data-canvas-floating-ui="creator-agent-launcher-slot"
          />
          <div className="t8-control-tools" data-canvas-floating-ui="control-tools">
            <button
              type="button"
              className={`t8-control-rail-help t8-control-tools-toggle t8-mini-icon-button${controlToolsOpen ? ' is-active' : ''}`}
              data-canvas-floating-ui="control-tools-toggle"
              aria-label={controlToolsOpen ? t('canvas:controls.toolsClose') : t('canvas:controls.toolsOpen')}
              title={controlToolsOpen ? t('canvas:controls.toolsClose') : t('canvas:controls.toolsOpen')}
              aria-expanded={controlToolsOpen}
              onClick={(event) => {
                event.stopPropagation();
                setControlToolsOpen((value) => !value);
              }}
            >
              <LucideIcons.Wrench size={16} />
            </button>
            {controlToolsOpen && (
              <div
                className="t8-control-tools-menu"
                data-canvas-floating-ui="control-tools-menu"
                role="menu"
                aria-label={t('canvas:controls.tools')}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={workflowDoctorEnabled ? 'is-active' : ''}
                  data-canvas-floating-ui="workflow-doctor-toggle"
                  data-workflow-doctor-enabled={workflowDoctorEnabled ? 'true' : 'false'}
                  role="menuitemcheckbox"
                  aria-checked={workflowDoctorEnabled}
                  onClick={() => {
                    toggleWorkflowDoctor();
                    setControlToolsOpen(false);
                  }}
                >
                  <LucideIcons.Stethoscope size={16} />
                  <span>{workflowDoctorEnabled ? t('canvas:controls.doctorOn') : t('canvas:controls.doctorOff')}</span>
                </button>
                <button
                  type="button"
                  className={modelHelpOpen ? 'is-active' : ''}
                  data-canvas-floating-ui="model-help-toggle"
                  role="menuitem"
                  onClick={() => {
                    setModelHelpOpen((value) => {
                      const next = !value;
                      if (next) {
                        setRadialSettingsOpen(false);
                        setCreativeDeskEditing(false);
                        setFarmCanvasEditing(false);
                      }
                      return next;
                    });
                    setControlToolsOpen(false);
                  }}
                >
                  <LucideIcons.CircleHelp size={16} />
                  <span>{t('canvas:controls.modelNotes')}</span>
                </button>
                <button
                  type="button"
                  className={!placementShelfHidden ? 'is-active' : ''}
                  data-canvas-floating-ui="placement-shelf-toggle"
                  role="menuitemcheckbox"
                  aria-checked={!placementShelfHidden}
                  onClick={() => {
                    setPlacementShelfHidden((value) => !value);
                    setControlToolsOpen(false);
                  }}
                >
                  <LucideIcons.Archive size={16} />
                  <span>{placementShelfHidden ? t('canvas:controls.shelfExpand') : t('canvas:controls.shelfCollapse')}</span>
                </button>
                <button
                  type="button"
                  className={creativeDeskEditing ? 'is-active' : ''}
                  data-canvas-floating-ui="creative-desk-toggle"
                  role="menuitem"
                  onClick={() => {
                    setCreativeDeskEditing((value) => {
                      const next = !value;
                      if (next) {
                        setRadialSettingsOpen(false);
                        setModelHelpOpen(false);
                        setFarmCanvasEditing(false);
                      }
                      return next;
                    });
                    setControlToolsOpen(false);
                  }}
                >
                  <LucideIcons.Images size={16} />
                  <span>{t('canvas:controls.creativeDesk')}</span>
                </button>
                <button
                  type="button"
                  className={radialSettingsOpen ? 'is-active' : ''}
                  data-canvas-floating-ui="radial-settings-toggle"
                  role="menuitem"
                  onClick={() => {
                    setRadialSettingsOpen((value) => {
                      const next = !value;
                      if (next) {
                        setModelHelpOpen(false);
                        setCreativeDeskEditing(false);
                        setFarmCanvasEditing(false);
                      }
                      return next;
                    });
                    setControlToolsOpen(false);
                  }}
                >
                  <LucideIcons.Settings2 size={16} />
                  <span>{t('canvas:controls.radialSettings')}</span>
                </button>
              </div>
            )}
          </div>
          <ThemeMusicToggle template={currentTemplate} />
          <Controls
            fitViewOptions={CANVAS_OVERVIEW_FIT_OPTIONS}
            style={{
              background: isFarmStory
                ? themeTokens.panelBg
                : isOp
                ? themeTokens.panelBg
                : isDark ? 'rgba(20,20,22,.9)' : 'rgba(255,255,255,.9)',
              border: isFarmStory
                ? `3px solid ${themeTokens.secondary}`
                : isOp
                ? `3px solid ${themeTokens.textMain}`
                : `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}`,
              borderRadius: isFarmStory ? 10 : isOp ? '16px 16px 8px 8px' : 8,
              boxShadow: isFarmStory ? `4px 4px 0 ${themeTokens.edge}` : isOp ? `4px 4px 0 ${themeTokens.textMain}` : undefined,
            }}
          />
        </div>
        {!placementShelfHidden && (
          <PlacementShelf
            items={placementShelfItems}
            open={placementShelfOpen}
            isDark={isDark}
            isPixel={isPixel}
            onToggle={() => setPlacementShelfOpen((prev) => !prev)}
            onHide={() => setPlacementShelfHidden(true)}
            onClear={clearPlacementShelf}
            onMoveNode={movePlacementShelfNode}
            onRemove={(id) => setPlacementShelfItems((prev) => prev.filter((item) => item.id !== id))}
          />
        )}
      </div>
      <RadialMenuSettingsModal open={radialSettingsOpen} onClose={() => setRadialSettingsOpen(false)} />
      {modelHelpOpen && (
        <div
          className="t8-model-help-panel nodrag nopan"
          data-canvas-floating-ui="model-help-panel"
          role="dialog"
          aria-modal="false"
          aria-label={t('canvas:controls.modelNotes')}
        >
          <div className="t8-model-help-panel__header">
            <div>
              <div className="t8-model-help-panel__eyebrow">MODEL NOTES</div>
              <h2>{t('canvas:controls.modelNotes')}</h2>
            </div>
            <button
              type="button"
              className="t8-model-help-panel__close t8-mini-icon-button"
              aria-label={t('canvas:controls.closeHelp')}
              title={t('canvas:controls.closeHelp')}
              onClick={(event) => {
                event.stopPropagation();
                setModelHelpOpen(false);
              }}
            >
              <LucideIcons.X size={16} />
            </button>
          </div>
          <div className="t8-model-help-panel__tabs" role="tablist" aria-label={t('canvas:controls.modelPlatform')}>
            {MODEL_USAGE_HELP_TABS.map((tab, tabIndex) => {
              const active = tab.id === modelHelpTab;
              return (
                <button
                  key={tab.id}
                  id={`model-help-tab-${tab.id}`}
                  type="button"
                  className={`t8-model-help-panel__tab${active ? ' is-active' : ''}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`model-help-panel-${tab.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    setModelHelpTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const nextIndex = event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? MODEL_USAGE_HELP_TABS.length - 1
                        : (tabIndex + (event.key === 'ArrowRight' ? 1 : -1) + MODEL_USAGE_HELP_TABS.length)
                          % MODEL_USAGE_HELP_TABS.length;
                    const nextTab = MODEL_USAGE_HELP_TABS[nextIndex];
                    setModelHelpTab(nextTab.id);
                    window.requestAnimationFrame(() => {
                      document.getElementById(`model-help-tab-${nextTab.id}`)?.focus();
                    });
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="t8-model-help-panel__body">
            <div
              id={`model-help-panel-${modelHelpTab}`}
              className="t8-model-help-panel__text"
              role="tabpanel"
              aria-labelledby={`model-help-tab-${modelHelpTab}`}
            >
              {MODEL_USAGE_HELP_TABS.find((tab) => tab.id === modelHelpTab)?.sections.map((section) => (
                <section className="t8-model-help-panel__section" key={section.title}>
                  <h3>{section.title}：</h3>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.items ? (
                    <ul>
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div
      ref={canvasShellRef}
      className={`t8-canvas-shell flex-1 relative${connectionPanModeActive ? ' connection-pan-mode-active' : ''}${edgeMotionReduced ? ' t8-edge-motion-reduced' : ''}${viewportMoving ? ' t8-viewport-moving' : ''}${nodeDragging ? ' t8-node-dragging' : ''}`}
      data-theme-visual={visualStyle}
      data-theme-mode={theme}
      data-edge-motion={edgeMotionMode}
      data-edge-load={heavyEdgeMotion ? 'heavy' : undefined}
      data-canvas-surface-load={heavyCanvasSurface ? 'heavy' : 'normal'}
      data-canvas-zoom-readability={canvasZoomReadability}
      data-canvas-node-count={nodes.length}
      data-canvas-edge-count={edges.length}
      data-canvas-performance={performanceDecision.effective}
      data-canvas-performance-requested={performanceDecision.requested}
      data-canvas-performance-reason={performanceDecision.reason}
      data-canvas-performance-fixture={performanceFixtureSize || undefined}
      style={{ background: bgColor }}
      onContextMenuCapture={onCanvasContextMenuCapture}
      onMouseMove={handleCanvasPointerMove}
    >
      {backgroundSaveFailure && (
        <div
          role="alert"
          data-canvas-background-save-error="true"
          data-canvas-background-save-error-kind={backgroundSaveFailure.kind}
          className={`absolute left-1/2 top-16 z-[120] flex w-[min(560px,calc(100%-32px))] -translate-x-1/2 items-start gap-3 border px-4 py-3 ${
            visualStyle === 'pixel'
              ? 'border-2 border-[var(--px-ink)] bg-[var(--px-yellow)] text-[var(--px-ink)] shadow-[4px_4px_0_var(--px-ink)]'
              : 'rounded-xl border-red-500/50 bg-[var(--bg-secondary)]/95 text-[var(--text-primary)] shadow-2xl backdrop-blur'
          }`}
        >
          <LucideIcons.AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={20} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {backgroundSaveFailure.kind === 'persist-failed'
                ? t('canvas:backgroundSave.persistFailed')
                : t('canvas:backgroundSave.syncFailed')}
            </p>
            <p className="mt-1 break-words text-xs leading-5 opacity-85">
              {t('canvas:backgroundSave.identity', backgroundSaveFailure)}
            </p>
            <p className="mt-1 text-xs leading-5 opacity-75">
              {backgroundSaveFailure.kind === 'persist-failed'
                ? t('canvas:backgroundSave.persistDetail')
                : t('canvas:backgroundSave.syncDetail')}
            </p>
          </div>
          <button
            type="button"
            className={`nodrag nopan shrink-0 px-2 py-1 text-xs font-bold ${
              visualStyle === 'pixel'
                ? 'border-2 border-[var(--px-ink)] bg-[var(--px-surface)]'
                : 'rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)]'
            }`}
            aria-label={t('canvas:backgroundSave.close')}
            onClick={() => setBackgroundSaveFailure(null)}
          >
            {t('common:actions.close')}
          </button>
        </div>
      )}
      <CanvasToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        selectedCount={selectedCount}
        clipboardCount={clipboardCount}
        onUndo={histUndo}
        onRedo={histRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDelete={handleDeleteSelected}
        onExport={handleExport}
        onImport={handleImportClick}
        onApplyTemplate={handleApplyTemplate}
        onFindNodeById={focusNodeBySerialId}
        onRunAll={handleRunAll}
        onCancelRun={handleCancelRun}
        isRunning={isRunning}
        batchTotal={batchTotal}
        batchDone={batchDone}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        outputMaterialPersistenceEnabled={outputMaterialPersistenceEnabled}
        onToggleOutputMaterialPersistence={toggleOutputMaterialPersistence}
        historyCount={generationHistoryCount}
        historyOpen={generationHistoryOpen}
        onToggleHistory={() => setGenerationHistoryOpen((value) => !value)}
        onOpenVibeXWorkbench={handleOpenVibeXWorkbench}
        onCreateVibeXNode={handleCreateVibeXNode}
        onCreateGenerationTarget={handleCreateGenerationTarget}
        onExportResourcePackage={handleExportResourcePackage}
        onAlignSelection={handleAlignSelection}
        endControl={<CanvasPerformanceControl decision={performanceDecision} />}
      >
        <button
          type="button"
          className={`t8-toolbar-button relative flex h-8 w-8 items-center justify-center rounded-md transition-colors${projectWorkbenchOpen ? ' bg-[var(--accent-primary)] text-white' : ''}`}
          aria-label={t('canvas:controls.projectWorkbench')}
          title={t('canvas:controls.projectWorkbenchDetail')}
          aria-pressed={projectWorkbenchOpen}
          onClick={(event) => {
            event.stopPropagation();
            setProjectWorkbenchOpen((value) => !value);
          }}
        >
          <LucideIcons.Boxes size={15} />
        </button>
        {isFarmStory && (
          <button
            type="button"
            className={`t8-toolbar-button t8-farm-story-toolbar-toggle relative flex h-8 w-8 items-center justify-center rounded-md transition-colors${farmStoryPanelOpen ? ' is-active' : ''}`}
            data-farm-control-console-toggle="toolbar"
            data-farm-control-console-priority={farmStoryToolbarHint?.tone}
            data-farm-control-console-priority-label={farmStoryToolbarHint?.primary}
            data-farm-control-console-priority-section={farmStoryToolbarHint?.section}
            data-farm-control-console-priority-section-label={farmStoryToolbarHint?.sectionLabel}
            data-farm-control-console-priority-count={farmStoryToolbarHint?.count}
            data-farm-control-console-state={farmStoryPanelOpen ? 'open' : 'closed'}
            data-farm-control-console-focus-request={farmStoryPriorityFocusRequestId || undefined}
            aria-label={farmStoryToolbarHint?.title || (farmStoryPanelOpen ? '收起牧场控制台' : '展开牧场控制台')}
            title={farmStoryToolbarHint?.title || (farmStoryPanelOpen ? '收起牧场控制台' : '展开牧场控制台')}
            aria-expanded={farmStoryPanelOpen}
            aria-pressed={farmStoryPanelOpen}
            onClick={(event) => {
              event.stopPropagation();
              const nextOpen = !farmStoryPanelOpen;
              if (nextOpen) {
                setRadialSettingsOpen(false);
                setModelHelpOpen(false);
                setCreativeDeskEditing(false);
                setFarmStoryPriorityFocusRequestId((value) => value + 1);
              }
              setFarmStoryPanelOpen(nextOpen);
            }}
          >
            <LucideIcons.Sprout size={15} />
            <span aria-hidden="true" data-farm-toolbar-priority-dot="true" />
          </button>
        )}
        {isGardenDefense && (
          <Suspense fallback={null}>
            <GardenDefenseExperience
              visualStyle={visualStyle}
              canvasId={renderedCanvasId}
              viewportMoving={viewportMoving}
              nodeDragging={nodeDragging}
            />
          </Suspense>
        )}
        {isTetris && (
          <Suspense fallback={null}>
            <TetrisPanel
              visualStyle={visualStyle}
              viewportMoving={viewportMoving}
              nodeDragging={nodeDragging}
            />
          </Suspense>
        )}
        {isDragonBall && (
          <Suspense fallback={null}>
            <DragonBallRadar
              visualStyle={visualStyle}
              viewportMoving={viewportMoving}
              nodeDragging={nodeDragging}
            />
          </Suspense>
        )}
        {isSaintSeiya && (
          <Suspense fallback={null}>
            <SaintSeiyaSanctuary
              visualStyle={visualStyle}
              viewportMoving={viewportMoving}
              nodeDragging={nodeDragging}
            />
          </Suspense>
        )}
      </CanvasToolbar>
      <GenerationHistoryPanel
        open={generationHistoryOpen}
        items={generationHistoryItems}
        onClose={() => setGenerationHistoryOpen(false)}
        onFocusNode={focusGenerationHistoryNode}
      />
      <RunPreflightModal
        preview={runPreflightModal?.preview || null}
        loading={runPreflightModal?.loading === true}
        onConfirm={handleConfirmRunPreflight}
        onCancel={handleCancelRunPreflight}
      />
      <ProjectWorkbench
        open={projectWorkbenchOpen && loaded && loadedCanvasId === renderedCanvasId && activeProjectId != null}
        canvasId={renderedCanvasId}
        projectId={activeProjectId || 'project-local'}
        canvasRevision={activeCanvasRevision}
        patchConflictMessage={canvasPatchConflictMessage}
        nodes={nodes}
        edges={edges}
        onClose={() => setProjectWorkbenchOpen(false)}
        onInsertSubflow={handleInsertSubflow}
        onUpgradeSubflowInstances={handleUpgradeSubflowInstances}
        onInsertAsset={handleInsertProjectAsset}
        onFocusNode={focusGenerationHistoryNode}
        onPreviewPatch={handlePreviewCanvasPatch}
        onApplyPatch={async (patch, preview) => {
          await handleApplyCanvasPatch(patch, preview);
        }}
        onRevertPatch={async (patchId, revision) => {
          await handleRevertCanvasPatch(patchId, revision);
        }}
        onResolvePatchConflict={handleResolveCanvasPatchConflict}
        onAcceptRunIntent={handleAcceptRunIntent}
        onRetryRun={handleRetryProjectRun}
        onRetrySubflowNodeRun={handleRetrySubflowNodeRun}
        onRetryRunAttempt={handleRetryProjectRunAttempt}
        onDoctorHighlightsChange={handleDoctorHighlightsChange}
      />
      {creatorAgentCanvasReady && activeProjectId && (
        <CreatorAgentPanel
          projectId={activeProjectId}
          canvasId={renderedCanvasId}
          selectedNodeIds={nodes.filter((node) => node.selected).map((node) => node.id)}
          selectedNodes={nodes.filter((node) => node.selected).map((node) => ({
            id: node.id,
            type: String(node.type || 'node'),
            label: placementShelfNodeTitle(node),
          }))}
          availableNodeIds={nodes.map((node) => node.id)}
          visualStyle={visualStyle}
          themeMode={theme}
          themeTokens={themeTokens}
          onFocusNode={focusGenerationHistoryNode}
          apiSettingsRevision={apiSettingsRevision}
          onOpenApiSettings={onOpenApiSettings}
        />
      )}
      <StartupPosterCarousel
        ready={creatorAgentCanvasReady}
        expectedNodeCount={renderedNodes.reduce((count, node) => count + (node.hidden ? 0 : 1), 0)}
      />
      {isFarmStory && (
        <Suspense fallback={null}>
          <FarmStoryPanel
        visualStyle={visualStyle}
        themeMode={theme}
        open={farmStoryPanelOpen}
        onOpenChange={setFarmStoryPanelOpen}
        showInlineToggle={false}
        priorityFocusRequestId={farmStoryPriorityFocusRequestId}
        viewportMoving={viewportMoving}
        nodeDragging={nodeDragging}
        farmCanvas={farmCanvas}
        editing={farmCanvasEditing}
        feedback={farmCanvasFeedback}
        soundEnabled={farmSoundEnabled}
        devToolsEnabled={farmDevToolsEnabled}
        onToggleEditing={handleFarmToggleEditing}
        onToggleSound={handleFarmToggleSound}
        onGrantDevMaterials={handleFarmGrantDevMaterials}
        onSelectTool={handleFarmSelectTool}
        onSelectBuilding={handleFarmSelectBuilding}
        onSelectDecor={handleFarmSelectDecor}
        resourceDecorItems={farmResourceDecorItems}
        resourceDecorLoading={farmResourceDecorLoading}
        onRefreshResourceDecor={loadFarmResourceDecorItems}
        onSelectResourceDecor={handleFarmSelectResourceDecor}
        onJumpToMature={handleFarmJumpToMature}
        onAdvanceDay={handleFarmAdvanceDay}
        onCompleteOrder={handleFarmCompleteOrder}
        onCompleteNpcVisit={handleFarmCompleteNpcVisit}
        onFollowupCanvasHint={handleFarmFollowupCanvasHint}
          />
        </Suspense>
      )}
      {isFarmStory && farmTopNotice && (
        <div
          className={`t8-farm-followup-notice is-${farmTopNotice.tone}`}
          data-canvas-floating-ui="farm-followup-notice"
          data-farm-followup-notice="top-quick-board"
          data-farm-followup-notice-state={farmFollowupNotice ? 'active' : 'idle'}
          data-farm-followup-notice-tone={farmTopNotice.tone}
          data-farm-followup-notice-route-target={farmTopNotice.routeTarget || undefined}
          data-farm-followup-notice-route-label={farmTopNotice.routeLabel || undefined}
          data-farm-followup-notice-created-at={farmTopNotice.createdAt}
          role="status"
          aria-live="polite"
        >
          <span className="t8-farm-followup-notice__rail" aria-hidden="true" />
          <span className="t8-farm-followup-notice__icon" aria-hidden="true">
            <LucideIcons.ClipboardList size={15} />
          </span>
          <span className="t8-farm-followup-notice__copy">
            <span>牧场公告</span>
            <b>{farmTopNotice.routeTitle || farmTopNotice.routeLabel || '下一步提示'}</b>
            <small>{farmTopNotice.message}</small>
          </span>
          <em>{farmTopNotice.routeLabel ? `路线 ${farmTopNotice.routeLabel}` : farmFollowupNotice ? '已更新' : '常驻'}</em>
        </div>
      )}
      <TerminalPanel />
      {connectionPanModeActive && (
        <div className="t8-connection-pan-hud" data-canvas-floating-ui="connection-pan-hud">
          <span className="t8-connection-pan-hud__signal" aria-hidden="true" />
          <span className="t8-connection-pan-hud__title">连线导航模式</span>
          <span className="t8-connection-pan-hud__hint">拖动画布后点击目标接口连接，再按 {shortcutText('connection.pan-mode')} 取消</span>
        </div>
      )}
      {fileDragOutFeedback && (
        <div
          data-canvas-floating-ui="file-drag-out-feedback"
          className={`t8-file-drag-out-feedback is-${fileDragOutFeedback.tone}`}
          style={{
            left: Math.min(
              Math.max(fileDragOutFeedback.x + 18, 12),
              Math.max(12, (typeof window !== 'undefined' ? window.innerWidth : 420) - 360),
            ),
            top: Math.min(
              Math.max(fileDragOutFeedback.y + 18, 12),
              Math.max(12, (typeof window !== 'undefined' ? window.innerHeight : 240) - 128),
            ),
          }}
        >
          <span className="t8-file-drag-out-feedback__keys" aria-hidden="true">
            <span>左</span>
            <span>右</span>
          </span>
          <span className="t8-file-drag-out-feedback__copy">
            <span className="t8-file-drag-out-feedback__title">{fileDragOutFeedback.title}</span>
            <span className="t8-file-drag-out-feedback__detail">{fileDragOutFeedback.detail}</span>
          </span>
        </div>
      )}
      {edgeCutFeedbacks.map((feedback) => (
        <div
          key={feedback.id}
          data-canvas-floating-ui="edge-cut-feedback"
          className={`t8-edge-cut-feedback is-${feedback.source} is-${feedback.kind}`}
          data-edge-cut-kind={feedback.kind}
          data-edge-cut-source={feedback.source}
          style={{ left: feedback.x, top: feedback.y }}
          role="status"
          aria-live="polite"
        >
          <span className="t8-edge-cut-feedback__icon" aria-hidden="true" />
          <span className="t8-edge-cut-feedback__copy">
            <span className="t8-edge-cut-feedback__title">{feedback.title}</span>
            <span className="t8-edge-cut-feedback__detail">{feedback.detail}</span>
          </span>
        </div>
      ))}
      {edgeConnectFeedbacks.map((feedback) => (
        <div
          key={feedback.id}
          data-canvas-floating-ui="edge-connect-feedback"
          className={`t8-edge-connect-feedback is-${feedback.kind}`}
          data-edge-connect-kind={feedback.kind}
          style={{ left: feedback.x, top: feedback.y }}
          role="status"
          aria-live="polite"
        >
          <span className="t8-edge-connect-feedback__icon" aria-hidden="true" />
          <span className="t8-edge-connect-feedback__copy">
            <span className="t8-edge-connect-feedback__title">{feedback.title}</span>
            <span className="t8-edge-connect-feedback__detail">{feedback.detail}</span>
          </span>
        </div>
      ))}
      {radialMenu && (
        <RadialNodeMenu
          center={radialMenu.center}
          anchor={radialMenu.anchor}
          cursor={radialMenu.cursor}
          slots={radialSlots}
          nodesByType={radialNodesByType}
          activeIndex={radialMenu.activeIndex}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />
      <NodeDomLanguageBoundary />
      <WorkflowDoctorHighlightContext.Provider value={workflowDoctorHighlightMap}>
        <CanvasPerformanceRenderProvider enabled={performanceDecision.effective === 'performance'}>
        <ReactFlow
          nodes={renderedNodes}
          key={loadedCanvasId || 'canvas-loading'}
          edges={renderedEdges}
          onInit={handleAuthoritativeFlowInit}
          nodeTypes={memoNodeTypes}
          edgeTypes={memoEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={onIsValidConnection}
          connectionLineComponent={memoConnectionLineComponent}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onMoveStart={handleViewportMoveStart}
          onMove={handleViewportMove}
          onMoveEnd={handleViewportMoveEnd}
          onSelectionContextMenu={onSelectionContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onDragOver={onCanvasFileDragOver}
          onDrop={onCanvasFileDrop}
          onSelectionChange={onSelectionChange}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          selectionKeyCode={memoSelectionKeyCode}
          multiSelectionKeyCode={memoMultiSelectionKeyCode}
          selectionMode={SelectionMode.Partial}
          panOnDrag={memoPanOnDrag}
          snapToGrid={snapEnabled}
          snapGrid={SNAP_GRID}
          elevateNodesOnSelect={false}
          minZoom={CANVAS_MIN_ZOOM}
          defaultViewport={
            initialCanvasViewport?.canvasId === loadedCanvasId && initialCanvasViewport.viewport
              ? initialCanvasViewport.viewport
              : CANVAS_DEFAULT_VIEWPORT
          }
          fitView={!(initialCanvasViewport?.canvasId === loadedCanvasId && initialCanvasViewport.viewport)}
          fitViewOptions={CANVAS_OVERVIEW_FIT_OPTIONS}
          proOptions={memoProOptions}
          defaultEdgeOptions={memoDefaultEdgeOptions}
        >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={isPixel ? 1.6 : 1.2}
          color={dotColor}
        />
        {(isFarmStory || farmCanvasEditing
          || farmCanvas.objects.length > 0 || farmCanvas.animals.length > 0) && (
          <Suspense fallback={null}>
            <FarmCanvasLayer
          farmCanvas={farmCanvas}
          editing={farmCanvasEditing}
          visualStyle={visualStyle}
          resourceDecorItems={farmResourceDecorItems}
          viewportMoving={viewportMoving}
          nodeDragging={nodeDragging}
          feedbacks={farmFloatingFeedbacks}
          highlightedObjectId={farmJumpHighlightObjectId}
          onAction={handleFarmCanvasAction}
          onCancelContinuousAction={handleFarmCancelContinuousAction}
          onFinishContinuousAction={handleFarmFinishContinuousAction}
            />
          </Suspense>
        )}
        {!creativeDeskEditing && (
          <CreativeDeskLayer
            creativeDesk={creativeDesk}
            editing={false}
            activeItemId={null}
            resources={creativeDeskResources}
            resourceLoading={creativeDeskResourceLoading}
            message={creativeDeskMessage}
            isPixel={isPixel}
            isDark={isDark}
            visualStyle={visualStyle}
            onChange={setCreativeDesk}
            onEditingChange={setCreativeDeskEditing}
            onActiveItemChange={setCreativeDeskActiveItemId}
            onUploadFiles={handleCreativeDeskUploadFiles}
            onAddResource={handleCreativeDeskResourceTouch}
            onRefreshResources={loadCreativeDeskResources}
          />
        )}
        {/* 对齐辅助线:在世界坐标系中随视口变换 */}
        {(guides.vertical.length > 0 || guides.horizontal.length > 0) && (
          <ViewportPortal>
            <svg
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 0,
                height: 0,
                overflow: 'visible',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              {guides.vertical.map((x, i) => (
                <line
                  key={`v-${i}-${x}`}
                  x1={x}
                  y1={-100000}
                  x2={x}
                  y2={100000}
                  stroke={guideColor}
                  strokeWidth={isPixel ? 1.5 : 1}
                  strokeDasharray={isPixel ? '8 4' : '6 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {guides.horizontal.map((y, i) => (
                <line
                  key={`h-${i}-${y}`}
                  x1={-100000}
                  y1={y}
                  x2={100000}
                  y2={y}
                  stroke={guideColor}
                  strokeWidth={isPixel ? 1.5 : 1}
                  strokeDasharray={isPixel ? '8 4' : '6 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </ViewportPortal>
        )}
        <MiniMap
          pannable
          zoomable
          onClick={(_e, position) => {
            // 点击小地图任意位置 → 平滑居中到该 flow 坐标,保持当前缩放级别
            const { zoom } = getViewport();
            setCenter(position.x, position.y, { zoom, duration: 400 });
          }}
          style={{
            width: isGardenDefense ? 224 : isFarmStory ? 214 : isOp ? 144 : isNaruto ? 182 : isEva ? 258 : isYyh ? 224 : isSlamdunk ? 214 : isSoccer ? 224 : isDragonBall ? 192 : undefined,
            height: isGardenDefense ? 144 : isFarmStory ? 136 : isOp ? 144 : isNaruto ? 122 : isEva ? 172 : isYyh ? 144 : isSlamdunk ? 128 : isSoccer ? 136 : isDragonBall ? 192 : undefined,
            background: isFarmStory
              ? themeTokens.panelBg
              : isGardenDefense
              ? themeTokens.panelBg
              : isOp
              ? themeTokens.panelBg
              : isNaruto
                ? themeTokens.panelBg
              : isEva
                ? themeTokens.panelBg
              : isYyh
                ? themeTokens.panelBg
              : isSlamdunk
                ? themeTokens.panelBg
              : isSoccer
                ? themeTokens.panelBg
              : isDragonBall
                ? themeTokens.panelBg
              : isDark ? 'rgba(20,20,22,.9)' : 'rgba(255,255,255,.9)',
            border: isFarmStory
              ? `3px solid ${themeTokens.secondary}`
              : isGardenDefense
              ? `4px solid ${themeTokens.edge}`
              : isOp
              ? `4px double ${themeTokens.textMain}`
              : isNaruto
                ? `3px solid ${themeTokens.textMain}`
              : isEva
                  ? `2px solid ${themeTokens.borderStrong}`
              : isYyh
                  ? `2px solid ${themeTokens.accent}`
              : isSlamdunk
                  ? `3px solid ${themeTokens.textMain}`
              : isSoccer
                  ? `3px solid ${themeTokens.textMain}`
              : isDragonBall
                  ? `3px solid ${themeTokens.warning}`
                : `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}`,
            borderRadius: isGardenDefense ? 7 : isFarmStory ? 10 : isOp ? 999 : isNaruto ? '18px 18px 12px 12px' : isEva ? 8 : isYyh ? 12 : isSlamdunk ? 10 : isSoccer ? 12 : isDragonBall ? 999 : 8,
            right: isGardenDefense ? 24 : isFarmStory ? 24 : isOp ? 24 : isNaruto ? 24 : isEva ? 24 : isYyh ? 24 : isSlamdunk ? 24 : isSoccer ? 24 : isDragonBall ? 28 : undefined,
            bottom: isGardenDefense ? 34 : isFarmStory ? 32 : isOp ? 42 : isNaruto ? 40 : isEva ? 24 : isYyh ? 28 : isSlamdunk ? 32 : isSoccer ? 32 : isDragonBall ? 34 : undefined,
            boxShadow: isFarmStory
              ? `0 0 0 5px ${themeTokens.warning}, 5px 5px 0 ${themeTokens.edge}, 0 18px 46px rgba(76,49,20,.24)`
              : isGardenDefense
              ? `0 0 0 5px ${themeTokens.warning}, 6px 7px 0 ${themeTokens.edge}, 0 20px 48px rgba(54,39,16,.3)`
              : isOp
              ? `0 0 0 7px ${themeTokens.warning}, 5px 5px 0 ${themeTokens.textMain}`
              : isNaruto
                ? themeTokens.shadowPanel
              : isEva
                  ? `0 0 0 4px ${themeTokens.panelBgElevated}, 0 0 0 6px ${themeTokens.borderStrong}, 0 18px 46px rgba(0,0,0,.5), inset 0 0 34px ${themeTokens.accent}22`
              : isYyh
                  ? `0 0 0 4px ${themeTokens.panelBgElevated}, 0 0 0 6px ${themeTokens.borderStrong}, 0 18px 46px rgba(0,0,0,.46), inset 0 0 34px ${themeTokens.secondary}22`
              : isSlamdunk
                  ? `0 0 0 5px ${themeTokens.secondary}, 5px 5px 0 ${themeTokens.textMain}, 0 18px 46px rgba(0,0,0,.28)`
              : isSoccer
                  ? `0 0 0 5px ${themeTokens.secondary}, 5px 5px 0 ${themeTokens.textMain}, 0 18px 46px rgba(0,0,0,.24)`
              : isDragonBall
                  ? `0 0 0 5px ${themeTokens.secondary}, 5px 5px 0 ${themeTokens.textMain}, 0 18px 46px rgba(0,0,0,.28), inset 0 0 34px ${themeTokens.warning}33`
              : undefined,
            cursor: 'pointer',
            overflow: isGardenDefense || isFarmStory || isOp || isNaruto || isEva || isYyh || isSlamdunk || isSoccer || isDragonBall ? 'hidden' : undefined,
            display: (viewportMoving || nodeDragging) && heavyCanvasSurface ? 'none' : undefined,
          }}
          maskColor={isGardenDefense ? 'rgba(255,216,83,.2)' : isFarmStory ? 'rgba(111,191,74,.22)' : isOp ? 'rgba(15,124,140,.28)' : isNaruto ? 'rgba(255,91,31,.22)' : isEva ? 'rgba(156,255,0,.18)' : isYyh ? 'rgba(67,247,255,.16)' : isSlamdunk ? 'rgba(240,123,34,.22)' : isSoccer ? 'rgba(18,107,216,.22)' : isDragonBall ? 'rgba(255,176,0,.22)' : isDark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.6)'}
          nodeColor={() => (isGardenDefense ? themeTokens.warning : isFarmStory ? themeTokens.secondary : isOp ? themeTokens.secondary : isNaruto ? themeTokens.accent : isEva ? themeTokens.danger : isYyh ? themeTokens.success : isSlamdunk ? themeTokens.accent : isSoccer ? themeTokens.accent : isDragonBall ? themeTokens.warning : isDark ? '#a1a1aa' : '#52525b')}
        />
        {farmMiniMapVisible && (
          <div
            className="t8-farm-minimap-markers"
            data-canvas-floating-ui="farm-minimap-markers"
            data-farm-minimap-marker-count={farmMiniMapRenderableMarkers.length}
            data-farm-minimap-route-hint-target={farmMiniMapRouteHint?.target || undefined}
            data-farm-minimap-route-hint-label={farmMiniMapRouteHint?.label || undefined}
            data-farm-minimap-route-hint-count={farmMiniMapRouteHint ? farmMiniMapRouteHintMarkers.length : undefined}
            data-farm-minimap-route-hint-count-label={farmMiniMapRouteHint ? farmMiniMapRouteHintCountLabel : undefined}
            data-farm-minimap-route-hint-empty={farmMiniMapRouteHint && farmMiniMapRouteHintMarkers.length === 0 ? 'true' : undefined}
            data-farm-minimap-route-hint-marker-id={farmMiniMapRouteHintMarker?.id || undefined}
            style={{
              width: FARM_MINIMAP_WIDTH,
              height: FARM_MINIMAP_HEIGHT,
              right: FARM_MINIMAP_RIGHT,
              bottom: FARM_MINIMAP_BOTTOM,
            }}
          >
            <div className="t8-farm-minimap-markers__legend">
              <span data-farm-minimap-legend="mature">收</span>
              <span data-farm-minimap-legend="dry">水</span>
              <span data-farm-minimap-legend="withered">枯</span>
              <span data-farm-minimap-legend="building">屋</span>
              <span data-farm-minimap-legend="animal">畜</span>
              <span data-farm-minimap-legend="npc">访</span>
              <span data-farm-minimap-legend="rare">星</span>
              <span data-farm-minimap-legend="order">单</span>
              <span data-farm-minimap-legend="cluster">簇</span>
            </div>
            {farmMiniMapRenderableMarkers.map((marker) => {
              const markerRouteHint = farmMiniMapRouteHint ? farmMiniMapMarkerMatchesRouteTarget(marker, farmMiniMapRouteHint.target) : false;
              const markerRouteHintStep = markerRouteHint ? farmMiniMapRouteHintMarkers.findIndex((routeMarker) => routeMarker.id === marker.id) + 1 : 0;
              return (
                <button
                  key={marker.id}
                  type="button"
                  className={`t8-farm-minimap-marker is-${marker.kind}${markerRouteHint ? ' is-route-hint' : ''}`}
                  data-farm-minimap-kind={marker.kind}
                  data-farm-minimap-object-id={marker.objectId || undefined}
                  data-farm-minimap-order-id={marker.orderId || undefined}
                  data-farm-minimap-npc-visit-id={marker.npcVisitId || undefined}
                  data-farm-minimap-visitor-id={marker.visitorId || undefined}
                  data-farm-minimap-rare-event-id={marker.rareEventId || undefined}
                  data-farm-minimap-animal-id={marker.animalId || undefined}
                  data-farm-minimap-cluster-count={marker.clusterCount || undefined}
                  data-farm-minimap-cluster-kinds={marker.clusterKinds?.join(',') || undefined}
                  data-farm-minimap-route-targets={marker.routeTargets?.join(' ') || undefined}
                  data-farm-minimap-route-hint={markerRouteHint ? 'true' : undefined}
                  data-farm-minimap-route-hint-active={markerRouteHint && marker.id === farmMiniMapRouteHintMarker?.id ? 'true' : undefined}
                  data-farm-minimap-route-hint-step={markerRouteHintStep || undefined}
                  data-farm-minimap-clickable="true"
                  aria-label={`定位${marker.label}`}
                  title={marker.label}
                  onPointerDownCapture={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => handleFarmMiniMapMarkerClick(event, marker)}
                  style={{
                    left: `${marker.leftPct}%`,
                    top: `${marker.topPct}%`,
                    width: `${marker.widthPct}%`,
                    height: `${marker.heightPct}%`,
                  }}
                />
              );
            })}
          </div>
        )}
        {/* 选中可执行节点时的浮动操作栏 (执行 / 中止 / 关闭) */}
        <NodeActionBar
          onRunNode={(nodeId) => { void handleRunGroup([nodeId]); }}
          onStopRun={handleCancelRun}
        />
        </ReactFlow>
        </CanvasPerformanceRenderProvider>
      {creativeDeskEditing && (
        <CreativeDeskLayer
          creativeDesk={creativeDesk}
          editing={creativeDeskEditing}
          activeItemId={creativeDeskActiveItemId}
          resources={creativeDeskResources}
          resourceLoading={creativeDeskResourceLoading}
          message={creativeDeskMessage}
          isPixel={isPixel}
          isDark={isDark}
          visualStyle={visualStyle}
          onChange={setCreativeDesk}
          onEditingChange={setCreativeDeskEditing}
          onActiveItemChange={setCreativeDeskActiveItemId}
          onUploadFiles={handleCreativeDeskUploadFiles}
          onAddResource={handleCreativeDeskResourceTouch}
          onRefreshResources={loadCreativeDeskResources}
        />
      )}
      {floatingControlRail}
      </WorkflowDoctorHighlightContext.Provider>

      {/* 跨节点素材拖拽浮层 (Ctrl + 鼠标左键 从素材缩略图拖出) */}
      <MaterialDragOverlay />

      {/* 拖线到空白处弹出的候选节点菜单 */}
      {picker && (
        <>
          {/* 遮罩层:点击空白关闭 (fixed 覆盖整个视口,确保点击空白区域可关闭) */}
          <div
            data-canvas-floating-ui="picker-backdrop"
            className="fixed inset-0 z-30"
            onClick={() => setPicker(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setPicker(null);
            }}
          />
          <div
            data-canvas-floating-ui="picker-menu"
            className="fixed z-40 overflow-hidden t8-context-menu t8-context-menu--picker"
            style={{
              // 使用 fixed + clientX/clientY (视口坐标) 让菜单精确跟随鼠标释放位置
              left: Math.min(picker.screenPos.x, window.innerWidth - 280),
              top: Math.min(picker.screenPos.y, window.innerHeight - 360),
              width: 260,
              maxHeight: 360,
            }}
          >
            <div
              className="t8-context-menu__header"
            >
              <span>
                {picker.fromHandleType === 'source' ? '连接到…' : '从…输入'}
              </span>
              <span className="text-[10px] font-normal opacity-60">
                {pickerCandidates.length} 个候选
              </span>
            </div>
            <button
              type="button"
              className="t8-context-menu__item t8-context-menu__item--candidate"
              onClick={handleConnectPickerToNodeId}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background: isPixel ? '#1A1410' : themeTokens.accent,
                  boxShadow: isPixel ? '0 0 0 1.5px #1A1410' : `0 0 0 2px ${themeTokens.accent}33`,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">发送到ID</div>
                <div
                  className="text-[10px] truncate"
                  style={{
                    color: isPixel ? '#7a6f5e' : isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)',
                  }}
                >
                  输入已有节点编号并自动连线
                </div>
              </div>
              <div className="text-[10px] opacity-60 flex-shrink-0">#</div>
            </button>
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              {pickerCandidates.length === 0 && (
                <div className="t8-context-menu__empty">
                  没有可连接的节点
                </div>
              )}
              {pickerCandidates.map((cand) => {
                const primary = cand.matchedTypes[0] ?? 'any';
                const dotColor = PORT_COLOR[primary];
                return (
                  <button
                    key={cand.type}
                    onClick={() => handlePickCandidate(cand)}
                    className="t8-context-menu__item t8-context-menu__item--candidate"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: dotColor,
                        boxShadow: isPixel ? '0 0 0 1.5px #1A1410' : `0 0 0 2px ${dotColor}33`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">{cand.label}</div>
                      <div
                        className="text-[10px] truncate"
                        style={{
                          color: isPixel ? '#7a6f5e' : isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)',
                        }}
                      >
                        {cand.description}
                      </div>
                    </div>
                    <div
                      className="flex gap-1 flex-shrink-0"
                      title={cand.matchedTypes.map((t) => PORT_LABEL[t]).join(' / ')}
                    >
                      {cand.matchedTypes.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            background: PORT_COLOR[t] + '33',
                            color: isPixel ? '#1A1410' : PORT_COLOR[t],
                            border: isPixel ? `1.5px solid #1A1410` : `1px solid ${PORT_COLOR[t]}66`,
                          }}
                        >
                          {PORT_LABEL[t]}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {nodeIdDialog && (
        <div
          data-canvas-floating-ui="node-id-dialog-backdrop"
          data-canvas-node-id-dialog="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={nodeIdDialog.title}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.currentTarget === event.target) {
              setNodeIdDialog(null);
            }
          }}
        >
          <form
            data-canvas-floating-ui="node-id-dialog"
            className={[
              'w-full max-w-[420px] p-4 text-sm shadow-2xl',
              isPixel
                ? 'border-2 border-[#1A1410] bg-[#FFF8E3] text-[#1A1410] shadow-[5px_5px_0_rgba(26,20,16,0.8)]'
                : isDark
                  ? 'rounded-2xl border border-white/15 bg-zinc-950 text-white'
                  : 'rounded-2xl border border-black/10 bg-white text-zinc-950',
            ].join(' ')}
            onSubmit={(event) => {
              event.preventDefault();
              submitNodeIdDialog();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold">{nodeIdDialog.title}</div>
                <div className={isDark && !isPixel ? 'mt-1 text-xs text-white/60' : 'mt-1 text-xs opacity-65'}>
                  {nodeIdDialog.description}
                </div>
              </div>
              <button
                type="button"
                className={[
                  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition',
                  isPixel
                    ? 'border-[#1A1410] bg-[#F6EABF] text-[#1A1410] hover:bg-[#EFCB69]'
                    : isDark
                      ? 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10'
                      : 'border-black/10 bg-black/5 text-zinc-700 hover:bg-black/10',
                ].join(' ')}
                aria-label="关闭"
                onClick={() => setNodeIdDialog(null)}
              >
                <LucideIcons.X className="h-4 w-4" />
              </button>
            </div>
            <input
              data-canvas-node-id-dialog-input
              autoFocus
              value={nodeIdDialog.value}
              placeholder={nodeIdDialog.placeholder}
              className={[
                'mt-4 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none transition',
                isPixel
                  ? 'border-[#1A1410] bg-[#F9F2D8] text-[#1A1410] focus:ring-2 focus:ring-[#EFCB69]'
                  : isDark
                    ? 'border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-cyan-300'
                    : 'border-black/10 bg-white text-zinc-950 placeholder:text-zinc-400 focus:border-cyan-500',
              ].join(' ')}
              onChange={(event) => {
                const value = event.target.value;
                setNodeIdDialog((current) => (current ? { ...current, value } : current));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setNodeIdDialog(null);
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={[
                  'rounded-full border px-4 py-2 text-xs font-semibold transition',
                  isPixel
                    ? 'border-[#1A1410] bg-[#F6EABF] text-[#1A1410] hover:bg-[#EFCB69]'
                    : isDark
                      ? 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10'
                      : 'border-black/10 bg-black/5 text-zinc-700 hover:bg-black/10',
                ].join(' ')}
                onClick={() => setNodeIdDialog(null)}
              >
                取消
              </button>
              <button
                type="submit"
                data-canvas-node-id-dialog-confirm
                className={[
                  'rounded-full border px-4 py-2 text-xs font-semibold transition',
                  isPixel
                    ? 'border-[#1A1410] bg-[#70B957] text-[#1A1410] hover:bg-[#84CB68]'
                    : isDark
                      ? 'border-cyan-300/50 bg-cyan-300 text-zinc-950 hover:bg-cyan-200'
                      : 'border-cyan-500/20 bg-cyan-500 text-white hover:bg-cyan-600',
                ].join(' ')}
              >
                确定
              </button>
            </div>
          </form>
        </div>
      )}

      {subflowDraft && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4"
          data-canvas-floating-ui="subflow-create-dialog"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !subflowDraft.saving) setSubflowDraft(null);
          }}
        >
          <form
            className="max-h-[90vh] w-full max-w-[960px] overflow-auto rounded-md border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void commitSubflowDraft();
            }}
          >
            <div className="flex items-center gap-3 border-b border-[var(--border-primary)] px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded bg-[var(--accent-primary)] text-white"><LucideIcons.GitFork size={20} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">封装为子工作流</h2>
                <p className="text-xs text-[var(--text-secondary)]">保存固定版本，并把当前选区原位替换成单个可复用节点。</p>
              </div>
              <button type="button" className="grid h-9 w-9 place-items-center rounded border border-[var(--border-primary)]" aria-label="关闭" disabled={subflowDraft.saving} onClick={() => setSubflowDraft(null)}>
                <LucideIcons.X size={17} />
              </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-[1fr_260px]">
              <div className="min-w-0 space-y-4">
                <label className="block text-xs font-semibold">
                  名称
                  <input
                    autoFocus
                    value={subflowDraft.name}
                    maxLength={80}
                    className="mt-1 h-10 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 text-sm outline-none focus:border-[var(--accent-primary)]"
                    onChange={(event) => setSubflowDraft((current) => current ? { ...current, name: event.target.value } : current)}
                  />
                </label>
                <label className="block text-xs font-semibold">
                  说明
                  <textarea
                    value={subflowDraft.description}
                    rows={5}
                    maxLength={500}
                    className="mt-1 w-full resize-none rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-sm outline-none focus:border-[var(--accent-primary)]"
                    placeholder="用途、输入约束和输出内容"
                    onChange={(event) => setSubflowDraft((current) => current ? { ...current, description: event.target.value } : current)}
                  />
                </label>
              </div>
              <section className="min-w-0 border-l border-[var(--border-primary)] pl-4">
                <div className="mb-3 text-xs font-bold">边界检查</div>
                <dl className="grid grid-cols-2 gap-y-2 text-xs">
                  <dt className="text-[var(--text-secondary)]">内部节点</dt><dd className="text-right font-semibold">{subflowDraft.analysis.definition.nodes.length}</dd>
                  <dt className="text-[var(--text-secondary)]">内部连线</dt><dd className="text-right font-semibold">{subflowDraft.analysis.definition.edges.length}</dd>
                  <dt className="text-[var(--text-secondary)]">输入端口</dt><dd className="text-right font-semibold">{subflowDraft.analysis.definition.inputs.length}</dd>
                  <dt className="text-[var(--text-secondary)]">输出端口</dt><dd className="text-right font-semibold">{subflowDraft.analysis.definition.outputs.length}</dd>
                </dl>
                <div className="mt-4 max-h-36 space-y-1 overflow-auto pr-1 text-[11px]">
                  {[...subflowDraft.analysis.definition.inputs, ...subflowDraft.analysis.definition.outputs].map((port) => (
                    <div key={port.id} className="flex items-center justify-between gap-2 border-b border-[var(--border-primary)] py-1.5">
                      <span className="truncate">{port.id.startsWith('in-') ? '输入' : '输出'} · {port.name}</span>
                      <span className="shrink-0 opacity-60">{port.kind}</span>
                    </div>
                  ))}
                  {subflowDraft.analysis.definition.inputs.length + subflowDraft.analysis.definition.outputs.length === 0 && (
                    <div className="py-3 text-[var(--text-secondary)]">当前选区没有跨边界连线。</div>
                  )}
                </div>
              </section>
            </div>
            <section className="border-t border-[var(--border-primary)] px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-xs font-bold">公开端口确认</h3><p className="mt-1 text-[11px] text-[var(--text-secondary)]">每条跨边界连线保持独立端口；名称相同也不会自动合并。</p></div><span className="text-[10px] text-[var(--text-secondary)]">{subflowDraft.analysis.definition.inputs.length} 入 / {subflowDraft.analysis.definition.outputs.length} 出</span></div>
              <div className="max-h-[34vh] overflow-auto border-y border-[var(--border-primary)]">
                {(['inputs', 'outputs'] as const).flatMap((direction) => subflowDraft.analysis.definition[direction].map((port, index) => {
                  const boundary = direction === 'inputs'
                    ? subflowDraft.analysis.incomingEdges.find((edge) => edge.id === port.boundaryEdgeId)
                    : subflowDraft.analysis.outgoingEdges.find((edge) => edge.id === port.boundaryEdgeId);
                  return <div key={`${direction}-${port.id}`} className="grid gap-2 border-b border-[var(--border-primary)] px-2 py-3 md:grid-cols-[72px_minmax(120px,1fr)_110px_72px_100px_minmax(150px,1.4fr)]">
                    <div className="text-[11px]"><span className="block font-bold">{direction === 'inputs' ? '输入' : '输出'} {index + 1}</span><span className="mt-1 block truncate opacity-50" title={port.id}>{port.id}</span></div>
                    <label className="text-[10px] text-[var(--text-secondary)]">名称<input value={port.name} maxLength={60} className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { name: event.target.value })} /></label>
                    <label className="text-[10px] text-[var(--text-secondary)]">类型<select value={port.kind} className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { kind: event.target.value })}>{['text', 'image', 'video', 'audio', 'model3d', 'metadata', 'config', 'any'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
                    <label className="text-[10px] text-[var(--text-secondary)]">顺序<input type="number" min={0} max={999} value={port.order ?? index} className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { order: Math.max(0, Number(event.target.value) || 0) })} /></label>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-[var(--text-secondary)]"><label>最少<input type="number" min={0} max={99} value={port.minConnections ?? (port.required ? 1 : 0)} className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { minConnections: Math.max(0, Number(event.target.value) || 0) })} /></label><label>最多<input type="number" min={1} max={99} value={port.maxConnections ?? ''} placeholder="∞" className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { maxConnections: event.target.value ? Math.max(1, Number(event.target.value) || 1) : null })} /></label></div>
                    <label className="text-[10px] text-[var(--text-secondary)]">说明<input value={port.description || ''} maxLength={160} placeholder={boundary ? `${boundary.source} → ${boundary.target}` : '用途和约束'} className="mt-1 h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" onChange={(event) => updateSubflowDraftPort(direction, port.id, { description: event.target.value })} /></label>
                    <div className="md:col-start-2 md:col-span-5 flex flex-wrap items-center gap-4 text-[10px] text-[var(--text-secondary)]"><label className="flex items-center gap-1"><input type="checkbox" checked={port.required} onChange={(event) => updateSubflowDraftPort(direction, port.id, { required: event.target.checked, minConnections: event.target.checked ? Math.max(1, port.minConnections || 0) : 0 })} />必填</label><label className="flex min-w-48 flex-1 items-center gap-2">默认值<input defaultValue={port.defaultValue == null ? '' : typeof port.defaultValue === 'string' ? port.defaultValue : JSON.stringify(port.defaultValue)} className="h-7 min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-[11px] text-[var(--text-primary)]" onBlur={(event) => updateSubflowDraftPort(direction, port.id, { defaultValue: parseSubflowPortDefault(event.target.value, port.kind) })} /></label><span className="truncate" title={boundary ? `${boundary.source}:${boundary.sourceHandle || 'default'} → ${boundary.target}:${boundary.targetHandle || 'default'}` : ''}>影响：{boundary ? `${boundary.source} → ${boundary.target}` : '内部端口'}</span></div>
                  </div>;
                }))}
                {subflowDraft.analysis.definition.inputs.length + subflowDraft.analysis.definition.outputs.length === 0 && <div className="py-8 text-center text-xs text-[var(--text-secondary)]">选区没有跨边界连线，无需公开端口。</div>}
              </div>
            </section>
            {(() => {
              const candidates = subflowParameterCandidates(subflowDraft.analysis.definition as SubflowDefinition);
              const exposed = subflowDraft.analysis.definition.exposedParameters || [];
              const exposedById = new Map(exposed.map((parameter) => [parameter.id, parameter]));
              return <section className="border-t border-[var(--border-primary)] px-5 py-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-xs font-bold">公开参数与固定设置</h3><p className="mt-1 text-[11px] text-[var(--text-secondary)]">仅勾选项允许实例覆盖；其余配置随固定版本锁定。凭据和私密字段已从定义中移除，只能读取全局 API Key 设置。</p></div>
                  <span className="text-[10px] text-[var(--text-secondary)]">公开 {exposed.length} · 固定 {Math.max(0, candidates.length - exposed.length)} · 私密字段不入包</span>
                </div>
                <div className="max-h-48 overflow-auto rounded border border-[var(--border-primary)]">
                  {candidates.map((candidate) => {
                    const parameter = exposedById.get(candidate.id);
                    return <div key={candidate.id} className="grid items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2 md:grid-cols-[24px_minmax(160px,1fr)_minmax(180px,1.2fr)_92px]">
                      <input type="checkbox" aria-label={`公开 ${candidate.name}`} checked={!!parameter} onChange={(event) => toggleSubflowDraftParameter(candidate, event.target.checked)} />
                      <div className="min-w-0"><div className="truncate text-xs font-semibold">{candidate.name}</div><code className="block truncate text-[9px] opacity-45">{candidate.nodeId}.{candidate.dataKey}</code></div>
                      {parameter ? <input value={parameter.name} maxLength={80} className="h-8 min-w-0 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" aria-label="公开参数名称" onChange={(event) => updateSubflowDraftParameter(parameter.id, { name: event.target.value })} /> : <span className="text-[10px] text-[var(--text-secondary)]">固定为 {String(candidate.defaultValue)}</span>}
                      {parameter ? <label className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]"><input type="checkbox" checked={!!parameter.required} onChange={(event) => updateSubflowDraftParameter(parameter.id, { required: event.target.checked })} />实例必填</label> : <span className="text-[10px] text-[var(--text-secondary)]">固定设置</span>}
                    </div>;
                  })}
                  {candidates.length === 0 && <div className="px-3 py-6 text-center text-xs text-[var(--text-secondary)]">当前内部节点没有适合公开的基础配置字段。</div>}
                </div>
              </section>;
            })()}
            <div className="flex justify-end gap-2 border-t border-[var(--border-primary)] px-5 py-4">
              <button type="button" className="h-10 rounded border border-[var(--border-primary)] px-5 text-sm font-semibold" disabled={subflowDraft.saving} onClick={() => setSubflowDraft(null)}>取消</button>
              <button type="submit" className="h-10 rounded bg-[var(--accent-primary)] px-5 text-sm font-bold text-white disabled:opacity-50" disabled={subflowDraft.saving || !subflowDraft.name.trim()}>
                {subflowDraft.saving ? '正在保存…' : '保存并替换选区'}
              </button>
            </div>
          </form>
        </div>
      )}

      {subflowInspector && (() => {
        const depth = subflowInspector.stack.length - 1;
        const editActive = subflowInspector.edit?.depth === depth ? subflowInspector.edit : undefined;
        const detaching = Boolean(subflowInspector.detaching);
        const definition = editActive?.draft || subflowInspector.stack[depth];
        const viewKey = buildSubflowInspectorViewportKey({
          rootInstanceNodeId: subflowInspector.instanceNodeId,
          pathNodeIds: subflowInspector.pathNodeIds,
          projectId: definition.projectId || renderedCanvasId,
          definitionId: definition.id,
          definitionVersion: definition.version,
          editing: Boolean(editActive),
        });
        const savedViewport = subflowInspectorViewportsRef.current[viewKey];
        const targetHandles = new Map<string, Set<string>>();
        const sourceHandles = new Map<string, Set<string>>();
        const addHandle = (collection: Map<string, Set<string>>, nodeId: string, handle: string | null | undefined, fallback: string) => {
          const values = collection.get(nodeId) || new Set<string>();
          values.add(handle || fallback);
          collection.set(nodeId, values);
        };
        for (const edge of definition.edges) {
          addHandle(sourceHandles, edge.source, edge.sourceHandle, SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE);
          addHandle(targetHandles, edge.target, edge.targetHandle, SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE);
        }
        for (const port of definition.inputs) addHandle(targetHandles, port.internalNodeId, port.internalHandle, SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE);
        for (const port of definition.outputs) addHandle(sourceHandles, port.internalNodeId, port.internalHandle, SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE);
        const previewNodes = definition.nodes.map((node) => ({
          ...node,
          type: 'subflowInspector',
          draggable: !!editActive,
          selectable: true,
          data: {
            label: `${node.type === 'subflow' ? '子流程 · ' : ''}${String((node.data as any)?.label || (node.data as any)?.definition?.name || node.type || '节点')}`,
            sourceHandles: [...(sourceHandles.get(node.id) || [SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE])],
            targetHandles: [...(targetHandles.get(node.id) || [SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE])],
            onOpenNested: !editActive && !detaching && node.type === 'subflow' ? () => { void handleOpenNestedSubflow(node); } : undefined,
          },
        }));
        const previewEdges = definition.edges.map((edge) => ({
          ...edge,
          sourceHandle: edge.sourceHandle || SUBFLOW_INSPECTOR_DEFAULT_SOURCE_HANDLE,
          targetHandle: edge.targetHandle || SUBFLOW_INSPECTOR_DEFAULT_TARGET_HANDLE,
          animated: false,
          selectable: !!editActive,
        }));
        return (
          <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-2 sm:p-4" data-canvas-floating-ui="subflow-inspector" onPointerDown={(event) => { if (event.target === event.currentTarget && !editActive && !detaching) setSubflowInspector(null); }}>
            <div
              className="flex max-h-[calc(100vh-1rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-md border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl sm:max-h-[92vh]"
              onKeyDown={(event) => {
                if (!editActive || (!event.ctrlKey && !event.metaKey)) return;
                const key = event.key.toLowerCase();
                const isUndo = key === 'z' && !event.shiftKey;
                const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
                if (!isUndo && !isRedo) return;
                event.stopPropagation();
                const target = event.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
                event.preventDefault();
                if (isUndo) handleUndoSubflowRevision();
                else handleRedoSubflowRevision();
              }}
            >
              <div className="flex flex-wrap items-start gap-2 border-b border-[var(--border-primary)] px-3 py-3 sm:flex-nowrap sm:items-center sm:gap-3 sm:px-5">
                <LucideIcons.Workflow size={20} className="shrink-0 text-[var(--accent-primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {subflowInspector.stack.map((item, index) => <span key={`${item.id}-${item.version}`} className="flex items-center gap-1"><button type="button" disabled={!!editActive || detaching} className={`max-w-44 truncate rounded px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-45 ${index === subflowInspector.stack.length - 1 ? 'bg-[var(--accent-primary)] font-bold text-white' : 'hover:bg-[var(--bg-tertiary)]'}`} onClick={() => setSubflowInspector((current) => current ? { ...current, stack: current.stack.slice(0, index + 1), pathNodeIds: current.pathNodeIds.slice(0, index + 1), edit: undefined } : current)}>{item.name}</button>{index < subflowInspector.stack.length - 1 && <LucideIcons.ChevronRight size={12} className="opacity-45" />}</span>)}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{editActive ? `编辑草稿 · 基于 revision ${editActive.baseRevision}` : `固定版本 v${definition.version} · revision ${definition.revision || definition.version}`} · {definition.nodes.length} 节点 · {definition.edges.length} 连线 · {editActive ? '发布后生成不可变新版本' : '双击子流程继续进入'}</p>
                </div>
                <div className="flex basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto sm:flex-nowrap">
                  {editActive ? <>
                    <button type="button" title="撤销内部草稿（Ctrl/Cmd+Z）" className="grid h-9 w-9 place-items-center rounded border border-[var(--border-primary)] disabled:opacity-40" disabled={editActive.saving || editActive.undoStack.length === 0} onClick={handleUndoSubflowRevision}><LucideIcons.Undo2 size={15} /></button>
                    <button type="button" title="重做内部草稿（Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y）" className="grid h-9 w-9 place-items-center rounded border border-[var(--border-primary)] disabled:opacity-40" disabled={editActive.saving || editActive.redoStack.length === 0} onClick={handleRedoSubflowRevision}><LucideIcons.Redo2 size={15} /></button>
                    <button type="button" className="flex h-9 items-center gap-2 rounded border border-[var(--border-primary)] px-3 text-xs font-semibold" disabled={editActive.saving} onClick={handleCancelSubflowRevisionEdit}><LucideIcons.X size={15} /> 放弃草稿</button>
                    <button type="button" className="flex h-9 items-center gap-2 rounded bg-[var(--accent-primary)] px-3 text-xs font-bold text-white disabled:opacity-50" disabled={editActive.saving || !!editActive.nodeDataError || !editActive.draft.name.trim() || !editActive.changeSummary.trim()} onClick={() => void handlePublishSubflowRevision()}><LucideIcons.Upload size={15} /> {editActive.saving ? '发布中…' : '发布新版本'}</button>
                  </> : <>
                    <button type="button" disabled={detaching} className="flex h-9 items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold disabled:opacity-45" onClick={handleStartSubflowRevisionEdit}><LucideIcons.Pencil size={15} /> 编辑新版本</button>
                    {subflowInspector.stack.length > 1
                      ? <button type="button" disabled={detaching} className="flex h-9 items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold disabled:opacity-45" onClick={handleReturnSubflowInspectorLevel}><LucideIcons.CornerUpLeft size={15} /> 返回上一级</button>
                      : <button type="button" disabled={detaching} className="flex h-9 items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold disabled:opacity-45" onClick={() => void handleDetachSubflow()}><LucideIcons.Unplug size={15} /> {detaching ? '解析依赖中…' : '脱离定义'}</button>}
                  </>}
                  <button type="button" disabled={!!editActive?.saving || detaching} className="grid h-9 w-9 place-items-center rounded border border-[var(--border-primary)] disabled:opacity-45" aria-label="关闭" onClick={() => setSubflowInspector(null)}><LucideIcons.X size={17} /></button>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
                <section className="relative h-[42vh] min-h-[260px] border-b border-[var(--border-primary)] bg-[var(--bg-primary)] md:h-[68vh] md:min-h-[420px] md:border-b-0 md:border-r">
                  <ReactFlowProvider>
                    <ReactFlow
                      key={viewKey}
                      nodeTypes={subflowInspectorNodeTypes}
                      nodes={previewNodes}
                      edges={previewEdges}
                      defaultViewport={savedViewport || { x: 0, y: 0, zoom: 1 }}
                      fitView={!savedViewport}
                      fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
                      nodesDraggable={!!editActive}
                      nodesConnectable={!!editActive}
                      elementsSelectable
                      deleteKeyCode={null}
                      multiSelectionKeyCode={null}
                      onNodesChange={editActive ? handleSubflowRevisionNodesChange : undefined}
                      onEdgesChange={editActive ? handleSubflowRevisionEdgesChange : undefined}
                      onConnect={editActive ? handleConnectSubflowRevision : undefined}
                      onNodeClick={editActive ? (_, node) => handleSelectSubflowRevisionNode(node.id) : undefined}
                      onEdgeClick={editActive ? (_, edge) => handleSelectSubflowRevisionEdge(edge.id) : undefined}
                      onPaneClick={editActive ? handleClearSubflowRevisionSelection : undefined}
                      onNodeDragStart={editActive ? handleSubflowRevisionNodeDragStart : undefined}
                      onNodeDragStop={editActive ? handleSubflowRevisionNodeDragStop : undefined}
                      onMoveEnd={(_, viewport) => { subflowInspectorViewportsRef.current[viewKey] = viewport; }}
                      onNodeDoubleClick={(_, previewNode) => {
                        if (editActive || detaching) return;
                        const original = definition.nodes.find((node) => node.id === previewNode.id);
                        if (original?.type === 'subflow') void handleOpenNestedSubflow(original);
                      }}
                      proOptions={{ hideAttribution: true }}
                    >
                      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                      <Controls showInteractive={!!editActive} position="bottom-right" />
                    </ReactFlow>
                  </ReactFlowProvider>
                  <div className="pointer-events-none absolute left-3 top-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]/95 px-2 py-1 text-[10px] text-[var(--text-secondary)]">{editActive ? '新版本草稿 · 可拖动、连线和选择删除' : '固定版本只读 · 视口按层记忆'}</div>
                </section>
                <aside className="min-h-0 overflow-visible p-3 md:overflow-auto md:p-4">
                  {subflowInspector.error && <div role="alert" className="mb-4 rounded border border-red-500/60 bg-red-500/10 p-3 text-[11px] leading-5 text-red-500">{subflowInspector.error}{editActive?.conflict && <div className="mt-2 border-t border-red-500/30 pt-2"><p>服务器当前为 v{editActive.conflict.latestVersion} / revision {editActive.conflict.revision}；你的草稿仍保留，未覆盖他人版本。</p><button type="button" className="mt-2 h-8 rounded border border-red-500/60 px-3 text-[10px] font-bold" onClick={handleLoadLatestSubflowRevision}>放弃当前草稿并载入最新版本</button></div>}</div>}
                  {editActive && <section className="mb-5 space-y-3 rounded border border-[var(--accent-primary)]/50 bg-[var(--bg-tertiary)] p-3">
                    <h3 className="text-xs font-bold">新版本信息</h3>
                    <label className="block text-[10px] font-semibold">名称<input value={editActive.draft.name} maxLength={100} className="mt-1 h-9 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" onChange={(event) => handleUpdateSubflowRevisionMetadata('name', event.target.value)} /></label>
                    <label className="block text-[10px] font-semibold">说明<textarea value={editActive.draft.description} maxLength={2000} rows={3} className="mt-1 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-primary)]" onChange={(event) => handleUpdateSubflowRevisionMetadata('description', event.target.value)} /></label>
                    <label className="block text-[10px] font-semibold">变更说明（必填）<textarea value={editActive.changeSummary} maxLength={500} rows={2} className="mt-1 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-primary)]" placeholder="说明本次为什么发布、改了什么" onChange={(event) => handleUpdateSubflowRevisionChangeSummary(event.target.value)} /></label>
                    <button type="button" className="flex h-9 w-full items-center justify-center gap-2 rounded border border-red-500/60 text-xs font-semibold text-red-500 disabled:cursor-not-allowed disabled:opacity-40" disabled={!editActive.draft.nodes.some((node) => node.selected) && !editActive.draft.edges.some((edge) => edge.selected)} onClick={handleDeleteSubflowRevisionSelection}><LucideIcons.Trash2 size={14} /> 删除选中节点或连线</button>
                    <p className="text-[10px] leading-4 text-[var(--text-secondary)]">不会覆盖 v{definition.version}，也不会自动升级主画布中的固定版本实例。</p>
                  </section>}
                  {editActive?.selectedNodeId && <section className="mb-5">
                    <h3 className="mb-2 text-xs font-bold">节点配置 · {editActive.selectedNodeId}</h3>
                    <textarea value={editActive.nodeDataText} rows={12} spellCheck={false} className={`w-full resize-y rounded border bg-[var(--bg-primary)] px-2 py-2 font-mono text-[10px] leading-4 text-[var(--text-primary)] ${editActive.nodeDataError ? 'border-red-500' : 'border-[var(--border-primary)]'}`} onChange={(event) => handleUpdateSubflowRevisionNodeData(event.target.value)} />
                    {editActive.nodeDataError && <p className="mt-1 text-[10px] text-red-500">{editActive.nodeDataError}</p>}
                  </section>}
                  <section>
                    <h3 className="mb-2 text-xs font-bold">公开端口</h3>
                    <div className="space-y-1 text-xs">
                      {[...definition.inputs, ...definition.outputs].map((port) => <div key={port.id} className="border-b border-[var(--border-primary)] py-2"><div className="flex justify-between gap-3"><span className="truncate">{definition.inputs.includes(port) ? '输入' : '输出'} · {port.name}</span><code className="shrink-0 opacity-55">{port.kind}</code></div>{port.description && <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{port.description}</p>}</div>)}
                      {definition.inputs.length + definition.outputs.length === 0 && <div className="py-3 text-[var(--text-secondary)]">无公开端口</div>}
                    </div>
                  </section>
                  <section className="mt-5">
                    <h3 className="mb-2 text-xs font-bold">公开参数</h3>
                    <div className="space-y-1 text-xs">
                      {(definition.exposedParameters || []).map((parameter) => <div key={parameter.id} className="border-b border-[var(--border-primary)] py-2"><div className="font-semibold">{parameter.name}</div><div className="mt-1 truncate text-[10px] text-[var(--text-secondary)]">{parameter.nodeId}.{parameter.dataKey}{parameter.required ? ' · 必填' : ''}</div></div>)}
                      {(definition.exposedParameters || []).length === 0 && <div className="py-3 text-[var(--text-secondary)]">无公开参数</div>}
                    </div>
                  </section>
                  {definition.description && <p className="mt-5 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{definition.description}</p>}
                  <div className="mt-5 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3 text-[10px] leading-5 text-[var(--text-secondary)]">{editActive ? '发布前会校验内部节点、连线、公开端口、公开参数和嵌套固定版本；失败不会写入新版本。' : subflowInspector.stack.length === 1 ? '“脱离定义”只作用于当前主画布实例，会完整展开固定版本并保留外部连接；该操作可撤销。' : '当前查看的是嵌套固定版本；请先返回最外层，才能脱离主画布实例，避免误展开错误层级。'}</div>
                </aside>
              </div>
            </div>
          </div>
        );
      })()}

      <SendMaterialsModal
        open={!!sendModal}
        materials={sendModal?.materials || []}
        nodeFragment={sendModal?.nodeFragment}
        sourceLabel={sendModal?.sourceLabel || '素材'}
        defaultMode={sendModal?.defaultMode || 'auto'}
        canvases={canvases}
        activeCanvasId={renderedCanvasId}
        onClose={() => setSendModal(null)}
        onSendToCanvas={handleSendMaterialsToCanvas}
        onLoadVideoEditTargets={loadVideoEditTargets}
        onSaveToResource={handleSaveSendMaterialsToResource}
        onSendToEagle={handleSendMaterialsToEagle}
        onSendToFigma={handleSendMaterialsToFigma}
        onSendToPhotoshop={handleSendMaterialsToPhotoshop}
      />

      {/* 右键菜单(框选 右键 或 节点右键) */}
      {contextMenu && (() => {
        const ids = contextMenu.ids;
        const selNodes = nodes.filter((n) => ids.includes(n.id));
        const exeCount = selNodes.filter((n) => n.type && EXECUTABLE_NODE_TYPES.has(n.type)).length;
        const selectedGroupIds = selNodes.filter((n) => n.type === 'groupBox').map((n) => n.id);
        const groupCascadeMemberCount = selectedGroupIds.reduce(
          (sum, groupId) => sum + getGroupMemberIds(groupId, nodes).length,
          0,
        );
        const mergeCandidate = getMaterialSetMergeCandidate(ids);
        const creativeSelectionSummary = collectCanvasSelectionSummary(
          nodes.map((node) => ({ ...node, selected: ids.includes(node.id) })),
          { canvasId: renderedCanvasId },
        );
        const canCreateSelectionImage =
          creativeSelectionSummary.texts.length > 0 || creativeSelectionSummary.images.length > 0;
        const materialSetNode = ids.length === 1 ? nodes.find((n) => n.id === ids[0] && n.type === 'material-set') : null;
        const materialSetKind = isMaterialSetKind((materialSetNode?.data as any)?.materialSetKind)
          ? ((materialSetNode?.data as any).materialSetKind as MaterialSetKind)
          : null;
        const materialSetItems = materialSetKind
          ? normalizeMaterialSetItems((materialSetNode?.data as any)?.materialSetItems, materialSetKind)
          : [];
        const downloadableCount = getDownloadableItemsFromNodes(ids).length;
        const sendableCount = collectSendableMaterialsFromNodes(selNodes, renderedCanvasId).length;
        const nodeFragmentPreview = buildSendNodeFragment(selNodes, edges, renderedCanvasId);
        const sendNodeCount = nodeFragmentPreview.nodes.length;
        const sendEdgeCount = nodeFragmentPreview.edges.length;
        const canSendSelection = sendNodeCount > 0 || sendableCount > 0;
        const sendMenuSummary =
          sendEdgeCount > 0
            ? `${sendNodeCount}节点/${sendEdgeCount}线`
            : sendableCount > 0
              ? `${sendableCount}素材`
              : `${sendNodeCount}节点`;
        const menuItemCls = 't8-context-menu__item';
        const alignMiniBtnCls = 't8-context-menu__item justify-center text-[11px] !px-2 !py-1.5';
        const menuWidth = 200;
        const alignSubmenuWidth = 238;
        const menuLeft = Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 20));
        const menuTop = Math.max(8, Math.min(contextMenu.y, window.innerHeight - 220));
        const alignSubmenuOpensLeft = menuLeft + menuWidth + alignSubmenuWidth > window.innerWidth - 8;
        const alignSubmenuLeft = alignSubmenuOpensLeft
          ? Math.max(8, menuLeft - alignSubmenuWidth + 2)
          : Math.max(8, Math.min(window.innerWidth - alignSubmenuWidth - 8, menuLeft + menuWidth - 2));
        const alignSubmenuTop = Math.max(8, Math.min(menuTop + 36, window.innerHeight - 230));
        const alignButton = (
          action: NodeAlignAction,
          label: string,
          Icon: ComponentType<{ size?: number }>,
          minCount = 2,
        ) => {
          const disabled = ids.length < minCount;
          return (
            <button
              key={action}
              className={alignMiniBtnCls}
              disabled={disabled}
              title={disabled ? `至少选择 ${minCount} 个节点` : label}
              onClick={() => {
                closeContextMenu();
                handleAlignSelection(action, ids);
              }}
            >
              <Icon size={12} />
              <span>{label}</span>
            </button>
          );
        };
        return (
          <>
            {/* 遮罩层 */}
            <div
              data-canvas-floating-ui="node-menu-backdrop"
              className="fixed inset-0 z-30"
              onClick={closeContextMenu}
              onContextMenu={(e) => {
                e.preventDefault();
                closeContextMenu();
              }}
            />
            <div
              data-canvas-floating-ui="node-menu"
              className="fixed z-40 overflow-hidden t8-context-menu t8-context-menu--selection"
              style={{
                left: menuLeft,
                top: menuTop,
                width: menuWidth,
              }}
            >
              <div
                className="t8-context-menu__header"
              >
                <span>已选 {ids.length} 个节点</span>
                <span className="text-[10px] font-normal opacity-60">
                  可执行 {exeCount}
                </span>
              </div>
              <div
                onMouseEnter={() => openSelectionContextSubmenu('align')}
                onMouseLeave={scheduleSelectionContextSubmenuClose}
              >
                <button
                  type="button"
                  className={menuItemCls}
                  aria-haspopup="menu"
                  aria-expanded={selectionContextSubmenu === 'align'}
                  aria-label="打开对齐和整理方式"
                  onFocus={() => openSelectionContextSubmenu('align')}
                  onClick={() => openSelectionContextSubmenu('align')}
                >
                  <LucideIcons.LayoutGrid size={13} />
                  <span className="flex-1">对齐 / 整理</span>
                  <LucideIcons.ChevronRight size={13} className={alignSubmenuOpensLeft ? 'rotate-180' : ''} />
                </button>
              </div>
              <button
                className={menuItemCls}
                disabled={isRunning || exeCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleRunGroup(ids);
                }}
              >
                <Play size={13} fill="currentColor" />
                <span>组执行 ({exeCount})</span>
              </button>
              <button
                className={menuItemCls}
                disabled={ids.filter((i) => {
                  const n = nodes.find((x) => x.id === i);
                  return n && n.type !== 'groupBox';
                }).length === 0}
                onClick={() => {
                  closeContextMenu();
                  handleCreateGroup(ids);
                }}
              >
                <FolderPlus size={13} />
                <span>打组 ({shortcutText('canvas.group')})</span>
              </button>
              <button
                className={menuItemCls}
                disabled={!mergeCandidate}
                title={mergeCandidate ? `合并为${PORT_LABEL[mergeCandidate.kind]}素材集` : '请选择多个同类型素材'}
                onClick={() => {
                  closeContextMenu();
                  handleMergeToMaterialSet(ids, { x: contextMenu.x, y: contextMenu.y });
                }}
              >
                <PackagePlus size={13} />
                <span>
                  合并到素材集
                  {mergeCandidate ? ` (${mergeCandidate.items.length})` : ''}
                </span>
              </button>
              <button
                className={menuItemCls}
                disabled={!canCreateSelectionImage}
                title={canCreateSelectionImage ? '把选区文字和图片整理成右侧图像生成节点' : '选区里没有可用提示词或图像'}
                onClick={() => {
                  closeContextMenu();
                  handleCreateImageFromSelection(ids);
                }}
              >
                <Sparkles size={13} />
                <span>选区生成图像</span>
              </button>
              {materialSetNode && (
                <button
                  className={menuItemCls}
                  disabled={!materialSetKind || materialSetItems.length === 0}
                  title={materialSetKind && materialSetItems.length > 0 ? '把整个素材集保存到资源库' : '请右键一个非空素材集节点'}
                  onClick={() => {
                    closeContextMenu();
                    if (!materialSetKind || materialSetItems.length === 0) return;
                    window.dispatchEvent(new CustomEvent('penguin:open-material-set-resource-menu', {
                      detail: {
                        x: contextMenu.x,
                        y: contextMenu.y,
                        sourceNodeId: materialSetNode.id,
                        title: `${PORT_LABEL[materialSetKind]}素材集`,
                        materialSetKind,
                        materialSetItems,
                      },
                    }));
                  }}
                >
                  <Library size={13} />
                  <span>保存素材集到资源库</span>
                </button>
              )}
              <button
                className={menuItemCls}
                disabled={sendNodeCount === 0}
                title={sendNodeCount > 0 ? '保存选中节点与内部连线为资源库工作流' : '请选择至少 1 个节点'}
                onClick={() => {
                  closeContextMenu();
                  void saveWorkflowFragmentToResource(
                    nodeFragmentPreview,
                    sendEdgeCount > 0 ? `${sendNodeCount}节点${sendEdgeCount}线工作流` : `${sendNodeCount}节点工作流`,
                  );
                }}
              >
                <Workflow size={13} />
                <span>保存工作流到资源库</span>
              </button>
              <button
                className={menuItemCls}
                disabled={sendNodeCount === 0}
                title={sendNodeCount > 0 ? '把所选节点封装为带显式输入输出端口的固定版本子工作流' : '请选择至少 1 个节点'}
                onClick={() => {
                  closeContextMenu();
                  prepareSubflowFromSelection(ids);
                }}
              >
                <LucideIcons.GitFork size={13} />
                <span>封装为子工作流</span>
              </button>
              <button
                className={menuItemCls}
                disabled={!canSendSelection}
                title={
                  canSendSelection
                    ? `发送选中节点片段到其他画布；其中 ${sendableCount} 个素材仍可保存到资源库或 Eagle`
                    : '所选内容没有可发送节点或素材'
                }
                onClick={() => {
                  closeContextMenu();
                  openSendMaterials(ids, { x: contextMenu.x, y: contextMenu.y });
                }}
              >
                <SendIcon size={13} />
                <span>发送到... ({sendMenuSummary})</span>
              </button>
              <button
                className={menuItemCls}
                disabled={ids.length === 0}
                title="把当前选中节点加入左下角放置栏，之后可从放置栏拖动移动原节点"
                onClick={() => {
                  closeContextMenu();
                  addNodesToPlacementShelf(ids);
                }}
              >
                <LucideIcons.Archive size={13} />
                <span>添加到放置栏</span>
              </button>
              <button
                className={menuItemCls}
                disabled={downloadableCount === 0}
                title={downloadableCount > 0 ? `下载所选节点中的 ${downloadableCount} 个素材` : '所选节点没有可下载素材'}
                onClick={() => {
                  closeContextMenu();
                  void handleBatchDownloadSelected(ids);
                }}
              >
                <Download size={13} />
                <span>批量下载 ({downloadableCount})</span>
              </button>
              {selectedGroupIds.length > 0 && (
                <button
                  className={`${menuItemCls} t8-context-menu__item--danger`}
                  title="删除组框以及组内节点，并清理相关连线"
                  onClick={() => {
                    closeContextMenu();
                    handleDeleteGroupsWithContents(selectedGroupIds);
                  }}
                >
                  <Trash2 size={13} />
                  <span>
                    删除组和内容 ({selectedGroupIds.length}/{groupCascadeMemberCount})
                  </span>
                </button>
              )}
              <button
                className={menuItemCls}
                onClick={() => {
                  closeContextMenu();
                  handleCopy();
                }}
              >
                <Copy size={13} />
                <span>复制 ({shortcutText('canvas.copy')})</span>
              </button>
              <button
                className={menuItemCls}
                onClick={() => {
                  closeContextMenu();
                  handleDuplicate();
                }}
              >
                <CopyPlus size={13} />
                <span>快速复制 ({shortcutText('canvas.duplicate')})</span>
              </button>
              <button
                className={`${menuItemCls} t8-context-menu__item--danger`}
                onClick={() => {
                  closeContextMenu();
                  handleDeleteSelected();
                }}
              >
                <Trash2 size={13} />
                <span>删除 ({shortcutText('canvas.delete')})</span>
              </button>
            </div>
            {selectionContextSubmenu === 'align' && (
              <div
                data-canvas-floating-ui="selection-align-submenu"
                className="fixed z-50 transition-opacity duration-100"
                style={{
                  left: alignSubmenuLeft,
                  top: alignSubmenuTop,
                  width: alignSubmenuWidth,
                }}
                role="menu"
                aria-label="对齐和整理方式"
                onMouseEnter={() => openSelectionContextSubmenu('align')}
                onMouseLeave={scheduleSelectionContextSubmenuClose}
              >
                <div className="t8-context-menu p-2">
                  <div className="mb-1 flex items-center gap-1 px-1 text-[10px] font-bold opacity-65">
                    <LucideIcons.LayoutGrid size={11} />
                    <span>对齐方式</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {alignButton('align-left', '左', LucideIcons.AlignStartVertical)}
                    {alignButton('align-center-x', '水平中', LucideIcons.AlignCenterVertical)}
                    {alignButton('align-right', '右', LucideIcons.AlignEndVertical)}
                    {alignButton('align-top', '上', LucideIcons.AlignStartHorizontal)}
                    {alignButton('align-center-y', '垂直中', LucideIcons.AlignCenterHorizontal)}
                    {alignButton('align-bottom', '下', LucideIcons.AlignEndHorizontal)}
                  </div>
                  <div className="my-2 h-px border-t" style={{ borderColor: 'var(--t8-border, rgba(148, 163, 184, 0.28))' }} />
                  <div className="mb-1 flex items-center gap-1 px-1 text-[10px] font-bold opacity-65">
                    <LucideIcons.Grid3x3 size={11} />
                    <span>整理方式</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {alignButton('distribute-x', '水平等距', LucideIcons.AlignHorizontalSpaceBetween, 3)}
                    {alignButton('distribute-y', '垂直等距', LucideIcons.AlignVerticalSpaceBetween, 3)}
                    {alignButton('snap-grid', '吸附网格', LucideIcons.Magnet, 1)}
                    {alignButton('arrange-grid', '整理网格', LucideIcons.Grid3x3, 2)}
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* 画布空白区右键菜单: 快速添加节点 */}
      {paneMenu && (() => {
        const QUICK_NODES = NODE_REGISTRY.filter(
          (n) => n.category === 'input' || n.category === 'core'
        );
        const COLOR_HEX: Record<string, string> = {
          sky: '#7dd3fc', amber: '#fcd34d', rose: '#fda4af', fuchsia: '#f0abfc',
          violet: '#c4b5fd', emerald: '#6ee7b7', cyan: '#67e8f9', indigo: '#a5b4fc',
          orange: '#fdba74', pink: '#f9a8d4', slate: '#cbd5e1', teal: '#5eead4',
        };
        const itemCls = 't8-context-menu__item';
        return (
          <>
            {/* 遮罩层 */}
            <div
              data-canvas-floating-ui="pane-menu-backdrop"
              className="fixed inset-0 z-30"
              onClick={closePaneMenu}
              onContextMenu={(e) => {
                e.preventDefault();
                closePaneMenu();
              }}
            />
            <div
              data-canvas-floating-ui="pane-menu"
              className="fixed z-40 overflow-hidden t8-context-menu t8-context-menu--quick-add"
              style={{
                left: Math.min(paneMenu.x, window.innerWidth - 220),
                top: Math.min(paneMenu.y, window.innerHeight - 360),
                width: 200,
              }}
            >
              <div className="t8-context-menu__header">
                快速添加节点
              </div>
              {QUICK_NODES.map((meta) => {
                const Icon = (LucideIcons as any)[meta.icon] || LucideIcons.Box;
                const color = COLOR_HEX[meta.color] || COLOR_HEX.slate;
                return (
                  <button
                    key={meta.type}
                    className={itemCls}
                    onClick={() => {
                      const at = { x: paneMenu.x, y: paneMenu.y };
                      closePaneMenu();
                      addNode(meta.type as NodeType, { atScreen: at });
                    }}
                  >
                    <span
                      className="t8-context-menu__node-icon"
                      style={{ '--t8-menu-icon-color': color } as CSSProperties}
                    >
                      <Icon size={13} />
                    </span>
                    <span className="flex-1 truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

interface CanvasProps {
  onAddNodeRef?: React.MutableRefObject<AddNodeFn | null>;
  onInsertWorkflowRef?: React.MutableRefObject<InsertWorkflowFn | null>;
  onReadinessChange?: (readiness: CanvasSurfaceReadiness) => void;
  onRetryLoadRef?: React.MutableRefObject<(() => void) | null>;
  themeStyleOverride?: string;
  apiSettingsRevision?: number;
  onOpenApiSettings?: () => void;
}

export default function Canvas(props: CanvasProps) {
  const activeCanvasId = useCanvasStore((state) => state.activeId);
  const persistenceRuntimeRef = useRef<CanvasPersistenceRuntime | null>(null);
  const persistenceRuntime = persistenceRuntimeRef.current || createCanvasPersistenceRuntime();
  persistenceRuntimeRef.current = persistenceRuntime;

  return (
    <ReactFlowProvider key={activeCanvasId || 'canvas-empty'}>
      <CanvasInner {...props} persistenceRuntime={persistenceRuntime} />
    </ReactFlowProvider>
  );
}
