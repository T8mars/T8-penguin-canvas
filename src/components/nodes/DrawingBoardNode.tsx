import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  ChevronDown,
  ChevronRight,
  Diamond,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FolderPlus,
  HelpCircle,
  ImagePlus,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  PanelTop,
  PenLine,
  PenTool,
  Pencil,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  Send,
  Trash2,
  Type,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PORT_COLOR } from '../../config/portTypes';
import { uploadDataUrl, uploadFileBlob } from '../../services/imageOps';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import {
  createSecondaryProviderActionForNode,
  executeRegisteredSecondaryProviderAction,
  registerSecondaryProviderActionExecutor,
  requestCanvasSecondaryProviderAction,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  type QueueSecondaryProviderAction,
  type SecondaryProviderActionExecution,
} from '../../utils/secondaryProviderAction';
import { executeRhImageEditorCutoutAction } from '../../utils/rhImageEditorCutout';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import {
  boardPointToImageFraction,
  closeCutoutPath,
  distanceBetween,
  isValidCutoutPath,
  simplifyCutoutPath,
} from '../../utils/drawingBoardCutout';
import {
  boardPointFromClientPoint,
  clampBoardZoom,
  fitBoardViewport,
  zoomBoardViewport,
} from '../../utils/drawingBoardViewport';
import {
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  clampBoardDimension,
  fitImageToBoard,
  originalPixelImagePlacement,
} from '../../utils/drawingBoardSizing';

type BoardTool = 'select' | 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'round-rect' | 'circle' | 'diamond' | 'cutout-lasso' | 'cutout-pen';
type BoardFillMode = 'stroke' | 'fill';
type BoardRatio = 'free' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

interface Point {
  x: number;
  y: number;
}

interface ImageElement {
  id: string;
  kind: 'image';
  url: string;
  name?: string;
  naturalW?: number;
  naturalH?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
}

interface PathElement {
  id: string;
  kind: 'path';
  points: Point[];
  color: string;
  size: number;
}

interface TextElement {
  id: string;
  kind: 'text';
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

interface ShapeElement {
  id: string;
  kind: 'line' | 'arrow' | 'rect' | 'round-rect' | 'circle' | 'diamond';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  size: number;
  fillMode?: BoardFillMode;
  rotation?: number;
}

interface CutoutDraft {
  mode: 'lasso' | 'pen';
  sourceLayerId: string;
  sourceElementId: string;
  points: Point[];
  closed: boolean;
}

type BoardElement = ImageElement | PathElement | TextElement | ShapeElement;
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type BoxElement = ImageElement | ShapeElement;

interface BoardLayer {
  id: string;
  kind: 'layer' | 'group';
  name: string;
  hidden?: boolean;
  locked?: boolean;
  collapsed?: boolean;
  groupId?: string | null;
  elements: BoardElement[];
}

type BoardAction = { recorded?: boolean } & (
  | { type: 'draw'; layerId: string; id: string }
  | { type: 'shape'; layerId: string; id: string }
  | { type: 'move'; layerId: string; id: string; start: Point; originals: BoardElement[] }
  | { type: 'resize'; layerId: string; id: string; corner: ResizeCorner; keepAspect: boolean; original: BoardElement }
  | { type: 'rotate'; layerId: string; id: string; center: Point; startAngle: number; originalRotation: number }
);

const NODE_W = 1120;
const NODE_H = 760;
const CONTROL_W = 330;
const DEFAULT_BOARD_W = 960;
const DEFAULT_BOARD_H = 540;

const RATIO_SIZE: Record<Exclude<BoardRatio, 'free'>, { w: number; h: number }> = {
  '1:1': { w: 900, h: 900 },
  '16:9': { w: 960, h: 540 },
  '9:16': { w: 540, h: 960 },
  '4:3': { w: 960, h: 720 },
  '3:4': { w: 720, h: 960 },
};

const TOOL_LABEL: Record<BoardTool, string> = {
  select: '选择',
  pen: '画笔',
  eraser: '擦除',
  text: '文字',
  line: '直线',
  arrow: '箭头',
  rect: '矩形',
  'round-rect': '圆角矩形',
  circle: '圆形',
  diamond: '菱形',
  'cutout-lasso': '套索',
  'cutout-pen': '钢笔',
};

const TOOL_SHORTCUTS: Array<{ tool: BoardTool; shortcut: string; key: string; shiftKey?: boolean }> = [
  { tool: 'select', shortcut: 'S', key: 's' },
  { tool: 'text', shortcut: 'T', key: 't' },
  { tool: 'eraser', shortcut: 'E', key: 'e' },
  { tool: 'pen', shortcut: 'B', key: 'b' },
  { tool: 'line', shortcut: 'I', key: 'i' },
  { tool: 'arrow', shortcut: 'A', key: 'a' },
  { tool: 'diamond', shortcut: 'D', key: 'd' },
  { tool: 'cutout-pen', shortcut: 'P', key: 'p' },
  { tool: 'cutout-lasso', shortcut: 'L', key: 'l' },
  { tool: 'circle', shortcut: 'R', key: 'r' },
  { tool: 'rect', shortcut: 'Shift+S', key: 's', shiftKey: true },
];

const TOOL_SHORTCUT_BY_TOOL = TOOL_SHORTCUTS.reduce<Partial<Record<BoardTool, string>>>((acc, item) => {
  acc[item.tool] = item.shortcut;
  return acc;
}, {});

function toolShortcutFor(value: BoardTool) {
  return TOOL_SHORTCUT_BY_TOOL[value] || '';
}

function toolFromShortcutEvent(event: Pick<KeyboardEvent | ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): BoardTool | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  const item = TOOL_SHORTCUTS.find((candidate) => candidate.key === key && (!!candidate.shiftKey === !!event.shiftKey));
  return item?.tool || null;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function isCutoutTool(value: BoardTool) {
  return value === 'cutout-lasso' || value === 'cutout-pen';
}

const BOARD_SHAPE_KINDS = ['line', 'arrow', 'rect', 'round-rect', 'circle', 'diamond'] as const;

type BoardShapeKind = (typeof BOARD_SHAPE_KINDS)[number];

function isBoardShapeKind(value: unknown): value is BoardShapeKind {
  return typeof value === 'string' && BOARD_SHAPE_KINDS.includes(value as BoardShapeKind);
}

function isShapeElement(el: BoardElement): el is ShapeElement {
  return isBoardShapeKind(el.kind);
}

function createBlankLayer(index = 1, groupId: string | null = null): BoardLayer {
  return {
    id: uid('layer'),
    kind: 'layer',
    name: `图层 ${index}`,
    groupId,
    elements: [],
  };
}

function createGroup(index = 1): BoardLayer {
  return {
    id: uid('group'),
    kind: 'group',
    name: `组 ${index}`,
    elements: [],
  };
}

function normalizeElements(value: unknown): BoardElement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any): BoardElement | null => {
      if (!item || typeof item !== 'object') return null;
      const id = typeof item.id === 'string' ? item.id : uid('el');
      if (item.kind === 'image' && typeof item.url === 'string') {
        return {
          id,
          kind: 'image',
          url: item.url,
          name: typeof item.name === 'string' ? item.name : undefined,
          naturalW: Number.isFinite(Number(item.naturalW)) && Number(item.naturalW) > 0 ? Math.round(Number(item.naturalW)) : undefined,
          naturalH: Number.isFinite(Number(item.naturalH)) && Number(item.naturalH) > 0 ? Math.round(Number(item.naturalH)) : undefined,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          w: Math.max(20, Number(item.w) || 320),
          h: Math.max(20, Number(item.h) || 180),
          rotation: Number.isFinite(Number(item.rotation)) ? Number(item.rotation) : 0,
          opacity: Number.isFinite(Number(item.opacity)) ? clamp(Number(item.opacity), 0.05, 1) : 1,
        };
      }
      if (item.kind === 'path' && Array.isArray(item.points)) {
        const points = item.points
          .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
          .filter((p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (points.length < 1) return null;
        return {
          id,
          kind: 'path',
          points,
          color: typeof item.color === 'string' ? item.color : '#111827',
          size: Math.max(1, Number(item.size) || 4),
        };
      }
      if (item.kind === 'text' && typeof item.text === 'string') {
        return {
          id,
          kind: 'text',
          text: item.text,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          color: typeof item.color === 'string' ? item.color : '#111827',
          size: Math.max(10, Number(item.size) || 32),
        };
      }
      if (isBoardShapeKind(item.kind)) {
        return {
          id,
          kind: item.kind,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          w: Number(item.w) || 120,
          h: Number(item.h) || 80,
          color: typeof item.color === 'string' ? item.color : '#fb923c',
          size: Math.max(1, Number(item.size) || 5),
          fillMode: item.fillMode === 'fill' ? 'fill' : 'stroke',
          rotation: Number.isFinite(Number(item.rotation)) ? Number(item.rotation) : 0,
        } as ShapeElement;
      }
      return null;
    })
    .filter(Boolean) as BoardElement[];
}

function normalizeLayers(value: unknown, legacyElements: unknown): BoardLayer[] {
  if (Array.isArray(value)) {
    const layers = value
      .map((item: any): BoardLayer | null => {
        if (!item || typeof item !== 'object') return null;
        const kind = item.kind === 'group' ? 'group' : 'layer';
        const id = typeof item.id === 'string' ? item.id : uid(kind);
        return {
          id,
          kind,
          name: typeof item.name === 'string' && item.name.trim() ? item.name : kind === 'group' ? '组' : '图层',
          hidden: !!item.hidden,
          locked: !!item.locked,
          collapsed: !!item.collapsed,
          groupId: typeof item.groupId === 'string' ? item.groupId : null,
          elements: kind === 'layer' ? normalizeElements(item.elements) : [],
        };
      })
      .filter(Boolean) as BoardLayer[];
    if (layers.some((l) => l.kind === 'layer')) return layers;
  }
  const migrated = normalizeElements(legacyElements);
  if (migrated.length > 0) {
    return [{ ...createBlankLayer(1), name: '迁移图层', elements: migrated }];
  }
  return [createBlankLayer(1)];
}

function flattenElements(layers: BoardLayer[]): BoardElement[] {
  return layers.flatMap((layer) => (layer.kind === 'layer' ? layer.elements : []));
}

function firstEditableLayerId(layers: BoardLayer[]) {
  return layers.find((layer) => layer.kind === 'layer')?.id || '';
}

function elementCount(layers: BoardLayer[]) {
  return flattenElements(layers).length;
}

function isGroupHidden(layers: BoardLayer[], groupId?: string | null): boolean {
  if (!groupId) return false;
  const group = layers.find((layer) => layer.id === groupId && layer.kind === 'group');
  return !!group?.hidden;
}

function isGroupLocked(layers: BoardLayer[], groupId?: string | null): boolean {
  if (!groupId) return false;
  const group = layers.find((layer) => layer.id === groupId && layer.kind === 'group');
  return !!group?.locked;
}

function isLayerVisible(layers: BoardLayer[], layer: BoardLayer) {
  return layer.kind === 'layer' && !layer.hidden && !isGroupHidden(layers, layer.groupId);
}

function isLayerEditable(layers: BoardLayer[], layer: BoardLayer | undefined) {
  return !!layer && layer.kind === 'layer' && !layer.hidden && !isGroupHidden(layers, layer.groupId) && !layer.locked && !isGroupLocked(layers, layer.groupId);
}

function isLayerFoldedInList(layers: BoardLayer[], layer: BoardLayer) {
  if (layer.kind !== 'layer' || !layer.groupId) return false;
  const group = layers.find((item) => item.id === layer.groupId && item.kind === 'group');
  return !!group?.collapsed;
}

function boundsOf(el: BoardElement) {
  if (el.kind === 'path') {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    const pad = Math.max(8, el.size);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      x: minX,
      y: minY,
      w: Math.max(12, Math.max(...xs) - Math.min(...xs) + pad * 2),
      h: Math.max(12, Math.max(...ys) - Math.min(...ys) + pad * 2),
    };
  }
  if (el.kind === 'text') {
    const lines = el.text.split(/\r?\n/);
    const maxLine = Math.max(...lines.map((line) => line.length), 1);
    return { x: el.x, y: el.y - el.size, w: Math.max(80, maxLine * el.size * 0.62), h: el.size * 1.35 * lines.length };
  }
  return {
    x: Math.min(el.x, el.x + el.w),
    y: Math.min(el.y, el.y + el.h),
    w: Math.abs(el.w),
    h: Math.abs(el.h),
  };
}

