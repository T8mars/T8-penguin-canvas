import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Box,
  Camera,
  CheckCircle2,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Globe2,
  HelpCircle,
  History,
  Image as ImageIcon,
  Lock,
  Loader2,
  MapPin,
  Maximize2,
  Move,
  PackagePlus,
  Palette,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { uploadDataUrl, uploadFileBlob } from '../../services/imageOps';
import { generateLlm, queryImageStatus, submitImageAsync } from '../../services/generation';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { extractRunProviderTrace } from '../../utils/runProviderTrace';
import {
  createSecondaryProviderActionForNode,
  requestCanvasSecondaryProviderAction,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  type SecondaryProviderActionEnvelope,
} from '../../utils/secondaryProviderAction';
import * as api from '../../services/api';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { trackAchievementEvent } from '../../stores/achievements';
import {
  PANORAMA_FIXED_PROMPT,
  PANORAMA_CAMERA_PRESETS,
  PANORAMA_AVATAR_COLORS,
  PANORAMA_AVATAR_POSES,
  PANORAMA_ACTION_TERMS,
  PANORAMA_COMPOSITION_GUIDES,
  PANORAMA_PROMPT_TEMPLATES,
  PANORAMA_RATIO_OPTIONS,
  PANORAMA_SHOT_PRESETS,
  PANORAMA_SHOT_TARGET_BONES,
  PANORAMA_STORYBOARD_PROMPT_DEFAULT,
  PANORAMA_KEYFRAME_SEQUENCE_DEFAULT,
  PANORAMA_KEYFRAME_SEQUENCE_MAX,
  PANORAMA_SIZE_LEVELS,
  buildPanoramaActionPlannerSystemPrompt,
  buildPanoramaActionPlannerUserPrompt,
  buildPanoramaAvatarSequenceFrames,
  buildPanoramaLocalActionPlan,
  buildPanoramaScenePrompt,
  buildPanoramaSceneSnapshot,
  buildPanoramaImageRequest,
  buildPanoramaPromptFinal,
  clampPanoramaNumber,
  composePanoramaStoryboardPromptDataUrl,
  createPanoramaStoryboardPromptPresetExport,
  deletePanoramaAvatarKeyframe,
  deletePanoramaAvatar,
  deletePanoramaCameraView,
  deletePanoramaHotspot,
  deletePanoramaOcclusionMask,
  estimatePanoramaImageQuality,
  isLikelyPanoramaImage,
  markPanoramaDefaultCameraView,
  measurePanoramaStoryboardPromptPanel,
  normalizePanoramaRatioId,
  normalizePanoramaStoryboardPrompt,
  normalizePanoramaYaw,
  insertPanoramaStoryboardPresetPrompt,
  inferPanoramaAvatarPoseFromText,
  panoramaAvatarPoseDefaultParams,
  panoramaAvatarPoseRootDefaults,
  panoramaRenderSize,
  parsePanoramaStoryboardPromptPresetImport,
  prependPanoramaHistory,
  projectPanoramaAvatar,
  projectPanoramaHotspot,
  projectPanoramaShotTarget,
  parsePanoramaActionPlanJson,
  resolvePanoramaRatio,
  safePanoramaAvatarFaceMode,
  safePanoramaAvatarGroundMode,
  safePanoramaAvatarPose,
  safePanoramaCompositionGuide,
  sanitizePanoramaSequenceFrameCount,
  sanitizePanoramaShotCamera,
  sanitizePanoramaActionPlan,
  sanitizePanoramaAvatarKeyframes,
  sanitizePanoramaAvatars,
  sanitizePanoramaCameraViews,
  sanitizePanoramaHotspots,
  sanitizePanoramaOcclusionMasks,
  sanitizePanoramaStoryboardPromptPresets,
  sanitizePanoramaViewAngles,
  screenPointToPanoramaAngles,
  safePanoramaGenerationMode,
  safePanoramaPanelMode,
  safePanoramaSizeLevel,
  updatePanoramaAvatar,
  updatePanoramaHotspot,
  upsertPanoramaAvatarKeyframe,
  upsertPanoramaAvatar,
  upsertPanoramaCameraView,
  upsertPanoramaHotspot,
  upsertPanoramaOcclusionMask,
  validatePanoramaGeneration,
  type PanoramaActionPlan,
  type PanoramaActionPlanAvatar,
  type PanoramaActionPlanKeyframe,
  type PanoramaAvatar,
  type PanoramaAvatarKeyframe,
  type PanoramaAvatarFaceMode,
  type PanoramaAvatarGroundMode,
  type PanoramaAvatarPoseId,
  type PanoramaCameraView,
  type PanoramaCompositionGuideId,
  type PanoramaGenerationHistoryItem,
  type PanoramaGenerationMode,
  type PanoramaHotspot,
  type PanoramaOcclusionMask,
  type PanoramaPanelMode,
  type PanoramaImageQuality,
  type PanoramaRatioId,
  type PanoramaShotCamera,
  type PanoramaStoryboardPromptPreset,
  type PanoramaSizeLevel,
} from '../../utils/panorama3d';
import { materialSetItemsToData, type MaterialSetItem } from '../../utils/materialSet';
import { placeSingleNode } from '../../utils/nodePlacement';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useHasAutoOutput } from './useHasAutoOutput';
import SmartImage from '../SmartImage';
import PromptTextarea from '../PromptTextarea';

const COLOR = '#38bdf8';
type PanoramaNodeRunMode = 'generate' | 'frame' | 'scene-snapshot' | 'control-snapshot';
const STORYBOARD_PREVIEW_READABLE_TEXT_SHADOW =
  '0 0 0 #ffffff, 0 1px 0 #000000, 1px 0 0 #000000, -1px 0 0 #000000, 0 -1px 0 #000000, 0 0 4px rgba(0,0,0,.98)';
const STORYBOARD_PREVIEW_LOCKED_WHITE_TEXT_STYLE: CSSProperties = {
  color: '#ffffff',
  colorScheme: 'dark',
  forcedColorAdjust: 'none',
  WebkitTextFillColor: '#ffffff',
  WebkitTextStroke: '0.22px rgba(255, 255, 255, .76)',
  paintOrder: 'stroke fill',
  opacity: 1,
  filter: 'none',
  mixBlendMode: 'normal',
  textRendering: 'geometricPrecision',
  textShadow: STORYBOARD_PREVIEW_READABLE_TEXT_SHADOW,
};
const STORYBOARD_PREVIEW_LOCKED_PLACEHOLDER_STYLE: CSSProperties = {
  ...STORYBOARD_PREVIEW_LOCKED_WHITE_TEXT_STYLE,
  color: 'rgba(255,255,255,.82)',
  WebkitTextFillColor: 'rgba(255,255,255,.82)',
};

type ThreeModule = typeof import('three');

interface PanoramaRuntime {
  three?: ThreeModule;
  loadPromise?: Promise<ThreeModule>;
  renderer?: any;
  scene?: any;
  camera?: any;
  sphere?: any;
  avatarRoot?: any;
  avatarMeshes?: Map<string, any>;
  texture?: any;
  image?: HTMLImageElement;
  animationId?: number;
  loadToken: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

interface AvatarDragState {
  pointerId: number;
  avatarId: string;
  rect: DOMRect;
}

interface AvatarRotateState {
  pointerId: number;
  avatarId: string;
  startX: number;
  startY: number;
  heading: number;
  rootPitch: number;
}

type AvatarIkHandleId =
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'handL'
  | 'handR'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'footL'
  | 'footR';

interface AvatarIkControl {
  id: AvatarIkHandleId;
  label: string;
  kind: 'joint' | 'end';
  avatarId: string;
  x: number;
  y: number;
}

interface AvatarIkDragState {
  pointerId: number;
  avatarId: string;
  handleId: AvatarIkHandleId;
  rect: DOMRect;
}

type OcclusionDragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type PanoramaInteractionSurface = 'node' | 'director';

const OCCLUSION_MASK_LABEL_CLASS = 'pointer-events-none absolute left-1 top-1 z-40 max-w-[90%] truncate rounded-md border border-slate-950/75 bg-amber-100 px-2 py-1 text-[10px] font-black text-slate-950 shadow-[0_0_0_2px_rgba(255,255,255,.86),0_5px_12px_rgba(2,6,23,.42)]';
const OCCLUSION_MASK_LABEL_STYLE = {
  backgroundColor: '#fef3c7',
  color: '#0f172a',
  textShadow: '0 1px 0 rgba(255,255,255,.72)',
} as const;
const PANORAMA_FLOATING_ICON_BUTTON_STYLE = {
  backgroundColor: '#ffffff',
  color: '#0f172a',
  borderColor: '#0f172a',
  boxShadow: '0 0 0 2px rgba(255,255,255,.92), 0 5px 14px rgba(15,23,42,.42)',
} as const;
const PANORAMA_MOVE_HANDLE_STYLE = {
  backgroundColor: '#ffffff',
  color: '#0f172a',
  borderColor: '#0f172a',
  boxShadow: '0 0 0 2px rgba(255,255,255,.82), 0 4px 10px rgba(15,23,42,.38)',
} as const;
const PANORAMA_ROTATE_HANDLE_STYLE = {
  backgroundColor: '#fef3c7',
  color: '#0f172a',
  borderColor: '#92400e',
  boxShadow: '0 0 0 2px rgba(255,255,255,.85), 0 4px 10px rgba(15,23,42,.38)',
} as const;

const getAvatarToolDockStyle = (
  avatar: Pick<PanoramaAvatar, 'scale'>,
  pos: { x: number; y: number },
  surface: PanoramaInteractionSurface,
) => {
  const scale = clampPanoramaNumber(avatar.scale, 0.35, 2.6, 1);
  const horizontal = Math.round((surface === 'director' ? 34 : 28) + scale * (surface === 'director' ? 10 : 8));
  const dockLeft = pos.x > 88;
  const pinToTop = pos.y < 12;
  const pinToBottom = pos.y > 88;
  return {
    left: dockLeft ? undefined : `${horizontal}px`,
    right: dockLeft ? `${horizontal}px` : undefined,
    top: pinToBottom ? undefined : pinToTop ? '-2px' : '50%',
    bottom: pinToBottom ? '-2px' : undefined,
    transform: pinToTop || pinToBottom ? undefined : 'translateY(-50%)',
  };
};

interface OcclusionMaskDragState {
  pointerId: number;
  maskId: string;
  mode: OcclusionDragMode;
  startX: number;
  startY: number;
  rect: DOMRect;
  mask: PanoramaOcclusionMask;
}

interface DirectorStageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampFov(value: unknown) {
  return clampPanoramaNumber(value, 35, 100, 75);
}

function clampPitch(value: unknown) {
  return clampPanoramaNumber(value, -85, 85, 0);
}

function cleanFileBase(value: string) {
  return (value.split('/').pop() || 'panorama').split('?')[0].replace(/\.[a-z0-9]{2,8}$/i, '') || 'panorama';
}

function generationModeLabel(mode: PanoramaGenerationMode) {
  return mode === 'image' ? '图生全景' : '文生全景';
}

function compactPrompt(value: string, fallback = '全景场景') {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

function avatarName(index: number) {
  return `角色 ${index + 1}`;
}

function inferAvatarPoseFromText(value: unknown): PanoramaAvatarPoseId {
  return inferPanoramaAvatarPoseFromText(value) || 'standing';
}

function avatarWorldPosition(THREE: ThreeModule, avatar: PanoramaAvatar) {
  const phi = THREE.MathUtils.degToRad(90 - avatar.pitch);
  const theta = THREE.MathUtils.degToRad(avatar.yaw);
  const radius = clampPanoramaNumber(avatar.distance, 80, 420, 220);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi) + avatar.heightOffset,
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function poseParamNumber(poseParams: Record<string, number | string | boolean> | undefined, key: string, fallback: number) {
  const value = poseParams?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function poseParamMaybeNumber(poseParams: Record<string, number | string | boolean> | undefined, key: string) {
  const value = poseParams?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function poseRotationWithOffset(
  poseParams: Record<string, number | string | boolean> | undefined,
  absoluteKey: string,
  offsetKey: string,
  current: number,
) {
  const absolute = poseParamMaybeNumber(poseParams, absoluteKey);
  if (absolute !== undefined) return absolute;
  return current + poseParamNumber(poseParams, offsetKey, 0);
}

const AVATAR_IK_CONTROL_META: Array<{ id: AvatarIkHandleId; objectName: string; label: string; kind: 'joint' | 'end' }> = [
  { id: 'shoulderL', objectName: 'armL', label: '左肩', kind: 'joint' },
  { id: 'shoulderR', objectName: 'armR', label: '右肩', kind: 'joint' },
  { id: 'elbowL', objectName: 'armLLower', label: '左肘', kind: 'joint' },
  { id: 'elbowR', objectName: 'armRLower', label: '右肘', kind: 'joint' },
  { id: 'handL', objectName: 'handL-control', label: '左手', kind: 'end' },
  { id: 'handR', objectName: 'handR-control', label: '右手', kind: 'end' },
  { id: 'hipL', objectName: 'legL', label: '左髋', kind: 'joint' },
  { id: 'hipR', objectName: 'legR', label: '右髋', kind: 'joint' },
  { id: 'kneeL', objectName: 'legLLower', label: '左膝', kind: 'joint' },
  { id: 'kneeR', objectName: 'legRLower', label: '右膝', kind: 'joint' },
  { id: 'footL', objectName: 'footL-control', label: '左脚', kind: 'end' },
  { id: 'footR', objectName: 'footR-control', label: '右脚', kind: 'end' },
];

function projectThreeObjectToCanvas(THREE: ThreeModule, camera: any, canvas: HTMLCanvasElement, object: any) {
  const world = new THREE.Vector3();
  object.getWorldPosition(world);
  const projected = world.clone().project(camera);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) {
    return null;
  }
  return {
    x: ((projected.x + 1) / 2) * 100,
    y: ((1 - projected.y) / 2) * 100,
  };
}

function collectAvatarIkControls(
  THREE: ThreeModule,
  rt: PanoramaRuntime,
  canvas: HTMLCanvasElement,
  avatarId: string,
): AvatarIkControl[] {
  if (!avatarId || !rt.camera || !rt.avatarMeshes) return [];
  const mesh = rt.avatarMeshes.get(avatarId);
  if (!mesh?.visible) return [];
  return AVATAR_IK_CONTROL_META
    .map((item) => {
      const object = mesh.getObjectByName?.(item.objectName);
      if (!object) return null;
      const pos = projectThreeObjectToCanvas(THREE, rt.camera, canvas, object);
      if (!pos || pos.x < -5 || pos.x > 105 || pos.y < -5 || pos.y > 105) return null;
      return { id: item.id, label: item.label, kind: item.kind, avatarId, x: pos.x, y: pos.y };
    })
    .filter((item): item is AvatarIkControl => Boolean(item));
}

function clampAvatarIkRotation(value: number) {
  return Math.max(-1.65, Math.min(1.65, value));
}

function stopPanoramaMouseDown(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function setPointerCaptureSafe(target: Element | null | undefined, pointerId: number) {
  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    // ReactFlow may have already claimed or released this pointer.
  }
}

function releasePointerCaptureSafe(target: (EventTarget & Element) | null | undefined, pointerId: number) {
  try {
    target?.releasePointerCapture?.(pointerId);
  } catch {
    // The fallback stage may receive the pointer-up even when the original handle owns capture.
  }
}

function avatarIkKeys(handleId: AvatarIkHandleId) {
  if (handleId === 'shoulderL') return { root: 'armLOffsetZ', bend: '', side: -1, rootScale: 0.012, bendScale: 0 };
  if (handleId === 'shoulderR') return { root: 'armROffsetZ', bend: '', side: 1, rootScale: 0.012, bendScale: 0 };
  if (handleId === 'elbowL') return { root: '', bend: 'armLBendOffsetZ', side: -1, rootScale: 0, bendScale: 0.012 };
  if (handleId === 'elbowR') return { root: '', bend: 'armRBendOffsetZ', side: 1, rootScale: 0, bendScale: 0.012 };
  if (handleId === 'handL') return { root: 'armLOffsetZ', bend: 'armLBendOffsetZ', side: -1, rootScale: 0.01, bendScale: 0.009 };
  if (handleId === 'handR') return { root: 'armROffsetZ', bend: 'armRBendOffsetZ', side: 1, rootScale: 0.01, bendScale: 0.009 };
  if (handleId === 'hipL') return { root: 'legLOffsetZ', bend: '', side: -1, rootScale: 0.011, bendScale: 0 };
  if (handleId === 'hipR') return { root: 'legROffsetZ', bend: '', side: 1, rootScale: 0.011, bendScale: 0 };
  if (handleId === 'kneeL') return { root: '', bend: 'legLBendOffsetZ', side: -1, rootScale: 0, bendScale: 0.011 };
  if (handleId === 'kneeR') return { root: '', bend: 'legRBendOffsetZ', side: 1, rootScale: 0, bendScale: 0.011 };
  if (handleId === 'footL') return { root: 'legLOffsetZ', bend: 'legLBendOffsetZ', side: -1, rootScale: 0.01, bendScale: 0.009 };
  return { root: 'legROffsetZ', bend: 'legRBendOffsetZ', side: 1, rootScale: 0.01, bendScale: 0.009 };
}

function avatarIkTrackedObjectName(handleId: AvatarIkHandleId) {
  if (handleId === 'shoulderL') return 'armLLower';
  if (handleId === 'shoulderR') return 'armRLower';
  if (handleId === 'elbowL' || handleId === 'handL') return 'handL-control';
  if (handleId === 'elbowR' || handleId === 'handR') return 'handR-control';
  if (handleId === 'hipL') return 'legLLower';
  if (handleId === 'hipR') return 'legRLower';
  if (handleId === 'kneeL' || handleId === 'footL') return 'footL-control';
  return 'footR-control';
}

function setLimb(
  group: any,
  name: string,
  rotZ: number,
  rotX = 0,
  bendZ = 0,
  bendX = 0,
) {
  const limb = group.getObjectByName?.(name);
  if (!limb) return;
  limb.rotation.z = rotZ;
  limb.rotation.x = rotX;
  limb.rotation.y = 0;
  const lower = group.getObjectByName?.(`${name}Lower`);
  if (lower) {
    lower.rotation.z = bendZ;
    lower.rotation.x = bendX;
    lower.rotation.y = 0;
  }
}

function setJoint(group: any, name: string, x: number, y: number, z = 0) {
  const joint = group.getObjectByName?.(name);
  if (!joint) return;
  joint.position.set(x, y, z);
}

function applyAvatarPose(
  group: any,
  poseId: PanoramaAvatarPoseId,
  poseParams?: Record<string, number | string | boolean>,
) {
  const pi = Math.PI;
  const resolvedPoseParams = {
    ...(panoramaAvatarPoseDefaultParams(poseId) || {}),
    ...(poseParams || {}),
  };
  group.userData.poseYOffset = 0;
  group.userData.poseRootPitch = 0;
  group.userData.poseRootRoll = 0;
  group.rotation.x = 0;
  group.rotation.z = 0;
  setLimb(group, 'armL', -0.08, 0, -0.08);
  setLimb(group, 'armR', 0.08, 0, 0.08);
  setLimb(group, 'legL', -0.04, 0, -0.04);
  setLimb(group, 'legR', 0.04, 0, 0.04);
  const head = group.getObjectByName?.('head');
  const torso = group.getObjectByName?.('torso');
  const neck = group.getObjectByName?.('neck');
  if (head) head.rotation.set(0, 0, 0);
  if (torso) {
    torso.position.y = 32;
    torso.scale.set(1, 1, 1);
    torso.rotation.set(0, 0, 0);
  }
  if (neck) {
    neck.position.y = 50;
    neck.rotation.set(0, 0, 0);
  }
  if (head) head.position.y = 58;
  setJoint(group, 'armL', -8.8, 43);
  setJoint(group, 'armR', 8.8, 43);
  setJoint(group, 'legL', -3.8, 20);
  setJoint(group, 'legR', 3.8, 20);
  if (poseId === 'walking') {
    setLimb(group, 'armL', -0.22, 0.03, -0.12);
    setLimb(group, 'armR', 0.2, -0.03, 0.12);
    setLimb(group, 'legL', -0.18, -0.04, -0.14);
    setLimb(group, 'legR', 0.2, 0.04, 0.14);
  } else if (poseId === 'running') {
    setLimb(group, 'armL', -0.48, 0.08, -0.14);
    setLimb(group, 'armR', 0.52, -0.08, 0.14);
    setLimb(group, 'legL', -0.3, -0.08, -0.28);
    setLimb(group, 'legR', 0.34, 0.08, 0.28);
  } else if (poseId === 'sitting') {
    setLimb(group, 'armL', -0.12, 0, -0.08);
    setLimb(group, 'armR', 0.12, 0, 0.08);
    setLimb(group, 'legL', -0.38, -0.12, -0.58);
    setLimb(group, 'legR', 0.38, -0.12, 0.58);
    if (torso) torso.position.y = 27;
    if (neck) neck.position.y = 45;
    if (head) head.position.y = 53;
    setJoint(group, 'armL', -8.6, 37);
    setJoint(group, 'armR', 8.6, 37);
    setJoint(group, 'legL', -4.2, 12);
    setJoint(group, 'legR', 4.2, 12);
  } else if (poseId === 'wave') {
    setLimb(group, 'armL', -0.08, 0, -0.08);
    setLimb(group, 'armR', 2.34, -0.04, 0.34, 0.02);
    setJoint(group, 'armR', 8.4, 44);
    if (head) head.rotation.y = -0.08;
  } else if (poseId === 'pointing') {
    setLimb(group, 'armL', -0.08, 0, -0.08);
    setLimb(group, 'armR', 1.34, -0.08, 0.02);
    setJoint(group, 'armR', 8.7, 42);
  } else if (poseId === 'look-back') {
    if (head) head.rotation.y = pi * 0.62;
    if (torso) torso.rotation.y = 0.18;
  } else if (poseId === 'hold-object') {
    setLimb(group, 'armL', -0.58, -0.18, -0.18, 0.04);
    setLimb(group, 'armR', 0.58, -0.18, 0.18, 0.04);
    setJoint(group, 'armL', -8.4, 41);
    setJoint(group, 'armR', 8.4, 41);
  } else if (poseId === 'talking') {
    setLimb(group, 'armL', -0.14, -0.04, -0.06);
    setLimb(group, 'armR', 0.82, -0.06, 0.18);
    if (head) head.rotation.y = -0.06;
  } else if (poseId === 'combat') {
    setLimb(group, 'armL', -0.72, -0.08, -0.18);
    setLimb(group, 'armR', 0.86, 0.06, 0.18);
    setLimb(group, 'legL', -0.28, -0.04, -0.16);
    setLimb(group, 'legR', 0.36, 0.04, 0.16);
    if (torso) torso.position.y = 30;
  } else if (poseId === 'jump') {
    setLimb(group, 'armL', -1.02, -0.04, -0.16);
    setLimb(group, 'armR', 1.02, -0.04, 0.16);
    setLimb(group, 'legL', -0.3, 0.04, -0.32);
    setLimb(group, 'legR', 0.32, -0.04, 0.32);
    group.userData.poseYOffset = 10;
  } else if (poseId === 'crouch') {
    setLimb(group, 'armL', -0.22, -0.04, -0.12);
    setLimb(group, 'armR', 0.22, -0.04, 0.12);
    setLimb(group, 'legL', -0.44, -0.12, -0.62);
    setLimb(group, 'legR', 0.44, -0.12, 0.62);
    if (torso) {
      torso.position.y = 24;
      torso.scale.y = 0.82;
    }
    if (neck) neck.position.y = 42;
    if (head) head.position.y = 49;
    setJoint(group, 'armL', -8.4, 35);
    setJoint(group, 'armR', 8.4, 35);
    setJoint(group, 'legL', -4.2, 14);
    setJoint(group, 'legR', 4.2, 14);
  } else if (poseId === 'flying-kick') {
    setLimb(group, 'armL', -0.6, -0.08, -0.16);
    setLimb(group, 'armR', 0.72, 0.08, 0.16);
    setLimb(group, 'legL', -0.56, -0.1, -0.44);
    setLimb(group, 'legR', 1.08, 0.08, 0.04);
    group.userData.poseYOffset = 12;
    group.userData.poseRootPitch = -4;
    group.userData.poseRootRoll = 0;
    if (torso) torso.position.y = 31;
    setJoint(group, 'armL', -8.8, 41);
    setJoint(group, 'armR', 8.8, 41);
    setJoint(group, 'legL', -3.6, 18);
    setJoint(group, 'legR', 3.6, 18);
  } else if (poseId === 'hit-back') {
    setLimb(group, 'armL', -0.82, 0.04, -0.14);
    setLimb(group, 'armR', 0.9, 0.04, 0.14);
    setLimb(group, 'legL', -0.2, -0.04, -0.08);
    setLimb(group, 'legR', 0.26, 0.04, 0.08);
    group.userData.poseYOffset = 4;
    group.userData.poseRootPitch = 4;
    group.userData.poseRootRoll = 0;
    if (head) head.rotation.y = -0.12;
    if (torso) torso.position.y = 31;
    setJoint(group, 'armL', -8.8, 42);
    setJoint(group, 'armR', 8.8, 42);
    setJoint(group, 'legL', -4.4, 19);
    setJoint(group, 'legR', 4.2, 20);
  } else if (poseId === 'kneel') {
    setLimb(group, 'armL', -0.24, -0.04, -0.1);
    setLimb(group, 'armR', 0.22, 0.04, 0.1);
    setLimb(group, 'legL', -0.18, -0.14, -0.62);
    setLimb(group, 'legR', 0.48, 0.08, 0.48);
    group.userData.poseRootPitch = 0;
    if (torso) torso.position.y = 25;
    if (neck) neck.position.y = 43;
    if (head) head.position.y = 50;
    setJoint(group, 'armL', -8.4, 36);
    setJoint(group, 'armR', 8.4, 36);
    setJoint(group, 'legL', -4.2, 12);
    setJoint(group, 'legR', 4.2, 12);
  } else if (poseId === 'lying') {
    setLimb(group, 'armL', -0.38, -0.04, -0.08);
    setLimb(group, 'armR', 0.38, 0.04, 0.08);
    setLimb(group, 'legL', -0.08, -0.04, -0.08);
    setLimb(group, 'legR', 0.1, 0.04, 0.08);
    group.userData.poseRootRoll = 0;
    if (torso) torso.position.y = 25;
    if (neck) neck.position.y = 43;
    if (head) head.position.y = 50;
    setJoint(group, 'armL', -8.6, 36);
    setJoint(group, 'armR', 8.6, 36);
    setJoint(group, 'legL', -4.2, 14);
    setJoint(group, 'legR', 4.2, 14);
  }
  group.userData.poseYOffset += poseParamNumber(resolvedPoseParams, 'poseYOffset', 0);
  group.userData.poseRootPitch += poseParamNumber(resolvedPoseParams, 'poseRootPitch', 0);
  group.userData.poseRootRoll += poseParamNumber(resolvedPoseParams, 'poseRootRoll', 0);
  setLimb(group, 'armL',
    poseRotationWithOffset(resolvedPoseParams, 'armLZ', 'armLOffsetZ', group.getObjectByName?.('armL')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armLX', 'armLOffsetX', group.getObjectByName?.('armL')?.rotation.x || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armLBendZ', 'armLBendOffsetZ', group.getObjectByName?.('armLLower')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armLBendX', 'armLBendOffsetX', group.getObjectByName?.('armLLower')?.rotation.x || 0),
  );
  setLimb(group, 'armR',
    poseRotationWithOffset(resolvedPoseParams, 'armRZ', 'armROffsetZ', group.getObjectByName?.('armR')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armRX', 'armROffsetX', group.getObjectByName?.('armR')?.rotation.x || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armRBendZ', 'armRBendOffsetZ', group.getObjectByName?.('armRLower')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'armRBendX', 'armRBendOffsetX', group.getObjectByName?.('armRLower')?.rotation.x || 0),
  );
  setLimb(group, 'legL',
    poseRotationWithOffset(resolvedPoseParams, 'legLZ', 'legLOffsetZ', group.getObjectByName?.('legL')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legLX', 'legLOffsetX', group.getObjectByName?.('legL')?.rotation.x || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legLBendZ', 'legLBendOffsetZ', group.getObjectByName?.('legLLower')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legLBendX', 'legLBendOffsetX', group.getObjectByName?.('legLLower')?.rotation.x || 0),
  );
  setLimb(group, 'legR',
    poseRotationWithOffset(resolvedPoseParams, 'legRZ', 'legROffsetZ', group.getObjectByName?.('legR')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legRX', 'legROffsetX', group.getObjectByName?.('legR')?.rotation.x || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legRBendZ', 'legRBendOffsetZ', group.getObjectByName?.('legRLower')?.rotation.z || 0),
    poseRotationWithOffset(resolvedPoseParams, 'legRBendX', 'legRBendOffsetX', group.getObjectByName?.('legRLower')?.rotation.x || 0),
  );
}

function makeAvatarMesh(THREE: ThreeModule, avatar: PanoramaAvatar, selected: boolean) {
  const group = new THREE.Group();
  group.userData.avatarId = avatar.id;
  const material = new THREE.MeshBasicMaterial({
    color: avatar.color,
    transparent: true,
    opacity: avatar.opacity,
    depthTest: true,
  });
  const helperMaterial = new THREE.MeshBasicMaterial({
    color: selected ? 0xffffff : avatar.color,
    transparent: true,
    opacity: selected ? 0.52 : 0,
    depthTest: false,
  });
  const controlMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: selected ? 0.88 : 0,
    depthTest: false,
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(6.5, 24, 4, 10), material);
  torso.name = 'torso';
  torso.position.y = 32;
  group.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 5, 10), material);
  neck.name = 'neck';
  neck.position.y = 50;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(6.8, 18, 14), material);
  head.name = 'head';
  head.scale.set(0.9, 1.08, 0.86);
  head.position.y = 58;
  group.add(head);
  const makeSegmentedLimb = (
    name: string,
    x: number,
    y: number,
    upperLength: number,
    lowerLength: number,
    radius: number,
    endName: string,
    endRadius: number,
  ) => {
    const joint = new THREE.Group();
    joint.name = name;
    joint.position.set(x, y, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, upperLength, 10), material);
    upper.name = `${name}-upper-bone`;
    upper.position.y = -upperLength / 2;
    joint.add(upper);
    const lowerJoint = new THREE.Group();
    lowerJoint.name = `${name}Lower`;
    lowerJoint.position.y = -upperLength;
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius * 0.78, lowerLength, 10), material);
    lower.name = `${name}-lower-bone`;
    lower.position.y = -lowerLength / 2;
    lowerJoint.add(lower);
    const end = new THREE.Mesh(new THREE.SphereGeometry(endRadius, 10, 8), material);
    end.name = endName;
    end.position.y = -lowerLength;
    lowerJoint.add(end);
    const endControl = new THREE.Mesh(new THREE.SphereGeometry(endRadius * 0.72, 10, 8), controlMaterial);
    endControl.name = `${endName}-control`;
    endControl.position.y = -lowerLength;
    endControl.visible = selected;
    lowerJoint.add(endControl);
    joint.add(lowerJoint);
    group.add(joint);
    return joint;
  };
  makeSegmentedLimb('armL', -8.8, 43, 13.5, 13.5, 1.7, 'handL', 2.4);
  makeSegmentedLimb('armR', 8.8, 43, 13.5, 13.5, 1.7, 'handR', 2.4);
  makeSegmentedLimb('legL', -3.8, 20, 14.5, 14.5, 2.1, 'footL', 2.8);
  makeSegmentedLimb('legR', 3.8, 20, 14.5, 14.5, 2.1, 'footR', 2.8);
  const makeControlPoint = (name: string, x: number, y: number, z = 0, radius = 1.9) => {
    const control = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), controlMaterial);
    control.name = name;
    control.position.set(x, y, z);
    control.visible = selected;
    group.add(control);
    return control;
  };
  makeControlPoint('head-control', 0, 58, 0, 2.3);
  makeControlPoint('pelvis-control', 0, 20, 0, 2.1);
  const foot = new THREE.Mesh(new THREE.RingGeometry(10, 11.6, 28), helperMaterial);
  foot.name = 'foot-ring';
  foot.rotation.x = -Math.PI / 2;
  foot.position.y = -11.5;
  foot.visible = selected;
  group.add(foot);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(3.2, 12, 12), helperMaterial);
  arrow.name = 'heading-arrow';
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, -10, -17);
  arrow.visible = selected;
  group.add(arrow);
  applyAvatarPose(group, avatar.poseId, avatar.poseParams);
  return group;
}