function pointInBounds(p: Point, b: { x: number; y: number; w: number; h: number }, pad = 0) {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

function isBoxElement(el: BoardElement): el is BoxElement {
  return el.kind === 'image' || isShapeElement(el);
}

function rotationOf(el: BoardElement) {
  return isBoxElement(el) && Number.isFinite(Number(el.rotation)) ? Number(el.rotation) : 0;
}

function centerOfBounds(b: { x: number; y: number; w: number; h: number }): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function rotatePoint(p: Point, center: Point, degrees: number): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function localPointForElement(p: Point, el: BoardElement): Point {
  const rotation = rotationOf(el);
  if (!rotation) return p;
  return rotatePoint(p, centerOfBounds(boundsOf(el)), -rotation);
}

function pointInElement(p: Point, el: BoardElement, pad = 0) {
  return pointInBounds(localPointForElement(p, el), boundsOf(el), pad);
}

const RESIZE_POINTS: Record<ResizeCorner, (b: { x: number; y: number; w: number; h: number }) => Point> = {
  nw: (b) => ({ x: b.x, y: b.y }),
  ne: (b) => ({ x: b.x + b.w, y: b.y }),
  sw: (b) => ({ x: b.x, y: b.y + b.h }),
  se: (b) => ({ x: b.x + b.w, y: b.y + b.h }),
};

function resizeCornerAt(p: Point, el: BoardElement): ResizeCorner | null {
  if (!isBoxElement(el)) return null;
  const b = boundsOf(el);
  const local = localPointForElement(p, el);
  const hit = Math.max(14, Math.min(24, Math.min(b.w, b.h) * 0.12));
  const corners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
  return corners.find((corner) => {
    const handle = RESIZE_POINTS[corner](b);
    return Math.abs(local.x - handle.x) <= hit && Math.abs(local.y - handle.y) <= hit;
  }) || null;
}

function isRotateHandleHit(p: Point, el: BoardElement) {
  if (!isBoxElement(el)) return false;
  const b = boundsOf(el);
  const local = localPointForElement(p, el);
  const handle = { x: b.x + b.w / 2, y: b.y - 34 };
  return Math.hypot(local.x - handle.x, local.y - handle.y) <= 18;
}

function resizeBoxElement(original: BoardElement, pointer: Point, corner: ResizeCorner, keepAspect: boolean): BoardElement {
  if (!isBoxElement(original)) return original;
  const b = boundsOf(original);
  const local = localPointForElement(pointer, original);
  let left = b.x;
  let right = b.x + b.w;
  let top = b.y;
  let bottom = b.y + b.h;
  const min = 20;

  if (corner.includes('w')) left = Math.min(local.x, right - min);
  if (corner.includes('e')) right = Math.max(local.x, left + min);
  if (corner.includes('n')) top = Math.min(local.y, bottom - min);
  if (corner.includes('s')) bottom = Math.max(local.y, top + min);

  if (keepAspect && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    let width = Math.max(min, right - left);
    let height = Math.max(min, bottom - top);
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;

    if (corner === 'se') {
      right = left + width;
      bottom = top + height;
    } else if (corner === 'sw') {
      left = right - width;
      bottom = top + height;
    } else if (corner === 'ne') {
      right = left + width;
      top = bottom - height;
    } else {
      left = right - width;
      top = bottom - height;
    }
  }

  return {
    ...original,
    x: left,
    y: top,
    w: Math.max(min, right - left),
    h: Math.max(min, bottom - top),
  } as BoardElement;
}

function normalizeShape(el: BoardElement): BoardElement {
  if (el.kind !== 'image' && (!isBoardShapeKind(el.kind) || el.kind === 'line' || el.kind === 'arrow')) return el;
  const shape = el as ImageElement | ShapeElement;
  if (shape.w >= 0 && shape.h >= 0) return el;
  return {
    ...shape,
    x: Math.min(shape.x, shape.x + shape.w),
    y: Math.min(shape.y, shape.y + shape.h),
    w: Math.abs(shape.w),
    h: Math.abs(shape.h),
  } as BoardElement;
}

function isDegenerateShapeElement(el: BoardElement) {
  if (el.kind === 'line' || el.kind === 'arrow') return Math.hypot(el.w, el.h) < 8;
  if (el.kind === 'rect' || el.kind === 'round-rect' || el.kind === 'circle' || el.kind === 'diamond') return Math.abs(el.w) < 8 || Math.abs(el.h) < 8;
  return false;
}

function boardShapeDragSize(start: Point, end: Point, kind: ShapeElement['kind'], lockAspect: boolean) {
  const w = end.x - start.x;
  const h = end.y - start.y;
  if (!lockAspect || kind === 'line' || kind === 'arrow') return { w, h };
  const side = Math.max(Math.abs(w), Math.abs(h));
  return {
    w: (w < 0 ? -1 : 1) * side,
    h: (h < 0 ? -1 : 1) * side,
  };
}

function boardArrowHeadLength(size: number) {
  return Math.max(12, size * 3.2);
}

function arrowLineEndBeforeHead(start: Point, end: Point, size: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return end;
  const inset = Math.min(length, boardArrowHeadLength(size) * 0.82);
  return {
    x: end.x - (dx / length) * inset,
    y: end.y - (dy / length) * inset,
  };
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const len = boardArrowHeadLength(size);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - len * Math.cos(angle - Math.PI / 6), to.y - len * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - len * Math.cos(angle + Math.PI / 6), to.y - len * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawBoardRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(Math.abs(w) / 2, Math.abs(h) / 2, Math.max(0, radius));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBoardDiamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
}

function drawBoardShapePath(ctx: CanvasRenderingContext2D, el: ShapeElement, b: { w: number; h: number }) {
  const x = -b.w / 2;
  const y = -b.h / 2;
  if (el.kind === 'round-rect') {
    drawBoardRoundedRectPath(ctx, x, y, b.w, b.h, Math.min(b.w, b.h) * 0.18);
    return;
  }
  if (el.kind === 'circle') {
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2);
    return;
  }
  if (el.kind === 'diamond') {
    drawBoardDiamondPath(ctx, x, y, b.w, b.h);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, b.w, b.h);
}

function labelForElement(el: BoardElement) {
  if (el.kind === 'image') return el.name || '图片元素';
  if (el.kind === 'path') return '笔迹元素';
  if (el.kind === 'text') return el.text.slice(0, 18) || '文字元素';
  if (el.kind === 'line') return '直线元素';
  if (el.kind === 'arrow') return '箭头元素';
  if (el.kind === 'rect') return '矩形元素';
  if (el.kind === 'round-rect') return '圆角矩形元素';
  if (el.kind === 'circle') return '圆形元素';
  return '菱形元素';
}

function isEditableEventTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

function isUndoShortcutEvent(event: Pick<KeyboardEvent | ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
}

function isRedoShortcutEvent(event: Pick<KeyboardEvent | ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  const key = event.key.toLowerCase();
  return (event.ctrlKey || event.metaKey) && ((key === 'z' && event.shiftKey) || key === 'y');
}

function isBoardRatio(value: unknown): value is BoardRatio {
  return value === 'free' || value === '1:1' || value === '16:9' || value === '9:16' || value === '4:3' || value === '3:4';
}

function cloneBoardLayers(layers: BoardLayer[]): BoardLayer[] {
  return layers.map((layer) => ({
    ...layer,
    elements: layer.elements.map((el) => (
      el.kind === 'path'
        ? { ...el, points: el.points.map((point) => ({ ...point })) }
        : { ...el }
    )),
  }));
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

const DrawingBoardNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate } = useTranslation(['nodes', 'common']);
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const upstream = useUpstreamMaterials(id);
  const rf = useReactFlow();
  const d = (data as any) || {};
  const initialLayersRef = useRef<BoardLayer[] | null>(null);
  if (!initialLayersRef.current) initialLayersRef.current = normalizeLayers(d.boardLayers, d.boardElements);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusOverlayRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const boardJsonInputRef = useRef<HTMLInputElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const autoImportSigRef = useRef('');
  const actionRef = useRef<BoardAction | null>(null);
  const cutoutDragRef = useRef<{ pointerId: number; sourceLayerId: string; sourceElementId: string } | null>(null);
  const historyRef = useRef<BoardLayer[][]>([]);
  const futureRef = useRef<BoardLayer[][]>([]);
  const textEditHistoryRef = useRef<string | null>(null);
  const editorSessionIdRef = useRef('');
  if (!editorSessionIdRef.current) {
    editorSessionIdRef.current = createCanvasNodeRunRequestId(id, 'drawing-board-editor');
  }

  const [layers, setLayers] = useState<BoardLayer[]>(() => initialLayersRef.current || [createBlankLayer(1)]);
  const [activeLayerId, setActiveLayerId] = useState<string>(() => {
    const initial = initialLayersRef.current || [];
    const saved = typeof d.activeBoardLayerId === 'string' ? d.activeBoardLayerId : '';
    return initial.some((layer) => layer.id === saved && layer.kind === 'layer') ? saved : firstEditableLayerId(initial);
  });
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [tool, setTool] = useState<BoardTool>('select');
  const [ratio, setRatio] = useState<BoardRatio>((d.boardRatio as BoardRatio) || '16:9');
  const [boardW, setBoardW] = useState(clampBoardDimension(Number(d.boardWidth), DEFAULT_BOARD_W));
  const [boardH, setBoardH] = useState(clampBoardDimension(Number(d.boardHeight), DEFAULT_BOARD_H));
  const [boardWDraft, setBoardWDraft] = useState(() => String(clampBoardDimension(Number(d.boardWidth), DEFAULT_BOARD_W)));
  const [boardHDraft, setBoardHDraft] = useState(() => String(clampBoardDimension(Number(d.boardHeight), DEFAULT_BOARD_H)));
  const [strokeColor, setStrokeColor] = useState(typeof d.boardColor === 'string' ? d.boardColor : '#111827');
  const [strokeSize, setStrokeSize] = useState(Math.max(1, Number(d.boardStrokeSize) || 5));
  const [boardFillMode, setBoardFillMode] = useState<BoardFillMode>(d.boardFillMode === 'fill' ? 'fill' : 'stroke');
  const [textDraft, setTextDraft] = useState(typeof d.boardTextDraft === 'string' ? d.boardTextDraft : '文字');
  const [cutoutDraft, setCutoutDraft] = useState<CutoutDraft | null>(null);
  const [cutoutSmooth, setCutoutSmooth] = useState(Math.max(0, Number(d.boardCutoutSmooth) || 2));
  const [cutoutFeather, setCutoutFeather] = useState(Math.max(0, Number(d.boardCutoutFeather) || 0));
  const [cutoutInvert, setCutoutInvert] = useState(false);
  const [focusEditorOpen, setFocusEditorOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [selectedTextEditorOpen, setSelectedTextEditorOpen] = useState(false);
  const [focusZoom, setFocusZoom] = useState<'fit' | number>('fit');
  const [windowSize, setWindowSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 820,
  }));
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>((d.status as any) || 'idle');
  const [error, setError] = useState<string | null>(typeof d.error === 'string' ? d.error : null);
  const [rhCutoutRunning, setRhCutoutRunning] = useState(false);
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const queueSecondaryAction = useCallback<QueueSecondaryProviderAction>((draft) => {
    const action = createSecondaryProviderActionForNode(id, 'drawing-board', draft);
    update(secondaryProviderActionNodePatch(action));
    queueMicrotask(() => {
      if (!requestCanvasSecondaryProviderAction(action)) {
        const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
        if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
        setError('无法请求画板 RH 抠图运行体检');
      }
    });
    return action;
  }, [id, rf, update]);

  const activeLayer = useMemo(() => layers.find((layer) => layer.id === activeLayerId && layer.kind === 'layer'), [activeLayerId, layers]);
  const activeLayerWritable = useMemo(() => isLayerEditable(layers, activeLayer), [activeLayer, layers]);
  const renderableLayers = useMemo(() => layers.filter((layer) => isLayerVisible(layers, layer)), [layers]);
  const hasBoardImages = useMemo(() => flattenElements(layers).some((el) => el.kind === 'image'), [layers]);
  const selectedElement = useMemo(() => {
    if (!selectedElementId) return null;
    for (const layer of layers) {
      if (layer.kind !== 'layer') continue;
      const found = layer.elements.find((el) => el.id === selectedElementId);
      if (found) return { layer, element: found };
    }
    return null;
  }, [layers, selectedElementId]);
  const selectedCutoutSource = useMemo(() => {
    if (!selectedElement || selectedElement.element.kind !== 'image') return null;
    if (!isLayerEditable(layers, selectedElement.layer)) return null;
    return selectedElement as { layer: BoardLayer; element: ImageElement };
  }, [layers, selectedElement]);
  const applyTool = useCallback((value: BoardTool) => {
    actionRef.current = null;
    cutoutDragRef.current = null;
    setTool(value);
    if (!isCutoutTool(value)) setCutoutDraft(null);
  }, []);
  const applyBoardFillMode = useCallback((next: BoardFillMode) => {
    setBoardFillMode(next);
    update({ boardFillMode: next });
  }, [update]);
  const boardHasKeyboardFocus = useCallback(() => {
    const root = rootRef.current;
    const focusOverlay = focusOverlayRef.current;
    const active = document.activeElement;
    return !!active && active instanceof globalThis.Node && (!!root?.contains(active) || !!focusOverlay?.contains(active));
  }, []);
  const hasUpstreamImages = upstream.images.length > 0;
  const previewSize = useMemo(() => {
    const maxW = NODE_W - CONTROL_W - 72;
    const maxH = NODE_H - 210;
    return fitBoardViewport({ boardW, boardH, maxW, maxH });
  }, [boardH, boardW]);
  const focusFitSize = useMemo(() => (
    fitBoardViewport({
      boardW,
      boardH,
      maxW: Math.max(360, windowSize.w - 430),
      maxH: Math.max(260, windowSize.h - 190),
    })
  ), [boardH, boardW, windowSize]);
  const focusStageSize = useMemo(() => (
    focusZoom === 'fit' ? focusFitSize : zoomBoardViewport({ boardW, boardH, zoom: focusZoom })
  ), [boardH, boardW, focusFitSize, focusZoom]);
  const focusZoomPercent = Math.round((focusStageSize.scale || 1) * 100);

  const persistLayers = useCallback(
    (next: BoardLayer[]) => {
      const safeNext = next.some((layer) => layer.kind === 'layer') ? next : [createBlankLayer(1)];
      update({ boardLayers: safeNext, boardElements: flattenElements(safeNext) });
      return safeNext;
    },
    [update],
  );

  const patchLayers = useCallback(
    (updater: BoardLayer[] | ((prev: BoardLayer[]) => BoardLayer[])) => {
      setLayers((prev) => {
        const proposed = typeof updater === 'function' ? (updater as (p: BoardLayer[]) => BoardLayer[])(prev) : updater;
        return persistLayers(proposed);
      });
    },
    [persistLayers],
  );

  const pushHistorySnapshot = useCallback((snapshot: BoardLayer[] = layers) => {
    historyRef.current = [...historyRef.current.slice(-59), cloneBoardLayers(snapshot)];
    futureRef.current = [];
  }, [layers]);

  const restoreLayerSnapshot = useCallback((snapshot: BoardLayer[]) => {
    const next = persistLayers(cloneBoardLayers(snapshot));
    setLayers(next);
    const selectedStillExists = selectedElementId
      ? next.some((layer) => layer.kind === 'layer' && layer.elements.some((el) => el.id === selectedElementId))
      : false;
    if (!selectedStillExists) setSelectedElementId(null);
    const activeStillExists = next.some((layer) => layer.id === activeLayerId && layer.kind === 'layer');
    if (!activeStillExists) setActiveLayerId(firstEditableLayerId(next));
  }, [activeLayerId, persistLayers, selectedElementId]);

  const undoBoardHistory = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return false;
    futureRef.current = [...futureRef.current.slice(-59), cloneBoardLayers(layers)];
    restoreLayerSnapshot(previous);
    actionRef.current = null;
    return true;
  }, [layers, restoreLayerSnapshot]);

  const redoBoardHistory = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return false;
    historyRef.current = [...historyRef.current.slice(-59), cloneBoardLayers(layers)];
    restoreLayerSnapshot(next);
    actionRef.current = null;
    return true;
  }, [layers, restoreLayerSnapshot]);

  useEffect(() => {
    if (layers.some((layer) => layer.id === activeLayerId && layer.kind === 'layer')) return;
    const nextActive = firstEditableLayerId(layers);
    if (nextActive) setActiveLayerId(nextActive);
  }, [activeLayerId, layers]);

  useEffect(() => {
    if (activeLayerId) update({ activeBoardLayerId: activeLayerId });
  }, [activeLayerId, update]);

  useEffect(() => {
    setBoardWDraft(String(boardW));
  }, [boardW]);

  useEffect(() => {
    setBoardHDraft(String(boardH));
  }, [boardH]);

  useEffect(() => {
    textEditHistoryRef.current = null;
  }, [selectedElementId]);

  useEffect(() => {
    if (!focusEditorOpen) return;
    const syncWindowSize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    syncWindowSize();
    window.addEventListener('resize', syncWindowSize);
    window.setTimeout(() => focusOverlayRef.current?.focus(), 0);
    return () => window.removeEventListener('resize', syncWindowSize);
  }, [focusEditorOpen]);

  useEffect(() => {
    const onPointerDownOutside = (event: globalThis.PointerEvent) => {
      const root = rootRef.current;
      const focusOverlay = focusOverlayRef.current;
      const target = event.target;
      if (!root || !(target instanceof globalThis.Node) || root.contains(target) || focusOverlay?.contains(target)) return;
      actionRef.current = null;
      setSelectedElementId(null);
      const active = document.activeElement;
      if (active instanceof globalThis.HTMLElement && root.contains(active)) active.blur();
    };
    document.addEventListener('pointerdown', onPointerDownOutside, true);
    return () => document.removeEventListener('pointerdown', onPointerDownOutside, true);
  }, []);

  const imageForUrl = useCallback((url: string) => {
    let img = imageCacheRef.current.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => forceRender((v) => v + 1);
      img.onerror = () => forceRender((v) => v + 1);
      img.src = url;
      imageCacheRef.current.set(url, img);
    }
    return img;
  }, []);

  const loadImage = useCallback(async (url: string) => {
    const cached = imageCacheRef.current.get(url);
    if (cached?.complete && cached.naturalWidth > 0) return cached;
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = cached || new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCacheRef.current.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`图片加载失败: ${url.split('/').pop() || url}`));
      if (!cached) {
        img.src = url;
        imageCacheRef.current.set(url, img);
      } else if (!img.src) {
        img.src = url;
      }
    });
  }, []);

  const executeAuthorizedEditorCutoutRef = useRef<
    (execution: SecondaryProviderActionExecution) => Promise<void>
  >(async () => undefined);
  executeAuthorizedEditorCutoutRef.current = async ({ action, reporter }) => {
    if (action.actionId !== 'rh-image.editor-cutout' || action.target !== 'editor-cutout') {
      throw new Error('画板 RH 抠图 action 与已注册能力不匹配');
    }
    const params = action.params;
    if (params.surface !== 'drawing-board' || params.editorSessionId !== editorSessionIdRef.current) {
      throw new Error('画板 RH 抠图编辑会话已变化，已停止调用 Provider');
    }

    const resolveBoundTarget = () => {
      const matches: Array<{ layer: BoardLayer; element: ImageElement }> = [];
      for (const layer of layersRef.current) {
        if (layer.kind !== 'layer') continue;
        const element = layer.elements.find(
          (item): item is ImageElement => item.kind === 'image' && item.id === params.targetId,
        );
        if (element) matches.push({ layer, element });
      }
      if (matches.length !== 1) {
        throw new Error('画板 RH 抠图目标已删除或不唯一，已停止调用 Provider');
      }
      const match = matches[0];
      if (!isLayerEditable(layersRef.current, match.layer) || match.element.url !== params.imageUrl) {
        throw new Error('画板 RH 抠图目标或源图已变化，已停止调用 Provider');
      }
      return match;
    };

    setRhCutoutRunning(true);
    setStatus('running');
    setError(null);
    try {
      await executeRhImageEditorCutoutAction(action, reporter, {
        assertTargetCurrent: resolveBoundTarget,
        onProgress: (progress) => {
          if (progress.stage === 'error') setError(progress.message || 'RH 自动抠图处理中发生错误');
        },
        onComplete: async (result) => {
          let resultImage: HTMLImageElement | null = null;
          try {
            resultImage = await loadImage(result.outputUrl);
          } catch {
            // 结果 URL 仍会回写；预览可在后续自然重试。
          }
          const { layer: sourceLayer, element: source } = resolveBoundTarget();
          const naturalW = resultImage
            ? Math.max(1, Math.round(resultImage.naturalWidth || source.naturalW || source.w))
            : source.naturalW;
          const naturalH = resultImage
            ? Math.max(1, Math.round(resultImage.naturalHeight || source.naturalH || source.h))
            : source.naturalH;

          pushHistorySnapshot(layersRef.current);
          patchLayers((prev) => prev.map((layer) => (
            layer.id === sourceLayer.id && layer.kind === 'layer'
              ? {
                  ...layer,
                  elements: layer.elements.map((element) => (
                    element.id === source.id && element.kind === 'image' && element.url === params.imageUrl
                      ? {
                          ...element,
                          url: result.outputUrl,
                          name: `${source.name || '图片'} RH抠图`,
                          naturalW,
                          naturalH,
                        }
                      : element
                  )),
                }
              : layer
          )));
          setActiveLayerId(sourceLayer.id);
          setSelectedElementId(source.id);
          applyTool('select');
          setError(null);
          setStatus('success');
        },
      });
    } catch (error: any) {
      setError(error?.message || 'RH 自动抠图失败');
      setStatus('error');
      throw error;
    } finally {
      setRhCutoutRunning(false);
    }
  };

  useEffect(() => registerSecondaryProviderActionExecutor(
    id,
    'rh-image.editor-cutout',
    'editor-cutout',
    (execution) => executeAuthorizedEditorCutoutRef.current(execution),
  ), [id]);

  const drawElement = useCallback(
    (ctx: CanvasRenderingContext2D, el: BoardElement, includeSelection: boolean) => {
      ctx.save();
      if (el.kind === 'image') {
        const img = imageForUrl(el.url);
        const b = boundsOf(el);
        const center = centerOfBounds(b);
        const rotation = rotationOf(el);
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.translate(center.x, center.y);
        ctx.rotate((rotation * Math.PI) / 180);
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, -b.w / 2, -b.h / 2, b.w, b.h);
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, .18)';
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
          ctx.fillStyle = 'rgba(15, 23, 42, .5)';
          ctx.font = '24px sans-serif';
          ctx.fillText('加载图片...', -b.w / 2 + 18, -b.h / 2 + 40);
        }
      } else if (el.kind === 'path') {
        if (el.points.length > 0) {
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(el.points[0].x, el.points[0].y);
          el.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.stroke();
        }
      } else if (el.kind === 'text') {
        ctx.fillStyle = el.color;
        ctx.font = `600 ${el.size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        el.text.split(/\r?\n/).forEach((line, i) => ctx.fillText(line, el.x, el.y + i * el.size * 1.28));
      } else {
        const b = boundsOf(el);
        const center = centerOfBounds(b);
        const rotation = rotationOf(el);
        const start = { x: el.x - center.x, y: el.y - center.y };
        const end = { x: el.x + el.w - center.x, y: el.y + el.h - center.y };
        ctx.lineWidth = el.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.translate(center.x, center.y);
        ctx.rotate((rotation * Math.PI) / 180);
        if (el.kind === 'line') {
          ctx.strokeStyle = el.color;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        } else if (el.kind === 'arrow') {
          const lineEnd = arrowLineEndBeforeHead(start, end, el.size);
          ctx.strokeStyle = el.color;
          ctx.fillStyle = el.color;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(lineEnd.x, lineEnd.y);
          ctx.stroke();
          drawArrowHead(ctx, start, end, el.size);
        } else {
          drawBoardShapePath(ctx, el, b);
          if (el.fillMode === 'fill') {
            ctx.fillStyle = el.color;
            ctx.fill();
          } else {
            ctx.strokeStyle = el.color;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      if (includeSelection && selectedElementId === el.id) {
        const b = boundsOf(el);
        ctx.save();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        if (isBoxElement(el)) {
          const center = centerOfBounds(b);
          const rotation = rotationOf(el);
          ctx.translate(center.x, center.y);
          ctx.rotate((rotation * Math.PI) / 180);
          const x = -b.w / 2;
          const y = -b.h / 2;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(x, y, b.w, b.h);
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(34, 211, 238, .75)';
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(0, y - 34);
          ctx.stroke();
          const handles = [
            { x, y },
            { x: x + b.w, y },
            { x, y: y + b.h },
            { x: x + b.w, y: y + b.h },
          ];
          ctx.fillStyle = '#22d3ee';
          handles.forEach((handle) => ctx.fillRect(handle.x - 8, handle.y - 8, 16, 16));
          ctx.beginPath();
          ctx.arc(0, y - 34, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(2, 6, 23, .75)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    },
    [imageForUrl, selectedElementId],
  );

  const drawCutoutDraft = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!cutoutDraft || cutoutDraft.points.length === 0) return;
      const pathPoints = cutoutDraft.closed ? closeCutoutPath(cutoutDraft.points) : cutoutDraft.points;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fb923c';
      ctx.fillStyle = cutoutInvert ? 'rgba(239, 68, 68, .16)' : 'rgba(34, 211, 238, .14)';
      ctx.setLineDash(cutoutDraft.mode === 'pen' ? [10, 6] : [7, 6]);
      ctx.beginPath();
      pathPoints.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (cutoutDraft.closed && pathPoints.length >= 3) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (cutoutDraft.mode === 'pen') {
        ctx.fillStyle = '#22d3ee';
        cutoutDraft.points.forEach((p, index) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, index === 0 ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(2, 6, 23, .78)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
      ctx.restore();
    },
    [cutoutDraft, cutoutInvert],
  );

  const renderCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, includeSelection = true) => {
      ctx.clearRect(0, 0, boardW, boardH);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, boardW, boardH);
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, .18)';
      ctx.lineWidth = 1;
      const grid = 60;
      for (let x = grid; x < boardW; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, boardH);
        ctx.stroke();
      }
      for (let y = grid; y < boardH; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(boardW, y);
        ctx.stroke();
      }
      ctx.restore();
      renderableLayers.forEach((layer) => layer.elements.forEach((el) => drawElement(ctx, el, includeSelection)));
      if (includeSelection) drawCutoutDraft(ctx);
    },
    [boardH, boardW, drawCutoutDraft, drawElement, renderableLayers],
  );

  const paintCanvas = useCallback((canvas: HTMLCanvasElement | null, displaySize: { w: number; h: number }) => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const pixelRatio = Math.min(3, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    canvas.width = Math.max(1, Math.round(displaySize.w * pixelRatio));
    canvas.height = Math.max(1, Math.round(displaySize.h * pixelRatio));
    canvas.style.width = `${Math.max(1, displaySize.w)}px`;
    canvas.style.height = `${Math.max(1, displaySize.h)}px`;
    ctx.setTransform(canvas.width / boardW, 0, 0, canvas.height / boardH, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    renderCanvas(ctx, true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [boardH, boardW, renderCanvas]);

  const handleFocusCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    focusCanvasRef.current = canvas;
    if (canvas) paintCanvas(canvas, focusStageSize);
  }, [focusStageSize, paintCanvas]);

  useEffect(() => {
    paintCanvas(canvasRef.current, previewSize);
    if (focusEditorOpen) paintCanvas(focusCanvasRef.current, focusStageSize);
  }, [focusEditorOpen, focusStageSize, paintCanvas, previewSize]);

  const clientToBoard = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return boardPointFromClientPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      boardW,
      boardH,
    });
  };

  const hitElement = (pnt: Point) => {
    for (let li = layers.length - 1; li >= 0; li -= 1) {
      const layer = layers[li];
      if (!isLayerVisible(layers, layer) || !isLayerEditable(layers, layer)) continue;
      for (let ei = layer.elements.length - 1; ei >= 0; ei -= 1) {
        const el = layer.elements[ei];
        if (pointInElement(pnt, el, el.kind === 'path' ? 10 : 0)) return { layerId: layer.id, element: el };
      }
    }
    return null;
  };

  const resolveCutoutSource = (pnt: Point) => {
    if (selectedCutoutSource && pointInElement(pnt, selectedCutoutSource.element)) return selectedCutoutSource;
    const hit = hitElement(pnt);
    if (!hit || hit.element.kind !== 'image') return null;
    const layer = layers.find((item) => item.id === hit.layerId && item.kind === 'layer');
    if (!layer || !isLayerEditable(layers, layer)) return null;
    return { layer, element: hit.element as ImageElement };
  };

  const closeCurrentCutoutDraft = useCallback(() => {
    let closed = false;
    let invalid = false;
    setCutoutDraft((prev) => {
      if (!prev || prev.closed || prev.points.length < 3) {
        invalid = true;
        return prev;
      }
      const points = closeCutoutPath(simplifyCutoutPath(prev.points, cutoutSmooth));
      if (!isValidCutoutPath(points)) {
        invalid = true;
        return prev;
      }
      closed = true;
      return { ...prev, points, closed: true };
    });
    if (closed) setError(null);
    if (invalid) setError('选区太小或点数不足，至少需要 3 个有效点');
    return closed;
  }, [cutoutSmooth]);

  const cancelCutoutDraft = useCallback(() => {
    cutoutDragRef.current = null;
    setCutoutDraft(null);
    setError(null);
  }, []);

  const removeLastCutoutPoint = useCallback(() => {
    setCutoutDraft((prev) => {
      if (!prev || prev.mode !== 'pen' || prev.closed) return prev;
      const next = prev.points.slice(0, -1);
      return next.length ? { ...prev, points: next } : null;
    });
  }, []);

  const appendToActiveLayer = (el: BoardElement, recordHistory = true) => {
    if (!activeLayer || !activeLayerWritable) {
      setError('当前图层不可编辑，请新建或解锁图层');
      return false;
    }
    setError(null);
    if (recordHistory) pushHistorySnapshot();
    setSelectedElementId(el.id);
    patchLayers((prev) =>
      prev.map((layer) =>
        layer.id === activeLayer.id && layer.kind === 'layer'
          ? { ...layer, elements: [...layer.elements, el] }
          : layer,
      ),
    );
    return true;
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      actionRef.current = null;
      cutoutDragRef.current = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pos = clientToBoard(event);

    if (tool === 'select') {
      if (selectedElement && isLayerEditable(layers, selectedElement.layer) && isBoxElement(selectedElement.element)) {
        if (isRotateHandleHit(pos, selectedElement.element)) {
          const b = boundsOf(selectedElement.element);
          const center = centerOfBounds(b);
          actionRef.current = {
            type: 'rotate',
            layerId: selectedElement.layer.id,
            id: selectedElement.element.id,
            center,
            startAngle: Math.atan2(pos.y - center.y, pos.x - center.x),
            originalRotation: rotationOf(selectedElement.element),
          };
          setActiveLayerId(selectedElement.layer.id);
          return;
        }
        const selectedCorner = resizeCornerAt(pos, selectedElement.element);
        if (selectedCorner) {
          actionRef.current = {
            type: 'resize',
            layerId: selectedElement.layer.id,
            id: selectedElement.element.id,
            corner: selectedCorner,
            keepAspect: !event.shiftKey,
            original: selectedElement.element,
          };
          setActiveLayerId(selectedElement.layer.id);
          return;
        }
      }
      const hit = hitElement(pos);
      setSelectedElementId(hit?.element.id || null);
      if (!hit) {
        actionRef.current = null;
        return;
      }
      setActiveLayerId(hit.layerId);
      const hitLayer = layers.find((layer) => layer.id === hit.layerId);
      const originals = hitLayer?.kind === 'layer' ? hitLayer.elements : [];
      const hitCorner = resizeCornerAt(pos, hit.element);
      if (hitCorner) {
        actionRef.current = { type: 'resize', layerId: hit.layerId, id: hit.element.id, corner: hitCorner, keepAspect: !event.shiftKey, original: hit.element };
      } else {
        actionRef.current = { type: 'move', layerId: hit.layerId, id: hit.element.id, start: pos, originals };
      }
      return;
    }

    if (isCutoutTool(tool)) {
      const source = resolveCutoutSource(pos);
      if (!source) {
        setError('请先选中一张未锁定的图片图层，再开始抠图');
        return;
      }
      if (!pointInElement(pos, source.element)) {
        setError('请在图片范围内开始抠图');
        return;
      }
      setError(null);
      setActiveLayerId(source.layer.id);
      setSelectedElementId(source.element.id);
      if (tool === 'cutout-lasso') {
        cutoutDragRef.current = { pointerId: event.pointerId, sourceLayerId: source.layer.id, sourceElementId: source.element.id };
        setCutoutDraft({
          mode: 'lasso',
          sourceLayerId: source.layer.id,
          sourceElementId: source.element.id,
          points: [pos],
          closed: false,
        });
        return;
      }
      setCutoutDraft((prev) => {
        if (prev?.mode === 'pen' && prev.sourceElementId === source.element.id && prev.sourceLayerId === source.layer.id && !prev.closed) {
          if (prev.points.length >= 3 && distanceBetween(pos, prev.points[0]) <= 18) {
            const points = closeCutoutPath(simplifyCutoutPath(prev.points, cutoutSmooth));
            if (!isValidCutoutPath(points)) {
              setError('选区太小或点数不足，至少需要 3 个有效点');
              return prev;
            }
            return { ...prev, points, closed: true };
          }
          return { ...prev, points: [...prev.points, pos] };
        }
        return {
          mode: 'pen',
          sourceLayerId: source.layer.id,
          sourceElementId: source.element.id,
          points: [pos],
          closed: false,
        };
      });
      return;
    }

    if (tool === 'text') {
      const text = textDraft.trim() || window.prompt('输入画板文字', '文字') || '';
      if (!text.trim()) return;
      appendToActiveLayer({
        id: uid('text'),
        kind: 'text',
        text,
        x: pos.x,
        y: pos.y,
        color: strokeColor,
        size: Math.max(16, strokeSize * 7),
      });
      return;
    }

    if (tool === 'pen' || tool === 'eraser') {
      if (!activeLayer || !activeLayerWritable) {
        setError('当前图层不可编辑，请新建或解锁图层');
        return;
      }
      const el: PathElement = {
        id: uid(tool),
        kind: 'path',
        points: [pos],
        color: tool === 'eraser' ? '#ffffff' : strokeColor,
        size: tool === 'eraser' ? strokeSize * 4 : strokeSize,
      };
      actionRef.current = { type: 'draw', layerId: activeLayer.id, id: el.id };
      appendToActiveLayer(el);
      return;
    }

    if (!activeLayer || !activeLayerWritable) {
      setError('当前图层不可编辑，请新建或解锁图层');
      return;
    }
    const el: ShapeElement = {
      id: uid(tool),
      kind: tool as ShapeElement['kind'],
      x: pos.x,
      y: pos.y,
      w: 1,
      h: 1,
      color: strokeColor,
      size: strokeSize,
      fillMode: boardFillMode,
    };
    actionRef.current = { type: 'shape', layerId: activeLayer.id, id: el.id };
    appendToActiveLayer(el);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const cutoutDrag = cutoutDragRef.current;
    if (cutoutDrag) {
      event.preventDefault();
      event.stopPropagation();
      const pos = clientToBoard(event);
      setCutoutDraft((prev) => {
        if (!prev || prev.closed || prev.sourceElementId !== cutoutDrag.sourceElementId || prev.sourceLayerId !== cutoutDrag.sourceLayerId) return prev;
        const last = prev.points[prev.points.length - 1];
        if (last && distanceBetween(last, pos) < 2) return prev;
        return { ...prev, points: [...prev.points, pos] };
      });
      return;
    }
    const action = actionRef.current;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = clientToBoard(event);
    if (!action.recorded && (action.type === 'move' || action.type === 'resize' || action.type === 'rotate')) {
      pushHistorySnapshot();
      action.recorded = true;
    }
    patchLayers((prev) =>
      prev.map((layer) => {
        if (layer.id !== action.layerId || layer.kind !== 'layer') return layer;
        return {
          ...layer,
          elements: layer.elements.map((el) => {
            if (el.id !== action.id) return el;
            if (action.type === 'draw' && el.kind === 'path') {
              const last = el.points[el.points.length - 1];
              if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 2) return el;
              return { ...el, points: [...el.points, pos] };
            }
            if (action.type === 'shape' && isShapeElement(el)) {
              const dragSize = boardShapeDragSize({ x: el.x, y: el.y }, pos, el.kind, event.shiftKey);
              return { ...el, w: dragSize.w, h: dragSize.h } as ShapeElement;
            }
            if (action.type === 'move') {
              const original = action.originals.find((x) => x.id === el.id);
              if (!original) return el;
              const dx = pos.x - action.start.x;
              const dy = pos.y - action.start.y;
              if (original.kind === 'path' && el.kind === 'path') {
                return { ...el, points: original.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
              }
              if (original.kind === 'path' || el.kind === 'path') return el;
              return { ...el, x: (original as any).x + dx, y: (original as any).y + dy } as BoardElement;
            }
            if (action.type === 'resize') {
              return resizeBoxElement(action.original, pos, action.corner, action.keepAspect);
            }
            if (action.type === 'rotate' && isBoxElement(el)) {
              const nextAngle = Math.atan2(pos.y - action.center.y, pos.x - action.center.x);
              return {
                ...el,
                rotation: action.originalRotation + ((nextAngle - action.startAngle) * 180) / Math.PI,
              } as BoardElement;
            }
            return el;
          }),
        };
      }),
    );
  };

  const endPointerAction = (event?: PointerEvent<HTMLCanvasElement>) => {
    event?.stopPropagation();
    const cutoutDrag = cutoutDragRef.current;
    if (cutoutDrag) {
      cutoutDragRef.current = null;
      setCutoutDraft((prev) => {
        if (!prev || prev.sourceElementId !== cutoutDrag.sourceElementId || prev.sourceLayerId !== cutoutDrag.sourceLayerId) return prev;
        const points = closeCutoutPath(simplifyCutoutPath(prev.points, cutoutSmooth));
        if (!isValidCutoutPath(points)) {
          setError('套索选区太小，请重新圈选');
          return null;
        }
        setError(null);
        return { ...prev, points, closed: true };
      });
      return;
    }
    const action = actionRef.current;
    actionRef.current = null;
    if (!action) return;
    let removedDegenerateShape = false;
    patchLayers((prev) =>
      prev.map((layer) =>
        layer.id === action.layerId && layer.kind === 'layer'
          ? {
            ...layer,
            elements: layer.elements
              .map(normalizeShape)
              .filter((el) => {
                const shouldRemove = action.type === 'shape' && el.id === action.id && isDegenerateShapeElement(el);
                if (shouldRemove) removedDegenerateShape = true;
                return !shouldRemove;
              }),
          }
          : layer,
      ),
    );
    if (removedDegenerateShape) setSelectedElementId(null);
  };

  const addBlankLayer = () => {
    pushHistorySnapshot();
    const next = createBlankLayer(layers.filter((layer) => layer.kind === 'layer').length + 1, activeLayer?.groupId || null);
    setActiveLayerId(next.id);
    setSelectedElementId(null);
    patchLayers((prev) => [...prev, next]);
  };

  const addLayerGroup = () => {
    pushHistorySnapshot();
    const group = createGroup(layers.filter((layer) => layer.kind === 'group').length + 1);
    patchLayers((prev) => [...prev, group].map((layer) => (layer.id === activeLayerId ? { ...layer, groupId: group.id } : layer)));
  };

  const addImageLayers = useCallback(
    async (urls: Array<{ url: string; name?: string }>) => {
      if (urls.length === 0) return;
      const existingNow = new Set(flattenElements(layers).filter((el): el is ImageElement => el.kind === 'image').map((el) => el.url));
      const unique = urls.filter((item) => item.url && !existingNow.has(item.url));
      if (unique.length === 0) return;

      const baseIndex = layers.filter((layer) => layer.kind === 'layer').length;
      const newLayers = await Promise.all(unique.map(async (item, index) => {
        let rect = fitImageToBoard(boardW, boardH, boardW, boardH, index);
        let naturalW: number | undefined;
        let naturalH: number | undefined;
        try {
          const img = await loadImage(item.url);
          naturalW = Math.max(1, Math.round(img.naturalWidth || 0));
          naturalH = Math.max(1, Math.round(img.naturalHeight || 0));
          rect = fitImageToBoard(img.naturalWidth, img.naturalHeight, boardW, boardH, index);
        } catch {
          // Fallback keeps the layer usable even if the preview image is still loading.
        }
        const layer = createBlankLayer(baseIndex + index + 1);
        layer.name = item.name || `图片 ${index + 1}`;
        layer.elements = [{
          id: uid('image'),
          kind: 'image',
          url: item.url,
          name: item.name,
          naturalW,
          naturalH,
          ...rect,
          rotation: 0,
          opacity: 1,
        }];
        return layer;
      }));

      pushHistorySnapshot();
      patchLayers((prev) => {
        const existing = new Set(flattenElements(prev).filter((el): el is ImageElement => el.kind === 'image').map((el) => el.url));
        const safeNewLayers = newLayers.filter((layer) => {
          const img = layer.elements[0];
          return img?.kind === 'image' && !existing.has(img.url);
        });
        return safeNewLayers.length ? [...prev, ...safeNewLayers] : prev;
      });
      const lastNewLayerId = newLayers[newLayers.length - 1]?.id;
      if (lastNewLayerId) {
        setActiveLayerId(lastNewLayerId);
        setSelectedElementId(null);
      }
    },
    [boardH, boardW, layers, loadImage, patchLayers, pushHistorySnapshot],
  );

  const applyCutoutDraft = useCallback(async () => {
    if (!cutoutDraft || !cutoutDraft.closed) {
      setError('请先完成套索或钢笔闭合选区');
      return;
    }
    const sourceLayer = layers.find((layer) => layer.id === cutoutDraft.sourceLayerId && layer.kind === 'layer');
    const source = sourceLayer?.kind === 'layer'
      ? sourceLayer.elements.find((el): el is ImageElement => el.id === cutoutDraft.sourceElementId && el.kind === 'image')
      : null;
    if (!sourceLayer || sourceLayer.kind !== 'layer' || !source || !isLayerEditable(layers, sourceLayer)) {
      setError('源图片图层已隐藏、锁定或不存在，无法抠图');
      return;
    }
    const points = closeCutoutPath(simplifyCutoutPath(cutoutDraft.points, cutoutSmooth));
    if (!isValidCutoutPath(points)) {
      setError('选区太小或点数不足，无法抠图');
      return;
    }

    setStatus('running');
    setError(null);
    try {
      const img = await loadImage(source.url);
      const W = Math.max(1, img.naturalWidth || Math.round(source.w));
      const H = Math.max(1, img.naturalHeight || Math.round(source.h));
      const mask = document.createElement('canvas');
      mask.width = W;
      mask.height = H;
      const maskCtx = mask.getContext('2d');
      if (!maskCtx) throw new Error('无法创建抠图遮罩');
      maskCtx.clearRect(0, 0, W, H);
      if (cutoutInvert) {
        maskCtx.fillStyle = '#fff';
        maskCtx.fillRect(0, 0, W, H);
        maskCtx.globalCompositeOperation = 'destination-out';
      }
      maskCtx.fillStyle = '#fff';
      maskCtx.beginPath();
      points.forEach((point, index) => {
        const f = boardPointToImageFraction(point, source);
        const x = f.x * W;
        const y = f.y * H;
        if (index === 0) maskCtx.moveTo(x, y);
        else maskCtx.lineTo(x, y);
      });
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.globalCompositeOperation = 'source-over';

      const softMask = document.createElement('canvas');
      softMask.width = W;
      softMask.height = H;
      const softCtx = softMask.getContext('2d');
      if (!softCtx) throw new Error('无法创建羽化遮罩');
      if (cutoutFeather > 0) {
        softCtx.filter = `blur(${cutoutFeather}px)`;
        softCtx.drawImage(mask, 0, 0);
        softCtx.filter = 'none';
      } else {
        softCtx.drawImage(mask, 0, 0);
      }

      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const outCtx = out.getContext('2d');
      if (!outCtx) throw new Error('无法创建抠图画布');
      outCtx.clearRect(0, 0, W, H);
      outCtx.drawImage(img, 0, 0, W, H);
      outCtx.globalCompositeOperation = 'destination-in';
      outCtx.drawImage(softMask, 0, 0);
      outCtx.globalCompositeOperation = 'source-over';

      const url = await uploadDataUrl(out.toDataURL('image/png'), 'drawing-board-cutout');
      await loadImage(url);
      const layerCount = layers.filter((layer) => layer.kind === 'layer').length;
      const newLayer = createBlankLayer(layerCount + 1, sourceLayer.groupId || null);
      const newImage: ImageElement = {
        ...source,
        id: uid('image-cutout'),
        url,
        name: `${source.name || '图片'} 抠图`,
        opacity: 1,
      };
      newLayer.name = `${source.name || '图片'} 抠图`;
      newLayer.elements = [newImage];
      pushHistorySnapshot();
      setActiveLayerId(newLayer.id);
      setSelectedElementId(newImage.id);
      applyTool('select');
      patchLayers((prev) => {
        const sourceIndex = prev.findIndex((layer) => layer.id === sourceLayer.id);
        if (sourceIndex < 0) return [...prev, newLayer];
        return [...prev.slice(0, sourceIndex + 1), newLayer, ...prev.slice(sourceIndex + 1)];
      });
      setStatus('success');
    } catch (e: any) {
      const msg = e?.message || '抠图失败';
      setError(msg);
      setStatus('error');
    }
  }, [applyTool, cutoutDraft, cutoutFeather, cutoutInvert, cutoutSmooth, layers, loadImage, patchLayers, pushHistorySnapshot]);

  const applyRhCutoutToSelectedImage = useCallback(() => {
    if (!selectedCutoutSource) {
      setError('请先选中一张可编辑图片再自动抠图');
      return;
    }
    const { layer: sourceLayer, element: source } = selectedCutoutSource;
    if (!isLayerEditable(layers, sourceLayer)) {
      setError('源图片图层已隐藏、锁定或不存在，无法自动抠图');
      return;
    }
    try {
      queueSecondaryAction({
        actionId: 'rh-image.editor-cutout',
        target: 'editor-cutout',
        params: {
          capability: 'image.cutout',
          preferredToolId: 'image-cutout-v1',
          imageUrl: source.url,
          surface: 'drawing-board',
          editorSessionId: editorSessionIdRef.current,
          targetId: source.id,
          retryCount: 2,
          retryDelayMs: 1200,
        },
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || '无法提交 RH 自动抠图');
      setStatus('error');
    }
  }, [layers, queueSecondaryAction, selectedCutoutSource]);

  const upstreamSig = useMemo(() => upstream.images.map((m) => m.url).join('|'), [upstream.images]);

  useEffect(() => {
    if (!upstreamSig || elementCount(layers) > 0 || autoImportSigRef.current === upstreamSig) return;
    autoImportSigRef.current = upstreamSig;
    void addImageLayers(upstream.images.map((m) => ({ url: m.url, name: m.label })));
  }, [addImageLayers, layers, upstream.images, upstreamSig]);

  const commitBoardDimension = useCallback(
    (axis: 'w' | 'h', raw: string) => {
      const current = axis === 'w' ? boardW : boardH;
      const parsed = raw.trim() ? Number(raw) : current;
      const next = clampBoardDimension(parsed, current);
      setRatio('free');
      if (axis === 'w') {
        setBoardW(next);
        setBoardWDraft(String(next));
        update({ boardRatio: 'free', boardWidth: next });
      } else {
        setBoardH(next);
        setBoardHDraft(String(next));
        update({ boardRatio: 'free', boardHeight: next });
      }
    },
    [boardH, boardW, update],
  );

  const resolveOriginalPixelSource = useCallback(() => {
    if (selectedElement?.element.kind === 'image') {
      return { layerId: selectedElement.layer.id, element: selectedElement.element as ImageElement };
    }
    for (const layer of renderableLayers) {
      if (layer.kind !== 'layer') continue;
      const element = layer.elements.find((el): el is ImageElement => el.kind === 'image');
      if (element) return { layerId: layer.id, element };
    }
    return null;
  }, [renderableLayers, selectedElement]);

  const applyOriginalPixelSize = useCallback(async () => {
    const source = resolveOriginalPixelSource();
    if (!source) {
      setError('请先载入或选中一张图片，再使用原图像素尺寸');
      return;
    }
    try {
      const img = await loadImage(source.element.url);
      const naturalW = source.element.naturalW || Math.max(1, Math.round(img.naturalWidth || source.element.w || boardW));
      const naturalH = source.element.naturalH || Math.max(1, Math.round(img.naturalHeight || source.element.h || boardH));
      const placement = originalPixelImagePlacement(naturalW, naturalH);
      pushHistorySnapshot();
      setRatio('free');
      setBoardW(placement.boardW);
      setBoardH(placement.boardH);
      setBoardWDraft(String(placement.boardW));
      setBoardHDraft(String(placement.boardH));
      setActiveLayerId(source.layerId);
      setSelectedElementId(source.element.id);
      patchLayers((prev) =>
        prev.map((layer) =>
          layer.id === source.layerId && layer.kind === 'layer'
            ? {
              ...layer,
              elements: layer.elements.map((el) =>
                el.id === source.element.id && el.kind === 'image'
                  ? {
                    ...el,
                    naturalW: placement.boardW,
                    naturalH: placement.boardH,
                    x: placement.rect.x,
                    y: placement.rect.y,
                    w: placement.rect.w,
                    h: placement.rect.h,
                    rotation: 0,
                  }
                  : el,
              ),
            }
            : layer,
        ),
      );
      update({
        boardRatio: 'free',
        boardWidth: placement.boardW,
        boardHeight: placement.boardH,
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || '读取原图像素尺寸失败');
    }
  }, [boardH, boardW, loadImage, patchLayers, pushHistorySnapshot, resolveOriginalPixelSource, update]);

  const changeRatio = (nextRatio: BoardRatio) => {
    setRatio(nextRatio);
    const patch: Record<string, any> = { boardRatio: nextRatio };
    if (nextRatio !== 'free') {
      const s = RATIO_SIZE[nextRatio];
      setBoardW(s.w);
      setBoardH(s.h);
      patch.boardWidth = s.w;
      patch.boardHeight = s.h;
    }
    update(patch);
  };

  const clearBoard = () => {
    if (elementCount(layers) > 0 && !window.confirm('清空当前画板？这会保留一个空白图层。')) return;
    pushHistorySnapshot();
    const fresh = createBlankLayer(1);
    setActiveLayerId(fresh.id);
    setSelectedElementId(null);
    setLayers([fresh]);
    update({
      boardLayers: [fresh],
      boardElements: [],
      activeBoardLayerId: fresh.id,
      imageUrl: '',
      imageUrls: [],
      urls: [],
      outputImageUrl: '',
      status: 'idle',
      error: null,
    });
    setStatus('idle');
    setError(null);
  };

  const reorderLayer = (layerId: string, direction: -1 | 1) => {
    pushHistorySnapshot();
    patchLayers((prev) => {
      const idx = prev.findIndex((layer) => layer.id === layerId);
      const nextIdx = idx + direction;
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  };

  const toggleLayerFlag = (layerId: string, key: 'hidden' | 'locked') => {
    pushHistorySnapshot();
    patchLayers((prev) => prev.map((layer) => (layer.id === layerId ? { ...layer, [key]: !layer[key] } : layer)));
  };

  const toggleGroupCollapsed = (groupId: string) => {
    pushHistorySnapshot();
    patchLayers((prev) => prev.map((layer) => (layer.id === groupId && layer.kind === 'group' ? { ...layer, collapsed: !layer.collapsed } : layer)));
  };

  const deleteLayer = (layerId: string) => {
    pushHistorySnapshot();
    patchLayers((prev) => {
      const target = prev.find((layer) => layer.id === layerId);
      if (!target) return prev;
      if (target.kind === 'group') {
        return prev.filter((layer) => layer.id !== layerId).map((layer) => (layer.groupId === layerId ? { ...layer, groupId: null } : layer));
      }
      const next = prev.filter((layer) => layer.id !== layerId);
      if (!next.some((layer) => layer.kind === 'layer')) return [createBlankLayer(1)];
      return next;
    });
    if (activeLayerId === layerId) {
      setSelectedElementId(null);
      setActiveLayerId('');
    }
  };

  const startLayerDrag = (event: ReactDragEvent<HTMLDivElement>, layer: BoardLayer) => {
    if (layer.kind !== 'layer') {
      event.preventDefault();
      return;
    }
    setDragLayerId(layer.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-t8-board-layer', layer.id);
    event.dataTransfer.setData('text/plain', layer.id);
  };

  const layerIdFromDrag = (event: ReactDragEvent<HTMLElement>) =>
    event.dataTransfer.getData('application/x-t8-board-layer') || event.dataTransfer.getData('text/plain') || dragLayerId || '';

  const moveLayerToGroup = (layerId: string, groupId: string | null) => {
    if (!layerId) return;
    pushHistorySnapshot();
    patchLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId && layer.kind === 'layer' ? { ...layer, groupId } : layer,
      ),
    );
    setActiveLayerId(layerId);
  };

  const deleteSelectedElement = useCallback(() => {
    if (!selectedElementId) return false;
    const exists = layers.some((layer) => layer.kind === 'layer' && layer.elements.some((el) => el.id === selectedElementId));
    if (!exists) return false;
    pushHistorySnapshot();
    patchLayers((prev) =>
      prev.map((layer) =>
        layer.kind === 'layer'
          ? { ...layer, elements: layer.elements.filter((el) => el.id !== selectedElementId) }
          : layer,
      ),
    );
    setSelectedElementId(null);
    return true;
  }, [layers, patchLayers, pushHistorySnapshot, selectedElementId]);

  const beginSelectedTextEdit = useCallback(() => {
    if (!selectedElementId || selectedElement?.element.kind !== 'text') return;
    if (textEditHistoryRef.current === selectedElementId) return;
    pushHistorySnapshot();
    textEditHistoryRef.current = selectedElementId;
  }, [pushHistorySnapshot, selectedElement, selectedElementId]);

  const updateSelectedTextElement = useCallback((patch: Partial<Pick<TextElement, 'text' | 'size' | 'color'>>) => {
    if (!selectedElementId) return;
    patchLayers((prev) =>
      prev.map((layer) => (
        layer.kind === 'layer'
          ? {
            ...layer,
            elements: layer.elements.map((el) => (
              el.id === selectedElementId && el.kind === 'text'
                ? { ...el, ...patch }
                : el
            )),
          }
          : layer
      )),
    );
  }, [patchLayers, selectedElementId]);

  const handleRootKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isEditableEventTarget(event.target)) {
        const handledHistory = isUndoShortcutEvent(event)
          ? undoBoardHistory()
          : isRedoShortcutEvent(event)
            ? redoBoardHistory()
            : false;
        if (handledHistory) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        const shortcutTool = toolFromShortcutEvent(event);
        if (shortcutTool) {
          applyTool(shortcutTool);
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
      }
      if (cutoutDraft && !isEditableEventTarget(event.target)) {
        if (event.key === 'Escape') {
          cancelCutoutDraft();
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        if (event.key === 'Enter' && cutoutDraft.mode === 'pen' && !cutoutDraft.closed) {
          closeCurrentCutoutDraft();
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        if (event.key === 'Backspace' && cutoutDraft.mode === 'pen' && !cutoutDraft.closed) {
          removeLastCutoutPoint();
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
      }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || isEditableEventTarget(event.target)) return;
      if (!selectedElementId) return;
      if (!deleteSelectedElement()) return;
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();
    },
    [applyTool, cancelCutoutDraft, closeCurrentCutoutDraft, cutoutDraft, deleteSelectedElement, redoBoardHistory, removeLastCutoutPoint, selectedElementId, undoBoardHistory],
  );

  useEffect(() => {
    if (!selected || selectedTextEditorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const keyboardActive = boardHasKeyboardFocus()
        || document.activeElement === document.body
        || document.activeElement === document.documentElement;
      if (!keyboardActive) return;
      if (!isEditableEventTarget(event.target)) {
        const handledHistory = isUndoShortcutEvent(event)
          ? undoBoardHistory()
          : isRedoShortcutEvent(event)
            ? redoBoardHistory()
            : false;
        if (handledHistory) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
        const shortcutTool = toolFromShortcutEvent(event);
        if (shortcutTool) {
          applyTool(shortcutTool);
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
      }
      if (cutoutDraft && !isEditableEventTarget(event.target)) {
        if (event.key === 'Escape') {
          cancelCutoutDraft();
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
        if (event.key === 'Enter' && cutoutDraft.mode === 'pen' && !cutoutDraft.closed) {
          closeCurrentCutoutDraft();
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
        if (event.key === 'Backspace' && cutoutDraft.mode === 'pen' && !cutoutDraft.closed) {
          removeLastCutoutPoint();
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
      }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || isEditableEventTarget(event.target)) return;
      if (!deleteSelectedElement()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [applyTool, boardHasKeyboardFocus, cancelCutoutDraft, closeCurrentCutoutDraft, cutoutDraft, deleteSelectedElement, redoBoardHistory, removeLastCutoutPoint, selected, selectedTextEditorOpen, undoBoardHistory]);

  const handleLocalImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
      event.target.value = '';
      if (files.length === 0) return;
      setError(null);
      try {
        const uploaded = await Promise.all(files.map(async (file) => ({
          url: await uploadFileBlob(file, file.name),
          name: file.name,
        })));
        await addImageLayers(uploaded);
      } catch (e: any) {
        setError(e?.message || '载入图片失败');
      }
    },
    [addImageLayers],
  );

  const exportBoardJson = useCallback(() => {
    downloadJsonFile(`t8-drawing-board-${Date.now()}.json`, {
      schema: 't8-drawing-board',
      version: 1,
      exportedAt: new Date().toISOString(),
      boardRatio: ratio,
      boardWidth: boardW,
      boardHeight: boardH,
      boardLayers: layers,
      activeBoardLayerId: activeLayerId,
    });
  }, [activeLayerId, boardH, boardW, layers, ratio]);

  const handleBoardJsonChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const nextLayers = normalizeLayers(json?.boardLayers || json?.layers, json?.boardElements || json?.elements);
        const nextRatio = isBoardRatio(json?.boardRatio) ? json.boardRatio : 'free';
        const nextW = clampBoardDimension(Number(json?.boardWidth), DEFAULT_BOARD_W);
        const nextH = clampBoardDimension(Number(json?.boardHeight), DEFAULT_BOARD_H);
        const nextActive = nextLayers.some((layer) => layer.id === json?.activeBoardLayerId && layer.kind === 'layer')
          ? json.activeBoardLayerId
          : firstEditableLayerId(nextLayers);
        pushHistorySnapshot();
        setRatio(nextRatio);
        setBoardW(nextW);
        setBoardH(nextH);
        setLayers(nextLayers);
        setActiveLayerId(nextActive);
        setSelectedElementId(null);
        setError(null);
        update({
          boardRatio: nextRatio,
          boardWidth: nextW,
          boardHeight: nextH,
          boardLayers: nextLayers,
          boardElements: flattenElements(nextLayers),
          activeBoardLayerId: nextActive,
        });
      } catch (e: any) {
        setError(e?.message || '导入画板 JSON 失败');
      }
    },
    [pushHistorySnapshot, update],
  );

  const exportBoard = useCallback(async () => {
    setError(null);
    setStatus('running');
    update({ status: 'running', error: null });
    try {
      const imageEls = renderableLayers.flatMap((layer) => layer.elements).filter((el): el is ImageElement => el.kind === 'image');
      await Promise.all(imageEls.map((el) => loadImage(el.url)));
      const out = document.createElement('canvas');
      out.width = boardW;
      out.height = boardH;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('无法创建画板画布');
      renderCanvas(ctx, false);
      const url = await uploadDataUrl(out.toDataURL('image/png'), 'drawing-board');
      update({
        status: 'success',
        error: null,
        boardLayers: layers,
        boardElements: flattenElements(layers),
        activeBoardLayerId: activeLayerId,
        boardWidth: boardW,
        boardHeight: boardH,
        boardRatio: ratio,
        imageUrl: url,
        imageUrls: [url],
        urls: [url],
        outputImageUrl: url,
      });
      setStatus('success');
    } catch (e: any) {
      const msg = e?.message || '导出画板失败';
      setError(msg);
      setStatus('error');
      update({ status: 'error', error: msg });
      throw e;
    }
  }, [activeLayerId, boardH, boardW, layers, ratio, renderCanvas, renderableLayers, update]);

  const runBoard = useCallback(async (reporter: RunNodeLifecycleReporter) => {
    const action = resolveSecondaryProviderActionForRun({
      nodeId: id,
      nodeType: 'drawing-board',
      nodeData: rf.getNode(id)?.data,
      runContext: reporter.runContext,
    });
    if (!action) {
      if (reporter.runContext?.secondaryProviderActionId) {
        throw new Error('画板的次级 Provider action 已过期或被修改，已停止调用 Provider');
      }
      await exportBoard();
      return;
    }
    try {
      await executeRegisteredSecondaryProviderAction(action, reporter);
    } finally {
      const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
      if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
    }
  }, [exportBoard, id, rf, update]);

  // 普通导出和次级 Provider action 共用唯一运行监听器。
  useRunTrigger(id, runBoard, undefined, { lifecycleAware: true });

  const chooseTool = (value: BoardTool) => applyTool(value);

  const toolButton = (value: BoardTool, icon: ReactNode) => {
    const shortcut = toolShortcutFor(value);
    return (
      <button
        type="button"
        className={`t8-btn min-h-8 min-w-0 px-1.5 text-[10px] ${tool === value ? 't8-btn-primary' : ''}`}
        onClick={() => chooseTool(value)}
        title={`${TOOL_LABEL[value]}${shortcut ? ` (${shortcut})` : ''}`}
      >
        {icon}
        <span className="hidden sm:inline">{TOOL_LABEL[value]}</span>
      </button>
    );
  };

  const renderBoardFillModeControls = () => (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="画板图形填充模式">
      {(['stroke', 'fill'] as const).map((mode) => {
        const next: BoardFillMode = mode;
        return (
          <button
            key={next}
            type="button"
            className={`t8-btn min-h-7 px-2 text-[10px] ${boardFillMode === next ? 't8-btn-primary' : ''}`}
            onClick={() => applyBoardFillMode(next)}
            title={next === 'fill' ? '新建闭合图形使用实心填充' : '新建图形只画描边'}
          >
            {next === 'fill' ? '实心' : '描边'}
          </button>
        );
      })}
    </div>
  );

  const getCutoutToolbarPosition = useCallback((size: { w: number; h: number }) => {
    if (!cutoutDraft?.closed || cutoutDraft.points.length < 3) return null;
    const xs = cutoutDraft.points.map((p) => p.x);
    const ys = cutoutDraft.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const left = clamp(((minX + maxX) / 2 / boardW) * size.w - 90, 8, Math.max(8, size.w - 188));
    const top = clamp((minY / boardH) * size.h - 44, 8, Math.max(8, size.h - 42));
    return { left, top };
  }, [boardH, boardW, cutoutDraft]);
  const cutoutToolbarPosition = useMemo(() => getCutoutToolbarPosition(previewSize), [getCutoutToolbarPosition, previewSize]);
  const focusCutoutToolbarPosition = useMemo(() => getCutoutToolbarPosition(focusStageSize), [focusStageSize, getCutoutToolbarPosition]);

  const activeLayerIndex = layers.findIndex((layer) => layer.id === activeLayerId);
  const numericFocusZoom = focusZoom === 'fit' ? focusStageSize.scale : focusZoom;
  const selectedTextElement = selectedElement?.element.kind === 'text' ? selectedElement.element : null;
  const setFocusZoomStep = (next: number) => setFocusZoom(clampBoardZoom(next));
  const openFocusEditor = () => {
    setFocusEditorOpen(true);
    setFocusZoom('fit');
  };

  useEffect(() => {
    if (!selected) setShortcutHelpOpen(false);
  }, [selected]);

  useEffect(() => {
    if (!selectedTextElement) setSelectedTextEditorOpen(false);
  }, [selectedTextElement]);

  const renderCutoutQuickBar = (position: { left: number; top: number } | null) => (
    cutoutDraft?.closed && position ? (
      <div
        className="absolute z-10 flex items-center gap-1 rounded border p-1 shadow-lg"
        style={{
          left: position.left,
          top: position.top,
          borderColor: 'var(--t8-border-strong, var(--t8-border, rgba(148,163,184,.45)))',
          background: 'var(--t8-card, rgba(15,23,42,.92))',
          color: 'var(--t8-text, #fff)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="t8-mini-icon-button" title="抠出为新图层" onClick={() => void applyCutoutDraft()} disabled={status === 'running'}>
          {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button type="button" className={`t8-mini-icon-button ${cutoutInvert ? 't8-btn-primary' : ''}`} title="反选" onClick={() => setCutoutInvert((v) => !v)}>
          <Scissors size={13} />
        </button>
        <button type="button" className="t8-mini-icon-button" title="取消选区" onClick={cancelCutoutDraft}>
          <X size={13} />
        </button>
      </div>
    ) : null
  );

  const renderShortcutHelp = () => (
    shortcutHelpOpen ? (
      <div
        className="nodrag nowheel absolute right-3 top-[54px] z-[80] w-72 rounded-lg border p-3 text-[11px] shadow-xl"
        style={{
          borderColor: 'var(--t8-border-strong, var(--t8-border, rgba(148,163,184,.45)))',
          background: 'var(--t8-card, rgba(255,248,220,.98))',
          color: 'var(--t8-text, #2b1f14)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5 font-semibold">
          <HelpCircle size={13} /> 画板快捷键
          <button type="button" className="t8-mini-icon-button ml-auto h-6 w-6" title="关闭快捷键说明" onClick={() => setShortcutHelpOpen(false)}>
            <X size={12} />
          </button>
        </div>
        <div className="mb-2 rounded border px-2 py-1 leading-relaxed opacity-75" style={{ borderColor: 'var(--t8-border, rgba(148,163,184,.25))' }}>
          仅在画板被选中，且焦点不在输入框、文字编辑框或下拉框时生效。矩形使用 Shift+S，S 保留给选择。
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {TOOL_SHORTCUTS.map((item) => (
            <div
              key={`${item.tool}-${item.shortcut}`}
              className="flex items-center justify-between gap-2 rounded border px-2 py-1"
              style={{ borderColor: 'var(--t8-border, rgba(148,163,184,.22))' }}
            >
              <span>{TOOL_LABEL[item.tool]}</span>
              <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(148,163,184,.45))' }}>
                {item.shortcut}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    ) : null
  );

  const renderLayerPanel = (variant: 'inline' | 'focus') => (
    <>
      <section className={`t8-card flex min-h-0 flex-1 flex-col space-y-2 p-2 ${variant === 'focus' ? 'min-h-[260px]' : ''}`}>
        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Layers size={14} /> 图层
          <span className="ml-auto text-[10px] font-normal opacity-60">{activeLayer?.name || '未选择'}</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button type="button" className="t8-btn min-h-7 px-2 text-[10px]" onClick={addBlankLayer}>
            <Plus size={12} /> 新图层
          </button>
          <button type="button" className="t8-btn min-h-7 px-2 text-[10px]" onClick={addLayerGroup}>
            <FolderPlus size={12} /> 新建组
          </button>
        </div>
        <div
          className="nowheel min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
          onDragOver={(e) => {
            if (!dragLayerId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            const layerId = layerIdFromDrag(e);
            if (!layerId) return;
            e.preventDefault();
            moveLayerToGroup(layerId, null);
            setDragLayerId(null);
          }}
        >
          {layers
            .map((layer, index) => ({ layer, index }))
            .filter(({ layer }) => !isLayerFoldedInList(layers, layer))
            .slice()
            .reverse()
            .map(({ layer }) => {
              const isActive = layer.id === activeLayerId;
              const isGroup = layer.kind === 'group';
              return (
                <div
                  key={layer.id}
                  draggable={layer.kind === 'layer'}
                  onDragStart={(e) => startLayerDrag(e, layer)}
                  onDragEnd={() => setDragLayerId(null)}
                  onDragOver={(e) => {
                    if (!dragLayerId || layer.kind !== 'group') return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    if (layer.kind !== 'group') return;
                    const layerId = layerIdFromDrag(e);
                    if (!layerId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    moveLayerToGroup(layerId, layer.id);
                    setDragLayerId(null);
                  }}
                  className={`flex w-full items-center gap-1 rounded border px-1 py-1 text-left text-[10px] ${
                    isActive ? 't8-btn-primary' : ''
                  }`}
                  style={{
                    borderColor: 'var(--t8-border, rgba(148,163,184,.25))',
                    paddingLeft: layer.groupId ? 14 : undefined,
                    opacity: layer.hidden ? 0.55 : 1,
                  }}
                >
                  <button
                    type="button"
                    className="t8-mini-icon-button h-5 w-5 shrink-0"
                    title={layer.hidden ? '显示图层' : '隐藏图层'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerFlag(layer.id, 'hidden');
                    }}
                  >
                    {layer.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                  <button
                    type="button"
                    className="t8-mini-icon-button h-5 w-5 shrink-0"
                    title={layer.locked ? '解锁图层' : '锁定图层'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerFlag(layer.id, 'locked');
                    }}
                  >
                    {layer.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 bg-transparent text-left"
                    title={isGroup ? (layer.collapsed ? '展开组内图层' : '折叠组内图层') : '选中图层'}
                    onClick={() => {
                      if (layer.kind === 'layer') {
                        setActiveLayerId(layer.id);
                        applyTool('select');
                      } else {
                        toggleGroupCollapsed(layer.id);
                      }
                    }}
                  >
                    {isGroup ? (layer.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : <Layers size={12} />}
                    <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                    <span className="opacity-50">{isGroup ? '组' : layer.elements.length}</span>
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      <section className="t8-card flex-none space-y-2 p-2">
        <div className="text-[12px] font-semibold">当前图层</div>
        {activeLayer ? (
          <>
            <input
              className="t8-input nodrag nowheel h-8 w-full px-2 text-[11px]"
              value={activeLayer.name}
              onChange={(e) => {
                const value = e.target.value;
                patchLayers((prev) => prev.map((layer) => (layer.id === activeLayer.id ? { ...layer, name: value } : layer)));
              }}
            />
            <div className="grid grid-cols-5 gap-1">
              <button className="t8-mini-icon-button" type="button" title="下移" onClick={() => reorderLayer(activeLayer.id, -1)} disabled={activeLayerIndex <= 0}>
                <ArrowDown size={13} />
              </button>
              <button className="t8-mini-icon-button" type="button" title="上移" onClick={() => reorderLayer(activeLayer.id, 1)} disabled={activeLayerIndex >= layers.length - 1}>
                <ArrowUp size={13} />
              </button>
              <button className="t8-mini-icon-button" type="button" title="删除图层" onClick={() => deleteLayer(activeLayer.id)}>
                <Trash2 size={13} />
              </button>
              <button className="t8-mini-icon-button" type="button" title="输出 PNG" onClick={() => requestCanvasNodeRun(id)} disabled={status === 'running'}>
                {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              </button>
              <button className="t8-mini-icon-button" type="button" title="删除选中元素" onClick={() => deleteSelectedElement()} disabled={!selectedElement}>
                <Eraser size={13} />
              </button>
            </div>
            <div className="text-[10px] leading-relaxed opacity-60">
              {activeLayerWritable ? '画笔和图形会写入当前图层。' : '当前图层隐藏或锁定，不能编辑。'}
              {selectedElement && <span> 选中：{labelForElement(selectedElement.element)}</span>}
            </div>
            {selectedTextElement && (
              <div className="space-y-1 rounded border border-dashed p-2 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(148,163,184,.32))' }}>
                <div className="flex items-center gap-1 font-semibold">
                  <Type size={12} /> 选中文字
                  <button
                    type="button"
                    className="t8-mini-icon-button ml-auto h-6 w-6"
                    title="放大编辑文字"
                    aria-label="放大编辑文字"
                    onClick={() => setSelectedTextEditorOpen(true)}
                  >
                    <Maximize2 size={12} />
                  </button>
                </div>
                <textarea
                  className="t8-input nodrag nowheel max-h-[78px] min-h-[44px] w-full resize-y px-2 py-1 text-[11px]"
                  value={selectedTextElement.text}
                  onFocus={beginSelectedTextEdit}
                  onBlur={() => { textEditHistoryRef.current = null; }}
                  onChange={(e) => updateSelectedTextElement({ text: e.target.value })}
                  placeholder="编辑画板文字"
                />
                <div className="grid grid-cols-[38px_1fr_48px] items-center gap-2">
                  <input
                    type="color"
                    className="nodrag h-7 w-full rounded border bg-transparent"
                    value={selectedTextElement.color}
                    title="文字颜色"
                    onFocus={beginSelectedTextEdit}
                    onChange={(e) => updateSelectedTextElement({ color: e.target.value })}
                  />
                  <input
                    type="range"
                    min={10}
                    max={160}
                    value={selectedTextElement.size}
                    onFocus={beginSelectedTextEdit}
                    onChange={(e) => updateSelectedTextElement({ size: Math.max(10, Number(e.target.value) || selectedTextElement.size) })}
                    className="nodrag nowheel w-full accent-orange-400"
                  />
                  <span className="text-right opacity-70">{Math.round(selectedTextElement.size)}px</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded border border-dashed p-4 text-center text-[11px] opacity-50">没有可编辑图层</div>
        )}
      </section>
    </>
  );

  const renderSelectedTextEditor = () => {
    if (!selectedTextEditorOpen || !selectedTextElement || typeof document === 'undefined') return null;
    return createPortal(
      <div
        data-canvas-floating-ui="drawing-board-text-editor"
        className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            setSelectedTextEditorOpen(false);
          }
        }}
      >
        <div
          className="t8-node flex h-[min(78vh,680px)] w-[min(920px,calc(100vw-40px))] flex-col overflow-hidden rounded-xl border"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="t8-node-header flex flex-none items-center gap-2 rounded-t-[inherit] px-3 py-2">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--t8-accent, #fb923c) 18%, transparent)', color: 'var(--t8-accent, #fb923c)' }}
            >
              <Type size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">选中文字 · 放大编辑</div>
              <div className="truncate text-[11px] opacity-70">编辑完成后会同步回画板文字元素</div>
            </div>
            <button type="button" className="t8-mini-icon-button" title="关闭文字放大编辑" onClick={() => setSelectedTextEditorOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <textarea
              className="t8-input nodrag nowheel min-h-0 flex-1 resize-none px-3 py-2 text-[15px] leading-relaxed"
              value={selectedTextElement.text}
              autoFocus
              onFocus={beginSelectedTextEdit}
              onBlur={() => { textEditHistoryRef.current = null; }}
              onChange={(e) => updateSelectedTextElement({ text: e.target.value })}
              placeholder="编辑画板文字"
            />
            <div className="grid flex-none grid-cols-[52px_1fr_64px_auto] items-center gap-3">
              <input
                type="color"
                className="nodrag h-9 w-full rounded border bg-transparent"
                value={selectedTextElement.color}
                title="文字颜色"
                onFocus={beginSelectedTextEdit}
                onChange={(e) => updateSelectedTextElement({ color: e.target.value })}
              />
              <input
                type="range"
                min={10}
                max={160}
                value={selectedTextElement.size}
                onFocus={beginSelectedTextEdit}
                onChange={(e) => updateSelectedTextElement({ size: Math.max(10, Number(e.target.value) || selectedTextElement.size) })}
                className="nodrag nowheel w-full accent-orange-400"
              />
              <span className="text-right text-[12px] opacity-70">{Math.round(selectedTextElement.size)}px</span>
              <button type="button" className="t8-btn t8-btn-primary min-h-9 px-4 text-[12px]" onClick={() => setSelectedTextEditorOpen(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  const renderFocusEditor = () => {
    if (!focusEditorOpen || typeof document === 'undefined') return null;
    return createPortal(
      <div
        ref={focusOverlayRef}
        tabIndex={-1}
        data-canvas-floating-ui="drawing-board-focus"
        className="fixed inset-0 z-[10020] flex flex-col bg-black/72 p-4 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
      >
        <div className="t8-node flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
          <div className="t8-node-header flex flex-none items-center gap-2 rounded-t-[inherit] px-3 py-2">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--t8-accent, #fb923c) 18%, transparent)', color: 'var(--t8-accent, #fb923c)' }}
            >
              <Pencil size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">画板 · 放大编辑</div>
              <div className="truncate text-[11px] opacity-70">{boardW}×{boardH} · {focusZoomPercent}% · {TOOL_LABEL[tool]}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="t8-mini-icon-button" title="适应窗口" onClick={() => setFocusZoom('fit')}>
                <Minimize2 size={13} />
              </button>
              <button type="button" className="t8-mini-icon-button" title="缩小" onClick={() => setFocusZoomStep(numericFocusZoom - 0.15)}>
                <ZoomOut size={13} />
              </button>
              <button type="button" className="t8-btn min-h-8 px-2 text-[11px]" onClick={() => setFocusZoom(1)}>
                100%
              </button>
              <button type="button" className="t8-mini-icon-button" title="放大" onClick={() => setFocusZoomStep(numericFocusZoom + 0.15)}>
                <ZoomIn size={13} />
              </button>
              <button type="button" className="t8-mini-icon-button" title="关闭放大编辑" onClick={() => setFocusEditorOpen(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr_250px] gap-3 overflow-hidden p-3">
            <aside className="flex min-h-0 flex-col gap-2 overflow-auto pr-1">
              <div className="grid grid-cols-3 gap-1.5">
                {toolButton('select', <MousePointer2 size={13} />)}
                {toolButton('pen', <PenLine size={13} />)}
                {toolButton('eraser', <Eraser size={13} />)}
                {toolButton('text', <Type size={13} />)}
                {toolButton('line', <Minus size={13} />)}
                {toolButton('arrow', <Send size={13} />)}
                {toolButton('rect', <RectangleHorizontal size={13} />)}
                {toolButton('round-rect', <PanelTop size={13} />)}
                {toolButton('circle', <Circle size={13} />)}
                {toolButton('diamond', <Diamond size={13} />)}
                {toolButton('cutout-lasso', <Scissors size={13} />)}
                {toolButton('cutout-pen', <PenTool size={13} />)}
              </div>
              <div className="grid grid-cols-[38px_1fr_46px] items-center gap-2">
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => {
                    setStrokeColor(e.target.value);
                    update({ boardColor: e.target.value });
                  }}
                  className="nodrag h-8 w-full rounded border bg-transparent"
                  title="颜色"
                />
                <input
                  type="range"
                  min={1}
                  max={28}
                  value={strokeSize}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 5;
                    setStrokeSize(v);
                    update({ boardStrokeSize: v });
                  }}
                  className="nodrag nowheel w-full accent-orange-400"
                />
                <div className="text-right text-[11px] opacity-70">{strokeSize}px</div>
              </div>
              {renderBoardFillModeControls()}
              {tool === 'text' && (
                <input
                  className="t8-input nodrag nowheel h-8 w-full px-2 text-[11px]"
                  value={textDraft}
                  onChange={(e) => {
                    setTextDraft(e.target.value);
                    update({ boardTextDraft: e.target.value });
                  }}
                  placeholder="点击画布放置文字"
                />
              )}
              {isCutoutTool(tool) && (
                <div className="space-y-2 rounded border border-dashed p-2 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(148,163,184,.32))' }}>
                  <div className="flex items-center gap-1.5">
                    <Scissors size={12} />
                    <span className="font-semibold">抠图</span>
                    <span className="ml-auto opacity-60">{selectedCutoutSource ? '已选图片' : '先选中图片'}</span>
                  </div>
                  <div className="grid grid-cols-[52px_1fr_34px] items-center gap-1.5">
                    <span className="opacity-70">平滑</span>
                    <input type="range" min={0} max={12} value={cutoutSmooth} onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setCutoutSmooth(v);
                      update({ boardCutoutSmooth: v });
                    }} className="nodrag nowheel w-full accent-orange-400" />
                    <span className="text-right opacity-70">{cutoutSmooth}</span>
                  </div>
                  <div className="grid grid-cols-[52px_1fr_34px] items-center gap-1.5">
                    <span className="opacity-70">羽化</span>
                    <input type="range" min={0} max={32} value={cutoutFeather} onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setCutoutFeather(v);
                      update({ boardCutoutFeather: v });
                    }} className="nodrag nowheel w-full accent-orange-400" />
                    <span className="text-right opacity-70">{cutoutFeather}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <button type="button" className={`t8-btn min-h-7 px-2 text-[10px] ${cutoutInvert ? 't8-btn-primary' : ''}`} onClick={() => setCutoutInvert((v) => !v)}>
                      反选
                    </button>
                    <button type="button" className="t8-btn min-h-7 px-2 text-[10px]" onClick={closeCurrentCutoutDraft} disabled={!cutoutDraft || cutoutDraft.closed || cutoutDraft.points.length < 3}>
                      <Check size={12} /> 闭合
                    </button>
                    <button type="button" className="t8-btn min-h-7 px-2 text-[10px]" onClick={cancelCutoutDraft} disabled={!cutoutDraft}>
                      <X size={12} /> 取消
                    </button>
                  </div>
                  <button type="button" className="t8-btn t8-btn-primary min-h-8 w-full px-2 text-[11px]" onClick={() => void applyCutoutDraft()} disabled={!cutoutDraft?.closed || status === 'running'}>
                    {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
                    抠出为新图层
                  </button>
                </div>
              )}
              <button type="button" className="t8-btn min-h-8 w-full px-2 text-[11px]" onClick={() => imageInputRef.current?.click()}>
                <ImagePlus size={13} /> 载入图片
              </button>
              <button
                type="button"
                className="t8-btn min-h-8 w-full px-2 text-[11px]"
                onClick={() => void applyRhCutoutToSelectedImage()}
                disabled={!selectedCutoutSource || rhCutoutRunning || status === 'running'}
                title={selectedCutoutSource ? '调用 RH工具箱自动抠图并替换选中图片' : '请先选中一张图片'}
              >
                {rhCutoutRunning ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
                {rhCutoutRunning ? 'RH抠图中...' : 'RH自动抠图'}
              </button>
            </aside>

            <main
              className="flex min-h-0 items-center justify-center overflow-auto rounded-lg border p-4"
              style={{
                borderColor: 'var(--t8-border, rgba(148,163,184,.25))',
                background: 'repeating-conic-gradient(rgba(148,163,184,.18) 0% 25%, transparent 0% 50%) 50% / 22px 22px',
              }}
            >
              <div className="relative flex-none shadow-2xl" style={{ width: focusStageSize.w, height: focusStageSize.h }}>
                <canvas
                  ref={handleFocusCanvasRef}
                  className={`block h-full w-full touch-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endPointerAction}
                  onPointerCancel={endPointerAction}
                  onPointerLeave={endPointerAction}
                />
                {renderCutoutQuickBar(focusCutoutToolbarPosition)}
              </div>
            </main>

            <aside className="flex min-h-0 flex-col gap-2 overflow-auto pl-1 text-[11px]">
              {renderLayerPanel('focus')}
            </aside>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  if (canvasRenderMode === 'cold' && !focusEditorOpen && !selectedTextEditorOpen && !shortcutHelpOpen) {
    return (
      <div
        ref={rootRef}
        data-drawing-board-node="true"
        data-t8-node-cold-shell="drawing-board"
        className="t8-node t8-node-cold-shell"
        style={{ width: NODE_W, height: NODE_H }}
      >
        <Handle type="target" position={Position.Left} style={{ background: PORT_COLOR.image, border: 0, zIndex: 40 }} />
        <Handle type="source" position={Position.Right} style={{ background: PORT_COLOR.image, border: 0, zIndex: 40 }} />
        <div className="t8-node-cold-shell__header">
          <Pencil size={18} className="shrink-0 text-orange-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate('nodes:drawingBoard.title')}</strong>
            <small>{boardW}×{boardH} · {translate('nodes:drawingBoard.layerCount', { count: layers.filter((layer) => layer.kind === 'layer').length })} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDownCapture={handleRootKeyDownCapture}
      data-drawing-board-node="true"
      className={`t8-node relative flex flex-col transition-all ${selected ? 'ring-2 ring-orange-300' : ''}`}
      style={{ width: NODE_W, height: NODE_H, overflow: 'visible' }}
    >
      <Handle type="target" position={Position.Left} style={{ background: PORT_COLOR.image, border: 0, zIndex: 40 }} />
      <Handle type="source" position={Position.Right} style={{ background: PORT_COLOR.image, border: 0, zIndex: 40 }} />
      <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleLocalImageChange} />
      <input ref={boardJsonInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleBoardJsonChange} />
      {renderShortcutHelp()}

      <div className="t8-node-header flex items-center gap-2 rounded-t-[inherit] px-3 py-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--t8-accent, #fb923c) 18%, transparent)', color: 'var(--t8-accent, #fb923c)' }}
        >
          <Pencil size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">画板</div>
          <div className="truncate text-[11px] opacity-70">
            {boardW}×{boardH} · {layers.filter((layer) => layer.kind === 'layer').length} 图层 · {elementCount(layers)} 元素
          </div>
        </div>
        <button
          type="button"
          className={`t8-mini-icon-button nodrag nopan ${shortcutHelpOpen ? 't8-btn-primary' : ''}`}
          onClick={() => setShortcutHelpOpen((v) => !v)}
          title="画板快捷键"
          aria-label="画板快捷键"
        >
          <HelpCircle size={14} />
        </button>
        <button type="button" className="t8-mini-icon-button nodrag nopan" onClick={clearBoard} title="清空画板">
          <RotateCcw size={14} />
        </button>
      </div>

      <div
        data-drawing-board-body="true"
        className="nodrag nowheel grid min-h-0 grid-cols-[330px_1fr] gap-3 overflow-hidden p-3"
        style={{ flex: '1 1 0%', minHeight: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          <section className="t8-card flex-none space-y-2 p-2">
            <div className="grid grid-cols-3 gap-1.5">
              {toolButton('select', <MousePointer2 size={13} />)}
              {toolButton('pen', <PenLine size={13} />)}
              {toolButton('eraser', <Eraser size={13} />)}
              {toolButton('text', <Type size={13} />)}
              {toolButton('line', <Minus size={13} />)}
              {toolButton('arrow', <Send size={13} />)}
              {toolButton('rect', <RectangleHorizontal size={13} />)}
              {toolButton('round-rect', <PanelTop size={13} />)}
              {toolButton('circle', <Circle size={13} />)}
              {toolButton('diamond', <Diamond size={13} />)}
              {toolButton('cutout-lasso', <Scissors size={13} />)}
              {toolButton('cutout-pen', <PenTool size={13} />)}
            </div>
            <div className="grid grid-cols-[1fr_82px_82px] gap-2">
              <select className="t8-select nodrag nowheel h-8 px-2 text-[11px]" value={ratio} onChange={(e) => changeRatio(e.target.value as BoardRatio)}>
                <option value="free">自由尺寸</option>
                <option value="1:1">1:1 方图</option>
                <option value="16:9">16:9 横图</option>
                <option value="9:16">9:16 竖图</option>
                <option value="4:3">4:3 横图</option>
                <option value="3:4">3:4 竖图</option>
              </select>
              <input
                className="t8-input nodrag nowheel h-8 px-2 text-[11px]"
                type="number"
                min={MIN_BOARD_DIMENSION}
                max={MAX_BOARD_DIMENSION}
                value={boardWDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  if (/^\d*$/.test(next)) setBoardWDraft(next);
                }}
                onBlur={(e) => commitBoardDimension('w', e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitBoardDimension('w', e.currentTarget.value);
                    e.currentTarget.blur();
                  }
                }}
                title="画布宽度"
              />
              <input
                className="t8-input nodrag nowheel h-8 px-2 text-[11px]"
                type="number"
                min={MIN_BOARD_DIMENSION}
                max={MAX_BOARD_DIMENSION}
                value={boardHDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  if (/^\d*$/.test(next)) setBoardHDraft(next);
                }}
                onBlur={(e) => commitBoardDimension('h', e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitBoardDimension('h', e.currentTarget.value);
                    e.currentTarget.blur();
                  }
                }}
                title="画布高度"
              />
              <button
                type="button"
                className="t8-btn col-span-3 min-h-7 px-2 text-[10px]"
                onClick={() => void applyOriginalPixelSize()}
                disabled={!hasBoardImages}
                title={hasBoardImages ? '用当前选中图片或第一张图片的原始像素设置画布，并按 1:1 放置图片' : '请先载入一张图片'}
              >
                <Ruler size={12} /> 保持原图像素尺寸
              </button>
              <button
                type="button"
                className="t8-btn col-span-3 min-h-7 px-2 text-[10px]"
                onClick={() => void applyRhCutoutToSelectedImage()}
                disabled={!selectedCutoutSource || rhCutoutRunning || status === 'running'}
                title={selectedCutoutSource ? '调用 RH工具箱自动抠图并替换选中图片' : '请先选中一张图片'}
              >
                {rhCutoutRunning ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
                {rhCutoutRunning ? 'RH抠图中...' : 'RH自动抠图'}
              </button>
            </div>
            <div className="grid grid-cols-[38px_1fr_46px] items-center gap-2">
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => {
                  setStrokeColor(e.target.value);
                  update({ boardColor: e.target.value });
                }}
                className="nodrag h-8 w-full rounded border bg-transparent"
                title="颜色"
              />
              <input
                type="range"
                min={1}
                max={28}
                value={strokeSize}
                onChange={(e) => {
                  const v = Number(e.target.value) || 5;
                  setStrokeSize(v);
                  update({ boardStrokeSize: v });
                }}
                className="nodrag nowheel w-full accent-orange-400"
              />
              <div className="text-right text-[11px] opacity-70">{strokeSize}px</div>
            </div>
            {renderBoardFillModeControls()}
            {tool === 'text' && (
              <input
                className="t8-input nodrag nowheel h-8 w-full px-2 text-[11px]"
                value={textDraft}
                onChange={(e) => {
                  setTextDraft(e.target.value);
                  update({ boardTextDraft: e.target.value });
                }}
                placeholder="点击右侧画布放置文字"
              />
            )}
            {isCutoutTool(tool) && (
              <div className="space-y-2 rounded border border-dashed p-2 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(148,163,184,.32))' }}>
                <div className="flex items-center gap-1.5">
                  <Scissors size={12} />
                  <span className="font-semibold">抠图</span>
                  <span className="ml-auto opacity-60">
                    {selectedCutoutSource ? '已选图片' : '先选中图片'}
                  </span>
                </div>
                <div className="grid grid-cols-[52px_1fr_34px] items-center gap-1.5">
                  <span className="opacity-70">平滑</span>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={cutoutSmooth}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setCutoutSmooth(v);
                      update({ boardCutoutSmooth: v });
                    }}
                    className="nodrag nowheel w-full accent-orange-400"
                  />
                  <span className="text-right opacity-70">{cutoutSmooth}</span>
                </div>
                <div className="grid grid-cols-[52px_1fr_34px] items-center gap-1.5">
                  <span className="opacity-70">羽化</span>
                  <input
                    type="range"
                    min={0}
                    max={32}
                    value={cutoutFeather}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      setCutoutFeather(v);
                      update({ boardCutoutFeather: v });
                    }}
                    className="nodrag nowheel w-full accent-orange-400"
                  />
                  <span className="text-right opacity-70">{cutoutFeather}</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <button type="button" className={`t8-btn min-h-7 px-2 text-[10px] ${cutoutInvert ? 't8-btn-primary' : ''}`} onClick={() => setCutoutInvert((v) => !v)}>
                    反选
                  </button>
                  <button
                    type="button"
                    className="t8-btn min-h-7 px-2 text-[10px]"
                    onClick={closeCurrentCutoutDraft}
                    disabled={!cutoutDraft || cutoutDraft.closed || cutoutDraft.points.length < 3}
                  >
                    <Check size={12} /> 闭合
                  </button>
                  <button type="button" className="t8-btn min-h-7 px-2 text-[10px]" onClick={cancelCutoutDraft} disabled={!cutoutDraft}>
                    <X size={12} /> 取消
                  </button>
                </div>
                <button
                  type="button"
                  className="t8-btn t8-btn-primary min-h-8 w-full px-2 text-[11px]"
                  onClick={() => void applyCutoutDraft()}
                  disabled={!cutoutDraft?.closed || status === 'running'}
                >
                  {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
                  抠出为新图层
                </button>
                <div className="leading-relaxed opacity-60">
                  {tool === 'cutout-lasso'
                    ? '套索：按住拖动圈选，松手后确认。'
                    : '钢笔：点击加点，点回起点或按 Enter 闭合，Backspace 撤回点。'}
                </div>
              </div>
            )}
          </section>

          {renderLayerPanel('inline')}

        </div>

        <section className="t8-card flex min-h-0 flex-col p-2">
          <div className="mb-2 flex flex-none items-center justify-between gap-2 text-[11px] opacity-80">
            <span>创作画布</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="t8-btn min-h-7 px-2 text-[10px]"
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlus size={12} /> 载入图片
              </button>
              <button
                type="button"
                className="t8-mini-icon-button"
                title="放大编辑"
                aria-label="放大编辑"
                onClick={openFocusEditor}
              >
                <Maximize2 size={13} />
              </button>
              {hasUpstreamImages && (
                <button
                  type="button"
                  className="t8-btn min-h-7 px-2 text-[10px]"
                  onClick={() => void addImageLayers(upstream.images.map((m) => ({ url: m.url, name: m.label })))}
                >
                  <ImagePlus size={12} /> 导入上游 {upstream.images.length}
                </button>
              )}
            </div>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border p-2"
            style={{
              borderColor: 'var(--t8-border, rgba(148,163,184,.25))',
              background: 'repeating-conic-gradient(rgba(148,163,184,.18) 0% 25%, transparent 0% 50%) 50% / 22px 22px',
            }}
          >
            <div className="relative flex-none" style={{ width: previewSize.w, height: previewSize.h }}>
              <canvas
                ref={canvasRef}
                className={`block h-full w-full touch-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPointerAction}
                onPointerCancel={endPointerAction}
                onPointerLeave={endPointerAction}
              />
              {renderCutoutQuickBar(cutoutToolbarPosition)}
            </div>
          </div>
          {error && (
            <div
              className="mt-2 flex-none rounded border px-2 py-1 text-[11px]"
              style={{
                borderColor: 'color-mix(in srgb, var(--t8-danger, #ef4444) 45%, transparent)',
                background: 'color-mix(in srgb, var(--t8-danger, #ef4444) 12%, transparent)',
                color: 'var(--t8-danger, #ef4444)',
              }}
            >
              {error}
            </div>
          )}
          <div className="mt-2 grid flex-none grid-cols-[1fr_1fr_1.35fr] gap-2">
            <button
              type="button"
              className="t8-btn min-h-8 px-2 text-[11px]"
              onClick={() => boardJsonInputRef.current?.click()}
            >
              <Upload size={13} /> 导入画板
            </button>
            <button type="button" className="t8-btn min-h-8 px-2 text-[11px]" onClick={exportBoardJson}>
              <Download size={13} /> 导出画板
            </button>
            <button
              type="button"
              className="t8-btn t8-btn-primary min-h-8 px-2 text-[11px]"
              onClick={() => requestCanvasNodeRun(id)}
              disabled={status === 'running'}
            >
              {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {status === 'running' ? '导出中...' : '运行输出画板图像'}
            </button>
          </div>
        </section>
      </div>
      {renderFocusEditor()}
      {renderSelectedTextEditor()}
    </div>
  );
};

export default memo(DrawingBoardNode);