async function copyText(value: string) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    downloadUrl(url, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
}

function shotFrameRect(canvas: HTMLCanvasElement, shotCamera: PanoramaShotCamera) {
  const guide = PANORAMA_COMPOSITION_GUIDES.find((item) => item.id === shotCamera.framingRatio)?.ratio || { w: 16, h: 9 };
  const canvasAspect = canvas.width / Math.max(1, canvas.height);
  const targetAspect = guide.w / Math.max(1, guide.h);
  const scale = 0.92 - clampPanoramaNumber(shotCamera.closeupStrength, 0, 100, 50) * 0.0034;
  let width = canvas.width * scale;
  let height = width / targetAspect;
  if (height > canvas.height * scale) {
    height = canvas.height * scale;
    width = height * targetAspect;
  }
  if (targetAspect >= canvasAspect) {
    width = Math.min(width, canvas.width * scale);
    height = width / targetAspect;
  }
  return {
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
    width,
    height,
  };
}

function drawShotCameraOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  shotCamera: PanoramaShotCamera,
  shotTarget: { visible: boolean; x: number; y: number; label: string },
) {
  if (shotCamera.mode !== 'shot-camera') return;
  const rect = shotFrameRect(canvas, shotCamera);
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
  ctx.lineWidth = Math.max(3, Math.round(canvas.width * 0.0022));
  ctx.setLineDash([Math.max(12, canvas.width * 0.01), Math.max(7, canvas.width * 0.006)]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
  ctx.fillRect(rect.x + 8, rect.y + 8, 150, 28);
  ctx.fillStyle = '#fde68a';
  ctx.font = `700 ${Math.max(13, Math.round(canvas.height * 0.018))}px sans-serif`;
  ctx.fillText('导演镜头', rect.x + 18, rect.y + 27);
  if (shotTarget.visible) {
    const targetX = (shotTarget.x / 100) * canvas.width;
    const targetY = (shotTarget.y / 100) * canvas.height;
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
    ctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0014));
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height / 2);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
    ctx.beginPath();
    ctx.arc(targetX, targetY, Math.max(7, Math.round(canvas.height * 0.012)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOcclusionMaskOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  masks: PanoramaOcclusionMask[],
) {
  if (masks.length === 0) return;
  ctx.save();
  masks.forEach((mask, index) => {
    const x = (mask.x / 100) * canvas.width;
    const y = (mask.y / 100) * canvas.height;
    const w = (mask.w / 100) * canvas.width;
    const h = (mask.h / 100) * canvas.height;
    const alpha = Math.min(0.78, 0.22 + mask.strength / 180);
    ctx.fillStyle = `rgba(14, 165, 233, ${alpha})`;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0014));
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.42)';
    ctx.lineWidth = Math.max(1, Math.round(canvas.width * 0.0009));
    const step = Math.max(12, Math.round(canvas.width * 0.012));
    for (let lineX = x - h; lineX < x + w + h; lineX += step) {
      ctx.beginPath();
      ctx.moveTo(lineX, y + h);
      ctx.lineTo(lineX + h, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.setLineDash([Math.max(8, canvas.width * 0.006), Math.max(5, canvas.width * 0.004)]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const labelW = Math.max(76, Math.min(Math.max(76, w - 12), 184));
    ctx.fillStyle = 'rgba(254, 243, 199, 0.96)';
    ctx.fillRect(x + 6, y + 6, labelW, 28);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.84)';
    ctx.lineWidth = Math.max(1, Math.round(canvas.width * 0.0008));
    ctx.strokeRect(x + 6.5, y + 6.5, labelW, 28);
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${Math.max(11, Math.round(canvas.height * 0.015))}px sans-serif`;
    ctx.fillText(`${index + 1}. ${mask.label}`, x + 14, y + 25, Math.max(60, labelW - 18));
  });
  ctx.restore();
}

function drawControlSnapshotBadge(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  ctx.save();
  const label = '控制快照';
  ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
  ctx.fillRect(canvas.width - 132, 12, 112, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.strokeRect(canvas.width - 132.5, 12.5, 112, 30);
  ctx.fillStyle = '#dbeafe';
  ctx.font = `700 ${Math.max(13, Math.round(canvas.height * 0.018))}px sans-serif`;
  ctx.fillText(label, canvas.width - 112, 32);
  ctx.restore();
}

function drawSequenceFrameBadge(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, label: string) {
  if (!label) return;
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
  ctx.fillRect(12, canvas.height - 44, 132, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.36)';
  ctx.strokeRect(12.5, canvas.height - 43.5, 132, 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.max(13, Math.round(canvas.height * 0.018))}px sans-serif`;
  ctx.fillText(label, 26, canvas.height - 23);
  ctx.restore();
}

async function canvasDataUrlWithLegend(
  canvas: HTMLCanvasElement,
  avatars: PanoramaAvatar[],
  showLegend: boolean,
  shotCamera: PanoramaShotCamera,
  shotTarget: { visible: boolean; x: number; y: number; label: string },
  occlusionMasks: PanoramaOcclusionMask[] = [],
  options: { controlSnapshot?: boolean; sequenceLabel?: string } = {},
) {
  const dataUrl = canvas.toDataURL('image/png');
  const visible = avatars.filter((item) => item.visible);
  if ((!showLegend || visible.length === 0) && shotCamera.mode !== 'shot-camera' && occlusionMasks.length === 0 && !options.controlSnapshot && !options.sequenceLabel) return dataUrl;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('生成图例失败'));
    img.src = dataUrl;
  });
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  if (options.controlSnapshot) drawControlSnapshotBadge(ctx, canvas);
  if (options.sequenceLabel) drawSequenceFrameBadge(ctx, canvas, options.sequenceLabel);
  drawOcclusionMaskOverlay(ctx, canvas, occlusionMasks);
  drawShotCameraOverlay(ctx, canvas, shotCamera, shotTarget);
  if (!showLegend || visible.length === 0) return out.toDataURL('image/png');
  const pad = Math.max(12, Math.round(canvas.width * 0.012));
  const rowH = Math.max(22, Math.round(canvas.height * 0.032));
  const fontSize = Math.max(12, Math.round(canvas.height * 0.018));
  const legendW = Math.min(Math.round(canvas.width * 0.32), 260);
  const legendH = pad + visible.length * rowH + 6;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
  ctx.fillRect(pad, pad, legendW, legendH);
  ctx.strokeStyle = 'rgba(255,255,255,0.38)';
  ctx.strokeRect(pad + 0.5, pad + 0.5, legendW - 1, legendH - 1);
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  visible.forEach((avatar, index) => {
    const y = pad + 15 + index * rowH;
    ctx.fillStyle = avatar.color;
    ctx.beginPath();
    ctx.arc(pad + 15, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${index + 1}. ${avatar.name}`, pad + 30, y, legendW - 42);
  });
  return out.toDataURL('image/png');
}

async function ensurePanoramaResourceCategory() {
  const categories = await api.getResourceCategories('panorama');
  if (!categories.success) throw new Error(categories.error || '读取资源库分类失败');
  const panoramaCategories = categories.data.filter((cat) => cat.kind === 'panorama');
  if (panoramaCategories.length === 0) {
    throw new Error('后端尚未加载全景资源类型，请重启开发后端后再保存。');
  }
  const existing =
    panoramaCategories.find((cat) => cat.id === 'panorama_uncategorized') ||
    panoramaCategories.find((cat) => cat.name === '未分类') ||
    panoramaCategories[0];
  if (existing) return existing;
  const created = await api.addResourceCategory('panorama', '未分类');
  if (!created.success) throw new Error(created.error || '创建全景分类失败');
  return created.data;
}

async function ensureImageResourceCategory(name = '3D全景场景') {
  const categories = await api.getResourceCategories('image');
  if (!categories.success) throw new Error(categories.error || '读取图片资源分类失败');
  const imageCategories = categories.data.filter((cat) => cat.kind === 'image');
  const existing =
    imageCategories.find((cat) => cat.name === name) ||
    imageCategories.find((cat) => cat.id === 'image_uncategorized') ||
    imageCategories.find((cat) => cat.name === '未分类') ||
    imageCategories[0];
  if (existing?.name === name) return existing;
  const created = await api.addResourceCategory('image', name);
  if (!created.success) {
    if (existing) return existing;
    throw new Error(created.error || '创建图片资源分类失败');
  }
  return created.data;
}

const PANORAMA_DIRECTOR_SHORTCUTS = [
  ['1-8', 'selectAvatar'],
  ['Tab / Shift+Tab', 'cycleAvatar'],
  ['A', 'addAvatar'],
  ['P', 'togglePlaceMode'],
  ['F', 'focusAvatar'],
  ['H', 'toggleActorControls'],
  ['I', 'toggleJointEdit'],
  ['[ / ]', 'cyclePose'],
  ['R', 'resetPose'],
  ['M', 'toggleShotMode'],
  ['O', 'openDirector'],
  ['Ctrl+Enter', 'localParseAction'],
  ['C', 'copyScenePrompt'],
  ['E', 'exportSceneSnapshot'],
  ['Esc', 'exitModes'],
  ['?', 'showShortcuts'],
] as const;

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

const Panorama3DNode = (p: NodeProps) => {
  const { t: translate, i18n } = useTranslation(['nodes', 'common']);
  const panoramaT = (key: string, options?: Record<string, unknown>) => translate(`nodes:panorama3D.editor.${key}`, options);
  const humanizeStableId = (value: string) => value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const stableDisplayLabel = (scope: string, stableId: string, zhLabel: string) => panoramaT(
    `${scope}.${stableId}`,
    { defaultValue: i18n.language.toLowerCase().startsWith('zh') ? zhLabel : humanizeStableId(stableId) },
  );
  const poseDisplayLabel = (poseId?: string) => {
    const pose = PANORAMA_AVATAR_POSES.find((item) => item.id === poseId) || PANORAMA_AVATAR_POSES[0];
    return stableDisplayLabel('poses', pose.id, pose.label);
  };
  const shotPresetDisplayLabel = (presetId?: string) => {
    const preset = PANORAMA_SHOT_PRESETS.find((item) => item.id === presetId) || PANORAMA_SHOT_PRESETS[0];
    return stableDisplayLabel('shotPresets', preset.id, preset.label);
  };
  const shotTargetDisplayLabel = (targetId?: string) => {
    const target = PANORAMA_SHOT_TARGET_BONES.find((item) => item.id === targetId) || PANORAMA_SHOT_TARGET_BONES[0];
    return stableDisplayLabel('shotTargets', target.id, target.label);
  };
  const compositionGuideDisplayLabel = (guideId: string, zhLabel: string) => (
    guideId === 'off' ? panoramaT('off') : stableDisplayLabel('compositionGuides', guideId, zhLabel)
  );
  const transientStateLabel = (value: string, fallbackKey: string) => {
    const stateKey = ({
      '已复制': 'copied',
      '复制失败': 'copyFailed',
      '先导出快照': 'exportSnapshotFirst',
      '保存中': 'saving',
      '已在资源库': 'alreadyInLibrary',
      '已保存': 'saved',
      '保存失败': 'saveFailed',
      '没有可保存的全景贴图': 'noTextureToSave',
      '保存资源失败': 'resourceSaveFailed',
    } as Record<string, string>)[value];
    return value ? (stateKey ? panoramaT(`states.${stateKey}`) : value) : panoramaT(fallbackKey);
  };
  const update = useUpdateNodeData(p.id);
  const rf = useReactFlow();
  const upstream = useUpstreamMaterials(p.id);
  const hasAutoOutput = useHasAutoOutput(p.id);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const directorPreviewWrapRef = useRef<HTMLDivElement | null>(null);
  const directorStageRef = useRef<HTMLDivElement | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);
  const storyboardPresetImportRef = useRef<HTMLInputElement | null>(null);
  const storyboardPromptPreviewRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PanoramaRuntime>({ loadToken: 0 });
  const dragRef = useRef<DragState | null>(null);
  const avatarDragRef = useRef<AvatarDragState | null>(null);
  const avatarRotateRef = useRef<AvatarRotateState | null>(null);
  const avatarIkDragRef = useRef<AvatarIkDragState | null>(null);
  const avatarIkControlsRef = useRef<AvatarIkControl[]>([]);
  const occlusionMaskDragRef = useRef<OcclusionMaskDragState | null>(null);
  const viewRef = useRef({ yaw: 0, pitch: 0, fov: 75 });
  const avatarsRef = useRef<PanoramaAvatar[]>([]);
  const d = (p.data as any) || {};
  const requestPanoramaRun = useCallback((mode: PanoramaNodeRunMode) => {
    const requestId = createCanvasNodeRunRequestId(p.id, `panorama-${mode}`);
    update({ panoramaRunMode: mode, panoramaRunRequestId: requestId });
    window.requestAnimationFrame(() => {
      if (requestCanvasNodeRun(p.id, { requestId })) return;
      const liveData = rf.getNode(p.id)?.data as Record<string, unknown> | undefined;
      if (liveData?.panoramaRunRequestId !== requestId) return;
      update({
        panoramaRunMode: 'generate',
        panoramaRunRequestId: '',
        status: 'error',
        panoramaError: '无法提交画布运行请求，请重试。',
      });
    });
  }, [p.id, rf, update]);
  const lockPanoramaStoryboardPreviewTextElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const style = element.style;
    style.setProperty('--tw-text-opacity', '1', 'important');
    style.setProperty('color', '#ffffff', 'important');
    style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
    style.setProperty('-webkit-text-stroke', '0.22px rgba(255, 255, 255, .78)', 'important');
    style.setProperty('color-scheme', 'dark', 'important');
    style.setProperty('forced-color-adjust', 'none', 'important');
    style.setProperty('filter', 'none', 'important');
    style.setProperty('mix-blend-mode', 'normal', 'important');
    style.setProperty('opacity', '1', 'important');
    style.setProperty('text-rendering', 'geometricPrecision', 'important');
    style.setProperty('paint-order', 'stroke fill', 'important');
    style.setProperty('text-shadow', STORYBOARD_PREVIEW_READABLE_TEXT_SHADOW, 'important');
    if (element.dataset.panoramaStoryboardPreview === 'true' || element.dataset.panoramaStoryboardPreviewCaption === 'true') {
      style.setProperty('background-color', '#050505', 'important');
      style.setProperty('background-image', 'none', 'important');
    }
    if (element.dataset.panoramaStoryboardPreviewPlaceholder === 'true') {
      style.setProperty('background-color', '#020617', 'important');
    }
    if (element.dataset.panoramaStoryboardPreviewLine === 'true' || element.dataset.panoramaStoryboardPreviewCaption === 'true') {
      style.setProperty('font-size', '15px', 'important');
      style.setProperty('font-weight', '900', 'important');
      style.setProperty('line-height', '1.42', 'important');
      style.setProperty('letter-spacing', '0', 'important');
    }
  }, []);
  const lockPanoramaStoryboardPreviewTextTree = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    lockPanoramaStoryboardPreviewTextElement(root);
    root
      .querySelectorAll<HTMLElement>('[data-t8-color-lock="panorama-storyboard-preview"], [data-panorama-storyboard-preview-contrast-lock="true"], [data-panorama-storyboard-live-preview-text="white"]')
      .forEach((element) => lockPanoramaStoryboardPreviewTextElement(element));
  }, [lockPanoramaStoryboardPreviewTextElement]);

  const connectedSource = upstream.images[0];
  const generationMode = safePanoramaGenerationMode(d.panoramaGenerationMode);
  const generatedSourceUrl = typeof d.panoramaSourceUrl === 'string' ? d.panoramaSourceUrl : '';
  const connectedSourceUrl = connectedSource?.url || '';
  const panelMode: PanoramaPanelMode = safePanoramaPanelMode(
    d.panoramaPanelMode
      ?? d.panoramaGenerationMode
      ?? (generatedSourceUrl || connectedSourceUrl ? 'preview' : 'text'),
  );
  const sourceUrl = panelMode === 'preview' && connectedSourceUrl
    ? connectedSourceUrl
    : generatedSourceUrl || connectedSourceUrl;
  const outputUrl = typeof d.imageUrl === 'string' ? d.imageUrl : '';
  const sizeLevel: PanoramaSizeLevel = safePanoramaSizeLevel(d.panoramaSizeLevel);
  const userPrompt = typeof d.panoramaPrompt === 'string' ? d.panoramaPrompt : '';
  const viewerPosition = typeof d.panoramaViewerPosition === 'string' ? d.panoramaViewerPosition : '';
  const viewCenter = typeof d.panoramaViewCenter === 'string' ? d.panoramaViewCenter : '';
  const buildPromptFinalFor = useCallback(
    (prompt: string, nextContext: { viewerPosition?: string; viewCenter?: string } = {}) => buildPanoramaPromptFinal(prompt, {
      viewerPosition: nextContext.viewerPosition ?? viewerPosition,
      viewCenter: nextContext.viewCenter ?? viewCenter,
    }),
    [viewCenter, viewerPosition],
  );
  const promptFinal = buildPromptFinalFor(userPrompt);
  const localReferenceUrl = typeof d.panoramaReferenceUrl === 'string' ? d.panoramaReferenceUrl : '';
  const imageReferenceUrl = connectedSource?.url || localReferenceUrl;
  const generatedHistory: PanoramaGenerationHistoryItem[] = Array.isArray(d.panoramaGeneratedHistory)
    ? d.panoramaGeneratedHistory.filter((item: any) => item && typeof item.url === 'string')
    : [];
  const ratioId: PanoramaRatioId = normalizePanoramaRatioId(d.panoramaRatio);
  const customW = clampPanoramaNumber(d.panoramaCustomW, 1, 999, 16);
  const customH = clampPanoramaNumber(d.panoramaCustomH, 1, 999, 9);
  const yaw = clampPanoramaNumber(d.panoramaYaw, -99999, 99999, 0);
  const pitch = clampPitch(d.panoramaPitch);
  const fov = clampFov(d.panoramaFov);
  const cameraViews: PanoramaCameraView[] = useMemo(
    () => sanitizePanoramaCameraViews(d.panoramaCameraViews),
    [d.panoramaCameraViews],
  );
  const hotspots: PanoramaHotspot[] = useMemo(
    () => sanitizePanoramaHotspots(d.panoramaHotspots),
    [d.panoramaHotspots],
  );
  const avatars: PanoramaAvatar[] = useMemo(
    () => sanitizePanoramaAvatars(d.panoramaAvatars),
    [d.panoramaAvatars],
  );
  const avatarKeyframes: PanoramaAvatarKeyframe[] = useMemo(
    () => sanitizePanoramaAvatarKeyframes(d.panoramaAvatarKeyframes, avatars),
    [d.panoramaAvatarKeyframes, avatars],
  );
  const occlusionMasks: PanoramaOcclusionMask[] = useMemo(
    () => sanitizePanoramaOcclusionMasks(d.panoramaOcclusionMasks),
    [d.panoramaOcclusionMasks],
  );
  const keyframeSequenceCount = sanitizePanoramaSequenceFrameCount(d.panoramaKeyframeSequenceCount ?? PANORAMA_KEYFRAME_SEQUENCE_DEFAULT);
  const activeCameraViewId = typeof d.panoramaActiveCameraViewId === 'string' ? d.panoramaActiveCameraViewId : '';
  const activeAvatarId = typeof d.panoramaActiveAvatarId === 'string' ? d.panoramaActiveAvatarId : '';
  const activeAvatar = avatars.find((item) => item.id === activeAvatarId) || avatars[0] || null;
  const avatarPickMode = Boolean(d.panoramaAvatarPickMode);
  const avatarOverlayVisible = d.panoramaActorOverlayVisible !== false;
  const avatarIkEditMode = Boolean(d.panoramaAvatarIkEditMode);
  const occlusionMaskVisible = d.panoramaOcclusionMaskVisible !== false;
  const sceneLegendVisible = d.panoramaSceneLegendVisible !== false;
  const storyboardPromptEnabled = Boolean(d.panoramaStoryboardPromptEnabled);
  const storyboardPromptText = normalizePanoramaStoryboardPrompt(d.panoramaStoryboardPromptText);
  const storyboardPromptPresets: PanoramaStoryboardPromptPreset[] = useMemo(
    () => sanitizePanoramaStoryboardPromptPresets(d.panoramaStoryboardPromptPresets),
    [d.panoramaStoryboardPromptPresets],
  );
  const storyboardSelectedPresetId = typeof d.panoramaStoryboardSelectedPresetId === 'string' ? d.panoramaStoryboardSelectedPresetId : '';
  const storyboardPresetPrompt =
    typeof d.panoramaStoryboardPresetPrompt === 'string' && d.panoramaStoryboardPresetPrompt.trim()
      ? d.panoramaStoryboardPresetPrompt
      : PANORAMA_STORYBOARD_PROMPT_DEFAULT;
  const storyboardPresetName = typeof d.panoramaStoryboardPresetName === 'string' ? d.panoramaStoryboardPresetName : '';
  const compositionGuide: PanoramaCompositionGuideId = safePanoramaCompositionGuide(d.panoramaCompositionGuide);
  const shotCamera: PanoramaShotCamera = useMemo(
    () => sanitizePanoramaShotCamera(d.panoramaShotCamera),
    [d.panoramaShotCamera],
  );
  const effectiveShotCamera: PanoramaShotCamera = useMemo(
    () => sanitizePanoramaShotCamera({
      ...shotCamera,
      targetAvatarId: shotCamera.targetAvatarId || activeAvatar?.id || avatars[0]?.id || '',
    }),
    [activeAvatar?.id, avatars, shotCamera],
  );
  const panoramaTargets = useMemo(
    () => rf.getNodes()
      .filter((node) => node.type === 'panorama-3d')
      .map((node) => ({
        id: node.id,
        label: node.id === p.id
          ? '当前全景'
          : String((node.data as any)?.title || (node.data as any)?.label || `3D全景 #${String((node.data as any)?.nodeSerialId || node.id).slice(0, 5)}`),
      })),
    [activeCameraViewId, hotspots.length, p.id, rf],
  );
  const poseTargets = useMemo(
    () => rf.getNodes()
      .filter((node) => node.type === 'pose-master')
      .map((node) => {
        const data = (node.data as any) || {};
        return {
          id: node.id,
          label: String(data.title || data.label || `姿势大师 #${String(data.nodeSerialId || node.id).slice(0, 5)}`),
          prompt: String(data.posePrompt || data.outputText || data.prompt || data.text || ''),
          presetId: String(data.posePresetId || data.presetId || ''),
          viewId: String(data.poseViewId || data.viewId || ''),
          shotId: String(data.poseShotId || data.shotId || ''),
        };
      }),
    [avatars.length, activeAvatarId, rf],
  );
  const autoRotate = Boolean(d.panoramaAutoRotate);
  const isGenerating = d.status === 'generating';
  const ratio = useMemo(() => resolvePanoramaRatio(ratioId, customW, customH), [customH, customW, ratioId]);
  const renderSize = useMemo(() => panoramaRenderSize(ratio), [ratio]);
  const storyboardPromptPreviewPanel = useMemo(
    () => measurePanoramaStoryboardPromptPanel(storyboardPromptText, Math.max(420, renderSize.width)),
    [renderSize.width, storyboardPromptText],
  );
  useEffect(() => {
    if (!storyboardPromptEnabled) return;
    const relockPreview = () => lockPanoramaStoryboardPreviewTextTree(storyboardPromptPreviewRef.current);
    relockPreview();
    let frame = window.requestAnimationFrame(() => lockPanoramaStoryboardPreviewTextTree(storyboardPromptPreviewRef.current));
    const observer = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          relockPreview();
          window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(() => lockPanoramaStoryboardPreviewTextTree(storyboardPromptPreviewRef.current));
        })
      : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-mode', 'data-theme-visual', 'class', 'style'],
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [
    storyboardPromptEnabled,
    storyboardPromptText,
    storyboardPromptPreviewPanel,
    sourceUrl,
    outputUrl,
    d.panoramaSceneSnapshot?.snapshotUrl,
    d.panoramaSceneSnapshot?.controlSnapshotUrl,
    lockPanoramaStoryboardPreviewTextTree,
  ]);
  const isLikely = useMemo(
    () => isLikelyPanoramaImage({ url: sourceUrl, label: connectedSource?.label, title: d.title, prompt: d.prompt }),
    [d.prompt, d.title, connectedSource?.label, sourceUrl],
  );

  const [textureStatus, setTextureStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [resourceState, setResourceState] = useState('');
  const [quality, setQuality] = useState<PanoramaImageQuality | null>(null);
  const [cameraName, setCameraName] = useState('入口视角');
  const [hotspotLabel, setHotspotLabel] = useState('前往');
  const [hotspotTargetId, setHotspotTargetId] = useState(p.id);
  const [hotspotPickMode, setHotspotPickMode] = useState(false);
  const [sceneCopyState, setSceneCopyState] = useState('');
  const [layoutIoState, setLayoutIoState] = useState('');
  const [storyboardPresetNotice, setStoryboardPresetNotice] = useState('');
  const [sceneResourceState, setSceneResourceState] = useState('');
  const [poseSourceId, setPoseSourceId] = useState('');
  const [avatarIkControls, setAvatarIkControls] = useState<AvatarIkControl[]>([]);
  const [directorFullscreenOpen, setDirectorFullscreenOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [directorPreviewUrl, setDirectorPreviewUrl] = useState('');
  const [activeOcclusionMaskId, setActiveOcclusionMaskId] = useState('');
  const [keyframeSequenceDraft, setKeyframeSequenceDraft] = useState(String(keyframeSequenceCount));
  const [actionPrompt, setActionPrompt] = useState<string>(typeof d.panoramaActionPrompt === 'string' ? d.panoramaActionPrompt : '');
  const [actionPlan, setActionPlan] = useState<PanoramaActionPlan | null>(
    d.panoramaActionPlan ? sanitizePanoramaActionPlan(d.panoramaActionPlan) : null,
  );
  const [actionPlanStatus, setActionPlanStatus] = useState('');
  const [isPlanningAction, setIsPlanningAction] = useState(false);
  const [directorStageBox, setDirectorStageBox] = useState<DirectorStageBox>({ left: 0, top: 0, width: 100, height: 100 });

  const queueAiActionPlan = useCallback((prompt: string) => {
    const normalizedPrompt = prompt.trim();
    const boundView = sanitizePanoramaViewAngles(viewRef.current);
    const boundAvatars = sanitizePanoramaAvatars(avatarsRef.current);
    try {
      const action = createSecondaryProviderActionForNode(p.id, 'panorama-3d', {
        actionId: 'panorama-3d.ai-action-plan',
        target: 'action-plan',
        params: {
          prompt: normalizedPrompt,
          plannerSystemPrompt: buildPanoramaActionPlannerSystemPrompt(),
          plannerUserPrompt: buildPanoramaActionPlannerUserPrompt({
            prompt: normalizedPrompt,
            view: boundView,
            avatars: boundAvatars,
            activeAvatarId: activeAvatarId || undefined,
          }),
          view: boundView as unknown as Record<string, unknown>,
          avatars: boundAvatars as unknown as Record<string, unknown>[],
          activeAvatarId: activeAvatarId || undefined,
        },
      });
      update({
        panoramaActionPrompt: normalizedPrompt,
        panoramaActionPlanError: '',
        ...secondaryProviderActionNodePatch(action),
      });
      setActionPlanStatus('等待运行前检查…');
      queueMicrotask(() => {
        if (!requestCanvasSecondaryProviderAction(action)) {
          const current = secondaryProviderActionFromNodeData(rf.getNode(p.id)?.data);
          if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
          setActionPlanStatus('无法请求画布运行前检查');
        }
      });
    } catch (e: any) {
      const message = e?.message || 'AI 动作解析请求无效';
      setActionPlanStatus(message);
      update({ panoramaActionPlanError: message });
    }
  }, [activeAvatarId, p.id, rf, update]);

  useEffect(() => {
    setKeyframeSequenceDraft(String(keyframeSequenceCount));
  }, [keyframeSequenceCount]);

  const updateKeyframeSequenceDraft = useCallback((value: string) => {
    const next = value.replace(/[^\d]/g, '').slice(0, 2);
    setKeyframeSequenceDraft(next);
    const parsed = Number(next);
    if (Number.isFinite(parsed) && parsed >= 2 && parsed <= PANORAMA_KEYFRAME_SEQUENCE_MAX) {
      update({ panoramaKeyframeSequenceCount: parsed });
    }
  }, [update]);

  const commitKeyframeSequenceDraft = useCallback(() => {
    const next = sanitizePanoramaSequenceFrameCount(keyframeSequenceDraft);
    setKeyframeSequenceDraft(String(next));
    update({ panoramaKeyframeSequenceCount: next });
  }, [keyframeSequenceDraft, update]);

  useEffect(() => {
    if (!directorFullscreenOpen) return;
    const host = directorPreviewWrapRef.current;
    if (!host) return;
    const updateStageBox = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const aspect = ratio.w / Math.max(1, ratio.h);
      let stageWidth = rect.width;
      let stageHeight = stageWidth / aspect;
      if (stageHeight > rect.height) {
        stageHeight = rect.height;
        stageWidth = stageHeight * aspect;
      }
      const next = {
        left: ((rect.width - stageWidth) / 2 / rect.width) * 100,
        top: ((rect.height - stageHeight) / 2 / rect.height) * 100,
        width: (stageWidth / rect.width) * 100,
        height: (stageHeight / rect.height) * 100,
      };
      setDirectorStageBox((prev) => (
        Math.abs(prev.left - next.left) < 0.05 &&
        Math.abs(prev.top - next.top) < 0.05 &&
        Math.abs(prev.width - next.width) < 0.05 &&
        Math.abs(prev.height - next.height) < 0.05
          ? prev
          : next
      ));
    };
    updateStageBox();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateStageBox) : null;
    observer?.observe(host);
    window.addEventListener('resize', updateStageBox);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateStageBox);
    };
  }, [directorFullscreenOpen, ratio.h, ratio.w]);

  const updateAvatarMeshes = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = rt.three;
    if (!THREE || !rt.avatarRoot) return;
    const view = viewRef.current;
    avatarsRef.current.forEach((avatar) => {
      const mesh = rt.avatarMeshes?.get(avatar.id);
      if (!mesh) return;
      mesh.visible = avatar.visible;
      applyAvatarPose(mesh, avatar.poseId, avatar.poseParams);
      const pos = avatarWorldPosition(THREE, avatar);
      const rootHeight = avatar.groundMode === 'grounded' ? 0 : clampPanoramaNumber(avatar.rootHeight, -40, 180, 0);
      pos.y += rootHeight + Number(mesh.userData?.poseYOffset || 0);
      mesh.position.copy(pos);
      const baseScale = clampPanoramaNumber(avatar.scale, 0.35, 2.6, 1);
      mesh.scale.setScalar(baseScale);
      const heading = avatar.faceMode === 'camera' ? view.yaw : avatar.heading;
      const rootPitch = clampPanoramaNumber(avatar.rootPitch, -90, 90, 0) + Number(mesh.userData?.poseRootPitch || 0);
      const rootRoll = clampPanoramaNumber(avatar.rootRoll, -120, 120, 0) + Number(mesh.userData?.poseRootRoll || 0);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(rootPitch),
        THREE.MathUtils.degToRad(-heading + 90),
        THREE.MathUtils.degToRad(rootRoll),
      );
    });
  }, []);

  const publishAvatarIkControls = useCallback(() => {
    const canvas = canvasRef.current;
    const rt = runtimeRef.current;
    const THREE = rt.three;
    if (!canvas || !THREE || !rt.camera || !activeAvatarId || !avatarOverlayVisible || !avatarIkEditMode) {
      if (avatarIkControlsRef.current.length) {
        avatarIkControlsRef.current = [];
        setAvatarIkControls([]);
      }
      return;
    }
    const next = collectAvatarIkControls(THREE, rt, canvas, activeAvatarId);
    const prevKey = avatarIkControlsRef.current
      .map((item) => `${item.id}:${item.avatarId}:${item.x.toFixed(2)}:${item.y.toFixed(2)}`)
      .join('|');
    const nextKey = next
      .map((item) => `${item.id}:${item.avatarId}:${item.x.toFixed(2)}:${item.y.toFixed(2)}`)
      .join('|');
    if (prevKey !== nextKey) {
      avatarIkControlsRef.current = next;
      setAvatarIkControls(next);
    }
  }, [activeAvatarId, avatarIkEditMode, avatarOverlayVisible]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const rt = runtimeRef.current;
    const THREE = rt.three;
    if (!canvas || !rt.renderer || !rt.scene || !rt.camera || !rt.sphere || !THREE || !rt.image?.naturalWidth) {
      return false;
    }
    const view = viewRef.current;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    rt.renderer.setSize(width, height, false);
    rt.camera.fov = view.fov;
    rt.camera.aspect = width / Math.max(1, height);
    rt.camera.updateProjectionMatrix();
    const phi = THREE.MathUtils.degToRad(90 - view.pitch);
    const theta = THREE.MathUtils.degToRad(view.yaw);
    const target = new THREE.Vector3(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta),
    );
    rt.camera.position.set(0, 0, 0);
    rt.camera.lookAt(target);
    updateAvatarMeshes();
    rt.renderer.render(rt.scene, rt.camera);
    publishAvatarIkControls();
    return true;
  }, [publishAvatarIkControls, updateAvatarMeshes]);

  const ensureRenderer = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rt = runtimeRef.current;
    if (!rt.three) {
      rt.loadPromise = rt.loadPromise || import('three');
      rt.three = await rt.loadPromise;
    }
    const THREE = rt.three;
    if (!rt.renderer) {
      rt.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      rt.renderer.setPixelRatio(1);
      rt.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if (!rt.scene) {
      rt.scene = new THREE.Scene();
      rt.camera = new THREE.PerspectiveCamera(viewRef.current.fov, 16 / 9, 1, 1200);
      const geometry = new THREE.SphereGeometry(500, 96, 64);
      geometry.scale(-1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      rt.sphere = new THREE.Mesh(geometry, material);
      rt.scene.add(rt.sphere);
      rt.avatarRoot = new THREE.Group();
      rt.avatarRoot.name = 'panorama-avatar-root';
      rt.scene.add(rt.avatarRoot);
      rt.avatarMeshes = new Map();
    }
    return true;
  }, []);

  const rebuildAvatarMeshes = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = rt.three;
    if (!THREE || !rt.scene || !rt.avatarRoot) return;
    const root = rt.avatarRoot;
    while (root.children.length) {
      const child = root.children.pop();
      child?.traverse?.((obj: any) => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
    }
    rt.avatarMeshes = new Map();
    avatarsRef.current.forEach((avatar) => {
      const mesh = makeAvatarMesh(THREE, avatar, avatar.id === activeAvatarId);
      rt.avatarMeshes?.set(avatar.id, mesh);
      root.add(mesh);
    });
    updateAvatarMeshes();
    drawFrame();
  }, [activeAvatarId, drawFrame, updateAvatarMeshes]);

  useEffect(() => {
    viewRef.current = { yaw, pitch, fov };
    drawFrame();
  }, [drawFrame, fov, pitch, yaw]);

  useEffect(() => {
    avatarsRef.current = avatars;
    rebuildAvatarMeshes();
  }, [avatars, rebuildAvatarMeshes]);

  const disposeTexture = useCallback(() => {
    const rt = runtimeRef.current;
    rt.texture?.dispose?.();
    rt.texture = undefined;
    if (rt.sphere?.material) {
      rt.sphere.material.map = null;
      rt.sphere.material.needsUpdate = true;
    }
    rt.image = undefined;
  }, []);

  const applyTexture = useCallback((img: HTMLImageElement) => {
    const rt = runtimeRef.current;
    const THREE = rt.three;
    if (!THREE || !rt.sphere || !img.naturalWidth || !img.naturalHeight) return false;
    disposeTexture();
    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    rt.texture = texture;
    rt.image = img;
    rt.sphere.material.map = texture;
    rt.sphere.material.needsUpdate = true;
    return true;
  }, [disposeTexture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = renderSize.width;
    canvas.height = renderSize.height;
    drawFrame();
  }, [drawFrame, renderSize.height, renderSize.width]);

  useEffect(() => {
    if (!sourceUrl) {
      runtimeRef.current.loadToken += 1;
      disposeTexture();
      setTextureStatus('idle');
      setError('');
      setQuality(null);
      return;
    }
    const token = ++runtimeRef.current.loadToken;
    setTextureStatus('loading');
    setError('');
    let cancelled = false;

    (async () => {
      try {
        const ready = await ensureRenderer();
        if (!ready || cancelled || token !== runtimeRef.current.loadToken) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled || token !== runtimeRef.current.loadToken) return;
          if (!applyTexture(img)) {
            setTextureStatus('error');
            setError('全景贴图加载失败');
            return;
          }
          setTextureStatus('ready');
          setQuality(estimatePanoramaImageQuality(img));
          rebuildAvatarMeshes();
          drawFrame();
        };
        img.onerror = () => {
          if (cancelled || token !== runtimeRef.current.loadToken) return;
          setTextureStatus('error');
          setQuality(null);
          setError('图片无法作为 3D 全景加载');
        };
        img.src = sourceUrl;
        if (img.complete && img.naturalWidth) img.onload?.(new Event('load'));
      } catch (e: any) {
        if (cancelled || token !== runtimeRef.current.loadToken) return;
        setTextureStatus('error');
        setQuality(null);
        setError(e?.message || 'Three.js 初始化失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyTexture, disposeTexture, drawFrame, ensureRenderer, rebuildAvatarMeshes, sourceUrl]);

  useEffect(() => {
    const rt = runtimeRef.current;
    if (rt.animationId) cancelAnimationFrame(rt.animationId);
    rt.animationId = undefined;
    if (!autoRotate || textureStatus !== 'ready') {
      return;
    }
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (!dragRef.current) {
        viewRef.current = {
          ...viewRef.current,
          yaw: viewRef.current.yaw + 0.12,
        };
      }
      drawFrame();
      rt.animationId = requestAnimationFrame(tick);
    };
    rt.animationId = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (rt.animationId) cancelAnimationFrame(rt.animationId);
      rt.animationId = undefined;
    };
  }, [autoRotate, drawFrame, textureStatus]);

  useEffect(() => () => {
    const rt = runtimeRef.current;
    if (rt.animationId) cancelAnimationFrame(rt.animationId);
    disposeTexture();
    rt.avatarRoot?.traverse?.((obj: any) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    rt.sphere?.geometry?.dispose?.();
    rt.sphere?.material?.dispose?.();
    rt.renderer?.dispose?.();
    runtimeRef.current = { loadToken: rt.loadToken + 1 };
  }, [disposeTexture]);

  const setView = (patch: Record<string, any>) => update(patch);

  const applyView = useCallback((patch: Partial<{ yaw: number; pitch: number; fov: number }>, extra: Record<string, any> = {}) => {
    const next = sanitizePanoramaViewAngles({
      ...viewRef.current,
      ...patch,
    });
    viewRef.current = next;
    drawFrame();
    update({
      panoramaYaw: next.yaw,
      panoramaPitch: next.pitch,
      panoramaFov: next.fov,
      ...extra,
    });
    return next;
  }, [drawFrame, update]);

  const getInteractionElement = useCallback((surface: PanoramaInteractionSurface = 'node') => (
    surface === 'director'
      ? directorStageRef.current
      : previewStageRef.current || canvasRef.current
  ), []);

  const getInteractionRect = useCallback((surface: PanoramaInteractionSurface = 'node') => {
    const target = getInteractionElement(surface);
    return target?.getBoundingClientRect() || canvasRef.current?.getBoundingClientRect() || null;
  }, [getInteractionElement]);

  const saveCameraView = useCallback(() => {
    const view = sanitizePanoramaViewAngles(viewRef.current);
    const next = upsertPanoramaCameraView(cameraViews, {
      name: cameraName,
      yaw: view.yaw,
      pitch: view.pitch,
      fov: view.fov,
    });
    const saved = next[0];
    update({
      panoramaCameraViews: next,
      panoramaActiveCameraViewId: saved?.id || '',
      panoramaYaw: saved?.yaw ?? view.yaw,
      panoramaPitch: saved?.pitch ?? view.pitch,
      panoramaFov: saved?.fov ?? view.fov,
    });
  }, [cameraName, cameraViews, update]);

  const applyCameraView = useCallback((item: PanoramaCameraView) => {
    applyView(item, { panoramaActiveCameraViewId: item.id });
  }, [applyView]);

  const setDefaultCameraView = useCallback((item: PanoramaCameraView) => {
    const next = markPanoramaDefaultCameraView(cameraViews, item.id);
    applyView(item, {
      panoramaCameraViews: next,
      panoramaActiveCameraViewId: item.id,
    });
  }, [applyView, cameraViews]);

  const removeCameraView = useCallback((item: PanoramaCameraView) => {
    const next = deletePanoramaCameraView(cameraViews, item.id);
    update({
      panoramaCameraViews: next,
      panoramaActiveCameraViewId: activeCameraViewId === item.id ? '' : activeCameraViewId,
    });
  }, [activeCameraViewId, cameraViews, update]);

  const addHotspotAt = useCallback((view: Partial<{ yaw: number; pitch: number; fov: number }>) => {
    const angles = sanitizePanoramaViewAngles(view);
    const target = hotspotTargetId || p.id;
    const targetAngles = target === p.id ? angles : sanitizePanoramaViewAngles(viewRef.current);
    const next = upsertPanoramaHotspot(hotspots, {
      label: hotspotLabel,
      yaw: angles.yaw,
      pitch: angles.pitch,
      fov: angles.fov,
      targetNodeId: target,
      targetYaw: targetAngles.yaw,
      targetPitch: targetAngles.pitch,
      targetFov: targetAngles.fov,
    });
    update({ panoramaHotspots: next });
  }, [hotspotLabel, hotspotTargetId, hotspots, p.id, update]);

  const removeHotspot = useCallback((item: PanoramaHotspot) => {
    update({ panoramaHotspots: deletePanoramaHotspot(hotspots, item.id) });
  }, [hotspots, update]);

  const patchHotspot = useCallback((item: PanoramaHotspot, patch: Partial<PanoramaHotspot>) => {
    update({ panoramaHotspots: updatePanoramaHotspot(hotspots, item.id, patch) });
  }, [hotspots, update]);

  const jumpToHotspot = useCallback((item: PanoramaHotspot) => {
    const targetNodeId = item.targetNodeId || p.id;
    const targetView = {
      yaw: item.targetYaw ?? item.yaw,
      pitch: item.targetPitch ?? item.pitch,
      fov: item.targetFov ?? item.fov ?? fov,
    };
    if (!targetNodeId || targetNodeId === p.id) {
      applyView(targetView);
      return;
    }
    const targetNode = rf.getNodes().find((node) => node.id === targetNodeId);
    rf.setNodes((nodes) => nodes.map((node) => {
      if (node.id !== targetNodeId) return { ...node, selected: false };
      return {
        ...node,
        selected: true,
        data: {
          ...(node.data as any),
          panoramaYaw: targetView.yaw,
          panoramaPitch: targetView.pitch,
          panoramaFov: targetView.fov,
          panoramaActiveCameraViewId: '',
        },
      };
    }));
    if (targetNode) {
      const width = Number((targetNode as any).measured?.width || (targetNode as any).width || 760);
      const height = Number((targetNode as any).measured?.height || (targetNode as any).height || 720);
      window.setTimeout(() => {
        rf.setCenter(targetNode.position.x + width / 2, targetNode.position.y + height / 2, { zoom: 0.85, duration: 420 });
      }, 40);
    }
  }, [applyView, fov, p.id, rf]);

  const visibleHotspots = useMemo(
    () => hotspots
      .map((item) => ({
        item,
        pos: projectPanoramaHotspot({
          hotspot: item,
          view: { yaw, pitch, fov },
          aspect: ratio.w / Math.max(1, ratio.h),
        }),
      }))
      .filter((entry) => entry.pos.visible),
    [fov, hotspots, pitch, ratio.h, ratio.w, yaw],
  );

  const scenePrompt = useMemo(
    () => buildPanoramaScenePrompt({
      avatars,
      view: { yaw, pitch, fov },
      shotCamera: effectiveShotCamera,
      keyframes: avatarKeyframes,
      sequenceFrameCount: keyframeSequenceCount,
      occlusionMasks,
    }),
    [avatarKeyframes, avatars, effectiveShotCamera, fov, keyframeSequenceCount, occlusionMasks, pitch, yaw],
  );

  const actionQuickTerms = useMemo(
    () => PANORAMA_ACTION_TERMS.filter((term) => (
      ['flying-kick', 'hit-back', 'dodge', 'help-up', 'foot-closeup', 'low-angle', 'wave', 'pointing'].includes(term.id)
    )),
    [],
  );
  const actionPlanSummary = useMemo(() => {
    if (!actionPlan) return [];
    const shotLabel = actionPlan.shotCamera?.presetId ? shotPresetDisplayLabel(actionPlan.shotCamera.presetId) : '';
    return [
      ...actionPlan.avatars.map((avatar, index) => panoramaT('actionPlanAvatarSummary', {
        index: index + 1,
        name: avatar.name || avatar.ref,
        pose: poseDisplayLabel(avatar.poseId),
        floating: avatar.groundMode === 'floating' ? panoramaT('floatingSuffix') : '',
      })),
      actionPlan.keyframes?.length ? panoramaT('actionPlanKeyframeSummary', {
        keyframes: actionPlan.keyframes.length,
        frames: actionPlan.sequenceFrameCount || keyframeSequenceCount,
      }) : '',
      shotLabel ? panoramaT('actionPlanShotSummary', { shot: shotLabel }) : '',
      ...(actionPlan.warnings || []).map((item) => panoramaT('actionPlanWarning', { message: item })),
    ].filter(Boolean);
  }, [actionPlan, i18n.language, keyframeSequenceCount]);

  const visibleAvatarMarkers = useMemo(
    () => avatars
      .filter((item) => item.visible)
      .map((item, index) => ({
        item,
        index,
        pos: projectPanoramaAvatar({
          avatar: item,
          view: { yaw, pitch, fov },
          aspect: ratio.w / Math.max(1, ratio.h),
        }),
      }))
      .filter((entry) => entry.pos.visible),
    [avatars, fov, pitch, ratio.h, ratio.w, yaw],
  );
  const guideRatio = PANORAMA_COMPOSITION_GUIDES.find((item) => item.id === compositionGuide)?.ratio || null;
  const guideStyle = useMemo(() => {
    if (!guideRatio) return null;
    const canvasAspect = ratio.w / Math.max(1, ratio.h);
    const targetAspect = guideRatio.w / Math.max(1, guideRatio.h);
    if (targetAspect >= canvasAspect) {
      const h = Math.min(92, 92 * (canvasAspect / targetAspect));
      return { width: '92%', height: `${h}%` };
    }
    const w = Math.min(92, 92 * (targetAspect / canvasAspect));
    return { width: `${w}%`, height: '92%' };
  }, [guideRatio, ratio.h, ratio.w]);
  const shotTarget = useMemo(
    () => projectPanoramaShotTarget({
      shotCamera: effectiveShotCamera,
      avatars,
      view: { yaw, pitch, fov },
      aspect: ratio.w / Math.max(1, ratio.h),
    }),
    [avatars, effectiveShotCamera, fov, pitch, ratio.h, ratio.w, yaw],
  );
  const shotGuideRatio = effectiveShotCamera.mode === 'shot-camera'
    ? PANORAMA_COMPOSITION_GUIDES.find((item) => item.id === effectiveShotCamera.framingRatio)?.ratio || { w: 16, h: 9 }
    : null;
  const shotGuideStyle = useMemo(() => {
    if (!shotGuideRatio) return null;
    const canvasAspect = ratio.w / Math.max(1, ratio.h);
    const targetAspect = shotGuideRatio.w / Math.max(1, shotGuideRatio.h);
    const scale = 92 - effectiveShotCamera.closeupStrength * 0.34;
    if (targetAspect >= canvasAspect) {
      const h = Math.min(scale, scale * (canvasAspect / targetAspect));
      return { width: `${scale}%`, height: `${h}%` };
    }
    const w = Math.min(scale, scale * (targetAspect / canvasAspect));
    return { width: `${w}%`, height: `${scale}%` };
  }, [effectiveShotCamera.closeupStrength, ratio.h, ratio.w, shotGuideRatio]);
  const shotTargetLineStyle = useMemo(() => {
    if (!shotGuideStyle || !shotTarget.visible) return null;
    const dx = shotTarget.x - 50;
    const dy = shotTarget.y - 50;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return {
      left: '50%',
      top: '50%',
      width: `${length}%`,
      transform: `rotate(${angle}deg)`,
    };
  }, [shotGuideStyle, shotTarget]);

  const addAvatarAt = useCallback((view: Partial<{ yaw: number; pitch: number; fov: number }>) => {
    setActiveOcclusionMaskId('');
    const angles = sanitizePanoramaViewAngles(view);
    const next = upsertPanoramaAvatar(avatars, {
      name: avatarName(avatars.length),
      yaw: angles.yaw,
      pitch: Math.min(30, angles.pitch),
      distance: 220,
      scale: 1,
      heading: angles.yaw,
      faceMode: 'camera',
      poseId: 'standing',
      groundMode: 'grounded',
      rootHeight: 0,
      rootPitch: 0,
      rootRoll: 0,
      color: PANORAMA_AVATAR_COLORS[avatars.length % PANORAMA_AVATAR_COLORS.length],
      opacity: 0.9,
    });
    update({
      panoramaAvatars: next,
      panoramaActiveAvatarId: next[0]?.id || '',
      panoramaAvatarPickMode: false,
      panoramaActorOverlayVisible: true,
    });
  }, [avatars, update]);

  const addAvatarAtCenter = useCallback(() => {
    addAvatarAt({ ...viewRef.current, pitch: Math.min(viewRef.current.pitch - 12, 20) });
  }, [addAvatarAt]);

  const patchAvatar = useCallback((avatar: PanoramaAvatar, patch: Partial<PanoramaAvatar>) => {
    update({ panoramaAvatars: updatePanoramaAvatar(avatars, avatar.id, patch) });
  }, [avatars, update]);

  const patchAvatarPoseParam = useCallback((avatar: PanoramaAvatar, key: string, value: number) => {
    patchAvatar(avatar, {
      poseParams: {
        ...(avatar.poseParams || {}),
        [key]: Math.round(value * 1000) / 1000,
      },
    });
  }, [patchAvatar]);

  const patchShotCamera = useCallback((patch: Partial<PanoramaShotCamera>) => {
    update({ panoramaShotCamera: sanitizePanoramaShotCamera({ ...effectiveShotCamera, ...patch }) });
  }, [effectiveShotCamera, update]);

  const saveAvatarKeyframe = useCallback(() => {
    if (!activeAvatar) return;
    const existingForAvatar = avatarKeyframes.filter((item) => item.avatarId === activeAvatar.id);
    const nextIndex = existingForAvatar.length + 1;
    const next = upsertPanoramaAvatarKeyframe(avatarKeyframes, {
      ...activeAvatar,
      avatarId: activeAvatar.id,
      avatarName: activeAvatar.name,
      label: `K${nextIndex}`,
      time: existingForAvatar.length,
      note: `${PANORAMA_AVATAR_POSES.find((pose) => pose.id === activeAvatar.poseId)?.label || '动作'}参考`,
    }, avatars);
    update({ panoramaAvatarKeyframes: next });
  }, [activeAvatar, avatarKeyframes, avatars, update]);

  const applyAvatarKeyframe = useCallback((keyframe: PanoramaAvatarKeyframe) => {
    const target = avatars.find((item) => item.id === keyframe.avatarId) || activeAvatar;
    if (!target) return;
    const next = updatePanoramaAvatar(avatars, target.id, {
      yaw: keyframe.yaw,
      pitch: keyframe.pitch,
      distance: keyframe.distance,
      heightOffset: keyframe.heightOffset,
      rootHeight: keyframe.rootHeight,
      rootPitch: keyframe.rootPitch,
      rootRoll: keyframe.rootRoll,
      groundMode: keyframe.groundMode,
      scale: keyframe.scale,
      heading: keyframe.heading,
      faceMode: keyframe.faceMode,
      poseId: keyframe.poseId,
      poseParams: keyframe.poseParams || {},
    });
    update({ panoramaAvatars: next, panoramaActiveAvatarId: target.id });
  }, [activeAvatar, avatars, update]);

  const removeAvatarKeyframe = useCallback((keyframe: PanoramaAvatarKeyframe) => {
    update({ panoramaAvatarKeyframes: deletePanoramaAvatarKeyframe(avatarKeyframes, keyframe.id, avatars) });
  }, [avatarKeyframes, avatars, update]);

  const addOcclusionMask = useCallback(() => {
    const id = `mask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const next = upsertPanoramaOcclusionMask(occlusionMasks, {
      id,
      label: `遮挡 ${occlusionMasks.length + 1}`,
      x: 35,
      y: 55,
      w: 30,
      h: 16,
      strength: 70,
      note: '前景遮挡或接触边界',
    });
    setActiveOcclusionMaskId(id);
    update({ panoramaOcclusionMasks: next, panoramaOcclusionMaskVisible: true });
  }, [occlusionMasks, update]);

  const patchOcclusionMask = useCallback((mask: PanoramaOcclusionMask, patch: Partial<PanoramaOcclusionMask>) => {
    update({ panoramaOcclusionMasks: upsertPanoramaOcclusionMask(occlusionMasks, { ...mask, ...patch }) });
  }, [occlusionMasks, update]);

  const removeOcclusionMask = useCallback((mask: PanoramaOcclusionMask) => {
    if (activeOcclusionMaskId === mask.id) setActiveOcclusionMaskId('');
    update({ panoramaOcclusionMasks: deletePanoramaOcclusionMask(occlusionMasks, mask.id) });
  }, [activeOcclusionMaskId, occlusionMasks, update]);

  const patchOcclusionMaskById = useCallback((id: string, patch: Partial<PanoramaOcclusionMask>) => {
    const target = occlusionMasks.find((item) => item.id === id);
    if (!target) return;
    update({ panoramaOcclusionMasks: upsertPanoramaOcclusionMask(occlusionMasks, { ...target, ...patch }) });
  }, [occlusionMasks, update]);

  const startOcclusionMaskDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mask: PanoramaOcclusionMask,
    mode: OcclusionDragMode,
    surface: PanoramaInteractionSurface = 'node',
  ) => {
    const rect = getInteractionRect(surface);
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    setPointerCaptureSafe(getInteractionElement(surface) || event.currentTarget, event.pointerId);
    setActiveOcclusionMaskId(mask.id);
    dragRef.current = null;
    avatarDragRef.current = null;
    avatarRotateRef.current = null;
    avatarIkDragRef.current = null;
    occlusionMaskDragRef.current = {
      pointerId: event.pointerId,
      maskId: mask.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      mask,
    };
    update({ panoramaOcclusionMaskVisible: true });
  };

  const moveOcclusionMaskDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = occlusionMaskDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = drag.rect.width > 0 ? ((event.clientX - drag.startX) / drag.rect.width) * 100 : 0;
    const dy = drag.rect.height > 0 ? ((event.clientY - drag.startY) / drag.rect.height) * 100 : 0;
    let x = drag.mask.x;
    let y = drag.mask.y;
    let w = drag.mask.w;
    let h = drag.mask.h;
    const minSize = 4;
    if (drag.mode === 'move') {
      x += dx;
      y += dy;
    } else {
      if (drag.mode.includes('w')) {
        x += dx;
        w -= dx;
      }
      if (drag.mode.includes('e')) w += dx;
      if (drag.mode.includes('n')) {
        y += dy;
        h -= dy;
      }
      if (drag.mode.includes('s')) h += dy;
    }
    w = Math.max(minSize, Math.min(100, w));
    h = Math.max(minSize, Math.min(100, h));
    x = Math.max(0, Math.min(100 - w, x));
    y = Math.max(0, Math.min(100 - h, y));
    patchOcclusionMaskById(drag.maskId, {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      w: Math.round(w * 10) / 10,
      h: Math.round(h * 10) / 10,
    });
  };

  const endOcclusionMaskDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = occlusionMaskDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureSafe(event.currentTarget, event.pointerId);
    occlusionMaskDragRef.current = null;
  };

  const changeShotPreset = useCallback((presetId: string) => {
    const preset = PANORAMA_SHOT_PRESETS.find((item) => item.id === presetId) || PANORAMA_SHOT_PRESETS[0];
    patchShotCamera({
      mode: 'shot-camera',
      presetId: preset.id,
      targetAvatarId: effectiveShotCamera.targetAvatarId || activeAvatar?.id || avatars[0]?.id || '',
      targetBone: preset.targetBone,
      framingRatio: preset.framingRatio,
      closeupStrength: preset.closeupStrength,
      lowAngle: preset.lowAngle,
    });
  }, [activeAvatar?.id, avatars, effectiveShotCamera.targetAvatarId, patchShotCamera]);

  const applyDirectorShotView = useCallback(() => {
    const target =
      avatars.find((item) => item.id === effectiveShotCamera.targetAvatarId) ||
      activeAvatar ||
      avatars[0];
    if (!target) return;
    const bonePitchOffset: Record<string, number> = {
      body: 0,
      head: 10,
      torso: 3,
      pelvis: -5,
      leftHand: 1,
      rightHand: 1,
      leftFoot: -16,
      rightFoot: -16,
    };
    const closeupFov = clampFov(82 - effectiveShotCamera.closeupStrength * 0.42);
    const lowAngleLift = (effectiveShotCamera.lowAngle - 45) * 0.12;
    applyView({
      yaw: target.yaw,
      pitch: clampPanoramaNumber(target.pitch + (bonePitchOffset[effectiveShotCamera.targetBone] || 0) + lowAngleLift, -85, 85, target.pitch),
      fov: closeupFov,
    }, {
      panoramaActiveAvatarId: target.id,
      panoramaShotCamera: sanitizePanoramaShotCamera({
        ...effectiveShotCamera,
        mode: 'shot-camera',
        targetAvatarId: target.id,
      }),
      panoramaActiveCameraViewId: '',
    });
  }, [activeAvatar, applyView, avatars, effectiveShotCamera]);

  const storeActionPlanDraft = useCallback((plan: PanoramaActionPlan, status: string, boundPrompt = actionPrompt) => {
    const next = sanitizePanoramaActionPlan({
      ...plan,
      prompt: plan.prompt || boundPrompt,
    });
    setActionPlan(next);
    setActionPlanStatus(status);
    update({
      panoramaActionPrompt: boundPrompt,
      panoramaActionPlan: next,
      panoramaActionPlanError: '',
    });
    return next;
  }, [actionPrompt, update]);

  const createLocalActionPlan = useCallback((mode: PanoramaActionPlan['mode'] = 'append') => {
    const next = buildPanoramaLocalActionPlan({
      prompt: actionPrompt,
      view: viewRef.current,
      avatars,
      activeAvatarId: activeAvatar?.id,
      mode,
    });
    storeActionPlanDraft(next, next.warnings?.length ? next.warnings[0] : '已生成本地动作草案');
  }, [actionPrompt, activeAvatar?.id, avatars, storeActionPlanDraft]);

  const requestAiActionPlan = useCallback(() => {
    if (!actionPrompt.trim()) {
      createLocalActionPlan();
      return;
    }
    queueAiActionPlan(actionPrompt);
  }, [actionPrompt, createLocalActionPlan, queueAiActionPlan]);

  const executeAiActionPlan = useCallback(async (
    action: Extract<SecondaryProviderActionEnvelope, { actionId: 'panorama-3d.ai-action-plan' }>,
    reporter: RunNodeLifecycleReporter,
  ) => {
    const params = action.params;
    const boundView = sanitizePanoramaViewAngles(params.view);
    const boundAvatars = sanitizePanoramaAvatars(params.avatars);
    let providerRequested = false;
    let providerResponded = false;
    setIsPlanningAction(true);
    setActionPlanStatus('AI解析中...');
    try {
      await reporter.providerRequest({
        provider: 'zhenzhen-llm',
        model: 'gpt-4o-mini',
        actionId: action.actionId,
        actionTarget: action.target,
        requestId: action.requestId,
      });
      providerRequested = true;
      const res = await generateLlm({
        model: 'gpt-4o-mini',
        temperature: 0.15,
        max_tokens: 2800,
        messages: [
          { role: 'system', content: params.plannerSystemPrompt },
          { role: 'user', content: params.plannerUserPrompt },
        ],
      }, { submissionKey: reporter.providerSubmissionKey });
      const trace = extractRunProviderTrace(res);
      await reporter.providerResponse({
        provider: 'zhenzhen-llm',
        model: res.model || 'gpt-4o-mini',
        ...trace,
        status: 'succeeded',
      });
      providerResponded = true;
      if (res.usage) {
        await reporter.providerUsage({
          provider: 'zhenzhen-llm',
          model: res.model || 'gpt-4o-mini',
          usage: res.usage,
        });
      }
      const parsed = parsePanoramaActionPlanJson(res.content);
      if (!parsed || parsed.avatars.length === 0) {
        throw new Error('AI 未返回有效动作 JSON');
      }
      const stored = storeActionPlanDraft(
        { ...parsed, prompt: parsed.prompt || params.prompt },
        '已生成 AI 动作草案',
        params.prompt,
      );
      await reporter.output({
        status: 'succeeded',
        actionPlan: stored,
      });
    } catch (e: any) {
      const message = e?.message || '调用失败';
      if (!providerRequested) {
        setActionPlanStatus(`AI解析未开始：${message}`);
        update({ panoramaActionPlanError: message });
        throw e;
      }
      const fallback = buildPanoramaLocalActionPlan({
        prompt: params.prompt,
        view: boundView,
        avatars: boundAvatars,
        activeAvatarId: params.activeAvatarId,
        mode: 'append',
      });
      storeActionPlanDraft(fallback, `AI解析失败，已用本地草案：${message}`, params.prompt);
      update({ panoramaActionPlanError: message });
      if (providerRequested && !providerResponded) {
        await reporter.providerResponse({
          provider: 'zhenzhen-llm',
          model: 'gpt-4o-mini',
          status: 'failed',
        });
      }
      throw e;
    } finally {
      setIsPlanningAction(false);
    }
  }, [storeActionPlanDraft, update]);

  const planAvatarPatch = useCallback((
    planAvatar: PanoramaActionPlanAvatar,
    index: number,
    targetId: string,
    existing?: PanoramaAvatar,
  ): Partial<PanoramaAvatar> => {
    const view = sanitizePanoramaViewAngles(viewRef.current);
    const resolvedPoseId = planAvatar.poseId ?? existing?.poseId ?? 'standing';
    const poseRootDefaults = panoramaAvatarPoseRootDefaults(resolvedPoseId);
    const poseChanged = Boolean(planAvatar.poseId && planAvatar.poseId !== existing?.poseId);
    return {
      id: targetId,
      name: planAvatar.name || existing?.name || (planAvatar.ref === '当前角色' ? `角色 ${index + 1}` : planAvatar.ref),
      visible: planAvatar.visible ?? existing?.visible ?? true,
      yaw: planAvatar.yaw ?? existing?.yaw ?? normalizePanoramaYaw(view.yaw + (index - 0.5) * 12),
      pitch: planAvatar.pitch ?? existing?.pitch ?? clampPanoramaNumber(view.pitch - 10, -50, 25, -12),
      distance: planAvatar.distance ?? existing?.distance ?? 220,
      heightOffset: planAvatar.heightOffset ?? existing?.heightOffset ?? 0,
      rootHeight: planAvatar.rootHeight ?? (poseChanged ? poseRootDefaults.rootHeight : existing?.rootHeight) ?? poseRootDefaults.rootHeight,
      rootPitch: planAvatar.rootPitch ?? (poseChanged ? poseRootDefaults.rootPitch : existing?.rootPitch) ?? poseRootDefaults.rootPitch,
      rootRoll: planAvatar.rootRoll ?? (poseChanged ? poseRootDefaults.rootRoll : existing?.rootRoll) ?? poseRootDefaults.rootRoll,
      groundMode: planAvatar.groundMode ?? (poseChanged ? poseRootDefaults.groundMode : existing?.groundMode) ?? poseRootDefaults.groundMode,
      scale: planAvatar.scale ?? existing?.scale ?? 1,
      heading: planAvatar.heading ?? existing?.heading ?? planAvatar.yaw ?? view.yaw,
      faceMode: planAvatar.faceMode ?? existing?.faceMode ?? (actionPlan?.avatars.length && actionPlan.avatars.length > 1 ? 'heading' : 'camera'),
      poseId: resolvedPoseId,
      poseParams: {
        ...(panoramaAvatarPoseDefaultParams(resolvedPoseId) || {}),
        ...(poseChanged ? {} : existing?.poseParams || {}),
        ...(planAvatar.poseParams || {}),
      },
      color: planAvatar.color || existing?.color || PANORAMA_AVATAR_COLORS[index % PANORAMA_AVATAR_COLORS.length],
      opacity: planAvatar.opacity ?? existing?.opacity ?? 0.9,
      locked: existing?.locked,
      characterPrompt: planAvatar.characterPrompt ?? existing?.characterPrompt ?? '',
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
  }, [actionPlan?.avatars.length]);

  const applyActionPlan = useCallback((modeOverride?: PanoramaActionPlan['mode']) => {
    const basePlan = actionPlan || buildPanoramaLocalActionPlan({
      prompt: actionPrompt,
      view: viewRef.current,
      avatars,
      activeAvatarId: activeAvatar?.id,
      mode: modeOverride || 'append',
    });
    if (!actionPlan) {
      storeActionPlanDraft(basePlan, '已生成本地动作草案');
    }
    const plan = sanitizePanoramaActionPlan({
      ...basePlan,
      mode: modeOverride || basePlan.mode,
      prompt: actionPrompt || basePlan.prompt,
    });
    if (plan.avatars.length === 0) {
      setActionPlanStatus('没有可应用的角色草案');
      return;
    }
    const mode = plan.mode;
    const refToId = new Map<string, string>();
    let nextAvatars = mode === 'replace-actors' ? [] as PanoramaAvatar[] : avatars;
    const planAvatars = mode === 'update-selected' && activeAvatar
      ? plan.avatars.slice(0, 1)
      : plan.avatars;
    planAvatars.forEach((planAvatar, index) => {
      const existing =
        mode === 'update-selected' && activeAvatar
          ? activeAvatar
          : avatars.find((item) => item.name === planAvatar.ref || item.name === planAvatar.name);
      const id = existing?.id || `avatar_action_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`;
      refToId.set(planAvatar.ref, id);
      if (planAvatar.name) refToId.set(planAvatar.name, id);
      if (mode === 'update-selected' && existing) {
        nextAvatars = updatePanoramaAvatar(nextAvatars, existing.id, planAvatarPatch(planAvatar, index, existing.id, existing));
      } else {
        nextAvatars = upsertPanoramaAvatar(nextAvatars, planAvatarPatch(planAvatar, index, id, existing));
      }
    });
    const activeId = refToId.get(planAvatars[0]?.ref || '') || activeAvatar?.id || nextAvatars[0]?.id || '';
    let nextKeyframes = mode === 'replace-actors' ? [] as PanoramaAvatarKeyframe[] : avatarKeyframes;
    (plan.keyframes || []).forEach((frame: PanoramaActionPlanKeyframe, index) => {
      const avatarId = refToId.get(frame.avatarRef);
      if (!avatarId) return;
      const linked = nextAvatars.find((item) => item.id === avatarId);
      if (!linked) return;
      const framePoseId = frame.poseId ?? linked.poseId;
      const frameRootDefaults = panoramaAvatarPoseRootDefaults(framePoseId);
      nextKeyframes = upsertPanoramaAvatarKeyframe(nextKeyframes, {
        id: `key_action_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        avatarId,
        avatarName: linked.name,
        label: frame.label || `K${index + 1}`,
        time: frame.time,
        yaw: frame.yaw ?? linked.yaw,
        pitch: frame.pitch ?? linked.pitch,
        distance: frame.distance ?? linked.distance,
        heightOffset: frame.heightOffset ?? linked.heightOffset,
        rootHeight: frame.rootHeight ?? frameRootDefaults.rootHeight ?? linked.rootHeight,
        rootPitch: frame.rootPitch ?? frameRootDefaults.rootPitch ?? linked.rootPitch,
        rootRoll: frame.rootRoll ?? frameRootDefaults.rootRoll ?? linked.rootRoll,
        groundMode: frame.groundMode ?? frameRootDefaults.groundMode ?? linked.groundMode,
        scale: frame.scale ?? linked.scale,
        heading: frame.heading ?? linked.heading,
        faceMode: frame.faceMode ?? linked.faceMode,
        poseId: framePoseId,
        poseParams: {
          ...(panoramaAvatarPoseDefaultParams(framePoseId) || {}),
          ...(linked.poseParams || {}),
          ...(frame.poseParams || {}),
        },
        note: frame.note,
      }, nextAvatars);
    });
    const shotPatch = plan.shotCamera
      ? sanitizePanoramaShotCamera({
          ...plan.shotCamera,
          mode: plan.shotCamera.mode || 'shot-camera',
          targetAvatarId:
            refToId.get(plan.shotCamera.targetAvatarRef || '') ||
            refToId.get(plan.shotCamera.targetAvatarId || '') ||
            activeId ||
            nextAvatars[0]?.id ||
            '',
        })
      : effectiveShotCamera;
    update({
      panoramaActionPrompt: actionPrompt || plan.prompt,
      panoramaActionPlan: plan,
      panoramaAvatars: nextAvatars,
      panoramaActiveAvatarId: activeId,
      panoramaAvatarKeyframes: nextKeyframes,
      panoramaKeyframeSequenceCount: plan.sequenceFrameCount ?? keyframeSequenceCount,
      panoramaShotCamera: shotPatch,
      panoramaOcclusionMasks: plan.occlusionMasks?.length
        ? sanitizePanoramaOcclusionMasks([...(mode === 'replace-actors' ? [] : occlusionMasks), ...plan.occlusionMasks])
        : occlusionMasks,
      panoramaActorOverlayVisible: true,
    });
    setActionPlan(plan);
    setActionPlanStatus(
      mode === 'update-selected'
        ? '已应用到当前角色'
        : mode === 'replace-actors'
        ? '已替换角色场景'
        : `已新增 ${planAvatars.length} 个动作角色`,
    );
    window.setTimeout(drawFrame, 30);
  }, [
    actionPlan,
    actionPrompt,
    activeAvatar,
    avatarKeyframes,
    avatars,
    drawFrame,
    effectiveShotCamera,
    keyframeSequenceCount,
    occlusionMasks,
    planAvatarPatch,
    storeActionPlanDraft,
    update,
  ]);

  const changeAvatarPose = useCallback((avatar: PanoramaAvatar, poseId: PanoramaAvatarPoseId) => {
    const rootDefaults = panoramaAvatarPoseRootDefaults(poseId);
    patchAvatar(avatar, { poseId, ...rootDefaults, poseParams: panoramaAvatarPoseDefaultParams(poseId) || {} });
  }, [patchAvatar]);

  const removeAvatar = useCallback((avatar: PanoramaAvatar) => {
    setActiveOcclusionMaskId('');
    const next = deletePanoramaAvatar(avatars, avatar.id);
    update({
      panoramaAvatars: next,
      panoramaActiveAvatarId: activeAvatarId === avatar.id ? (next[0]?.id || '') : activeAvatarId,
    });
  }, [activeAvatarId, avatars, update]);

  const duplicateAvatar = useCallback((avatar: PanoramaAvatar) => {
    setActiveOcclusionMaskId('');
    const next = upsertPanoramaAvatar(avatars, {
      ...avatar,
      id: '',
      name: `${avatar.name} 副本`,
      yaw: avatar.yaw + 8,
      createdAt: new Date().toISOString(),
    });
    update({ panoramaAvatars: next, panoramaActiveAvatarId: next[0]?.id || '' });
  }, [avatars, update]);

  const focusAvatar = useCallback((avatar: PanoramaAvatar) => {
    setActiveOcclusionMaskId('');
    applyView({ yaw: avatar.yaw, pitch: avatar.pitch + 8, fov: Math.min(fov, 70) }, {
      panoramaActiveAvatarId: avatar.id,
      panoramaActiveCameraViewId: '',
    });
  }, [applyView, fov]);

  const copyScenePrompt = useCallback(async () => {
    try {
      await copyText(scenePrompt || '当前还没有可见角色。');
      setSceneCopyState('已复制');
      update({ panoramaScenePrompt: scenePrompt });
      window.setTimeout(() => setSceneCopyState(''), 1200);
    } catch (e: any) {
      setSceneCopyState(e?.message || '复制失败');
    }
  }, [scenePrompt, update]);

  const exportAvatarLayout = useCallback(async () => {
    try {
      await copyText(JSON.stringify({ schema: 't8-panorama-avatar-layout', version: 1, avatars }, null, 2));
      setLayoutIoState('布局已复制');
      window.setTimeout(() => setLayoutIoState(''), 1400);
    } catch (e: any) {
      setLayoutIoState(e?.message || '复制失败');
    }
  }, [avatars]);

  const importAvatarLayout = useCallback(() => {
    const raw = window.prompt('粘贴 3D 全景人物布局 JSON');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const next = sanitizePanoramaAvatars(Array.isArray(parsed) ? parsed : parsed.avatars);
      update({ panoramaAvatars: next, panoramaActiveAvatarId: next[0]?.id || '' });
      setLayoutIoState(`已导入 ${next.length} 人`);
      window.setTimeout(() => setLayoutIoState(''), 1400);
    } catch (e: any) {
      setLayoutIoState(e?.message || '导入失败');
    }
  }, [update]);

  const syncSequenceMaterialSet = useCallback((sequenceUrls: string[], snapshot: any) => {
    const nodes = rf.getNodes();
    const edges = rf.getEdges();
    const managedNodes = nodes.filter((node) => {
      const data = (node.data as any) || {};
      return node.type === 'material-set' && data.panoramaSequenceSourceId === p.id && data.panoramaSequenceAutoManaged === true;
    });
    if (sequenceUrls.length <= 1) {
      if (managedNodes.length === 0) return;
      const removeIds = new Set(managedNodes.map((node) => node.id));
      rf.setNodes((current) => current.filter((node) => !removeIds.has(node.id)));
      rf.setEdges((current) => current.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)));
      return;
    }

    const items: MaterialSetItem[] = sequenceUrls.map((url, index) => {
      const frameLabel = `F${String(index + 1).padStart(2, '0')}`;
      return {
        id: `panorama-sequence-${p.id}-${index + 1}`,
        kind: 'image',
        url,
        name: `${frameLabel} · ${cleanFileBase(url)}`,
      };
    });
    const now = Date.now();
    const sequenceData = {
      ...materialSetItemsToData('image', items),
      title: `3D全景序列帧 · ${items.length}帧`,
      label: `3D全景序列帧 · ${items.length}帧`,
      panoramaSequenceSourceId: p.id,
      panoramaSequenceAutoManaged: true,
      panoramaSequenceFrameCount: items.length,
      panoramaSceneSnapshot: snapshot,
      sourceNodeId: p.id,
      updatedAt: now,
    };
    const target = managedNodes[0];
    const duplicateIds = new Set(managedNodes.slice(1).map((node) => node.id));

    if (target) {
      rf.setNodes((current) =>
        current
          .filter((node) => !duplicateIds.has(node.id))
          .map((node) => (
            node.id === target.id
              ? { ...node, data: { ...(node.data as any), ...sequenceData } }
              : node
          )),
      );
      rf.setEdges((current) => {
        const cleaned = current.filter((edge) => !duplicateIds.has(edge.source) && !duplicateIds.has(edge.target));
        if (cleaned.some((edge) => edge.source === p.id && edge.target === target.id)) return cleaned;
        return [
          ...cleaned,
          { id: `e-auto-panorama-sequence-${target.id}`, source: p.id, target: target.id, type: 'smoothstep' },
        ];
      });
      logBus.success(`3D全景序列帧已更新为素材集 · ${items.length}帧`, `panorama:${p.id.slice(0, 6)}`);
      return;
    }

    const self = nodes.find((node) => node.id === p.id);
    const baseX = (self?.position.x || 0) + 1240;
    const baseY = (self?.position.y || 0) + 220;
    const position = placeSingleNode(baseX, baseY, 'material-set', nodes, { source: `placement:panorama-sequence:${p.id}` });
    const newId = `material-set-auto-panorama-${p.id}-${now}-${Math.random().toString(36).slice(2, 6)}`;
    rf.addNodes({
      id: newId,
      type: 'material-set',
      position,
      data: sequenceData,
    });
    rf.addEdges({
      id: `e-auto-panorama-sequence-${newId}`,
      source: p.id,
      target: newId,
      type: 'smoothstep',
    });
    logBus.success(`3D全景序列帧已输出为素材集 · ${items.length}帧`, `panorama:${p.id.slice(0, 6)}`);
  }, [p.id, rf]);

  const sendSceneSnapshot = useCallback(() => {
    const snapshotUrl = typeof d.panoramaSceneSnapshot?.snapshotUrl === 'string'
      ? d.panoramaSceneSnapshot.snapshotUrl
      : outputUrl;
    const controlSnapshotUrl = typeof d.panoramaSceneSnapshot?.controlSnapshotUrl === 'string'
      ? d.panoramaSceneSnapshot.controlSnapshotUrl
      : typeof d.panoramaControlSnapshotUrl === 'string'
      ? d.panoramaControlSnapshotUrl
      : '';
    const sequenceUrls = Array.isArray(d.panoramaSceneSnapshot?.sequenceFrames)
      ? d.panoramaSceneSnapshot.sequenceFrames
          .map((frame: any) => (typeof frame?.imageUrl === 'string' ? frame.imageUrl : ''))
          .filter(Boolean)
      : [];
    const hasSequence = sequenceUrls.length > 1;
    const urls = hasSequence ? Array.from(new Set(sequenceUrls)) : Array.from(new Set([snapshotUrl, controlSnapshotUrl].filter(Boolean)));
    if (urls.length === 0) {
      setSceneCopyState('先导出快照');
      window.setTimeout(() => setSceneCopyState(''), 1200);
      return;
    }
    window.dispatchEvent(new CustomEvent('penguin:open-send-materials', {
      detail: {
        materials: urls.map((url, index) => ({
          id: `${hasSequence ? 'panorama-sequence' : 'panorama-scene'}-${index + 1}-${p.id}`,
          kind: 'image',
          url,
          name: hasSequence
            ? `F${String(index + 1).padStart(2, '0')} · ${compactPrompt(userPrompt || d.prompt || '3D全景动作序列')}`
            : `${compactPrompt(userPrompt || d.prompt || '3D全景场景')} · ${url === controlSnapshotUrl ? '控制快照' : '场景快照'}`,
          sourceNodeId: p.id,
          sourceType: 'panorama-3d',
          sourceNodeData: {
            ...(d as Record<string, any>),
            panoramaSceneSnapshot: d.panoramaSceneSnapshot,
            panoramaScenePrompt: scenePrompt,
          },
        })),
        sourceLabel: hasSequence ? '3D全景动作序列帧' : '3D全景场景快照',
        defaultMode: hasSequence ? 'material-set' : 'upload',
      },
    }));
  }, [d, outputUrl, p.id, scenePrompt, userPrompt]);

  const saveSceneSnapshotResource = useCallback(async () => {
    const snapshotUrl = typeof d.panoramaSceneSnapshot?.snapshotUrl === 'string'
      ? d.panoramaSceneSnapshot.snapshotUrl
      : outputUrl;
    if (!snapshotUrl) {
      setSceneResourceState('先导出快照');
      window.setTimeout(() => setSceneResourceState(''), 1400);
      return;
    }
    setSceneResourceState('保存中');
    try {
      const category = await ensureImageResourceCategory();
      const saved = await api.addResourceItem({
        url: snapshotUrl,
        kind: 'image',
        categoryId: category.id,
        title: `${compactPrompt(userPrompt || d.prompt || '3D全景场景')} · 人物参考`,
        tags: [
          '3D全景场景',
          '人物参考',
          'scene-snapshot',
          avatars.length ? `${avatars.length}角色` : '',
          compositionGuide !== 'off' ? compositionGuide : '',
          effectiveShotCamera.mode === 'shot-camera' ? '导演镜头' : '',
        ].filter(Boolean),
        sourceNodeId: p.id,
        favorite: false,
      });
      if (!saved.success) throw new Error(saved.error || '保存场景快照失败');
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
      if (!saved.data.duplicate) trackAchievementEvent({ type: 'resource.saved', kind: 'image', category: category.id });
      setSceneResourceState(saved.data.duplicate ? '已在资源库' : '已保存');
      window.setTimeout(() => setSceneResourceState(''), 1600);
    } catch (e: any) {
      setSceneResourceState(e?.message || '保存失败');
    }
  }, [avatars.length, compositionGuide, d, effectiveShotCamera.mode, outputUrl, p.id, userPrompt]);

  const importPoseToAvatar = useCallback(() => {
    if (!activeAvatar) return;
    const source = poseTargets.find((item) => item.id === poseSourceId) || poseTargets[0];
    if (!source) return;
    const poseText = [source.prompt, source.presetId, source.viewId, source.shotId].filter(Boolean).join(' ');
    const nextPose = inferAvatarPoseFromText(poseText);
    const rootDefaults = panoramaAvatarPoseRootDefaults(nextPose);
    const characterPrompt = [activeAvatar.characterPrompt, source.prompt].filter(Boolean).join('；').slice(0, 180);
    patchAvatar(activeAvatar, {
      poseId: nextPose,
      ...rootDefaults,
      characterPrompt,
      poseParams: {
        ...(panoramaAvatarPoseDefaultParams(nextPose) || {}),
        source: 'pose-master',
        sourceNodeId: source.id,
        presetId: source.presetId,
        viewId: source.viewId,
        shotId: source.shotId,
      },
    });
    setPoseSourceId(source.id);
  }, [activeAvatar, patchAvatar, poseSourceId, poseTargets]);

  const syncDirectorPreviewFromCanvas = () => {
    if (!directorFullscreenOpen || !canvasRef.current) return;
    try {
      setDirectorPreviewUrl(canvasRef.current.toDataURL('image/png'));
    } catch {
      // The preview is best-effort; interaction should keep working even if a data URL cannot be read.
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (textureStatus !== 'ready') return;
    event.preventDefault();
    event.stopPropagation();
    if (avatarPickMode) {
      const rect = event.currentTarget.getBoundingClientRect();
      const view = screenPointToPanoramaAngles({
        xRatio: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
        yRatio: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5,
        view: viewRef.current,
        aspect: ratio.w / Math.max(1, ratio.h),
      });
      if (activeAvatar) {
        patchAvatar(activeAvatar, { yaw: view.yaw, pitch: view.pitch });
        update({ panoramaAvatarPickMode: false });
      } else {
        addAvatarAt(view);
      }
      return;
    }
    if (hotspotPickMode) {
      const rect = event.currentTarget.getBoundingClientRect();
      const view = screenPointToPanoramaAngles({
        xRatio: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
        yRatio: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5,
        view: viewRef.current,
        aspect: ratio.w / Math.max(1, ratio.h),
      });
      addHotspotAt(view);
      setHotspotPickMode(false);
      return;
    }
    setPointerCaptureSafe(event.currentTarget, event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw,
      pitch,
    };
    setIsDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    viewRef.current = sanitizePanoramaViewAngles({
      yaw: drag.yaw - dx * 0.18,
      pitch: clampPitch(drag.pitch + dy * 0.18),
      fov: viewRef.current.fov,
    });
    drawFrame();
    syncDirectorPreviewFromCanvas();
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    releasePointerCaptureSafe(event.currentTarget, event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
    const view = sanitizePanoramaViewAngles(viewRef.current);
    update({
      panoramaYaw: view.yaw,
      panoramaPitch: view.pitch,
      panoramaFov: view.fov,
      panoramaActiveCameraViewId: '',
    });
  };

  const startAvatarDrag = (
    event: ReactPointerEvent<HTMLElement>,
    avatar: PanoramaAvatar,
    surface: PanoramaInteractionSurface = 'node',
  ) => {
    if (avatar.locked || textureStatus !== 'ready') return;
    const rect = getInteractionRect(surface);
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveOcclusionMaskId('');
    update({ panoramaActiveAvatarId: avatar.id });
    setPointerCaptureSafe(getInteractionElement(surface) || event.currentTarget, event.pointerId);
    dragRef.current = null;
    avatarRotateRef.current = null;
    avatarIkDragRef.current = null;
    avatarDragRef.current = {
      pointerId: event.pointerId,
      avatarId: avatar.id,
      rect,
    };
  };

  const moveAvatarDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    const view = screenPointToPanoramaAngles({
      xRatio: drag.rect.width > 0 ? (event.clientX - drag.rect.left) / drag.rect.width : 0.5,
      yRatio: drag.rect.height > 0 ? (event.clientY - drag.rect.top) / drag.rect.height : 0.5,
      view: viewRef.current,
      aspect: ratio.w / Math.max(1, ratio.h),
    });
    avatarsRef.current = updatePanoramaAvatar(avatarsRef.current, target.id, { yaw: view.yaw, pitch: view.pitch });
    updateAvatarMeshes();
    drawFrame();
    syncDirectorPreviewFromCanvas();
  };

  const endAvatarDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureSafe(event.currentTarget, event.pointerId);
    avatarDragRef.current = null;
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    update({
      panoramaAvatars: updatePanoramaAvatar(avatars, target.id, { yaw: target.yaw, pitch: target.pitch }),
      panoramaActiveAvatarId: target.id,
    });
  };

  const startAvatarRotate = (
    event: ReactPointerEvent<HTMLElement>,
    avatar: PanoramaAvatar,
    surface: PanoramaInteractionSurface = 'node',
  ) => {
    if (avatar.locked || textureStatus !== 'ready') return;
    if (!getInteractionRect(surface)) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveOcclusionMaskId('');
    update({ panoramaActiveAvatarId: avatar.id });
    setPointerCaptureSafe(getInteractionElement(surface) || event.currentTarget, event.pointerId);
    dragRef.current = null;
    avatarDragRef.current = null;
    avatarIkDragRef.current = null;
    avatarRotateRef.current = {
      pointerId: event.pointerId,
      avatarId: avatar.id,
      startX: event.clientX,
      startY: event.clientY,
      heading: avatar.heading,
      rootPitch: avatar.rootPitch,
    };
  };

  const moveAvatarRotate = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarRotateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    const dx = event.clientX - drag.startX;
    const rootPitch = clampPanoramaNumber(drag.rootPitch + (drag.startY - event.clientY) * 0.28, -90, 90, 0);
    avatarsRef.current = updatePanoramaAvatar(avatarsRef.current, target.id, {
      heading: normalizePanoramaYaw(drag.heading + dx * 0.7),
      rootPitch: Math.round(rootPitch),
      faceMode: 'heading',
    });
    updateAvatarMeshes();
    drawFrame();
    syncDirectorPreviewFromCanvas();
  };

  const endAvatarRotate = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarRotateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureSafe(event.currentTarget, event.pointerId);
    avatarRotateRef.current = null;
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    update({
      panoramaAvatars: updatePanoramaAvatar(avatars, target.id, {
        heading: target.heading,
        rootPitch: target.rootPitch,
        faceMode: 'heading',
      }),
      panoramaActiveAvatarId: target.id,
    });
  };

  const startAvatarIkDrag = (
    event: ReactPointerEvent<HTMLElement>,
    control: AvatarIkControl,
    surface: PanoramaInteractionSurface = 'node',
  ) => {
    const target = avatarsRef.current.find((item) => item.id === control.avatarId);
    if (!target || target.locked || textureStatus !== 'ready') return;
    const rect = getInteractionRect(surface);
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveOcclusionMaskId('');
    update({ panoramaActiveAvatarId: target.id, panoramaActorOverlayVisible: true, panoramaAvatarIkEditMode: true });
    setPointerCaptureSafe(getInteractionElement(surface) || event.currentTarget, event.pointerId);
    dragRef.current = null;
    avatarDragRef.current = null;
    avatarRotateRef.current = null;
    avatarIkDragRef.current = {
      pointerId: event.pointerId,
      avatarId: target.id,
      handleId: control.id,
      rect,
    };
  };

  const moveAvatarIkDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarIkDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    const targetX = drag.rect.width > 0 ? ((event.clientX - drag.rect.left) / drag.rect.width) * 100 : 50;
    const targetY = drag.rect.height > 0 ? ((event.clientY - drag.rect.top) / drag.rect.height) * 100 : 50;
    const keys = avatarIkKeys(drag.handleId);
    const paramKeys = [keys.root, keys.bend].filter(Boolean) as string[];
    if (!paramKeys.length) return;
    const trackedObjectName = avatarIkTrackedObjectName(drag.handleId);
    const projectTrackedPoint = () => {
      const canvas = canvasRef.current;
      const rt = runtimeRef.current;
      const THREE = rt.three;
      const mesh = rt.avatarMeshes?.get(drag.avatarId);
      const object = mesh?.getObjectByName?.(trackedObjectName);
      if (!canvas || !THREE || !rt.camera || !object) return null;
      return projectThreeObjectToCanvas(THREE, rt.camera, canvas, object);
    };
    const applyPoseParams = (poseParams: Record<string, number | string | boolean>) => {
      avatarsRef.current = updatePanoramaAvatar(avatarsRef.current, target.id, { poseParams });
      updateAvatarMeshes();
    };
    const scorePoseParams = (poseParams: Record<string, number | string | boolean>) => {
      applyPoseParams(poseParams);
      const projected = projectTrackedPoint();
      if (!projected) return Number.POSITIVE_INFINITY;
      const dx = projected.x - targetX;
      const dy = projected.y - targetY;
      return dx * dx + dy * dy;
    };
    let bestPoseParams: Record<string, number | string | boolean> = { ...(target.poseParams || {}) };
    let bestScore = scorePoseParams(bestPoseParams);
    [0.18, 0.09, 0.045, 0.022].forEach((step) => {
      paramKeys.forEach((key) => {
        const current = poseParamNumber(bestPoseParams, key, 0);
        ([-1, 1] as const).forEach((dir) => {
          const candidate = {
            ...bestPoseParams,
            [key]: clampAvatarIkRotation(current + dir * step),
          };
          const score = scorePoseParams(candidate);
          if (score < bestScore) {
            bestScore = score;
            bestPoseParams = candidate;
          }
        });
      });
    });
    applyPoseParams(bestPoseParams);
    drawFrame();
    syncDirectorPreviewFromCanvas();
  };

  const endAvatarIkDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = avatarIkDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureSafe(event.currentTarget, event.pointerId);
    avatarIkDragRef.current = null;
    const target = avatarsRef.current.find((item) => item.id === drag.avatarId);
    if (!target) return;
    update({
      panoramaAvatars: updatePanoramaAvatar(avatars, target.id, { poseParams: target.poseParams }),
      panoramaActiveAvatarId: target.id,
    });
  };

  const getAvatarIkControlAtPointer = (
    event: Pick<ReactPointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
    surface: PanoramaInteractionSurface,
  ) => {
    const rect = getInteractionRect(surface);
    if (!rect || !avatarIkEditMode || !avatarOverlayVisible) return null;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (localX < -24 || localY < -24 || localX > rect.width + 24 || localY > rect.height + 24) return null;
    const hitRadius = Math.max(20, Math.min(34, Math.min(rect.width, rect.height) * 0.08));
    let bestControl: AvatarIkControl | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    avatarIkControlsRef.current.forEach((control) => {
      const x = (control.x / 100) * rect.width;
      const y = (control.y / 100) * rect.height;
      const distance = Math.hypot(localX - x, localY - y);
      if (distance <= hitRadius && distance < bestDistance) {
        bestControl = control;
        bestDistance = distance;
      }
    });
    return bestControl;
  };

  const getInteractionSurfaceAtPointer = (
    event: Pick<ReactPointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
  ): PanoramaInteractionSurface | null => {
    const pointInRect = (rect: DOMRect | null | undefined) => (
      !!rect
      && event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    );
    const directorRect = directorStageRef.current?.getBoundingClientRect();
    if (pointInRect(directorRect)) return 'director';
    const previewRect = previewStageRef.current?.getBoundingClientRect();
    if (pointInRect(previewRect)) return 'node';
    return null;
  };

  const handleInteractionStagePointerDownCapture = (
    event: ReactPointerEvent<HTMLElement>,
    surface: PanoramaInteractionSurface,
  ) => {
    if (event.button !== 0 || !avatarIkEditMode || !avatarOverlayVisible) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const ikTarget = target?.closest<HTMLElement>('[data-panorama-ik-control="true"]') || null;
    if (!ikTarget && target?.closest('button')) return;
    const control = ikTarget
      ? avatarIkControlsRef.current.find((item) => (
        item.avatarId === ikTarget.dataset.panoramaIkAvatarId
        && item.id === ikTarget.dataset.panoramaIkHandleId
      ))
      : getAvatarIkControlAtPointer(event, surface);
    if (!control) return;
    startAvatarIkDrag(event, control, surface);
  };

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    onPointerMove(event);
    moveAvatarDrag(event);
    moveAvatarRotate(event);
    moveAvatarIkDrag(event);
    moveOcclusionMaskDrag(event);
  };

  const handleStagePointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    endDrag(event);
    endAvatarDrag(event);
    endAvatarRotate(event);
    endAvatarIkDrag(event);
    endOcclusionMaskDrag(event);
  };

  useEffect(() => {
    const hasActiveDrag = (pointerId: number) => (
      dragRef.current?.pointerId === pointerId
      || avatarDragRef.current?.pointerId === pointerId
      || avatarRotateRef.current?.pointerId === pointerId
      || avatarIkDragRef.current?.pointerId === pointerId
      || occlusionMaskDragRef.current?.pointerId === pointerId
    );
    const handleWindowPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !avatarIkEditMode || !avatarOverlayVisible) return;
      const surface = getInteractionSurfaceAtPointer(event);
      if (!surface) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const ikTarget = target?.closest<HTMLElement>('[data-panorama-ik-control="true"]') || null;
      if (!ikTarget && target?.closest('button')) return;
      const control = ikTarget
        ? avatarIkControlsRef.current.find((item) => (
          item.avatarId === ikTarget.dataset.panoramaIkAvatarId
          && item.id === ikTarget.dataset.panoramaIkHandleId
        ))
        : getAvatarIkControlAtPointer(event, surface);
      if (!control) return;
      startAvatarIkDrag(event as unknown as ReactPointerEvent<HTMLElement>, control, surface);
    };
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!hasActiveDrag(event.pointerId)) return;
      handleStagePointerMove(event as unknown as ReactPointerEvent<HTMLElement>);
    };
    const handleWindowPointerEnd = (event: PointerEvent) => {
      if (!hasActiveDrag(event.pointerId)) return;
      handleStagePointerEnd(event as unknown as ReactPointerEvent<HTMLElement>);
    };
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handleWindowPointerEnd, { capture: true, passive: false });
    window.addEventListener('pointercancel', handleWindowPointerEnd, { capture: true, passive: false });
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
      window.removeEventListener('pointermove', handleWindowPointerMove, true);
      window.removeEventListener('pointerup', handleWindowPointerEnd, true);
      window.removeEventListener('pointercancel', handleWindowPointerEnd, true);
    };
  }, [handleStagePointerEnd, handleStagePointerMove]);

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (textureStatus !== 'ready') return;
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY < 0 ? 0.92 : 1 / 0.92;
    applyView({ fov: clampFov(fov * factor) }, { panoramaActiveCameraViewId: '' });
  };

  const resetView = () => applyView({ yaw: 0, pitch: 0, fov: 75 }, { panoramaActiveCameraViewId: '' });

  const composeStoryboardSnapshotDataUrl = useCallback(
    async (dataUrl: string) => (
      storyboardPromptEnabled
        ? composePanoramaStoryboardPromptDataUrl(dataUrl, storyboardPromptText)
        : dataUrl
    ),
    [storyboardPromptEnabled, storyboardPromptText],
  );

  const exportFrame = useCallback(async () => {
    if (textureStatus !== 'ready' || !canvasRef.current) {
      const message = '请先连接并加载全景图';
      update({ status: 'error', panoramaError: message });
      throw new Error(message);
    }
    update({ status: 'generating', progress: '导出中', panoramaError: '' });
    try {
      if (!drawFrame()) throw new Error('当前画面不可导出');
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const imageUrl = await uploadDataUrl(await composeStoryboardSnapshotDataUrl(dataUrl), `${cleanFileBase(sourceUrl)}-panorama-frame`);
      const view = viewRef.current;
      update({
        status: 'success',
        panoramaError: '',
        imageUrl,
        imageUrls: [imageUrl],
        urls: [imageUrl],
        panoramaSourceUrl: sourceUrl,
        panoramaYaw: view.yaw,
        panoramaPitch: view.pitch,
        panoramaFov: view.fov,
        panoramaSnapshot: {
          yaw: view.yaw,
          pitch: view.pitch,
          fov: view.fov,
          ratio: ratioId,
          customW,
          customH,
          cameraViewId: activeCameraViewId,
          cameraViews: cameraViews.length,
          hotspots: hotspots.length,
          width: canvasRef.current.width,
          height: canvasRef.current.height,
        },
        panoramaStoryboardPromptSnapshotText: storyboardPromptEnabled ? storyboardPromptText : '',
      });
    } catch (e: any) {
      const msg = e?.message || '导出全景画面失败';
      update({ status: 'error', panoramaError: msg });
      setError(msg);
      throw e;
    }
  }, [activeCameraViewId, cameraViews.length, composeStoryboardSnapshotDataUrl, customH, customW, drawFrame, hotspots.length, ratioId, sourceUrl, textureStatus, update]);

  const renderControlSnapshotDataUrl = useCallback(async () => {
    const rt = runtimeRef.current;
    const THREE = rt.three;
    const canvas = canvasRef.current;
    if (!canvas || !THREE || !rt.renderer || !rt.scene || !rt.sphere) {
      throw new Error('控制快照不可用');
    }
    const oldSphereVisible = rt.sphere.visible;
    const oldBackground = rt.scene.background;
    const oldClearColor = new THREE.Color();
    const oldClearAlpha = typeof rt.renderer.getClearAlpha === 'function' ? rt.renderer.getClearAlpha() : 1;
    if (typeof rt.renderer.getClearColor === 'function') rt.renderer.getClearColor(oldClearColor);
    try {
      rt.sphere.visible = false;
      rt.scene.background = new THREE.Color(0x111827);
      rt.renderer.setClearColor?.(0x111827, 1);
      if (!drawFrame()) throw new Error('控制快照不可导出');
      return await canvasDataUrlWithLegend(
        canvas,
        avatars,
        true,
        effectiveShotCamera,
        shotTarget,
        occlusionMaskVisible ? occlusionMasks : [],
        { controlSnapshot: true },
      );
    } finally {
      rt.sphere.visible = oldSphereVisible;
      rt.scene.background = oldBackground;
      rt.renderer.setClearColor?.(oldClearColor, oldClearAlpha);
      drawFrame();
    }
  }, [avatars, drawFrame, effectiveShotCamera, occlusionMaskVisible, occlusionMasks, shotTarget]);

  const renderSceneSequenceSnapshots = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || avatarKeyframes.length < 2) return [] as string[];
    const view = sanitizePanoramaViewAngles(viewRef.current);
    const sequenceFrames = buildPanoramaAvatarSequenceFrames({
      keyframes: avatarKeyframes,
      avatars,
      view,
      width: canvas.width,
      height: canvas.height,
      frameCount: keyframeSequenceCount,
    });
    if (sequenceFrames.length === 0) return [] as string[];
    const previousAvatars = avatarsRef.current;
    const urls: string[] = [];
    const aspect = canvas.width / Math.max(1, canvas.height);
    try {
      for (const frame of sequenceFrames) {
        const frameAvatars = avatars.map((avatar) => {
          const frameAvatar = frame.avatars.find((item) => item.avatarId === avatar.id);
          if (!frameAvatar) return avatar;
          return {
            ...avatar,
            yaw: frameAvatar.yaw,
            pitch: frameAvatar.pitch,
            distance: frameAvatar.distance,
            heightOffset: frameAvatar.heightOffset,
            rootHeight: frameAvatar.rootHeight,
            rootPitch: frameAvatar.rootPitch,
            rootRoll: frameAvatar.rootRoll,
            groundMode: frameAvatar.groundMode,
            scale: frameAvatar.scale,
            heading: frameAvatar.heading,
            faceMode: frameAvatar.faceMode,
            poseId: frameAvatar.poseId,
            poseParams: frameAvatar.poseParams || {},
            visible: true,
          };
        });
        avatarsRef.current = frameAvatars;
        updateAvatarMeshes();
        if (!drawFrame()) continue;
        const frameShotTarget = projectPanoramaShotTarget({
          shotCamera: effectiveShotCamera,
          avatars: frameAvatars,
          view,
          aspect,
        });
        const dataUrl = await canvasDataUrlWithLegend(
          canvas,
          frameAvatars,
          sceneLegendVisible,
          effectiveShotCamera,
          frameShotTarget,
          occlusionMaskVisible ? occlusionMasks : [],
          { sequenceLabel: `${frame.frameLabel} / ${sequenceFrames.length}` },
        );
        const imageUrl = await uploadDataUrl(
          await composeStoryboardSnapshotDataUrl(dataUrl),
          `${cleanFileBase(sourceUrl)}-panorama-seq-${String(frame.frameIndex).padStart(2, '0')}`,
        );
        urls.push(imageUrl);
      }
    } finally {
      avatarsRef.current = previousAvatars;
      updateAvatarMeshes();
      drawFrame();
    }
    return urls;
  }, [avatarKeyframes, avatars, composeStoryboardSnapshotDataUrl, drawFrame, effectiveShotCamera, keyframeSequenceCount, occlusionMaskVisible, occlusionMasks, sceneLegendVisible, sourceUrl, updateAvatarMeshes]);

  const exportSceneSnapshot = useCallback(async () => {
    if (textureStatus !== 'ready' || !canvasRef.current) {
      const message = '请先连接并加载全景图';
      update({ status: 'error', panoramaError: message });
      throw new Error(message);
    }
    update({ status: 'generating', progress: '场景快照导出中', panoramaError: '' });
    try {
      if (!drawFrame()) throw new Error('当前场景不可导出');
      const dataUrl = await canvasDataUrlWithLegend(canvasRef.current, avatars, sceneLegendVisible, effectiveShotCamera, shotTarget, occlusionMaskVisible ? occlusionMasks : []);
      const imageUrl = await uploadDataUrl(await composeStoryboardSnapshotDataUrl(dataUrl), `${cleanFileBase(sourceUrl)}-panorama-scene`);
      const sequenceUrls = await renderSceneSequenceSnapshots();
      const view = sanitizePanoramaViewAngles(viewRef.current);
      const snapshot = buildPanoramaSceneSnapshot({
        sourceUrl,
        promptFinal,
        view,
        ratioId,
        width: canvasRef.current.width,
        height: canvasRef.current.height,
        avatars,
        compositionGuide,
        shotCamera: effectiveShotCamera,
        keyframes: avatarKeyframes,
        sequenceFrameCount: keyframeSequenceCount,
        sequenceFrameUrls: sequenceUrls,
        occlusionMasks,
        snapshotUrl: imageUrl,
        controlSnapshotUrl: d.panoramaControlSnapshotUrl,
      });
      syncSequenceMaterialSet(sequenceUrls, snapshot);
      update({
        status: 'success',
        progress: '100%',
        panoramaError: '',
        imageUrl,
        imageUrls: [imageUrl],
        urls: [imageUrl],
        panoramaSourceUrl: sourceUrl,
        panoramaYaw: view.yaw,
        panoramaPitch: view.pitch,
        panoramaFov: view.fov,
        panoramaSceneSnapshot: snapshot,
        panoramaScenePrompt: snapshot.promptText,
        panoramaStoryboardPromptSnapshotText: storyboardPromptEnabled ? storyboardPromptText : '',
      });
      taskCompletionSound.notifyComplete(p.id, 'image');
    } catch (e: any) {
      const msg = e?.message || '导出场景快照失败';
      update({ status: 'error', panoramaError: msg });
      setError(msg);
      throw e;
    }
  }, [avatarKeyframes, avatars, composeStoryboardSnapshotDataUrl, compositionGuide, d.panoramaControlSnapshotUrl, drawFrame, effectiveShotCamera, keyframeSequenceCount, occlusionMaskVisible, occlusionMasks, p.id, promptFinal, ratioId, renderSceneSequenceSnapshots, sceneLegendVisible, shotTarget, sourceUrl, syncSequenceMaterialSet, textureStatus, update]);

  const exportControlSnapshot = useCallback(async () => {
    if (textureStatus !== 'ready' || !canvasRef.current) {
      const message = '请先连接并加载全景图';
      update({ status: 'error', panoramaError: message });
      throw new Error(message);
    }
    update({ status: 'generating', progress: '控制快照导出中', panoramaError: '' });
    try {
      const dataUrl = await renderControlSnapshotDataUrl();
      const imageUrl = await uploadDataUrl(await composeStoryboardSnapshotDataUrl(dataUrl), `${cleanFileBase(sourceUrl)}-panorama-control`);
      const view = sanitizePanoramaViewAngles(viewRef.current);
      const snapshot = buildPanoramaSceneSnapshot({
        sourceUrl,
        promptFinal,
        view,
        ratioId,
        width: canvasRef.current.width,
        height: canvasRef.current.height,
        avatars,
        compositionGuide,
        shotCamera: effectiveShotCamera,
        keyframes: avatarKeyframes,
        sequenceFrameCount: keyframeSequenceCount,
        occlusionMasks,
        snapshotUrl: d.panoramaSceneSnapshot?.snapshotUrl,
        controlSnapshotUrl: imageUrl,
      });
      update({
        status: 'success',
        progress: '100%',
        panoramaError: '',
        imageUrl,
        imageUrls: [imageUrl],
        urls: [imageUrl],
        panoramaSourceUrl: sourceUrl,
        panoramaYaw: view.yaw,
        panoramaPitch: view.pitch,
        panoramaFov: view.fov,
        panoramaControlSnapshotUrl: imageUrl,
        panoramaSceneSnapshot: snapshot,
        panoramaScenePrompt: snapshot.promptText,
        panoramaStoryboardPromptSnapshotText: storyboardPromptEnabled ? storyboardPromptText : '',
      });
      taskCompletionSound.notifyComplete(p.id, 'image');
    } catch (e: any) {
      const msg = e?.message || '导出控制快照失败';
      update({ status: 'error', panoramaError: msg });
      setError(msg);
      throw e;
    }
  }, [avatarKeyframes, avatars, composeStoryboardSnapshotDataUrl, compositionGuide, d.panoramaSceneSnapshot?.snapshotUrl, effectiveShotCamera, keyframeSequenceCount, occlusionMasks, p.id, promptFinal, ratioId, renderControlSnapshotDataUrl, sourceUrl, textureStatus, update]);

  const selectAvatarAtIndex = useCallback((index: number) => {
    const avatar = avatars[index];
    if (!avatar) return false;
    focusAvatar(avatar);
    return true;
  }, [avatars, focusAvatar]);

  const cycleAvatar = useCallback((direction: 1 | -1) => {
    if (avatars.length === 0) return false;
    const currentIndex = Math.max(0, avatars.findIndex((item) => item.id === activeAvatarId));
    const nextIndex = (currentIndex + direction + avatars.length) % avatars.length;
    focusAvatar(avatars[nextIndex]);
    return true;
  }, [activeAvatarId, avatars, focusAvatar]);

  const cycleActivePose = useCallback((direction: 1 | -1) => {
    if (!activeAvatar) return false;
    const currentIndex = Math.max(0, PANORAMA_AVATAR_POSES.findIndex((pose) => pose.id === activeAvatar.poseId));
    const nextPose = PANORAMA_AVATAR_POSES[(currentIndex + direction + PANORAMA_AVATAR_POSES.length) % PANORAMA_AVATAR_POSES.length];
    changeAvatarPose(activeAvatar, nextPose.id);
    return true;
  }, [activeAvatar, changeAvatarPose]);

  const resetActivePoseParams = useCallback(() => {
    if (!activeAvatar) return false;
    const rootDefaults = panoramaAvatarPoseRootDefaults(activeAvatar.poseId);
    patchAvatar(activeAvatar, { ...rootDefaults, poseParams: panoramaAvatarPoseDefaultParams(activeAvatar.poseId) || {} });
    return true;
  }, [activeAvatar, patchAvatar]);

  const toggleShotMode = useCallback(() => {
    patchShotCamera({
      mode: effectiveShotCamera.mode === 'shot-camera' ? 'panorama-view' : 'shot-camera',
      targetAvatarId: effectiveShotCamera.targetAvatarId || activeAvatar?.id || avatars[0]?.id || '',
    });
    return true;
  }, [activeAvatar?.id, avatars, effectiveShotCamera.mode, effectiveShotCamera.targetAvatarId, patchShotCamera]);

  const toggleAvatarIkEditMode = useCallback(() => {
    const next = !avatarIkEditMode;
    update({ panoramaAvatarIkEditMode: next, panoramaActorOverlayVisible: true });
    if (!next) {
      avatarIkControlsRef.current = [];
      setAvatarIkControls([]);
    }
    return true;
  }, [avatarIkEditMode, update]);

  const refreshDirectorPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      drawFrame();
      setDirectorPreviewUrl(canvas.toDataURL('image/png'));
    } catch {
      setDirectorPreviewUrl('');
    }
  }, [drawFrame]);

  useEffect(() => {
    if (!avatarIkEditMode) {
      avatarIkControlsRef.current = [];
      setAvatarIkControls([]);
      return;
    }
    drawFrame();
  }, [avatarIkEditMode, drawFrame]);

  useEffect(() => {
    if (!directorFullscreenOpen) return;
    refreshDirectorPreview();
    const timer = window.setInterval(refreshDirectorPreview, 500);
    return () => window.clearInterval(timer);
  }, [directorFullscreenOpen, refreshDirectorPreview]);

  useEffect(() => {
    if (!p.selected && !directorFullscreenOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isEditableShortcutTarget(event.target)) return;
      let handled = false;
      const key = event.key.toLowerCase();

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const activeMask = activeOcclusionMaskId
          ? occlusionMasks.find((item) => item.id === activeOcclusionMaskId)
          : null;
        if (activeMask) {
          removeOcclusionMask(activeMask);
          handled = true;
        } else if (activeAvatar) {
          removeAvatar(activeAvatar);
          handled = true;
        }
      } else if (/^[1-8]$/.test(event.key)) {
        handled = selectAvatarAtIndex(Number(event.key) - 1);
      } else if (event.key === 'Tab') {
        handled = cycleAvatar(event.shiftKey ? -1 : 1);
      } else if (key === 'a') {
        addAvatarAtCenter();
        handled = true;
      } else if (key === 'p') {
        update({ panoramaAvatarPickMode: !avatarPickMode, panoramaActorOverlayVisible: true });
        handled = true;
      } else if (key === 'f') {
        handled = activeAvatar ? selectAvatarAtIndex(Math.max(0, avatars.findIndex((item) => item.id === activeAvatar.id))) : false;
      } else if (key === 'h') {
        update({ panoramaActorOverlayVisible: !avatarOverlayVisible });
        handled = true;
      } else if (key === 'i') {
        handled = toggleAvatarIkEditMode();
      } else if (event.key === '[') {
        handled = cycleActivePose(-1);
      } else if (event.key === ']') {
        handled = cycleActivePose(1);
      } else if (key === 'r') {
        handled = resetActivePoseParams();
      } else if (key === 'm') {
        handled = toggleShotMode();
      } else if (key === 'o') {
        setDirectorFullscreenOpen(true);
        handled = true;
      } else if (key === 'c') {
        void copyScenePrompt();
        handled = true;
      } else if (key === 'e') {
        requestPanoramaRun('scene-snapshot');
        handled = true;
      } else if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        setShortcutHelpOpen(true);
        handled = true;
      } else if (event.key === 'Escape') {
        if (shortcutHelpOpen) {
          setShortcutHelpOpen(false);
          handled = true;
        } else if (directorFullscreenOpen) {
          setDirectorFullscreenOpen(false);
          handled = true;
        } else if (avatarPickMode || hotspotPickMode || avatarIkEditMode) {
          update({ panoramaAvatarPickMode: false, panoramaAvatarIkEditMode: false });
          setHotspotPickMode(false);
          handled = true;
        }
      }

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeAvatar,
    activeOcclusionMaskId,
    addAvatarAtCenter,
    avatarIkEditMode,
    avatarOverlayVisible,
    avatarPickMode,
    avatars,
    copyScenePrompt,
    cycleActivePose,
    cycleAvatar,
    directorFullscreenOpen,
    hotspotPickMode,
    occlusionMasks,
    p.selected,
    removeAvatar,
    removeOcclusionMask,
    requestPanoramaRun,
    resetActivePoseParams,
    selectAvatarAtIndex,
    shortcutHelpOpen,
    toggleAvatarIkEditMode,
    toggleShotMode,
    update,
  ]);

  const applyGeneratedPanorama = useCallback((url: string, params: {
    mode: PanoramaGenerationMode;
    prompt: string;
    promptFinal: string;
    sizeLevel: PanoramaSizeLevel;
    referenceUrl?: string;
  }) => {
    const history = prependPanoramaHistory(generatedHistory, {
      url,
      mode: params.mode,
      sizeLevel: params.sizeLevel,
      prompt: params.prompt,
      promptFinal: params.promptFinal,
      referenceUrl: params.referenceUrl,
      createdAt: new Date().toISOString(),
    });
    update({
      status: 'success',
      progress: '100%',
      error: '',
      panoramaError: '',
      panoramaSourceUrl: url,
      panoramaGeneratedUrl: url,
      panoramaPrompt: params.prompt,
      panoramaPromptFinal: params.promptFinal,
      panoramaGenerationMode: params.mode,
      panoramaPanelMode: params.mode,
      panoramaSizeLevel: params.sizeLevel,
      panoramaGeneratedHistory: history,
      panoramaRatio: 'ultrawide',
      imageUrl: url,
      imageUrls: [url],
      urls: [url],
      usedI2I: params.mode === 'image',
      panoramaStoryboardPromptSnapshotText: '',
    });
    taskCompletionSound.notifyComplete(p.id, 'image');
  }, [generatedHistory, p.id, update]);

  const generatePanorama = useCallback(async (reporter?: RunNodeLifecycleReporter) => {
    const mode: PanoramaGenerationMode = panelMode === 'image' ? 'image' : 'text';
    const prompt = userPrompt.trim();
    const referenceUrl = mode === 'image' ? imageReferenceUrl : '';
    const validation = validatePanoramaGeneration({ mode, prompt, referenceUrl });
    if (!validation.ok) {
      update({
        status: 'error',
        panoramaError: validation.error,
        panoramaPromptFinal: buildPromptFinalFor(prompt),
      });
      setError(validation.error);
      throw new Error(validation.error);
    }
    const request = buildPanoramaImageRequest({
      mode,
      prompt,
      sizeLevel,
      referenceUrl,
      viewerPosition,
      viewCenter,
    });
    const finalPrompt = request.prompt;
    update({
      status: 'generating',
      progress: '提交中',
      error: '',
      panoramaError: '',
      panoramaPrompt: prompt,
      panoramaPromptFinal: finalPrompt,
      panoramaGenerationMode: mode,
      panoramaPanelMode: mode,
      panoramaSizeLevel: sizeLevel,
    });
    logBus.info(
      `提交3D全景: ${generationModeLabel(mode)} 21:9 ${sizeLevel} 参考图=${request.images.length}`,
      `panorama:${p.id.slice(0, 6)}`,
    );
    try {
      const submit = await submitImageAsync(request, { submissionKey: reporter?.providerSubmissionKey });
      if (submit.sync && submit.urls?.length) {
        applyGeneratedPanorama(submit.urls[0], { mode, prompt, promptFinal: finalPrompt, sizeLevel, referenceUrl });
        logBus.success(`3D全景生成完成 → ${submit.urls[0]}`, `panorama:${p.id.slice(0, 6)}`);
        return;
      }
      const taskId = submit.taskId;
      if (!taskId) throw new Error('提交成功但未返回任务 ID');
      update({ progress: submit.progress || '0%', taskId });
      const maxPoll = 1800;
      const interval = 2000;
      let lastProgress = '';
      for (let i = 0; i < maxPoll; i++) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const q = await queryImageStatus(taskId, 'gpt-image-2');
        if (q.progress && q.progress !== lastProgress) {
          lastProgress = q.progress;
          update({ progress: q.progress });
          logBus.debug(`3D全景轮询 ${i + 1}/${maxPoll}: ${q.status} ${q.progress}`, `panorama:${p.id.slice(0, 6)}`);
        }
        if (String(q.status || '').toLowerCase() === 'materializing') {
          update({ progress: '100% · 正在下载' });
          if (i === 0 || (i + 1) % 10 === 0) {
            logBus.warn(
              q.error || '3D 全景已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
              `panorama:${p.id.slice(0, 6)}`,
            );
          }
          continue;
        }
        if (q.status === 'completed' && q.urls?.length) {
          applyGeneratedPanorama(q.urls[0], { mode, prompt, promptFinal: finalPrompt, sizeLevel, referenceUrl });
          logBus.success(`3D全景生成完成 → ${q.urls[0]}`, `panorama:${p.id.slice(0, 6)}`);
          return;
        }
        if (q.status === 'failed') {
          throw new Error(q.error || '3D全景生成失败');
        }
      }
      throw new Error('3D全景生成超时，请稍后查询或精简提示词重试');
    } catch (e: any) {
      const msg = e?.message || '3D全景生成失败';
      update({
        status: 'error',
        error: msg,
        panoramaError: msg,
        progress: '',
        panoramaPromptFinal: finalPrompt,
      });
      setError(msg);
      logBus.error(msg, `panorama:${p.id.slice(0, 6)}`);
      throw e;
    }
  }, [applyGeneratedPanorama, buildPromptFinalFor, imageReferenceUrl, p.id, panelMode, sizeLevel, update, userPrompt, viewCenter, viewerPosition]);

  const runNode = useCallback(async (reporter?: RunNodeLifecycleReporter) => {
    if (panelMode === 'preview') {
      await exportFrame();
      return;
    }
    await generatePanorama(reporter);
  }, [exportFrame, generatePanorama, panelMode]);

  const runNodeWithSecondaryAction = useCallback(async (reporter: RunNodeLifecycleReporter) => {
    const action = resolveSecondaryProviderActionForRun({
      nodeId: p.id,
      nodeType: 'panorama-3d',
      nodeData: rf.getNode(p.id)?.data,
      runContext: reporter.runContext,
    });
    if (action) {
      if (action.actionId !== 'panorama-3d.ai-action-plan') {
        throw new Error('3D 全景节点收到不受支持的次级 Provider action');
      }
      try {
        await executeAiActionPlan(action, reporter);
      } finally {
        const current = secondaryProviderActionFromNodeData(rf.getNode(p.id)?.data);
        if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
      }
      return;
    }
    if (reporter.runContext?.secondaryProviderActionId) {
      throw new Error('3D 全景 AI 动作 action 已过期或被修改，已停止调用 Provider');
    }
    const liveData = rf.getNode(p.id)?.data as Record<string, unknown> | undefined;
    const contextRequestId = String(reporter.runContext?.requestId || '').trim();
    const persistedRequestId = String(liveData?.panoramaRunRequestId || '').trim();
    const requestedMode = String(liveData?.panoramaRunMode || 'generate') as PanoramaNodeRunMode;
    try {
      if (!persistedRequestId) {
        await runNode(reporter);
        return;
      }
      if (contextRequestId !== persistedRequestId) {
        throw new Error('3D 全景运行请求已过期或被修改，已停止输出。');
      }
      switch (requestedMode) {
        case 'generate':
          await generatePanorama(reporter);
          break;
        case 'frame':
          await exportFrame();
          break;
        case 'scene-snapshot':
          await exportSceneSnapshot();
          break;
        case 'control-snapshot':
          await exportControlSnapshot();
          break;
        default:
          throw new Error('3D 全景运行模式无效，已停止输出。');
      }
    } finally {
      if (contextRequestId) {
        const latestData = rf.getNode(p.id)?.data as Record<string, unknown> | undefined;
        if (latestData?.panoramaRunRequestId === contextRequestId) {
          update({ panoramaRunMode: 'generate', panoramaRunRequestId: '' });
        }
      }
    }
  }, [executeAiActionPlan, exportControlSnapshot, exportFrame, exportSceneSnapshot, generatePanorama, p.id, rf, runNode, update]);

  const handleReferenceUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      update({ panoramaError: '' });
      const url = await uploadFileBlob(file, file.name || `panorama-reference-${Date.now()}.png`);
      update({
        panoramaReferenceUrl: url,
        panoramaPanelMode: 'image',
        panoramaGenerationMode: 'image',
      });
      logBus.success(`3D全景参考图已上传 → ${url}`, `panorama:${p.id.slice(0, 6)}`);
    } catch (e: any) {
      const msg = e?.message || '参考图上传失败';
      update({ panoramaError: msg });
      setError(msg);
    } finally {
      if (refInputRef.current) refInputRef.current.value = '';
    }
  }, [p.id, update]);

  const copyPrompt = useCallback(async () => {
    try {
      await copyText(promptFinal);
      setCopyState('已复制');
      window.setTimeout(() => setCopyState(''), 1200);
    } catch (e: any) {
      setCopyState(e?.message || '复制失败');
    }
  }, [promptFinal]);

  const savePanoramaResource = useCallback(async () => {
    if (!sourceUrl) {
      setResourceState('没有可保存的全景贴图');
      return;
    }
    setResourceState('保存中');
    try {
      const category = await ensurePanoramaResourceCategory();
      const title = `${compactPrompt(userPrompt || d.prompt || '3D全景贴图')} · ${sizeLevel}`;
      const saved = await api.addResourceItem({
        url: sourceUrl,
        kind: 'panorama',
        categoryId: category.id,
        title,
        tags: [
          '3D全景',
          'panorama',
          'VR',
          sizeLevel,
          generationModeLabel(generationMode),
          cameraViews.length ? `${cameraViews.length}机位` : '',
          hotspots.length ? `${hotspots.length}热点` : '',
        ].filter(Boolean),
        sourceNodeId: p.id,
        favorite: false,
      });
      if (!saved.success) throw new Error(saved.error || '保存资源失败');
      if (saved.data.kind !== 'panorama') {
        throw new Error('后端未按全景类型保存，请重启开发后端后再试。');
      }
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
      if (!saved.data.duplicate) trackAchievementEvent({ type: 'resource.saved', kind: 'panorama', category: category.id });
      setResourceState(saved.data.duplicate ? '已在资源库' : '已保存');
      window.setTimeout(() => setResourceState(''), 1800);
    } catch (e: any) {
      setResourceState(e?.message || '保存资源失败');
    }
  }, [cameraViews.length, d.prompt, generationMode, hotspots.length, p.id, sizeLevel, sourceUrl, userPrompt]);

  const useHistoryItem = useCallback((item: PanoramaGenerationHistoryItem) => {
    update({
      panoramaSourceUrl: item.url,
      panoramaGeneratedUrl: item.url,
      panoramaPrompt: item.prompt || '',
      panoramaPromptFinal: item.promptFinal || buildPromptFinalFor(item.prompt || ''),
      panoramaGenerationMode: item.mode,
      panoramaPanelMode: item.mode,
      panoramaSizeLevel: item.sizeLevel,
      imageUrl: item.url,
      imageUrls: [item.url],
      urls: [item.url],
      status: 'success',
      panoramaError: '',
    });
  }, [buildPromptFinalFor, update]);

  useRunTrigger(p.id, runNodeWithSecondaryAction, 'image', { lifecycleAware: true });

  const nodeStyle = {
    width: 1180,
    borderColor: p.selected ? COLOR : undefined,
    boxShadow: p.selected ? `0 0 0 2px ${COLOR}, var(--t8-shadow-strong, 0 18px 36px rgba(0,0,0,.22))` : undefined,
  };

  const savedError = typeof d.panoramaError === 'string' ? d.panoramaError : '';
  const hasSource = Boolean(sourceUrl);
  const isGeneratedPreview = Boolean(generatedSourceUrl && sourceUrl === generatedSourceUrl);
  const generatedSubtitle = isGenerating
    ? panoramaT('generatingSubtitle', { size: sizeLevel })
    : hasSource
    ? panoramaT('sourceSubtitle', {
        ratio: PANORAMA_RATIO_OPTIONS.find((x) => x.id === ratioId)?.label || '21:9',
        detail: isGeneratedPreview ? `${sizeLevel} · GPT Image 2` : `FOV ${Math.round(fov)}°`,
      })
    : panoramaT('emptySubtitle');
  const hasConnectedReference = Boolean(connectedSource?.url);
  const hasLocalReference = Boolean(localReferenceUrl);
  const activeReferenceUrl = imageReferenceUrl;
  const qualityClass = quality?.level === 'warning'
    ? 'border-amber-400/35 bg-amber-400/10 text-amber-100'
    : quality?.level === 'unknown'
    ? 'border-slate-400/25 bg-slate-400/10 text-[var(--t8-text-muted)]'
    : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
  const qualityLabel = quality ? panoramaT(`quality.levels.${quality.level}`) : '';
  const qualityAspectLabel = quality?.aspectLabel === '未知比例'
    ? panoramaT('quality.unknownAspect')
    : quality?.aspectLabel.startsWith('非标准 ')
      ? panoramaT('quality.nonStandardAspect', { ratio: quality.aspectLabel.slice(4) })
      : quality?.aspectLabel || '';
  const qualityHint = quality
    ? panoramaT(`quality.hints.${quality.level}`, {
        extra: quality.aspectLabel.startsWith('非标准 ') ? panoramaT('quality.nonStandardHint') : '',
      })
    : '';

  const selectStoryboardPreset = (presetId: string) => {
    if (!presetId) {
      update({
        panoramaStoryboardSelectedPresetId: '',
        panoramaStoryboardPresetPrompt: PANORAMA_STORYBOARD_PROMPT_DEFAULT,
        panoramaStoryboardPresetName: '',
      });
      return;
    }
    const preset = storyboardPromptPresets.find((item) => item.id === presetId);
    if (!preset) return;
    update({
      panoramaStoryboardSelectedPresetId: preset.id,
      panoramaStoryboardPresetPrompt: preset.text,
      panoramaStoryboardPresetName: preset.name,
    });
  };

  const insertStoryboardPreset = () => {
    update({
      panoramaStoryboardPromptText: insertPanoramaStoryboardPresetPrompt(storyboardPromptText, storyboardPresetPrompt),
      panoramaStoryboardPromptEnabled: true,
    });
    setStoryboardPresetNotice('已插入到场景');
  };

  const saveStoryboardPreset = () => {
    const now = new Date().toISOString();
    const text = normalizePanoramaStoryboardPrompt(storyboardPresetPrompt);
    const existing = storyboardPromptPresets.find((item) => item.id === storyboardSelectedPresetId);
    const fallbackName = text.replace(/\s+/g, ' ').slice(0, 18) || `预设 ${storyboardPromptPresets.length + 1}`;
    const name = storyboardPresetName.trim() || existing?.name || fallbackName;
    const next = existing
      ? storyboardPromptPresets.map((item) => item.id === existing.id ? { ...item, name, text, updatedAt: now } : item)
      : [
          ...storyboardPromptPresets,
          {
            id: `storyboard-preset-${Date.now().toString(36)}`,
            name,
            text,
            createdAt: now,
            updatedAt: now,
          },
        ];
    const sanitized = sanitizePanoramaStoryboardPromptPresets(next);
    const saved = existing
      ? sanitized.find((item) => item.id === existing.id)
      : sanitized[sanitized.length - 1];
    update({
      panoramaStoryboardPromptPresets: sanitized,
      panoramaStoryboardSelectedPresetId: saved?.id || '',
      panoramaStoryboardPresetPrompt: saved?.text || text,
      panoramaStoryboardPresetName: saved?.name || name,
    });
    setStoryboardPresetNotice(existing ? '已更新预设' : '已保存预设');
  };

  const exportStoryboardPresets = () => {
    const exportPresets = storyboardPromptPresets.length
      ? storyboardPromptPresets
      : sanitizePanoramaStoryboardPromptPresets([
          {
            id: 'default',
            name: storyboardPresetName.trim() || '默认提示词',
            text: storyboardPresetPrompt,
          },
        ]);
    downloadJson(
      `panorama-storyboard-prompts-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`,
      createPanoramaStoryboardPromptPresetExport(exportPresets),
    );
    setStoryboardPresetNotice('已导出预设');
  };

  const importStoryboardPresets = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = parsePanoramaStoryboardPromptPresetImport(await file.text());
      const next = sanitizePanoramaStoryboardPromptPresets([...storyboardPromptPresets, ...imported]);
      const firstImported = next[Math.max(0, next.length - imported.length)];
      update({
        panoramaStoryboardPromptPresets: next,
        panoramaStoryboardSelectedPresetId: firstImported?.id || '',
        panoramaStoryboardPresetPrompt: firstImported?.text || storyboardPresetPrompt,
        panoramaStoryboardPresetName: firstImported?.name || storyboardPresetName,
      });
      setStoryboardPresetNotice(`已导入 ${imported.length} 条预设`);
    } catch (error: any) {
      setStoryboardPresetNotice(error?.message || '导入预设失败');
    }
  };

  const renderStoryboardPromptPreview = () => {
    const sceneSnapshotUrl = typeof d.panoramaSceneSnapshot?.snapshotUrl === 'string' ? d.panoramaSceneSnapshot.snapshotUrl : '';
    const controlSnapshotUrl = typeof d.panoramaSceneSnapshot?.controlSnapshotUrl === 'string' ? d.panoramaSceneSnapshot.controlSnapshotUrl : '';
    const rawPreviewUrl = sourceUrl || sceneSnapshotUrl || controlSnapshotUrl || outputUrl;
    const previewFontSize = 15;
    return (
      <div
        className="t8-panorama-storyboard-preview overflow-hidden rounded-md border border-white/15 bg-black shadow-inner"
        ref={(element) => {
          storyboardPromptPreviewRef.current = element;
          lockPanoramaStoryboardPreviewTextElement(element);
        }}
        data-t8-color-lock="panorama-storyboard-preview"
        data-panorama-storyboard-preview="true"
        data-panorama-storyboard-preview-day-safe="true"
        data-panorama-storyboard-preview-tone="locked-white"
        data-panorama-storyboard-preview-safe-color="white"
        data-panorama-storyboard-preview-contrast-lock="true"
        style={{
          backgroundColor: '#050505',
          ...STORYBOARD_PREVIEW_LOCKED_WHITE_TEXT_STYLE,
          color: '#ffffff',
          colorScheme: 'dark',
          forcedColorAdjust: 'none',
          isolation: 'isolate',
          opacity: 1,
          filter: 'none',
          mixBlendMode: 'normal',
        }}
      >
        {rawPreviewUrl ? (
          <SmartImage
            src={rawPreviewUrl}
            alt={panoramaT('storyboardPreviewAlt')}
            className="max-h-28 w-full bg-slate-950 object-contain"
            draggable={false}
            thumbSize={720}
          />
        ) : (
          <div
            className="t8-panorama-storyboard-preview-placeholder flex h-24 items-center justify-center bg-slate-950 text-[10px] font-semibold"
            ref={lockPanoramaStoryboardPreviewTextElement}
            data-t8-color-lock="panorama-storyboard-preview"
            data-panorama-storyboard-preview-placeholder="true"
            data-panorama-storyboard-preview-day-safe="true"
            data-panorama-storyboard-preview-tone="locked-white"
            data-panorama-storyboard-preview-safe-color="white"
            data-panorama-storyboard-preview-contrast-lock="true"
            style={{
              ...STORYBOARD_PREVIEW_LOCKED_PLACEHOLDER_STYLE,
              color: 'rgba(255,255,255,.82)',
              colorScheme: 'dark',
              forcedColorAdjust: 'none',
              WebkitTextFillColor: 'rgba(255,255,255,.82)',
            }}
          >
            {panoramaT('waitingSnapshotPreview')}
          </div>
        )}
        <div
          className="t8-panorama-storyboard-preview-caption space-y-1 bg-black px-3 py-2 font-bold leading-snug"
          ref={lockPanoramaStoryboardPreviewTextElement}
          data-t8-color-lock="panorama-storyboard-preview"
          data-panorama-storyboard-preview-caption="true"
          data-panorama-storyboard-preview-day-safe="true"
          data-panorama-storyboard-preview-tone="locked-white"
          data-panorama-storyboard-preview-safe-color="white"
          data-panorama-storyboard-preview-contrast-lock="true"
          data-panorama-storyboard-live-preview-text="white"
          style={{
            backgroundColor: '#050505',
            backgroundImage: 'none',
            fontSize: previewFontSize,
            fontWeight: 900,
            ...STORYBOARD_PREVIEW_LOCKED_WHITE_TEXT_STYLE,
            color: '#ffffff',
            colorScheme: 'dark',
            forcedColorAdjust: 'none',
            WebkitTextFillColor: '#ffffff',
            opacity: 1,
            filter: 'none',
            mixBlendMode: 'normal',
            lineHeight: 1.42,
            textShadow: STORYBOARD_PREVIEW_READABLE_TEXT_SHADOW,
          }}
        >
          {storyboardPromptPreviewPanel.lines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              className="t8-panorama-storyboard-preview-caption-line whitespace-pre-wrap break-words"
              ref={lockPanoramaStoryboardPreviewTextElement}
              data-t8-color-lock="panorama-storyboard-preview"
              data-panorama-storyboard-preview-line="true"
              data-panorama-storyboard-preview-day-safe="true"
              data-panorama-storyboard-preview-tone="locked-white"
              data-panorama-storyboard-preview-safe-color="white"
              data-panorama-storyboard-preview-contrast-lock="true"
              data-panorama-storyboard-live-preview-text="white"
              style={{
                ...STORYBOARD_PREVIEW_LOCKED_WHITE_TEXT_STYLE,
                fontWeight: 900,
                color: '#ffffff',
                colorScheme: 'dark',
                forcedColorAdjust: 'none',
                WebkitTextFillColor: '#ffffff',
                opacity: 1,
                filter: 'none',
                mixBlendMode: 'normal',
                fontSize: previewFontSize,
                lineHeight: 1.42,
              }}
            >
              {line || '\u00a0'}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderActionPlannerPanel = (director = false) => (
    <section className={`space-y-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2 ${director ? '' : 'min-w-0'}`}>
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--t8-text-main)]">
        <span className="flex items-center gap-1">
          <Sparkles size={13} />
          {panoramaT('actionGeneration')}
        </span>
        <span className="text-[10px] text-[var(--t8-text-muted)]">
          {actionPlan ? panoramaT('avatarDraftCount', { count: actionPlan.avatars.length }) : panoramaT('localOrAi')}
        </span>
      </div>
      <textarea
        value={actionPrompt}
        onChange={(event) => setActionPrompt(event.target.value)}
        onBlur={() => update({ panoramaActionPrompt: actionPrompt })}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            createLocalActionPlan('append');
          }
        }}
        placeholder={panoramaT('actionPromptPlaceholder')}
        rows={director ? 3 : 2}
        className="nodrag nopan nowheel w-full resize-none rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs leading-relaxed text-[var(--t8-text-main)] outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {actionQuickTerms.map((term) => (
          <button
            key={term.id}
            type="button"
            className="t8-btn h-7 px-2 text-[10px]"
            onClick={() => setActionPrompt((current) => current ? `${current}，${panoramaT(`quickTerms.${term.id}.label`, { defaultValue: term.label })}` : panoramaT(`quickTerms.${term.id}.label`, { defaultValue: term.label }))}
            title={panoramaT(`quickTerms.${term.id}.description`, { defaultValue: term.description })}
          >
            {panoramaT(`quickTerms.${term.id}.label`, { defaultValue: term.label })}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => createLocalActionPlan('append')}>
          <Sparkles size={12} />
          {panoramaT('localParse')}
        </button>
        <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={requestAiActionPlan} disabled={isPlanningAction}>
          {isPlanningAction ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {panoramaT('aiParse')}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => applyActionPlan('update-selected')} disabled={!activeAvatar && avatars.length === 0}>
          <Move size={12} />
          {panoramaT('applyCurrent')}
        </button>
        <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => applyActionPlan('append')}>
          <Plus size={12} />
          {panoramaT('addAvatar')}
        </button>
        <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => applyActionPlan('replace-actors')}>
          <RotateCcw size={12} />
          {panoramaT('replaceScene')}
        </button>
      </div>
      {(actionPlanStatus || actionPlanSummary.length > 0) && (
        <div className="max-h-32 overflow-y-auto rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
          {actionPlanStatus && <div className="font-bold text-[var(--t8-text-main)]">{actionPlanStatus}</div>}
          {actionPlanSummary.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
    <div className="t8-node relative transition-all" style={nodeStyle}>
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="relative z-10">
        <div className="t8-node-header flex items-center gap-2 px-3 py-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--t8-accent) 18%, transparent)', color: 'var(--t8-accent)' }}
          >
            <Globe2 size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-[var(--t8-text-main)]">{translate('nodes:panorama3D.title')}</div>
            <div className="text-[10px] text-[var(--t8-text-muted)]">
              {generatedSubtitle}
            </div>
          </div>
          {isLikely && (
            <span className="rounded-md border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-200">
              360
            </span>
          )}
          <button
            type="button"
            className="t8-mini-icon-button nodrag nopan"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => setShortcutHelpOpen(true)}
            title={panoramaT('shortcutHelpTitle')}
          >
            <HelpCircle size={13} />
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,760px)_360px] gap-3 p-3 nodrag" onMouseDown={(e) => e.stopPropagation()}>
          <div className="min-w-0 space-y-3">
          <div
            ref={previewStageRef}
            className={`relative overflow-hidden rounded-lg border border-[var(--t8-border)] bg-slate-950 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ aspectRatio: `${ratio.w} / ${ratio.h}`, minHeight: 260 }}
            onWheel={onWheel}
            onPointerDownCapture={(event) => handleInteractionStagePointerDownCapture(event, 'node')}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerEnd}
            onPointerCancel={handleStagePointerEnd}
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={endDrag}
            />
            <div className="absolute right-2 top-2 z-50 flex items-center gap-1">
              <button
                type="button"
                className="t8-mini-icon-button nodrag nopan h-8 w-8 rounded-full border-2 text-slate-950"
                style={PANORAMA_FLOATING_ICON_BUTTON_STYLE}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => setShortcutHelpOpen(true)}
                title={panoramaT('shortcutsTitle')}
              >
                <HelpCircle size={13} />
              </button>
              <button
                type="button"
                className="t8-mini-icon-button nodrag nopan h-8 w-8 rounded-full border-2 text-slate-950"
                style={PANORAMA_FLOATING_ICON_BUTTON_STYLE}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => {
                  setDirectorFullscreenOpen(true);
                  window.setTimeout(refreshDirectorPreview, 0);
                }}
                title={panoramaT('openDirectorTitle')}
              >
                <Maximize2 size={13} />
              </button>
            </div>
            {visibleHotspots.map(({ item, pos }) => (
              <button
                key={item.id}
                type="button"
                className="absolute z-20 flex h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1 rounded-full border border-sky-200 bg-sky-500/90 px-2 text-[10px] font-bold text-slate-950 shadow-lg shadow-sky-950/35"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                title={`${item.label} · ${Math.round(item.yaw)}°/${Math.round(item.pitch)}°`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  jumpToHotspot(item);
                }}
              >
                <MapPin size={13} />
                <span className="max-w-20 truncate">{item.label}</span>
              </button>
            ))}
            {avatarOverlayVisible && visibleAvatarMarkers.map(({ item, index, pos }) => (
              <div
                key={item.id}
                className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${activeAvatarId === item.id ? 'z-[60]' : 'z-20'}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <button
                  type="button"
                  className={`nodrag nopan pointer-events-auto relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border text-[9px] font-bold shadow-md transition-transform hover:scale-125 ${
                    activeAvatarId === item.id
                      ? 'border-white bg-white text-slate-950 ring-2 ring-white/40'
                      : 'border-white/60 bg-slate-950/20 text-white'
                  }`}
                  style={{ touchAction: 'none' }}
                  title={panoramaT('dragAvatarTitle', { index: index + 1, name: item.name })}
                  onMouseDown={stopPanoramaMouseDown}
                  onPointerDown={(event) => startAvatarDrag(event, item)}
                  onPointerMove={moveAvatarDrag}
                  onPointerUp={endAvatarDrag}
                  onPointerCancel={endAvatarDrag}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    focusAvatar(item);
                  }}
                >
                  <span className="absolute inset-1 rounded-full" style={{ background: item.color }} />
                  <span className="relative text-[8px] leading-none">{index + 1}</span>
                </button>
                {activeAvatarId === item.id && !item.locked && (
                  <div
                    className="pointer-events-auto absolute z-[70] flex flex-col gap-1.5"
                    style={getAvatarToolDockStyle(item, pos, 'node')}
                  >
                    <button
                      type="button"
                      className="nodrag nopan flex h-8 w-8 items-center justify-center rounded-full border-2 text-slate-950 transition-transform hover:scale-110"
                      style={{ ...PANORAMA_MOVE_HANDLE_STYLE, touchAction: 'none' }}
                      title={panoramaT('moveAvatarTitle', { name: item.name })}
                      onMouseDown={stopPanoramaMouseDown}
                      onPointerDown={(event) => startAvatarDrag(event, item)}
                      onPointerMove={moveAvatarDrag}
                      onPointerUp={endAvatarDrag}
                      onPointerCancel={endAvatarDrag}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      <Move size={13} />
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan flex h-8 w-8 items-center justify-center rounded-full border-2 text-slate-950 transition-transform hover:scale-110"
                      style={{ ...PANORAMA_ROTATE_HANDLE_STYLE, touchAction: 'none' }}
                      title={panoramaT('rotateAvatarTitle', { name: item.name })}
                      onMouseDown={stopPanoramaMouseDown}
                      onPointerDown={(event) => startAvatarRotate(event, item)}
                      onPointerMove={moveAvatarRotate}
                      onPointerUp={endAvatarRotate}
                      onPointerCancel={endAvatarRotate}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {avatarOverlayVisible && avatarIkControls.map((control) => (
              <button
                key={`${control.avatarId}-${control.id}`}
                type="button"
                className={`nodrag nopan pointer-events-auto absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-950/70 shadow-sm transition-transform hover:scale-150 ${
                  control.kind === 'end' ? 'h-5 w-5 bg-white/95' : 'h-[18px] w-[18px] bg-amber-300/95'
                }`}
                style={{ left: `${control.x}%`, top: `${control.y}%`, touchAction: 'none' }}
                data-panorama-ik-control="true"
                data-panorama-ik-avatar-id={control.avatarId}
                data-panorama-ik-handle-id={control.id}
                title={panoramaT('dragJointTitle', { label: control.label })}
                onMouseDown={stopPanoramaMouseDown}
                onPointerDown={(event) => startAvatarIkDrag(event, control)}
                onPointerMove={moveAvatarIkDrag}
                onPointerUp={endAvatarIkDrag}
                onPointerCancel={endAvatarIkDrag}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <span className={`${control.kind === 'end' ? 'h-2 w-2' : 'h-1.5 w-1.5'} rounded-full bg-slate-950/85`} />
              </button>
            ))}
            {guideStyle && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div
                  className="relative border border-white/75 shadow-[0_0_0_9999px_rgba(2,6,23,.22)]"
                  style={guideStyle}
                >
                  <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {compositionGuide}
                  </span>
                  <span className="absolute left-1/3 top-0 h-full border-l border-white/25" />
                  <span className="absolute left-2/3 top-0 h-full border-l border-white/25" />
                  <span className="absolute left-0 top-1/3 w-full border-t border-white/25" />
                  <span className="absolute left-0 top-2/3 w-full border-t border-white/25" />
                </div>
              </div>
            )}
            {shotGuideStyle && (
              <div className="pointer-events-none absolute inset-0 z-30">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="relative border-2 border-dashed border-amber-300/95 shadow-[0_0_0_1px_rgba(2,6,23,.38)]"
                    style={shotGuideStyle}
                  >
                    <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">
                      {panoramaT('directorShot')}
                    </span>
                  </div>
                </div>
                {shotTargetLineStyle && (
                  <span
                    className="absolute h-px origin-left border-t border-amber-200/80"
                    style={shotTargetLineStyle}
                  />
                )}
                {shotTarget.visible && (
                  <span
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-amber-200/80 bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-amber-100 shadow-md"
                    style={{ left: `${shotTarget.x}%`, top: `${shotTarget.y}%` }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                    {shotTarget.label}
                  </span>
                )}
              </div>
            )}
            {occlusionMaskVisible && occlusionMasks.map((mask, index) => (
              <div
                key={mask.id}
                className={`nodrag nopan pointer-events-auto absolute z-30 rounded-sm border-2 shadow-[0_0_0_1px_rgba(2,6,23,.45)] ${
                  activeOcclusionMaskId === mask.id ? 'border-amber-200 ring-2 ring-amber-300/70' : 'border-white/90'
                }`}
                style={{
                  left: `${mask.x}%`,
                  top: `${mask.y}%`,
                  width: `${mask.w}%`,
                  height: `${mask.h}%`,
                  touchAction: 'none',
                  cursor: 'move',
                  backgroundColor: `rgba(14, 165, 233, ${Math.min(0.72, 0.2 + mask.strength / 200)})`,
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(2,6,23,.32) 0 2px, transparent 2px 10px)',
                }}
                title={panoramaT('moveResizeMaskTitle', { label: mask.label })}
                onMouseDown={stopPanoramaMouseDown}
                onPointerDown={(event) => startOcclusionMaskDrag(event, mask, 'move')}
                onPointerMove={moveOcclusionMaskDrag}
                onPointerUp={endOcclusionMaskDrag}
                onPointerCancel={endOcclusionMaskDrag}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveOcclusionMaskId(mask.id);
                }}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <span
                  className={OCCLUSION_MASK_LABEL_CLASS}
                  style={OCCLUSION_MASK_LABEL_STYLE}
                >
                  {index + 1}. {mask.label}
                </span>
                {([
                  ['nw', '-left-1.5 -top-1.5 cursor-nwse-resize'],
                  ['n', 'left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize'],
                  ['ne', '-right-1.5 -top-1.5 cursor-nesw-resize'],
                  ['e', '-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
                  ['se', '-bottom-1.5 -right-1.5 cursor-nwse-resize'],
                  ['s', '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                  ['sw', '-bottom-1.5 -left-1.5 cursor-nesw-resize'],
                  ['w', '-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
                ] as Array<[OcclusionDragMode, string]>).map(([mode, className]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`nodrag nopan absolute h-3 w-3 rounded-full border border-slate-950 bg-white shadow-sm ${className}`}
                    style={{ touchAction: 'none' }}
                    title={panoramaT('resizeMaskTitle', { label: mask.label })}
                    onMouseDown={stopPanoramaMouseDown}
                    onPointerDown={(event) => startOcclusionMaskDrag(event, mask, mode)}
                    onPointerMove={moveOcclusionMaskDrag}
                    onPointerUp={endOcclusionMaskDrag}
                    onPointerCancel={endOcclusionMaskDrag}
                    onDragStart={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                ))}
              </div>
            ))}
            {hotspotPickMode && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sky-950/25 text-xs font-bold text-sky-100">
                <div className="rounded-full border border-sky-200/60 bg-slate-950/80 px-3 py-1.5 shadow-lg">
                  {panoramaT('clickToPlaceHotspot')}
                </div>
              </div>
            )}
            {avatarPickMode && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-fuchsia-950/25 text-xs font-bold text-fuchsia-100">
                <div className="rounded-full border border-fuchsia-200/60 bg-slate-950/80 px-3 py-1.5 shadow-lg">
                  {panoramaT('clickToPlaceAvatar', { name: activeAvatar ? `「${activeAvatar.name}」` : panoramaT('newAvatar') })}
                </div>
              </div>
            )}
            {!hasSource && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950 text-center text-xs text-slate-300">
                <Box size={24} className="text-sky-300" />
                <span>{panoramaT('connectOrGenerateTexture')}</span>
              </div>
            )}
            {textureStatus === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/70 text-xs font-bold text-slate-100">
                <Loader2 size={15} className="animate-spin" />
                {panoramaT('loading')}
              </div>
            )}
            {isGenerating && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/75 text-xs font-bold text-slate-100">
                <Loader2 size={15} className="animate-spin" />
                {d.progress || panoramaT('generating')}
              </div>
            )}
            {(textureStatus === 'error' || savedError) && (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg border border-red-400/25 bg-red-950/80 px-2 py-1.5 text-xs text-red-100">
                <AlertCircle size={14} />
                <span className="min-w-0 truncate">{error || savedError}</span>
              </div>
            )}
          </div>

          <input ref={refInputRef} type="file" accept="image/*" className="hidden" onChange={handleReferenceUpload} />

          <div className="grid grid-cols-3 gap-1.5">
            {(['preview', 'text', 'image'] as PanoramaPanelMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`t8-btn min-h-8 px-2 text-[11px] ${panelMode === mode ? 't8-btn-primary' : ''}`}
                onClick={() => update({
                  panoramaPanelMode: mode,
                  ...(mode === 'text' || mode === 'image' ? { panoramaGenerationMode: mode } : {}),
                })}
              >
                {panoramaT(`panelModes.${mode}`)}
              </button>
            ))}
          </div>

          {panelMode !== 'preview' && (
            <div className="space-y-2 rounded-lg border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-sky-400/15 px-2 py-1 text-[10px] font-bold text-sky-200">GPT Image 2</span>
                <span className="rounded-md bg-amber-400/15 px-2 py-1 text-[10px] font-bold text-amber-200">21:9</span>
                {PANORAMA_SIZE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`t8-btn h-7 px-2 text-[10px] ${sizeLevel === level ? 't8-btn-primary' : ''}`}
                    onClick={() => update({ panoramaSizeLevel: level })}
                  >
                    {level}
                  </button>
                ))}
              </div>

              <div className="rounded-md border border-sky-400/20 bg-sky-950/25 px-2 py-1.5 text-[10px] leading-relaxed text-sky-100">
                {PANORAMA_FIXED_PROMPT}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('viewerPosition')}</span>
                  <input
                    value={viewerPosition}
                    onChange={(event) => {
                      const next = event.target.value;
                      update({
                        panoramaViewerPosition: next,
                        panoramaPromptFinal: buildPromptFinalFor(userPrompt, { viewerPosition: next }),
                      });
                    }}
                    placeholder={panoramaT('viewerPositionPlaceholder')}
                    className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('initialViewCenter')}</span>
                  <input
                    value={viewCenter}
                    onChange={(event) => {
                      const next = event.target.value;
                      update({
                        panoramaViewCenter: next,
                        panoramaPromptFinal: buildPromptFinalFor(userPrompt, { viewCenter: next }),
                      });
                    }}
                    placeholder={panoramaT('initialViewCenterPlaceholder')}
                    className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  />
                </label>
              </div>

              <PromptTextarea
                title={panoramaT('promptTitle')}
                value={userPrompt}
                onValueChange={(value) => update({
                  panoramaPrompt: value,
                  panoramaPromptFinal: buildPromptFinalFor(value),
                })}
                rows={3}
                placeholder={panelMode === 'image' ? panoramaT('imagePromptPlaceholder') : panoramaT('scenePromptPlaceholder')}
                promptTemplateKind="image"
                className="w-full resize-none rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
              />

              <div className="flex flex-wrap gap-1">
                {PANORAMA_PROMPT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    className="t8-btn h-7 px-2 text-[10px]"
                    onClick={() => {
                      const next = userPrompt.trim() ? `${userPrompt.trim()}，${tpl}` : tpl;
                      update({ panoramaPrompt: next, panoramaPromptFinal: buildPromptFinalFor(next) });
                    }}
                  >
                    {tpl}
                  </button>
                ))}
              </div>

              {panelMode === 'image' && (
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md bg-[var(--t8-bg-panel)] px-2 py-1.5">
                  <div className="min-w-0 text-[10px] text-[var(--t8-text-muted)]">
                    {hasConnectedReference
                      ? panoramaT('upstreamFirstReference', { label: connectedSource?.label || panoramaT('referenceImage') })
                      : hasLocalReference
                      ? panoramaT('localReference', { name: cleanFileBase(localReferenceUrl) })
                      : panoramaT('waitingReference')}
                  </div>
                  <button type="button" className="t8-mini-icon-button" onClick={() => refInputRef.current?.click()} title={panoramaT('uploadReference')}>
                    <Upload size={13} />
                  </button>
                  <button
                    type="button"
                    className="t8-mini-icon-button"
                    onClick={() => update({ panoramaReferenceUrl: '' })}
                    disabled={!hasLocalReference}
                    title={panoramaT('clearLocalReference')}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              )}

              {panelMode === 'image' && activeReferenceUrl && (
                <div className="overflow-hidden rounded-md border border-[var(--t8-border)] bg-slate-950">
                  <SmartImage src={activeReferenceUrl} alt={panoramaT('referenceAlt')} className="h-20 w-full object-contain" draggable={false} thumbSize={420} />
                </div>
              )}

              <details className="rounded-md bg-[var(--t8-bg-panel)] px-2 py-1 text-[10px] text-[var(--t8-text-muted)]">
                <summary className="cursor-pointer font-bold text-[var(--t8-text-main)]">{panoramaT('actualRequest')}</summary>
                <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed">{promptFinal}</div>
              </details>

              <div className="grid grid-cols-4 gap-1.5">
                <button type="button" className="t8-btn t8-btn-primary min-h-8 px-2 text-[11px]" onClick={() => requestPanoramaRun('generate')} disabled={isGenerating}>
                  {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {d.panoramaGeneratedUrl ? panoramaT('regenerate') : panoramaT('generatePanorama')}
                </button>
                <button type="button" className="t8-btn min-h-8 px-2 text-[11px]" onClick={copyPrompt}>
                  {copyState ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  {transientStateLabel(copyState, 'copy')}
                </button>
                <button type="button" className="t8-btn min-h-8 px-2 text-[11px]" onClick={savePanoramaResource} disabled={!sourceUrl || resourceState === '保存中'}>
                  {resourceState === '保存中' ? <Loader2 size={13} className="animate-spin" /> : <PackagePlus size={13} />}
                  {transientStateLabel(resourceState, 'resourceLibrary')}
                </button>
                <button type="button" className="t8-btn min-h-8 px-2 text-[11px]" onClick={() => sourceUrl && downloadUrl(sourceUrl, `${cleanFileBase(sourceUrl)}-panorama.png`)} disabled={!sourceUrl}>
                  <Download size={13} />
                  {panoramaT('texture')}
                </button>
              </div>

              {generatedHistory.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-[var(--t8-text-muted)]">
                    <History size={12} /> {panoramaT('recentGenerations')}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {generatedHistory.map((item) => (
                      <button
                        key={`${item.url}:${item.createdAt}`}
                        type="button"
                        className="group overflow-hidden rounded-md border border-[var(--t8-border)] bg-slate-950 text-left"
                        onClick={() => useHistoryItem(item)}
                        title={item.promptFinal}
                      >
                        <SmartImage src={item.url} alt={panoramaT('historyAlt')} className="h-12 w-full object-cover" draggable={false} thumbSize={240} />
                        <div className="truncate px-1.5 py-1 text-[9px] text-slate-200">{item.sizeLevel} · {panoramaT(`panelModes.${item.mode}`)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-1.5">
            {PANORAMA_RATIO_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                title={stableDisplayLabel('ratios', item.id, item.label)}
                onClick={() => setView({ panoramaRatio: item.id })}
                className={`t8-btn px-1.5 py-1.5 text-[10px] ${ratioId === item.id ? 't8-btn-primary' : ''}`}
              >
                {stableDisplayLabel('ratios', item.id, item.label)}
              </button>
            ))}
          </div>

          {ratioId === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('ratioWidth')}</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={customW}
                  onChange={(e) => update({ panoramaCustomW: clampPanoramaNumber(e.target.value, 1, 999, 16) })}
                  className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1 text-xs text-[var(--t8-text-main)] outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('ratioHeight')}</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={customH}
                  onChange={(e) => update({ panoramaCustomH: clampPanoramaNumber(e.target.value, 1, 999, 9) })}
                  className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1 text-xs text-[var(--t8-text-main)] outline-none"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-5 gap-2">
            <button type="button" className="t8-btn py-2 text-xs" onClick={() => applyView({ fov: clampFov(fov * 0.92) }, { panoramaActiveCameraViewId: '' })} title={panoramaT('zoomIn')}>
              <ZoomIn size={14} />
            </button>
            <button type="button" className="t8-btn py-2 text-xs" onClick={() => applyView({ fov: clampFov(fov / 0.92) }, { panoramaActiveCameraViewId: '' })} title={panoramaT('zoomOut')}>
              <ZoomOut size={14} />
            </button>
            <button type="button" className="t8-btn py-2 text-xs" onClick={resetView} title={panoramaT('resetView')}>
              <RotateCcw size={14} />
            </button>
            <button type="button" className={`t8-btn py-2 text-xs ${autoRotate ? 't8-btn-primary' : ''}`} onClick={() => update({ panoramaAutoRotate: !autoRotate })} title={panoramaT('autoRotate')}>
              {autoRotate ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" className="t8-btn t8-btn-primary py-2 text-xs" onClick={() => requestPanoramaRun('frame')} disabled={textureStatus !== 'ready' || isGenerating} title={panoramaT('exportCurrentFrame')}>
              {isGenerating && d.progress === '导出中' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
          </div>

          <section className="rounded-lg border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--t8-text-main)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Camera size={14} />
                {panoramaT('cameraAndTour')}
              </span>
              <span className="min-w-0 truncate text-right text-[10px] text-[var(--t8-text-muted)]">{panoramaT('cameraHotspotCount', { cameras: cameraViews.length, hotspots: hotspots.length })}</span>
            </div>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-6 gap-1.5">
                {PANORAMA_CAMERA_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="t8-btn h-7 px-1 text-[10px]"
                    onClick={() => applyView(item, { panoramaActiveCameraViewId: '' })}
                    title={`${stableDisplayLabel('cameraPresets', item.id, item.label)} ${item.yaw}°/${item.pitch}°`}
                  >
                    {stableDisplayLabel('cameraPresets', item.id, item.label)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-1.5">
                <input
                  value={cameraName}
                  onChange={(event) => setCameraName(event.target.value)}
                  placeholder={panoramaT('cameraNamePlaceholder')}
                  className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                />
                <button type="button" className="t8-btn t8-btn-primary px-2 text-[11px]" onClick={saveCameraView}>
                  <Plus size={13} />
                  {panoramaT('saveCamera')}
                </button>
              </div>

              {cameraViews.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {cameraViews.map((item) => (
                    <div key={item.id} className={`rounded-md border px-2 py-1.5 text-[10px] ${activeCameraViewId === item.id ? 'border-sky-300 bg-sky-400/15' : 'border-[var(--t8-border)] bg-[var(--t8-bg-panel)]'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left font-bold text-[var(--t8-text-main)]"
                          onClick={() => applyCameraView(item)}
                          title={`${item.name} · Yaw ${Math.round(item.yaw)}° Pitch ${Math.round(item.pitch)}° FOV ${Math.round(item.fov)}°`}
                        >
                          {item.isDefault ? panoramaT('defaultPrefix') : ''}{item.name}
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => setDefaultCameraView(item)} title={panoramaT('setDefault')}>
                          <Crosshair size={12} />
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => removeCameraView(item)} title={panoramaT('deleteCamera')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="mt-1 text-[9px] text-[var(--t8-text-muted)]">
                        Y {Math.round(item.yaw)}° · P {Math.round(item.pitch)}° · FOV {Math.round(item.fov)}°
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold text-[var(--t8-text-muted)]">
                  <MapPin size={12} />
                  {panoramaT('panoramaHotspots')}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <input
                    value={hotspotLabel}
                    onChange={(event) => setHotspotLabel(event.target.value)}
                    placeholder={panoramaT('hotspotNamePlaceholder')}
                    className="min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  />
                  <select
                    value={hotspotTargetId}
                    onChange={(event) => setHotspotTargetId(event.target.value)}
                    className="min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  >
                    {panoramaTargets.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap ${hotspotPickMode ? 't8-btn-primary' : ''}`}
                    onClick={() => setHotspotPickMode((value) => !value)}
                    title={panoramaT('pickHotspotTitle')}
                  >
                    <Crosshair size={12} />
                    {panoramaT('pickPoint')}
                  </button>
                  <button
                    type="button"
                    className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap"
                    onClick={() => addHotspotAt(viewRef.current)}
                    title={panoramaT('saveCenterHotspotTitle')}
                  >
                    <Plus size={12} />
                    {panoramaT('center')}
                  </button>
                </div>
                <div className="mt-1.5 text-[9px] leading-relaxed text-[var(--t8-text-muted)]">
                  {panoramaT('hotspotHelp')}
                </div>
                {hotspots.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {hotspots.map((item) => (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px_28px] items-center gap-1 rounded-md bg-[var(--t8-bg-panel-muted)] px-1.5 py-1">
                        <input
                          value={item.label}
                          onChange={(event) => patchHotspot(item, { label: event.target.value })}
                          className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                        />
                        <select
                          value={item.targetNodeId || p.id}
                          onChange={(event) => patchHotspot(item, { targetNodeId: event.target.value })}
                          className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                        >
                          {panoramaTargets.map((target) => (
                            <option key={target.id} value={target.id}>{target.label}</option>
                          ))}
                        </select>
                        <button type="button" className="t8-mini-icon-button" onClick={() => jumpToHotspot(item)} title={panoramaT('jumpHotspot')}>
                          <MapPin size={12} />
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => removeHotspot(item)} title={panoramaT('deleteHotspot')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {renderActionPlannerPanel(false)}

          </div>

          <div className="nodrag nowheel min-w-0 space-y-2" onWheel={(event) => event.stopPropagation()}>
          <section className="rounded-lg border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs font-bold text-[var(--t8-text-main)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Users size={14} />
                {panoramaT('actorsAndScene')}
              </span>
              <span className="min-w-0 truncate text-right text-[10px] text-[var(--t8-text-muted)]">{panoramaT('sceneStatusSummary', {
                visible: avatars.filter((item) => item.visible).length,
                total: avatars.length,
                guide: compositionGuide === 'off' ? panoramaT('noSafeArea') : compositionGuide,
                view: effectiveShotCamera.mode === 'shot-camera' ? panoramaT('directorShot') : panoramaT('currentView'),
              })}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <div className="order-[-40] grid grid-cols-4 gap-1.5">
                <button type="button" className="t8-btn t8-btn-primary h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={addAvatarAtCenter}>
                  <UserPlus size={13} />
                  {panoramaT('avatar')}
                </button>
                <button
                  type="button"
                  className={`t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap ${avatarPickMode ? 't8-btn-primary' : ''}`}
                  onClick={() => update({ panoramaAvatarPickMode: !avatarPickMode, panoramaActorOverlayVisible: true })}
                  disabled={textureStatus !== 'ready'}
                >
                  <Crosshair size={13} />
                  {panoramaT('place')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={() => requestPanoramaRun('scene-snapshot')} disabled={textureStatus !== 'ready' || isGenerating} title={panoramaT('exportSceneSnapshotTitle')}>
                  {isGenerating && d.progress === '场景快照导出中' ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                  {panoramaT('snapshot')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={() => requestPanoramaRun('control-snapshot')} disabled={textureStatus !== 'ready' || isGenerating}>
                  {isGenerating && d.progress === '控制快照导出中' ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
                  {panoramaT('controlImage')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={copyScenePrompt} disabled={!scenePrompt}>
                  <Copy size={13} />
                  {transientStateLabel(sceneCopyState, 'scenePrompt')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={sendSceneSnapshot} disabled={!outputUrl && !d.panoramaSceneSnapshot?.snapshotUrl}>
                  <PackagePlus size={13} />
                  {panoramaT('send')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={saveSceneSnapshotResource} disabled={sceneResourceState === '保存中' || (!outputUrl && !d.panoramaSceneSnapshot?.snapshotUrl)}>
                  {sceneResourceState === '保存中' ? <Loader2 size={13} className="animate-spin" /> : <PackagePlus size={13} />}
                  {transientStateLabel(sceneResourceState, 'saveToLibrary')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={exportAvatarLayout}>
                  <FileJson size={13} />
                  {panoramaT('export')}
                </button>
                <button type="button" className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap" onClick={importAvatarLayout}>
                  <Upload size={13} />
                  {panoramaT('import')}
                </button>
              </div>

              <div className="order-[-30] flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-[10px] text-[var(--t8-text-muted)]">
                <span className="min-w-0">
                  {activeAvatar
                    ? panoramaT('currentAvatarSummary', { name: activeAvatar.name, pose: poseDisplayLabel(activeAvatar.poseId) })
                    : panoramaT('noAvatars')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={`t8-btn h-7 px-2 text-[10px] ${avatarIkEditMode ? 't8-btn-primary' : ''}`}
                    onClick={toggleAvatarIkEditMode}
                    disabled={!activeAvatar}
                    title={panoramaT('jointEditTitle')}
                  >
                    <Move size={12} />
                    {panoramaT('joints')}
                  </button>
                  <button type="button" className="t8-btn h-7 px-2 text-[10px]" onClick={() => setDirectorFullscreenOpen(true)} title={panoramaT('openDirectorTitle')}>
                    <Maximize2 size={12} />
                    {panoramaT('allParameters')}
                  </button>
                  <button type="button" className="t8-mini-icon-button" onClick={() => setShortcutHelpOpen(true)} title={panoramaT('shortcutsTitle')}>
                    <HelpCircle size={12} />
                  </button>
                </div>
              </div>

              <div className="order-[-10] grid grid-cols-[1fr_1fr_auto_auto] items-center gap-1.5">
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('compositionSafeArea')}</span>
                  <select
                    value={compositionGuide}
                    onChange={(event) => update({ panoramaCompositionGuide: event.target.value })}
                    className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  >
                    {PANORAMA_COMPOSITION_GUIDES.map((item) => (
                      <option key={item.id} value={item.id}>{compositionGuideDisplayLabel(item.id, item.label)}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('snapshotLegend')}</span>
                  <select
                    value={sceneLegendVisible ? '1' : '0'}
                    onChange={(event) => update({ panoramaSceneLegendVisible: event.target.value === '1' })}
                    className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  >
                    <option value="1">{panoramaT('show')}</option>
                    <option value="0">{panoramaT('hide')}</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`t8-mini-icon-button panorama-avatar-overlay-toggle self-end ${avatarOverlayVisible ? 'is-active' : ''}`}
                  onClick={() => update({ panoramaActorOverlayVisible: !avatarOverlayVisible })}
                  title={panoramaT('toggleActorControls')}
                >
                  {avatarOverlayVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  className="t8-mini-icon-button self-end"
                  onClick={() => activeAvatar && focusAvatar(activeAvatar)}
                  disabled={!activeAvatar}
                  title={panoramaT('locateSelectedAvatar')}
                >
                  <ScanLine size={13} />
                </button>
              </div>

              <section className="order-[-10] rounded-md border border-amber-300/35 bg-amber-400/10 p-2">
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-main)]">
                  <span className="flex items-center gap-1">
                    <Camera size={12} />
                    {panoramaT('directorShot')}
                  </span>
                  <span className="text-[9px] text-[var(--t8-text-muted)]">{panoramaT('directorAllParametersHint')}</span>
                </div>
                <div className="mt-2 space-y-2">
                <div className="grid grid-cols-4 gap-1.5">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('snapshotMode')}</span>
                    <select
                      value={effectiveShotCamera.mode}
                      onChange={(event) => patchShotCamera({
                        mode: event.target.value === 'shot-camera' ? 'shot-camera' : 'panorama-view',
                        targetAvatarId: effectiveShotCamera.targetAvatarId || activeAvatar?.id || avatars[0]?.id || '',
                      })}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    >
                      <option value="panorama-view">{panoramaT('currentView')}</option>
                      <option value="shot-camera">{panoramaT('directorShot')}</option>
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('shotPreset')}</span>
                    <select
                      value={effectiveShotCamera.presetId}
                      onChange={(event) => changeShotPreset(event.target.value)}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    >
                      {PANORAMA_SHOT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{shotPresetDisplayLabel(preset.id)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('shotTarget')}</span>
                    <select
                      value={effectiveShotCamera.targetAvatarId}
                      onChange={(event) => patchShotCamera({ mode: 'shot-camera', targetAvatarId: event.target.value })}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    >
                      {avatars.length === 0 && <option value="">{panoramaT('noAvatars')}</option>}
                      {avatars.map((avatar, index) => (
                        <option key={avatar.id} value={avatar.id}>{index + 1}. {avatar.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('bodyPart')}</span>
                    <select
                      value={effectiveShotCamera.targetBone}
                      onChange={(event) => patchShotCamera({ mode: 'shot-camera', targetBone: event.target.value as PanoramaShotCamera['targetBone'] })}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    >
                      {PANORAMA_SHOT_TARGET_BONES.map((bone) => (
                        <option key={bone.id} value={bone.id}>{shotTargetDisplayLabel(bone.id)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1.5">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('shotAspect')}</span>
                    <select
                      value={effectiveShotCamera.framingRatio}
                      onChange={(event) => patchShotCamera({ mode: 'shot-camera', framingRatio: event.target.value as PanoramaCompositionGuideId })}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    >
                      {PANORAMA_COMPOSITION_GUIDES.filter((item) => item.id !== 'off').map((item) => (
                        <option key={item.id} value={item.id}>{compositionGuideDisplayLabel(item.id, item.label)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('closeupValue', { value: Math.round(effectiveShotCamera.closeupStrength) })}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={effectiveShotCamera.closeupStrength}
                      onChange={(event) => patchShotCamera({ mode: 'shot-camera', closeupStrength: Number(event.target.value) })}
                      className="w-full"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('lowAngleValue', { value: Math.round(effectiveShotCamera.lowAngle) })}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={effectiveShotCamera.lowAngle}
                      onChange={(event) => patchShotCamera({ mode: 'shot-camera', lowAngle: Number(event.target.value) })}
                      className="w-full"
                    />
                  </label>
                  <button
                    type="button"
                    className="t8-btn h-8 px-2 text-[10px]"
                    onClick={applyDirectorShotView}
                    disabled={avatars.length === 0}
                    title={panoramaT('applyDirectorShotTitle')}
                  >
                    <Camera size={13} />
                    {panoramaT('apply')}
                  </button>
                </div>
                </div>
              </section>
              <section className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2">
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-main)]">
                  <span className="flex items-center gap-1">
                    <History size={12} />
                    {panoramaT('actionTimeline')}
                  </span>
                  <span className="text-[9px] text-[var(--t8-text-muted)]">{panoramaT('keyframeSequenceCount', { keyframes: avatarKeyframes.length, frames: keyframeSequenceCount })}</span>
                </div>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-[1fr_72px_auto] gap-1.5">
                    <div className="rounded-md bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
                      {panoramaT('keyframeTimelineHint')}
                    </div>
                    <label className="min-w-0">
                      <span className="mb-0.5 block text-[9px] font-bold text-[var(--t8-text-muted)]">{panoramaT('sequenceFrames')}</span>
                      <input
                        type="number"
                        min={2}
                        max={48}
                        value={keyframeSequenceDraft}
                        onChange={(event) => updateKeyframeSequenceDraft(event.target.value)}
                        onBlur={commitKeyframeSequenceDraft}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitKeyframeSequenceDraft();
                            event.currentTarget.blur();
                          }
                        }}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-center text-[10px] text-[var(--t8-text-main)] outline-none"
                      />
                    </label>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={saveAvatarKeyframe} disabled={!activeAvatar}>
                      <Plus size={12} />
                      {panoramaT('record')}
                    </button>
                  </div>
                  {avatarKeyframes.length > 0 ? (
                    <div className="space-y-1">
                      {avatarKeyframes.map((frame) => (
                        <div key={frame.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md bg-[var(--t8-bg-panel-muted)] px-1.5 py-1">
                          <button type="button" className="min-w-0 truncate text-left text-[10px] text-[var(--t8-text-main)]" onClick={() => applyAvatarKeyframe(frame)} title={panoramaT('applyThisKeyframe')}>
                            {frame.label} · {frame.time.toFixed(1)}s · {frame.avatarName} · {poseDisplayLabel(frame.poseId)}
                          </button>
                          <button type="button" className="t8-mini-icon-button" onClick={() => applyAvatarKeyframe(frame)} title={panoramaT('applyKeyframe')}>
                            <ScanLine size={12} />
                          </button>
                          <button type="button" className="t8-mini-icon-button" onClick={() => removeAvatarKeyframe(frame)} title={panoramaT('deleteKeyframe')}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--t8-border)] px-2 py-2 text-center text-[10px] text-[var(--t8-text-muted)]">
                      {panoramaT('noKeyframes')}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-md border border-sky-300/35 bg-sky-400/10 p-2">
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-main)]">
                  <span className="flex items-center gap-1">
                    <ScanLine size={12} />
                    {panoramaT('occlusionReference')}
                  </span>
                  <span className="text-[9px] text-[var(--t8-text-muted)]">{panoramaT('occlusionCount', { count: occlusionMasks.length })}</span>
                </div>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                    <div className="rounded-md bg-[var(--t8-bg-panel)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
                      {panoramaT('occlusionHint')}
                    </div>
                    <button type="button" className={`t8-mini-icon-button ${occlusionMaskVisible ? 'is-active' : ''}`} onClick={() => update({ panoramaOcclusionMaskVisible: !occlusionMaskVisible })} title={panoramaT('toggleOcclusionReference')}>
                      {occlusionMaskVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={addOcclusionMask}>
                      <Plus size={12} />
                      {panoramaT('add')}
                    </button>
                  </div>
                  {occlusionMasks.length > 0 && (
                    <div className="space-y-1.5">
                      {occlusionMasks.map((mask) => (
                        <div
                          key={mask.id}
                          className={`space-y-1 rounded-md border bg-[var(--t8-bg-panel)] p-1.5 ${activeOcclusionMaskId === mask.id ? 'border-[var(--t8-accent)] shadow-[0_0_0_1px_var(--t8-accent)]' : 'border-[var(--t8-border)]'}`}
                          onMouseDown={() => setActiveOcclusionMaskId(mask.id)}
                        >
                          <div className="grid grid-cols-[1fr_28px] gap-1">
                            <input
                              value={mask.label}
                              onChange={(event) => patchOcclusionMask(mask, { label: event.target.value })}
                              className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                            />
                            <button type="button" className="t8-mini-icon-button" onClick={() => removeOcclusionMask(mask)} title={panoramaT('deleteOcclusionArea')}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            {([
                              ['X', 'x', 0, 96],
                              ['Y', 'y', 0, 96],
                              ['宽', 'w', 4, 100],
                              ['高', 'h', 4, 100],
                              ['强', 'strength', 0, 100],
                            ] as Array<[string, keyof PanoramaOcclusionMask, number, number]>).map(([label, keyName, min, max]) => (
                              <label key={keyName} className="min-w-0">
                                <span className="mb-0.5 block text-[9px] font-bold text-[var(--t8-text-muted)]">{stableDisplayLabel('maskControls', String(keyName), label)} {Math.round(Number(mask[keyName]) || 0)}</span>
                                <input type="range" min={min} max={max} value={Number(mask[keyName]) || 0} onChange={(event) => patchOcclusionMask(mask, { [keyName]: Number(event.target.value) } as Partial<PanoramaOcclusionMask>)} className="w-full" />
                              </label>
                            ))}
                          </div>
                          <input
                            value={mask.note || ''}
                            onChange={(event) => patchOcclusionMask(mask, { note: event.target.value })}
                            placeholder={panoramaT('occlusionNotePlaceholder')}
                            className="w-full rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              <section className="rounded-md border border-zinc-300/30 bg-black/10 p-2">
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-main)]">
                  <span className="flex items-center gap-1">
                    <FileJson size={12} />
                    {panoramaT('storyboardPromptBoard')}
                  </span>
                  <button
                    type="button"
                    className={`t8-btn h-7 px-2 text-[10px] ${storyboardPromptEnabled ? 't8-btn-primary' : ''}`}
                    onClick={() => update({
                      panoramaStoryboardPromptEnabled: !storyboardPromptEnabled,
                      panoramaStoryboardPromptText: storyboardPromptText || PANORAMA_STORYBOARD_PROMPT_DEFAULT,
                    })}
                    title={panoramaT('storyboardPromptBoardTitle')}
                  >
                    {storyboardPromptEnabled ? panoramaT('enabled') : panoramaT('off')}
                  </button>
                </div>
                {storyboardPromptEnabled ? (
                  <div className="mt-2 space-y-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('scene')}</span>
                      <textarea
                        value={storyboardPromptText}
                        onChange={(event) => update({ panoramaStoryboardPromptText: event.target.value })}
                        rows={Math.min(10, Math.max(3, storyboardPromptPreviewPanel.lines.length + 1))}
                        className="nodrag nowheel w-full resize-y rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs leading-relaxed text-[var(--t8-text-main)] outline-none"
                        placeholder={PANORAMA_STORYBOARD_PROMPT_DEFAULT}
                      />
                    </label>
                    {renderStoryboardPromptPreview()}
                    <div className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-muted)]">
                        <span>{panoramaT('presetPromptsList')}</span>
                        <span>{panoramaT('presetCount', { count: storyboardPromptPresets.length })}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_1fr] gap-1.5">
                        <select
                          aria-label="panorama-storyboard-preset-select"
                          value={storyboardSelectedPresetId}
                          onChange={(event) => selectStoryboardPreset(event.target.value)}
                          className="nodrag nowheel min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-[10px] font-bold text-[var(--t8-text-main)] outline-none"
                        >
                          <option value="">{panoramaT('defaultPreset')}</option>
                          {storyboardPromptPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name}</option>
                          ))}
                        </select>
                        <input
                          value={storyboardPresetName}
                          onChange={(event) => update({ panoramaStoryboardPresetName: event.target.value })}
                          placeholder={panoramaT('presetNamePlaceholder')}
                          className="nodrag nowheel min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-[10px] text-[var(--t8-text-main)] outline-none"
                        />
                      </div>
                      <textarea
                        value={storyboardPresetPrompt}
                        onChange={(event) => update({ panoramaStoryboardPresetPrompt: event.target.value })}
                        rows={2}
                        className="nodrag nowheel mt-1.5 w-full resize-y rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--t8-text-main)] outline-none"
                        placeholder={PANORAMA_STORYBOARD_PROMPT_DEFAULT}
                      />
                      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                        <button type="button" className="t8-btn t8-btn-primary h-7 px-1 text-[10px]" onClick={insertStoryboardPreset} title={panoramaT('insertPresetTitle')}>
                          <Plus size={12} /> {panoramaT('insert')}
                        </button>
                        <button type="button" className="t8-btn h-7 px-1 text-[10px]" onClick={saveStoryboardPreset} title={panoramaT('savePresetTitle')}>
                          <CheckCircle2 size={12} /> {panoramaT('savePreset')}
                        </button>
                        <button type="button" className="t8-btn h-7 px-1 text-[10px]" onClick={exportStoryboardPresets} title={panoramaT('exportPresetJsonTitle')}>
                          <Download size={12} /> {panoramaT('exportPreset')}
                        </button>
                        <button type="button" className="t8-btn h-7 px-1 text-[10px]" onClick={() => storyboardPresetImportRef.current?.click()} title={panoramaT('importPresetJsonTitle')}>
                          <Upload size={12} /> {panoramaT('importPreset')}
                        </button>
                      </div>
                      <input
                        ref={storyboardPresetImportRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={importStoryboardPresets}
                      />
                      {storyboardPresetNotice && (
                        <div className="mt-1.5 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1 text-[10px] font-bold text-[var(--t8-text-muted)]">
                          {storyboardPresetNotice}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 rounded-md border border-dashed border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-2 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
                    {panoramaT('storyboardPromptDisabledHint')}
                  </div>
                )}
              </section>
              {layoutIoState && <div className="rounded-md bg-sky-400/10 px-2 py-1 text-[10px] font-bold text-sky-100">{layoutIoState}</div>}

              <div className="order-[-20] space-y-2">
              {sceneLegendVisible && avatars.length > 0 && (
                <div className="flex flex-wrap gap-1.5 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-1.5">
                  {avatars.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] ${activeAvatarId === item.id ? 'border-sky-300 bg-sky-400/15' : 'border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)]'}`}
                      onClick={() => focusAvatar(item)}
                      title={panoramaT('selectAndJumpAvatar')}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      <span>{index + 1}</span>
                      <span className="max-w-20 truncate">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {avatars.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-3 py-4 text-center text-xs text-[var(--t8-text-muted)]">
                  {panoramaT('emptyAvatarHint')}
                </div>
              ) : activeAvatar ? (
                <div className="space-y-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-1.5">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('name')}</span>
                      <input
                        value={activeAvatar.name}
                        onChange={(event) => patchAvatar(activeAvatar, { name: event.target.value })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      />
                    </label>
                    <button type="button" className="t8-mini-icon-button" onClick={() => patchAvatar(activeAvatar, { visible: !activeAvatar.visible })} title={panoramaT('toggleVisibility')}>
                      {activeAvatar.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button type="button" className="t8-mini-icon-button" onClick={() => patchAvatar(activeAvatar, { locked: !activeAvatar.locked })} title={panoramaT('toggleLock')}>
                      {activeAvatar.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button type="button" className="t8-mini-icon-button" onClick={() => removeAvatar(activeAvatar)} title={panoramaT('deleteAvatar')}>
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('pose')}</span>
                      <select
                        value={activeAvatar.poseId}
                        onChange={(event) => changeAvatarPose(activeAvatar, safePanoramaAvatarPose(event.target.value))}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        {PANORAMA_AVATAR_POSES.map((pose) => (
                          <option key={pose.id} value={pose.id}>{poseDisplayLabel(pose.id)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('facing')}</span>
                      <select
                        value={activeAvatar.faceMode}
                        onChange={(event) => patchAvatar(activeAvatar, { faceMode: safePanoramaAvatarFaceMode(event.target.value) })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        <option value="camera">{panoramaT('faceCamera')}</option>
                        <option value="heading">{panoramaT('manualHeading')}</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      className={`t8-btn h-8 px-2 text-[10px] ${avatarIkEditMode ? 't8-btn-primary' : ''}`}
                      onClick={toggleAvatarIkEditMode}
                      title={panoramaT('jointEditTitle')}
                    >
                      <Move size={12} />
                      {panoramaT('joints')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={resetActivePoseParams} title={panoramaT('resetPoseTitle')}>
                      <RotateCcw size={12} />
                      {panoramaT('reset')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => duplicateAvatar(activeAvatar)}>
                      <Plus size={12} />
                      {panoramaT('duplicate')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => setDirectorFullscreenOpen(true)} title={panoramaT('openDirectorTitle')}>
                      <Maximize2 size={12} />
                      {panoramaT('fullscreen')}
                    </button>
                  </div>

                  <section className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--t8-text-main)]">
                      <span>{panoramaT('advancedPosePosition')}</span>
                      <span className="text-[9px] text-[var(--t8-text-muted)]">{panoramaT('advancedPoseHint')}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                  {poseTargets.length > 0 && (
                    <div className="grid grid-cols-[1fr_auto] gap-1.5">
                      <label className="min-w-0">
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseMaster')}</span>
                        <select
                          value={poseSourceId || poseTargets[0]?.id || ''}
                          onChange={(event) => setPoseSourceId(event.target.value)}
                          className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                        >
                          {poseTargets.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="t8-btn self-end px-2 text-[10px]" onClick={importPoseToAvatar}>
                        <UserPlus size={12} />
                        {panoramaT('importPose')}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('groundMode')}</span>
                      <select
                        value={activeAvatar.groundMode}
                        onChange={(event) => patchAvatar(activeAvatar, { groundMode: safePanoramaAvatarGroundMode(event.target.value) as PanoramaAvatarGroundMode })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        <option value="grounded">{panoramaT('groundModes.grounded')}</option>
                        <option value="floating">{panoramaT('groundModes.floating')}</option>
                        <option value="manual">{panoramaT('groundModes.manual')}</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootHeightValue', { value: Math.round(activeAvatar.rootHeight) })}</span>
                      <input
                        type="range"
                        min={-40}
                        max={180}
                        value={activeAvatar.rootHeight}
                        disabled={activeAvatar.groundMode === 'grounded'}
                        onChange={(event) => patchAvatar(activeAvatar, { rootHeight: Number(event.target.value), groundMode: activeAvatar.groundMode === 'grounded' ? 'manual' : activeAvatar.groundMode })}
                        className="w-full"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootPitchValue', { value: Math.round(activeAvatar.rootPitch) })}</span>
                      <input type="range" min={-90} max={90} value={activeAvatar.rootPitch} onChange={(event) => patchAvatar(activeAvatar, { rootPitch: Number(event.target.value) })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootRollValue', { value: Math.round(activeAvatar.rootRoll) })}</span>
                      <input type="range" min={-120} max={120} value={activeAvatar.rootRoll} onChange={(event) => patchAvatar(activeAvatar, { rootRoll: Number(event.target.value) })} className="w-full" />
                    </label>
                  </div>

                  <div className="space-y-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
                    <div className="grid grid-cols-4 gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.leftUpperArm'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'armLOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.5}
                          max={1.5}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'armLOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'armLOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.rightUpperArm'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'armROffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.5}
                          max={1.5}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'armROffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'armROffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.leftThigh'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'legLOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.5}
                          max={1.5}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'legLOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'legLOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.rightThigh'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'legROffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.5}
                          max={1.5}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'legROffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'legROffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.leftElbow'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'armLBendOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.4}
                          max={1.4}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'armLBendOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'armLBendOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.rightElbow'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'armRBendOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.4}
                          max={1.4}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'armRBendOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'armRBendOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.leftKnee'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'legLBendOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.4}
                          max={1.4}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'legLBendOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'legLBendOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: panoramaT('poseParams.rightKnee'), value: Math.round(poseParamNumber(activeAvatar.poseParams, 'legRBendOffsetZ', 0) * 57.3) })}</span>
                        <input
                          type="range"
                          min={-1.4}
                          max={1.4}
                          step={0.05}
                          value={poseParamNumber(activeAvatar.poseParams, 'legRBendOffsetZ', 0)}
                          onChange={(event) => patchAvatarPoseParam(activeAvatar, 'legRBendOffsetZ', Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('distanceValue', { value: Math.round(activeAvatar.distance) })}</span>
                      <input type="range" min={80} max={420} value={activeAvatar.distance} onChange={(event) => patchAvatar(activeAvatar, { distance: Number(event.target.value) })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('scaleValue', { value: activeAvatar.scale.toFixed(1) })}</span>
                      <input type="range" min={0.35} max={2.6} step={0.05} value={activeAvatar.scale} onChange={(event) => patchAvatar(activeAvatar, { scale: Number(event.target.value) })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('feetOffsetValue', { value: Math.round(activeAvatar.heightOffset) })}</span>
                      <input type="range" min={-80} max={120} value={activeAvatar.heightOffset} onChange={(event) => patchAvatar(activeAvatar, { heightOffset: Number(event.target.value) })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('opacityValue', { value: Math.round(activeAvatar.opacity * 100) })}</span>
                      <input type="range" min={0.15} max={1} step={0.05} value={activeAvatar.opacity} onChange={(event) => patchAvatar(activeAvatar, { opacity: Number(event.target.value) })} className="w-full" />
                    </label>
                  </div>

                  {activeAvatar.faceMode === 'heading' && (
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('manualHeadingValue', { value: Math.round(activeAvatar.heading) })}</span>
                      <input type="range" min={-180} max={180} value={activeAvatar.heading} onChange={(event) => patchAvatar(activeAvatar, { heading: Number(event.target.value) })} className="w-full" />
                    </label>
                  )}

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <label className="min-w-0">
                      <span className="mb-1 flex items-center gap-1 text-[10px] font-bold text-[var(--t8-text-muted)]"><Palette size={11} /> {panoramaT('color')}</span>
                      <div className="flex flex-wrap gap-1">
                        {PANORAMA_AVATAR_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`h-6 w-6 rounded-md border ${activeAvatar.color === color ? 'border-white ring-2 ring-white/40' : 'border-white/20'}`}
                            style={{ background: color }}
                            onClick={() => patchAvatar(activeAvatar, { color })}
                            title={color}
                          />
                        ))}
                      </div>
                    </label>
                    <button type="button" className="t8-btn self-end px-2 text-[10px]" onClick={() => duplicateAvatar(activeAvatar)}>
                      <Plus size={12} />
                      {panoramaT('duplicate')}
                    </button>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('characterPromptOptional')}</span>
                    <input
                      value={activeAvatar.characterPrompt || ''}
                      onChange={(event) => patchAvatar(activeAvatar, { characterPrompt: event.target.value })}
                      placeholder={panoramaT('characterPromptPlaceholder')}
                      className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                    />
                  </label>
                    </div>
                  </section>
                </div>
              ) : null}
              </div>

              {scenePrompt && (
                <section className="rounded-md bg-[var(--t8-bg-panel)] px-2 py-1 text-[10px] text-[var(--t8-text-muted)]">
                  <div className="font-bold text-[var(--t8-text-main)]">{panoramaT('scenePromptPreview')}</div>
                  <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap leading-relaxed">{scenePrompt}</div>
                </section>
              )}
            </div>
          </section>

          <section className="hidden">
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--t8-text-main)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Camera size={14} />
                {panoramaT('cameraAndTour')}
              </span>
              <span className="min-w-0 truncate text-right text-[10px] text-[var(--t8-text-muted)]">{panoramaT('cameraHotspotCount', { cameras: cameraViews.length, hotspots: hotspots.length })}</span>
            </div>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-6 gap-1.5">
                {PANORAMA_CAMERA_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="t8-btn h-7 px-1 text-[10px]"
                    onClick={() => applyView(item, { panoramaActiveCameraViewId: '' })}
                    title={`${stableDisplayLabel('cameraPresets', item.id, item.label)} ${item.yaw}°/${item.pitch}°`}
                  >
                    {stableDisplayLabel('cameraPresets', item.id, item.label)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-1.5">
                <input
                  value={cameraName}
                  onChange={(event) => setCameraName(event.target.value)}
                  placeholder={panoramaT('cameraNamePlaceholder')}
                  className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                />
                <button type="button" className="t8-btn t8-btn-primary px-2 text-[11px]" onClick={saveCameraView}>
                  <Plus size={13} />
                  {panoramaT('saveCamera')}
                </button>
              </div>

              {cameraViews.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {cameraViews.map((item) => (
                    <div key={item.id} className={`rounded-md border px-2 py-1.5 text-[10px] ${activeCameraViewId === item.id ? 'border-sky-300 bg-sky-400/15' : 'border-[var(--t8-border)] bg-[var(--t8-bg-panel)]'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left font-bold text-[var(--t8-text-main)]"
                          onClick={() => applyCameraView(item)}
                          title={`${item.name} · Yaw ${Math.round(item.yaw)}° Pitch ${Math.round(item.pitch)}° FOV ${Math.round(item.fov)}°`}
                        >
                          {item.isDefault ? panoramaT('defaultPrefix') : ''}{item.name}
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => setDefaultCameraView(item)} title={panoramaT('setDefault')}>
                          <Crosshair size={12} />
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => removeCameraView(item)} title={panoramaT('deleteCamera')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="mt-1 text-[9px] text-[var(--t8-text-muted)]">
                        Y {Math.round(item.yaw)}° · P {Math.round(item.pitch)}° · FOV {Math.round(item.fov)}°
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] p-2">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold text-[var(--t8-text-muted)]">
                  <MapPin size={12} />
                  {panoramaT('panoramaHotspots')}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={hotspotLabel}
                    onChange={(event) => setHotspotLabel(event.target.value)}
                    placeholder={panoramaT('hotspotNamePlaceholder')}
                    className="min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  />
                  <select
                    value={hotspotTargetId}
                    onChange={(event) => setHotspotTargetId(event.target.value)}
                    className="min-w-0 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                  >
                    {panoramaTargets.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap ${hotspotPickMode ? 't8-btn-primary' : ''}`}
                    onClick={() => setHotspotPickMode((value) => !value)}
                    title={panoramaT('pickHotspotTitle')}
                  >
                    <Crosshair size={12} />
                    {panoramaT('pickPoint')}
                  </button>
                  <button
                    type="button"
                    className="t8-btn h-8 min-w-0 justify-center px-2 text-[10px] whitespace-nowrap"
                    onClick={() => addHotspotAt(viewRef.current)}
                    title={panoramaT('saveCenterHotspotTitle')}
                  >
                    <Plus size={12} />
                    {panoramaT('center')}
                  </button>
                </div>
                <div className="mt-1.5 text-[9px] leading-relaxed text-[var(--t8-text-muted)]">
                  {panoramaT('hotspotHelp')}
                </div>
                {hotspots.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {hotspots.map((item) => (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px_28px] items-center gap-1 rounded-md bg-[var(--t8-bg-panel-muted)] px-1.5 py-1">
                        <input
                          value={item.label}
                          onChange={(event) => patchHotspot(item, { label: event.target.value })}
                          className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                        />
                        <select
                          value={item.targetNodeId || p.id}
                          onChange={(event) => patchHotspot(item, { targetNodeId: event.target.value })}
                          className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none"
                        >
                          {panoramaTargets.map((target) => (
                            <option key={target.id} value={target.id}>{target.label}</option>
                          ))}
                        </select>
                        <button type="button" className="t8-mini-icon-button" onClick={() => jumpToHotspot(item)} title={panoramaT('jumpHotspot')}>
                          <MapPin size={12} />
                        </button>
                        <button type="button" className="t8-mini-icon-button" onClick={() => removeHotspot(item)} title={panoramaT('deleteHotspot')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          </div>

          <div className="col-span-2 grid grid-cols-3 gap-2 text-[10px] text-[var(--t8-text-muted)]">
            <div className="rounded-md bg-[var(--t8-bg-panel-muted)] px-2 py-1">Yaw {Math.round(yaw)}°</div>
            <div className="rounded-md bg-[var(--t8-bg-panel-muted)] px-2 py-1">Pitch {Math.round(pitch)}°</div>
            <div className="rounded-md bg-[var(--t8-bg-panel-muted)] px-2 py-1">{renderSize.width}×{renderSize.height}</div>
          </div>

          {textureStatus === 'ready' && quality && (
            <div className={`col-span-2 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed ${qualityClass}`} title={qualityHint}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{qualityLabel}</span>
                <span>{quality.seamScore == null ? panoramaT('quality.pixelsUnreadable') : `${quality.seamScore}/100`} · {qualityAspectLabel}</span>
              </div>
              <div className="mt-0.5 opacity-80">{qualityHint}</div>
            </div>
          )}

          {outputUrl && !hasAutoOutput && (
            <div className="col-span-2 rounded-lg border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
              <SmartImage src={outputUrl} alt={panoramaT('exportedFrameAlt')} className="max-h-28 w-full rounded object-contain" draggable={false} thumbSize={720} />
            </div>
          )}
        </div>
      </div>
    </div>
    {shortcutHelpOpen && typeof document !== 'undefined' ? createPortal(
      <div
        data-canvas-floating-ui
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/70 p-4"
        onMouseDown={() => setShortcutHelpOpen(false)}
      >
        <div
          className="w-full max-w-xl rounded-lg border border-white/15 bg-[var(--t8-bg-panel)] p-4 text-[var(--t8-text-main)] shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold">{panoramaT('shortcutHelpHeading')}</div>
              <div className="text-[10px] text-[var(--t8-text-muted)]">{panoramaT('shortcutHelpScope')}</div>
            </div>
            <button type="button" className="t8-mini-icon-button" onClick={() => setShortcutHelpOpen(false)} title={translate('common:actions.close')}>
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PANORAMA_DIRECTOR_SHORTCUTS.map(([keyLabel, helpKey]) => (
              <div key={keyLabel} className="grid grid-cols-[92px_1fr] items-center gap-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-[11px] text-[var(--t8-text-main)]">
                <span className="rounded border border-[var(--t8-border-strong)] bg-[var(--t8-accent)] px-1.5 py-0.5 text-center font-bold text-[var(--t8-accent-text)] shadow-sm">{keyLabel}</span>
                <span className="text-[var(--t8-text-main)]">{panoramaT(`shortcuts.${helpKey}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>,
      document.body,
    ) : null}
    {directorFullscreenOpen && typeof document !== 'undefined' ? createPortal(
      <div
        data-canvas-floating-ui
        className="fixed inset-0 z-[9997] bg-slate-950 text-slate-100"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Globe2 size={16} />
                {panoramaT('directorWorkbench')}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                {panoramaT('directorSummary', {
                  count: avatars.length,
                  view: effectiveShotCamera.mode === 'shot-camera' ? panoramaT('directorShot') : panoramaT('currentView'),
                  pose: activeAvatar ? poseDisplayLabel(activeAvatar.poseId) : panoramaT('noAvatarSelected'),
                })}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => setShortcutHelpOpen(true)} title={panoramaT('shortcutsTitle')}>
                <HelpCircle size={13} />
                {panoramaT('shortcutsLabel')}
              </button>
              <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={refreshDirectorPreview} title={panoramaT('refreshPreviewTitle')}>
                <ScanLine size={13} />
                {panoramaT('refresh')}
              </button>
              <button type="button" className="t8-mini-icon-button" onClick={() => setDirectorFullscreenOpen(false)} title={panoramaT('closeEsc')}>
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_430px] gap-3 p-3">
            <div ref={directorPreviewWrapRef} className="relative min-h-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
              <div
                ref={directorStageRef}
                className={`absolute overflow-hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{
                  left: `${directorStageBox.left}%`,
                  top: `${directorStageBox.top}%`,
                  width: `${directorStageBox.width}%`,
                  height: `${directorStageBox.height}%`,
                  touchAction: 'none',
                }}
                onWheel={onWheel}
                onPointerDownCapture={(event) => handleInteractionStagePointerDownCapture(event, 'director')}
                onPointerDown={onPointerDown}
                onPointerMove={handleStagePointerMove}
                onPointerUp={handleStagePointerEnd}
                onPointerCancel={handleStagePointerEnd}
              >
                {directorPreviewUrl ? (
                  <img src={directorPreviewUrl} alt={panoramaT('directorPreviewAlt')} className="pointer-events-none h-full w-full object-fill" draggable={false} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    {panoramaT('refreshingPreview')}
                  </div>
                )}

                {visibleHotspots.map(({ item, pos }) => (
                  <button
                    key={`director-hotspot-${item.id}`}
                    type="button"
                    className="absolute z-20 flex h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1 rounded-full border border-sky-200 bg-sky-500/90 px-2 text-[10px] font-bold text-slate-950 shadow-lg shadow-sky-950/35"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    title={`${item.label} · ${Math.round(item.yaw)}°/${Math.round(item.pitch)}°`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      jumpToHotspot(item);
                    }}
                  >
                    <MapPin size={13} />
                    <span className="max-w-20 truncate">{item.label}</span>
                  </button>
                ))}

                {avatarOverlayVisible && visibleAvatarMarkers.map(({ item, index, pos }) => (
                  <div
                    key={`director-avatar-${item.id}`}
                    className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${activeAvatarId === item.id ? 'z-[60]' : 'z-20'}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <button
                      type="button"
                      className={`nodrag nopan pointer-events-auto relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border text-[10px] font-bold shadow-md transition-transform hover:scale-125 ${
                        activeAvatarId === item.id
                          ? 'border-white bg-white text-slate-950 ring-2 ring-white/40'
                          : 'border-white/60 bg-slate-950/20 text-white'
                      }`}
                      style={{ touchAction: 'none' }}
                      title={panoramaT('dragAvatarTitle', { index: index + 1, name: item.name })}
                      onMouseDown={stopPanoramaMouseDown}
                      onPointerDown={(event) => startAvatarDrag(event, item, 'director')}
                      onPointerMove={moveAvatarDrag}
                      onPointerUp={endAvatarDrag}
                      onPointerCancel={endAvatarDrag}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusAvatar(item);
                      }}
                    >
                      <span className="absolute inset-1 rounded-full" style={{ background: item.color }} />
                      <span className="relative text-[9px] leading-none">{index + 1}</span>
                    </button>
                    {activeAvatarId === item.id && !item.locked && (
                      <div
                        className="pointer-events-auto absolute z-[70] flex flex-col gap-2"
                        style={getAvatarToolDockStyle(item, pos, 'director')}
                      >
                        <button
                          type="button"
                          className="nodrag nopan flex h-9 w-9 items-center justify-center rounded-full border-2 text-slate-950 transition-transform hover:scale-110"
                          style={{ ...PANORAMA_MOVE_HANDLE_STYLE, touchAction: 'none' }}
                          title={panoramaT('moveAvatarTitle', { name: item.name })}
                          onMouseDown={stopPanoramaMouseDown}
                          onPointerDown={(event) => startAvatarDrag(event, item, 'director')}
                          onPointerMove={moveAvatarDrag}
                          onPointerUp={endAvatarDrag}
                          onPointerCancel={endAvatarDrag}
                          onDragStart={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <Move size={14} />
                        </button>
                        <button
                          type="button"
                          className="nodrag nopan flex h-9 w-9 items-center justify-center rounded-full border-2 text-slate-950 transition-transform hover:scale-110"
                          style={{ ...PANORAMA_ROTATE_HANDLE_STYLE, touchAction: 'none' }}
                          title={panoramaT('rotateAvatarTitle', { name: item.name })}
                          onMouseDown={stopPanoramaMouseDown}
                          onPointerDown={(event) => startAvatarRotate(event, item, 'director')}
                          onPointerMove={moveAvatarRotate}
                          onPointerUp={endAvatarRotate}
                          onPointerCancel={endAvatarRotate}
                          onDragStart={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {avatarOverlayVisible && avatarIkControls.map((control) => (
                  <button
                    key={`director-ik-${control.avatarId}-${control.id}`}
                    type="button"
                    className={`nodrag nopan pointer-events-auto absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-950/70 shadow-sm transition-transform hover:scale-150 ${
                      control.kind === 'end' ? 'h-6 w-6 bg-white/95' : 'h-5 w-5 bg-amber-300/95'
                    }`}
                    style={{ left: `${control.x}%`, top: `${control.y}%`, touchAction: 'none' }}
                    data-panorama-ik-control="true"
                    data-panorama-ik-avatar-id={control.avatarId}
                    data-panorama-ik-handle-id={control.id}
                    title={panoramaT('dragJointTitle', { label: control.label })}
                    onMouseDown={stopPanoramaMouseDown}
                    onPointerDown={(event) => startAvatarIkDrag(event, control, 'director')}
                    onPointerMove={moveAvatarIkDrag}
                    onPointerUp={endAvatarIkDrag}
                    onPointerCancel={endAvatarIkDrag}
                    onDragStart={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <span className={`${control.kind === 'end' ? 'h-2.5 w-2.5' : 'h-2 w-2'} rounded-full bg-slate-950/85`} />
                  </button>
                ))}

                {guideStyle && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <div
                      className="relative border border-white/75 shadow-[0_0_0_9999px_rgba(2,6,23,.22)]"
                      style={guideStyle}
                    >
                      <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        {compositionGuide}
                      </span>
                      <span className="absolute left-1/3 top-0 h-full border-l border-white/25" />
                      <span className="absolute left-2/3 top-0 h-full border-l border-white/25" />
                      <span className="absolute left-0 top-1/3 w-full border-t border-white/25" />
                      <span className="absolute left-0 top-2/3 w-full border-t border-white/25" />
                    </div>
                  </div>
                )}

                {shotGuideStyle && (
                  <div className="pointer-events-none absolute inset-0 z-30">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="relative border-2 border-dashed border-amber-300/95 shadow-[0_0_0_1px_rgba(2,6,23,.38)]"
                        style={shotGuideStyle}
                      >
                        <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">
                          {panoramaT('directorShot')}
                        </span>
                      </div>
                    </div>
                    {shotTargetLineStyle && (
                      <span
                        className="absolute h-px origin-left border-t border-amber-200/80"
                        style={shotTargetLineStyle}
                      />
                    )}
                    {shotTarget.visible && (
                      <span
                        className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-amber-200/80 bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-bold text-amber-100 shadow-md"
                        style={{ left: `${shotTarget.x}%`, top: `${shotTarget.y}%` }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                        {shotTarget.label}
                      </span>
                    )}
                  </div>
                )}

                {occlusionMaskVisible && occlusionMasks.map((mask, index) => (
                  <div
                    key={`director-mask-${mask.id}`}
                    className={`nodrag nopan pointer-events-auto absolute z-30 rounded-sm border-2 shadow-[0_0_0_1px_rgba(2,6,23,.45)] ${
                      activeOcclusionMaskId === mask.id ? 'border-amber-200 ring-2 ring-amber-300/70' : 'border-white/90'
                    }`}
                    style={{
                      left: `${mask.x}%`,
                      top: `${mask.y}%`,
                      width: `${mask.w}%`,
                      height: `${mask.h}%`,
                      touchAction: 'none',
                      cursor: 'move',
                      backgroundColor: `rgba(14, 165, 233, ${Math.min(0.72, 0.2 + mask.strength / 200)})`,
                      backgroundImage: 'repeating-linear-gradient(135deg, rgba(2,6,23,.32) 0 2px, transparent 2px 10px)',
                    }}
                  title={panoramaT('moveResizeMaskTitle', { label: mask.label })}
                    onMouseDown={stopPanoramaMouseDown}
                    onPointerDown={(event) => startOcclusionMaskDrag(event, mask, 'move', 'director')}
                    onPointerMove={moveOcclusionMaskDrag}
                    onPointerUp={endOcclusionMaskDrag}
                    onPointerCancel={endOcclusionMaskDrag}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveOcclusionMaskId(mask.id);
                    }}
                    onDragStart={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <span
                      className={OCCLUSION_MASK_LABEL_CLASS}
                      style={OCCLUSION_MASK_LABEL_STYLE}
                    >
                      {index + 1}. {mask.label}
                    </span>
                    {([
                      ['nw', '-left-1.5 -top-1.5 cursor-nwse-resize'],
                      ['n', 'left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize'],
                      ['ne', '-right-1.5 -top-1.5 cursor-nesw-resize'],
                      ['e', '-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
                      ['se', '-bottom-1.5 -right-1.5 cursor-nwse-resize'],
                      ['s', '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize'],
                      ['sw', '-bottom-1.5 -left-1.5 cursor-nesw-resize'],
                      ['w', '-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
                    ] as Array<[OcclusionDragMode, string]>).map(([mode, className]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`nodrag nopan absolute h-3.5 w-3.5 rounded-full border border-slate-950 bg-white shadow-sm ${className}`}
                        style={{ touchAction: 'none' }}
                      title={panoramaT('resizeMaskTitle', { label: mask.label })}
                        onMouseDown={stopPanoramaMouseDown}
                        onPointerDown={(event) => startOcclusionMaskDrag(event, mask, mode, 'director')}
                        onPointerMove={moveOcclusionMaskDrag}
                        onPointerUp={endOcclusionMaskDrag}
                        onPointerCancel={endOcclusionMaskDrag}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="absolute left-3 top-3 z-40 flex flex-wrap gap-1.5 text-[10px] font-bold">
                <span className="rounded-full border border-white/20 bg-slate-950/75 px-2 py-1">Yaw {Math.round(yaw)}°</span>
                <span className="rounded-full border border-white/20 bg-slate-950/75 px-2 py-1">Pitch {Math.round(pitch)}°</span>
                <span className="rounded-full border border-white/20 bg-slate-950/75 px-2 py-1">FOV {Math.round(fov)}°</span>
                {activeAvatar && <span className="rounded-full border border-white/20 bg-slate-950/75 px-2 py-1">{activeAvatar.name}</span>}
              </div>
            </div>

            <div className="nodrag nowheel min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-[var(--t8-bg-panel)] p-3 text-[var(--t8-text-main)]" onWheel={(event) => event.stopPropagation()}>
              <div className="space-y-3">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span>{panoramaT('currentView')}</span>
                    <button type="button" className="t8-btn h-7 px-2 text-[10px]" onClick={resetView}>
                      <RotateCcw size={12} />
                      {panoramaT('reset')}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">Yaw {Math.round(yaw)}°</span>
                      <input type="range" min={-180} max={180} value={Math.round(yaw)} onChange={(event) => applyView({ yaw: Number(event.target.value) }, { panoramaActiveCameraViewId: '' })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">Pitch {Math.round(pitch)}°</span>
                      <input type="range" min={-85} max={85} value={Math.round(pitch)} onChange={(event) => applyView({ pitch: Number(event.target.value) }, { panoramaActiveCameraViewId: '' })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">FOV {Math.round(fov)}°</span>
                      <input type="range" min={35} max={100} value={Math.round(fov)} onChange={(event) => applyView({ fov: Number(event.target.value) }, { panoramaActiveCameraViewId: '' })} className="w-full" />
                    </label>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span>{panoramaT('avatars')}</span>
                    <button type="button" className="t8-btn h-7 px-2 text-[10px]" onClick={addAvatarAtCenter}>
                      <UserPlus size={12} />
                      {panoramaT('add')}
                    </button>
                  </div>
                  {avatars.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {avatars.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${activeAvatarId === item.id ? 'border-sky-300 bg-sky-400/15' : 'border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)]'}`}
                          onClick={() => selectAvatarAtIndex(index)}
                          title={`${index + 1} · ${item.name}`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                          <span>{index + 1}</span>
                          <span className="max-w-24 truncate">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--t8-border)] px-3 py-4 text-center text-xs text-[var(--t8-text-muted)]">{panoramaT('noAvatars')}</div>
                  )}
                </section>

                {renderActionPlannerPanel(true)}

                {activeAvatar && (
                  <section className="space-y-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-1.5">
                      <label className="min-w-0">
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('name')}</span>
                        <input
                          value={activeAvatar.name}
                          onChange={(event) => patchAvatar(activeAvatar, { name: event.target.value })}
                          className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                        />
                      </label>
                      <button type="button" className="t8-mini-icon-button" onClick={() => patchAvatar(activeAvatar, { visible: !activeAvatar.visible })} title={panoramaT('toggleVisibility')}>
                        {activeAvatar.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button type="button" className="t8-mini-icon-button" onClick={() => patchAvatar(activeAvatar, { locked: !activeAvatar.locked })} title={panoramaT('toggleLock')}>
                        {activeAvatar.locked ? <Lock size={13} /> : <Unlock size={13} />}
                      </button>
                      <button type="button" className="t8-mini-icon-button" onClick={() => removeAvatar(activeAvatar)} title={panoramaT('deleteAvatar')}>
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('pose')}</span>
                        <select
                          value={activeAvatar.poseId}
                          onChange={(event) => changeAvatarPose(activeAvatar, safePanoramaAvatarPose(event.target.value))}
                          className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                        >
                          {PANORAMA_AVATAR_POSES.map((pose) => (
                            <option key={pose.id} value={pose.id}>{poseDisplayLabel(pose.id)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('facing')}</span>
                        <select
                          value={activeAvatar.faceMode}
                          onChange={(event) => patchAvatar(activeAvatar, { faceMode: safePanoramaAvatarFaceMode(event.target.value) })}
                          className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                        >
                          <option value="camera">{panoramaT('faceCamera')}</option>
                          <option value="heading">{panoramaT('manualHeading')}</option>
                        </select>
                      </label>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('groundMode')}</span>
                        <select
                          value={activeAvatar.groundMode}
                          onChange={(event) => patchAvatar(activeAvatar, { groundMode: safePanoramaAvatarGroundMode(event.target.value) as PanoramaAvatarGroundMode })}
                          className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                        >
                          <option value="grounded">{panoramaT('groundModes.grounded')}</option>
                          <option value="floating">{panoramaT('groundModes.floating')}</option>
                          <option value="manual">{panoramaT('groundModes.manual')}</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootHeightValue', { value: Math.round(activeAvatar.rootHeight) })}</span>
                        <input type="range" min={-40} max={180} value={activeAvatar.rootHeight} disabled={activeAvatar.groundMode === 'grounded'} onChange={(event) => patchAvatar(activeAvatar, { rootHeight: Number(event.target.value), groundMode: activeAvatar.groundMode === 'grounded' ? 'manual' : activeAvatar.groundMode })} className="w-full" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootPitchValue', { value: Math.round(activeAvatar.rootPitch) })}</span>
                        <input type="range" min={-90} max={90} value={activeAvatar.rootPitch} onChange={(event) => patchAvatar(activeAvatar, { rootPitch: Number(event.target.value) })} className="w-full" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('rootRollValue', { value: Math.round(activeAvatar.rootRoll) })}</span>
                        <input type="range" min={-120} max={120} value={activeAvatar.rootRoll} onChange={(event) => patchAvatar(activeAvatar, { rootRoll: Number(event.target.value) })} className="w-full" />
                      </label>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {([
                        ['左上臂', 'armLOffsetZ', -1.5, 1.5],
                        ['右上臂', 'armROffsetZ', -1.5, 1.5],
                        ['左大腿', 'legLOffsetZ', -1.5, 1.5],
                        ['右大腿', 'legROffsetZ', -1.5, 1.5],
                        ['左肘', 'armLBendOffsetZ', -1.4, 1.4],
                        ['右肘', 'armRBendOffsetZ', -1.4, 1.4],
                        ['左膝', 'legLBendOffsetZ', -1.4, 1.4],
                        ['右膝', 'legRBendOffsetZ', -1.4, 1.4],
                      ] as Array<[string, string, number, number]>).map(([label, keyName, min, max]) => (
                        <label key={keyName}>
                          <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('poseParamValue', { label: stableDisplayLabel('poseParams', keyName, label), value: Math.round(poseParamNumber(activeAvatar.poseParams, keyName, 0) * 57.3) })}</span>
                          <input type="range" min={min} max={max} step={0.05} value={poseParamNumber(activeAvatar.poseParams, keyName, 0)} onChange={(event) => patchAvatarPoseParam(activeAvatar, keyName, Number(event.target.value))} className="w-full" />
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('distanceValue', { value: Math.round(activeAvatar.distance) })}</span>
                        <input type="range" min={80} max={420} value={activeAvatar.distance} onChange={(event) => patchAvatar(activeAvatar, { distance: Number(event.target.value) })} className="w-full" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('scaleValue', { value: activeAvatar.scale.toFixed(1) })}</span>
                        <input type="range" min={0.35} max={2.6} step={0.05} value={activeAvatar.scale} onChange={(event) => patchAvatar(activeAvatar, { scale: Number(event.target.value) })} className="w-full" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('feetOffsetValue', { value: Math.round(activeAvatar.heightOffset) })}</span>
                        <input type="range" min={-80} max={120} value={activeAvatar.heightOffset} onChange={(event) => patchAvatar(activeAvatar, { heightOffset: Number(event.target.value) })} className="w-full" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('opacityValue', { value: Math.round(activeAvatar.opacity * 100) })}</span>
                        <input type="range" min={0.15} max={1} step={0.05} value={activeAvatar.opacity} onChange={(event) => patchAvatar(activeAvatar, { opacity: Number(event.target.value) })} className="w-full" />
                      </label>
                    </div>

                    {activeAvatar.faceMode === 'heading' && (
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('manualHeadingValue', { value: Math.round(activeAvatar.heading) })}</span>
                        <input type="range" min={-180} max={180} value={activeAvatar.heading} onChange={(event) => patchAvatar(activeAvatar, { heading: Number(event.target.value) })} className="w-full" />
                      </label>
                    )}

                    <div className="flex flex-wrap gap-1">
                      {PANORAMA_AVATAR_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`h-6 w-6 rounded-md border ${activeAvatar.color === color ? 'border-white ring-2 ring-white/40' : 'border-white/20'}`}
                          style={{ background: color }}
                          onClick={() => patchAvatar(activeAvatar, { color })}
                          title={color}
                        />
                      ))}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      <button type="button" className={`t8-btn h-8 px-2 text-[10px] ${avatarIkEditMode ? 't8-btn-primary' : ''}`} onClick={toggleAvatarIkEditMode} title={panoramaT('jointEditTitle')}>
                        <Move size={12} />
                        {panoramaT('joints')}
                      </button>
                      <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={resetActivePoseParams}>
                        <RotateCcw size={12} />
                        {panoramaT('reset')}
                      </button>
                      <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => duplicateAvatar(activeAvatar)}>
                        <Plus size={12} />
                        {panoramaT('duplicate')}
                      </button>
                      <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => focusAvatar(activeAvatar)}>
                        <ScanLine size={12} />
                        {panoramaT('locate')}
                      </button>
                    </div>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('characterPrompt')}</span>
                      <input
                        value={activeAvatar.characterPrompt || ''}
                        onChange={(event) => patchAvatar(activeAvatar, { characterPrompt: event.target.value })}
                        placeholder={panoramaT('characterPromptPlaceholder')}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      />
                    </label>
                  </section>
                )}

                <section className="space-y-2 rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span>{panoramaT('actionTimeline')}</span>
                    <span className="text-[10px] text-[var(--t8-text-muted)]">{panoramaT('keyframeSequenceCount', { keyframes: avatarKeyframes.length, frames: keyframeSequenceCount })}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_84px_auto] items-end gap-1.5">
                    <div className="rounded-md bg-[var(--t8-bg-panel)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
                      {panoramaT('directorKeyframeHint')}
                    </div>
                    <label className="min-w-0">
                      <span className="mb-0.5 block text-[9px] font-bold text-[var(--t8-text-muted)]">{panoramaT('sequenceFrames')}</span>
                      <input
                        type="number"
                        min={2}
                        max={48}
                        value={keyframeSequenceDraft}
                        onChange={(event) => updateKeyframeSequenceDraft(event.target.value)}
                        onBlur={commitKeyframeSequenceDraft}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitKeyframeSequenceDraft();
                            event.currentTarget.blur();
                          }
                        }}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-1.5 py-1 text-center text-[10px] text-[var(--t8-text-main)] outline-none"
                      />
                    </label>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={saveAvatarKeyframe} disabled={!activeAvatar}>
                      <Plus size={12} />
                      {panoramaT('record')}
                    </button>
                  </div>
                  {avatarKeyframes.length > 0 ? (
                    <div className="space-y-1">
                      {avatarKeyframes.map((frame) => (
                        <div key={frame.id} className="grid grid-cols-[minmax(0,1fr)_28px_28px] items-center gap-1 rounded-md bg-[var(--t8-bg-panel)] px-1.5 py-1">
                          <button type="button" className="min-w-0 truncate text-left text-[10px] text-[var(--t8-text-main)]" onClick={() => applyAvatarKeyframe(frame)}>
                            {frame.label} · {frame.time.toFixed(1)}s · {frame.avatarName} · {poseDisplayLabel(frame.poseId)}
                          </button>
                          <button type="button" className="t8-mini-icon-button" onClick={() => applyAvatarKeyframe(frame)} title={panoramaT('applyKeyframe')}>
                            <ScanLine size={12} />
                          </button>
                          <button type="button" className="t8-mini-icon-button" onClick={() => removeAvatarKeyframe(frame)} title={panoramaT('deleteKeyframe')}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--t8-border)] px-3 py-3 text-center text-xs text-[var(--t8-text-muted)]">{panoramaT('noKeyframes')}</div>
                  )}
                </section>

                <section className="space-y-2 rounded-md border border-sky-300/35 bg-sky-400/10 p-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span>{panoramaT('occlusionReference')}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" className={`t8-mini-icon-button ${occlusionMaskVisible ? 'is-active' : ''}`} onClick={() => update({ panoramaOcclusionMaskVisible: !occlusionMaskVisible })} title={panoramaT('toggleOcclusionReference')}>
                        {occlusionMaskVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button type="button" className="t8-btn h-7 px-2 text-[10px]" onClick={addOcclusionMask}>
                        <Plus size={12} />
                        {panoramaT('add')}
                      </button>
                    </div>
                  </div>
                  {occlusionMasks.length > 0 ? (
                    <div className="space-y-1.5">
                      {occlusionMasks.map((mask) => (
                        <div
                          key={mask.id}
                          className={`space-y-1 rounded-md border bg-[var(--t8-bg-panel)] p-1.5 ${activeOcclusionMaskId === mask.id ? 'border-[var(--t8-accent)] shadow-[0_0_0_1px_var(--t8-accent)]' : 'border-[var(--t8-border)]'}`}
                          onMouseDown={() => setActiveOcclusionMaskId(mask.id)}
                        >
                          <div className="grid grid-cols-[1fr_28px] gap-1">
                            <input value={mask.label} onChange={(event) => patchOcclusionMask(mask, { label: event.target.value })} className="min-w-0 rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none" />
                            <button type="button" className="t8-mini-icon-button" onClick={() => removeOcclusionMask(mask)} title={panoramaT('deleteOcclusionArea')}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            {([
                              ['X', 'x', 0, 96],
                              ['Y', 'y', 0, 96],
                              ['宽', 'w', 4, 100],
                              ['高', 'h', 4, 100],
                              ['强', 'strength', 0, 100],
                            ] as Array<[string, keyof PanoramaOcclusionMask, number, number]>).map(([label, keyName, min, max]) => (
                              <label key={keyName} className="min-w-0">
                                <span className="mb-0.5 block text-[9px] font-bold text-[var(--t8-text-muted)]">{stableDisplayLabel('maskControls', String(keyName), label)} {Math.round(Number(mask[keyName]) || 0)}</span>
                                <input type="range" min={min} max={max} value={Number(mask[keyName]) || 0} onChange={(event) => patchOcclusionMask(mask, { [keyName]: Number(event.target.value) } as Partial<PanoramaOcclusionMask>)} className="w-full" />
                              </label>
                            ))}
                          </div>
                          <input value={mask.note || ''} onChange={(event) => patchOcclusionMask(mask, { note: event.target.value })} placeholder={panoramaT('occlusionNotePlaceholder')} className="w-full rounded border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-1.5 py-1 text-[10px] text-[var(--t8-text-main)] outline-none" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-sky-200/30 px-3 py-3 text-center text-xs text-[var(--t8-text-muted)]">{panoramaT('noOcclusionAreas')}</div>
                  )}
                </section>

                <section className="space-y-2 rounded-md border border-amber-300/35 bg-amber-400/10 p-2">
                  <div className="text-xs font-bold">{panoramaT('directorShot')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('snapshotMode')}</span>
                      <select
                        value={effectiveShotCamera.mode}
                        onChange={(event) => patchShotCamera({ mode: event.target.value === 'shot-camera' ? 'shot-camera' : 'panorama-view', targetAvatarId: effectiveShotCamera.targetAvatarId || activeAvatar?.id || avatars[0]?.id || '' })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        <option value="panorama-view">{panoramaT('currentView')}</option>
                        <option value="shot-camera">{panoramaT('directorShot')}</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('shotPreset')}</span>
                      <select
                        value={effectiveShotCamera.presetId}
                        onChange={(event) => changeShotPreset(event.target.value)}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        {PANORAMA_SHOT_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>{shotPresetDisplayLabel(preset.id)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('targetAvatar')}</span>
                      <select
                        value={effectiveShotCamera.targetAvatarId}
                        onChange={(event) => patchShotCamera({ mode: 'shot-camera', targetAvatarId: event.target.value })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        {avatars.length === 0 && <option value="">{panoramaT('noAvatars')}</option>}
                        {avatars.map((avatar, index) => (
                          <option key={avatar.id} value={avatar.id}>{index + 1}. {avatar.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('bodyPart')}</span>
                      <select
                        value={effectiveShotCamera.targetBone}
                        onChange={(event) => patchShotCamera({ mode: 'shot-camera', targetBone: event.target.value as PanoramaShotCamera['targetBone'] })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        {PANORAMA_SHOT_TARGET_BONES.map((bone) => (
                          <option key={bone.id} value={bone.id}>{shotTargetDisplayLabel(bone.id)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('shotAspect')}</span>
                      <select
                        value={effectiveShotCamera.framingRatio}
                        onChange={(event) => patchShotCamera({ mode: 'shot-camera', framingRatio: event.target.value as PanoramaCompositionGuideId })}
                        className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none"
                      >
                        {PANORAMA_COMPOSITION_GUIDES.filter((item) => item.id !== 'off').map((item) => (
                          <option key={item.id} value={item.id}>{compositionGuideDisplayLabel(item.id, item.label)}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('closeupValue', { value: Math.round(effectiveShotCamera.closeupStrength) })}</span>
                      <input type="range" min={0} max={100} value={effectiveShotCamera.closeupStrength} onChange={(event) => patchShotCamera({ mode: 'shot-camera', closeupStrength: Number(event.target.value) })} className="w-full" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('lowAngleValue', { value: Math.round(effectiveShotCamera.lowAngle) })}</span>
                      <input type="range" min={0} max={100} value={effectiveShotCamera.lowAngle} onChange={(event) => patchShotCamera({ mode: 'shot-camera', lowAngle: Number(event.target.value) })} className="w-full" />
                    </label>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={applyDirectorShotView} disabled={avatars.length === 0}>
                      <Camera size={13} />
                      {panoramaT('apply')}
                    </button>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('compositionSafeArea')}</span>
                      <select value={compositionGuide} onChange={(event) => update({ panoramaCompositionGuide: event.target.value })} className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none">
                        {PANORAMA_COMPOSITION_GUIDES.map((item) => (
                          <option key={item.id} value={item.id}>{compositionGuideDisplayLabel(item.id, item.label)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-bold text-[var(--t8-text-muted)]">{panoramaT('snapshotLegend')}</span>
                      <select value={sceneLegendVisible ? '1' : '0'} onChange={(event) => update({ panoramaSceneLegendVisible: event.target.value === '1' })} className="w-full rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] px-2 py-1.5 text-xs text-[var(--t8-text-main)] outline-none">
                        <option value="1">{panoramaT('show')}</option>
                        <option value="0">{panoramaT('hide')}</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => requestPanoramaRun('scene-snapshot')} disabled={textureStatus !== 'ready' || isGenerating} title={panoramaT('exportSceneSnapshotTitle')}>
                      <ImageIcon size={12} />
                      {panoramaT('snapshot')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={() => requestPanoramaRun('control-snapshot')} disabled={textureStatus !== 'ready' || isGenerating}>
                      <ScanLine size={12} />
                      {panoramaT('controlImage')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={copyScenePrompt} disabled={!scenePrompt}>
                      <Copy size={12} />
                      {panoramaT('scenePrompt')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={sendSceneSnapshot} disabled={!outputUrl && !d.panoramaSceneSnapshot?.snapshotUrl}>
                      <PackagePlus size={12} />
                      {panoramaT('send')}
                    </button>
                    <button type="button" className="t8-btn h-8 px-2 text-[10px]" onClick={saveSceneSnapshotResource} disabled={sceneResourceState === '保存中' || (!outputUrl && !d.panoramaSceneSnapshot?.snapshotUrl)}>
                      <PackagePlus size={12} />
                      {panoramaT('saveToLibrary')}
                    </button>
                  </div>
                  {scenePrompt && (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--t8-border)] bg-[var(--t8-bg-panel-muted)] p-2 text-[10px] leading-relaxed text-[var(--t8-text-muted)]">
                      {scenePrompt}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    ) : null}
    </>
  );
};

export default memo(Panorama3DNode);
