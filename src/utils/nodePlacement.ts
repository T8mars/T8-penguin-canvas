/**
 * src/utils/nodePlacement.ts (v1.2.10.5)
 *
 * 节点落点防重叠解析器 — 收口所有"新节点写入画布"的位置计算。
 *
 * 背景:
 *   画布 6 处入口 (Sidebar 添加 / 右键添加 / autoOutput / 双击编辑产物 /
 *   循环器克隆 / Upload 自动 output) 之前都用硬编码坐标写 setNodes/addNodes,
 *   未读取 nodes[] 求交集, 高密度场景下新节点会精确盖在旧节点上。
 *
 * 设计:
 *   1. 单节点避让 resolveSingleSpawn — 阿基米德方形螺线 (右→下→左→上),
 *      step=80px, 最多 64 次 (≈5 圈), 找不到再走"最右兜底 + toast + setCenter"。
 *   2. 整组避让 resolveBatchSpawn — 把 N 个 desiredRect 视作整组,
 *      用同样螺线找一个公共偏移 (dx,dy) 让整组都不与现有节点相交;
 *      保持 9 宫格 / 多链克隆 等内部相对布局完整。
 *   3. 默认尺寸字典 NODE_DEFAULT_SIZE — 新节点尚未挂载时的兜底估算,
 *      已挂载节点优先取 measured > width/height > 字典默认。
 *
 * 配置:
 *   GAP=32 STEP=80 MAX_TRIES=64 (skill.md §48 沉淀)
 *
 * 提示:
 *   兜底触发时通过 logBus.warn 写日志面板 + onFallback 回调由调用方挂 setCenter 飞镜。
 */

import type { Node } from '@xyflow/react';
import { logBus } from '../stores/logs';

// ===== 配置项 =====
export const PLACEMENT_GAP = 32;
export const PLACEMENT_STEP = 80;
export const PLACEMENT_MAX_TRIES = 64;

// ===== 默认尺寸字典 (新节点尚未挂载时的兜底估算) =====
// 数值参考各节点组件的默认 size / minWidth / 实测 measured 中位数
export const NODE_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  text: { w: 280, h: 180 },
  image: { w: 320, h: 360 },
  edit: { w: 320, h: 360 },
  output: { w: 320, h: 360 },
  upload: { w: 260, h: 360 },
  'model-3d-upload': { w: 260, h: 260 },
  'material-set': { w: 320, h: 300 },
  'generation-target': { w: 360, h: 260 },
  'drawing-board': { w: 1120, h: 760 },
  video: { w: 320, h: 380 },
  'video-edit': { w: 1120, h: 680 },
  seedance: { w: 320, h: 380 },
  'script-master': { w: 390, h: 360 },
  'minimax-music3-prompt-enhancer': { w: 440, h: 760 },
  'mv-music-master': { w: 410, h: 430 },
  'localization-master': { w: 560, h: 720 },
  audio: { w: 320, h: 380 },
  llm: { w: 320, h: 360 },
  runninghub: { w: 360, h: 460 },
  'runninghub-wallet': { w: 360, h: 460 },
  'rh-tools': { w: 360, h: 460 },
  'rh-toolbox': { w: 360, h: 460 },
  vibex: { w: 1080, h: 820 },
  'fal-toolbox': { w: 380, h: 500 },
  'codex-cli-agent': { w: 420, h: 520 },
  'codex-image-conjure': { w: 520, h: 680 },
  'artist-style-master': { w: 480, h: 620 },
  'anime-tag-master': { w: 500, h: 660 },
  'model-3d-preview': { w: 520, h: 440 },
  'model-3d': { w: 360, h: 560 },
  'grok-image-tools': { w: 360, h: 520 },
  'face-expression-3d': { w: 520, h: 520 },
  'comfyui-store': { w: 400, h: 560 },
  'comfyui-app-maker': { w: 720, h: 620 },
  ...(import.meta.env?.DEV ? { 'rh-toolbox-maker': { w: 760, h: 620 }, 'fal-toolbox-maker': { w: 720, h: 620 } } : {}),
  'multi-angle-3d': { w: 320, h: 380 },
  'panorama-720': { w: 320, h: 380 },
  'penguin-portrait': { w: 320, h: 380 },
  loop: { w: 320, h: 240 },
  'random-route': { w: 300, h: 420 },
  'pick-from-set': { w: 280, h: 200 },
  'text-split': { w: 760, h: 520 },
  resize: { w: 280, h: 220 },
  combine: { w: 280, h: 220 },
  'remove-bg': { w: 280, h: 220 },
  upscale: { w: 280, h: 220 },
  'frame-extractor': { w: 320, h: 300 },
  'frame-pair': { w: 320, h: 360 },
  'grid-crop': { w: 320, h: 360 },
  'grid-editor': { w: 520, h: 620 },
  cinematic: { w: 720, h: 460 },
  'video-motion': { w: 720, h: 460 },
  'multi-angle-visual': { w: 760, h: 520 },
  'portrait-master': { w: 560, h: 360 },
  'pose-master': { w: 900, h: 720 },
  'aggregate-parser': { w: 620, h: 680 },
  'batch-processor': { w: 640, h: 560 },
  'batch-tagger': { w: 720, h: 620 },
  'topaz-image-upscale': { w: 390, h: 620 },
  'topaz-video-upscale': { w: 420, h: 720 },
  'panorama-3d': { w: 1180, h: 760 },
  'remove-ai-watermark': { w: 380, h: 520 },
  groupBox: { w: 480, h: 320 },
};

const FALLBACK_SIZE = { w: 320, h: 240 };

// ===== 类型 =====
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementOptions {
  gap?: number;
  step?: number;
  maxTries?: number;
  /** 兜底触发时回调 (调用方可调 setCenter 飞镜) */
  onFallback?: (finalPos: { x: number; y: number }) => void;
  /** 日志来源标识 (TerminalPanel 显示前缀) */
  source?: string;
}

// ===== 工具函数 =====
/** 读取节点实际包围盒: measured > width/height > 字典默认 > FALLBACK_SIZE
 * v1.2.10.5-hotfix2: 当 measured 不可用时(节点未被 DOM 渲染/测量), 字典默认值加 30% 安全边距,
 * 避免实际渲染尺寸超出字典导致碰撞检测遍漏。
 */
export function rectOf(node: Node): Rect {
  const hasMeasured = !!(node as any).measured?.width;
  const rawW =
    (node as any).measured?.width ||
    (node as any).width ||
    (node.type ? NODE_DEFAULT_SIZE[node.type]?.w : undefined) ||
    FALLBACK_SIZE.w;
  const rawH =
    (node as any).measured?.height ||
    (node as any).height ||
    (node.type ? NODE_DEFAULT_SIZE[node.type]?.h : undefined) ||
    FALLBACK_SIZE.h;
  // 未测量时加 30% 安全边距（节点实际常比字典大）
  const safetyFactor = hasMeasured ? 1 : 1.3;
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    w: Math.ceil(rawW * safetyFactor),
    h: Math.ceil(rawH * safetyFactor),
  };
}

/** 按节点类型估算默认尺寸 (用于新节点尚未挂载时) */
export function defaultSizeOf(type: string): { w: number; h: number } {
  return NODE_DEFAULT_SIZE[type] || FALLBACK_SIZE;
}

/** 矩形相交判定 (含 padding) */
export function rectsIntersect(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/** 任一相交即冲突 */
function anyIntersect(rect: Rect, others: Rect[], gap: number): boolean {
  for (const r of others) {
    if (rectsIntersect(rect, r, gap)) return true;
  }
  return false;
}

/**
 * 阿基米德方形螺线 (右→下→左→上), 累圈递增。
 * 第 k 圈每个方向的步数 = k (右 k 步, 下 k 步, 左 k+1 步, 上 k+1 步)。
 * 这样保证落点优先往右下蔓延 (符合阅读习惯), 且不会跳跃。
 *
 * 生成器返回相对偏移 (dx, dy), step 单位 px。
 */
function* spiralOffsets(step: number, maxTries: number): Generator<{ dx: number; dy: number }> {
  yield { dx: 0, dy: 0 };
  let x = 0;
  let y = 0;
  let tries = 1;
  let leg = 1;
  while (tries < maxTries) {
    // 右 leg 步
    for (let i = 0; i < leg && tries < maxTries; i++) {
      x += step;
      yield { dx: x, dy: y };
      tries++;
    }
    // 下 leg 步
    for (let i = 0; i < leg && tries < maxTries; i++) {
      y += step;
      yield { dx: x, dy: y };
      tries++;
    }
    leg++;
    // 左 leg 步
    for (let i = 0; i < leg && tries < maxTries; i++) {
      x -= step;
      yield { dx: x, dy: y };
      tries++;
    }
    // 上 leg 步
    for (let i = 0; i < leg && tries < maxTries; i++) {
      y -= step;
      yield { dx: x, dy: y };
      tries++;
    }
    leg++;
  }
}

/** 取所有现有节点矩形 (排除自身或克隆来源节点, 由调用方在 existingNodes 里筛) */
export function collectRects(nodes: Node[], excludeIds?: Set<string>): Rect[] {
  const out: Rect[] = [];
  for (const n of nodes) {
    if (excludeIds && excludeIds.has(n.id)) continue;
    out.push(rectOf(n));
  }
  return out;
}

/**
 * v1.2.10.5-hotfix: 自适应 step 计算
 * 取参与碰撞的所有矩形(desired + existing) 最大维度 + gap, 保证 spiral 一步即可跨出最大节点。
 * 兜底不小于 fallback (默认 PLACEMENT_STEP=80) 防止全空场景 step=0。
 *
 * 之前 bug: 默认 step=80 远小于 OutputNode 等大节点 (320x360),
 * spiral 前 20+ 步全在节点内部反复横跳, 64 步都走不出去, 落点仍重叠。
 */
function computeAdaptiveStep(rects: Rect[], gap: number, fallback: number): number {
  let maxDim = fallback;
  for (const r of rects) {
    const w = r.w + gap;
    const h = r.h + gap;
    if (w > maxDim) maxDim = w;
    if (h > maxDim) maxDim = h;
  }
  return maxDim;
}

/** spiral 单 pass 搜索: 找到无重叠 candidate 即返回 {x,y}, 否则 null */
function spiralSearchSingle(
  desired: Rect,
  existing: Rect[],
  step: number,
  maxTries: number,
  gap: number
): { x: number; y: number } | null {
  for (const off of spiralOffsets(step, maxTries)) {
    const candidate: Rect = { x: desired.x + off.dx, y: desired.y + off.dy, w: desired.w, h: desired.h };
    if (!anyIntersect(candidate, existing, gap)) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return null;
}

/** spiral 单 pass 搜索 (整组): 找到所有矩形都无重叠的公共偏移即返回 {dx,dy}, 否则 null */
function spiralSearchBatch(
  desiredRects: Rect[],
  existing: Rect[],
  step: number,
  maxTries: number,
  gap: number
): { dx: number; dy: number } | null {
  for (const off of spiralOffsets(step, maxTries)) {
    let ok = true;
    for (const r of desiredRects) {
      const cand: Rect = { x: r.x + off.dx, y: r.y + off.dy, w: r.w, h: r.h };
      if (anyIntersect(cand, existing, gap)) {
        ok = false;
        break;
      }
    }
    if (ok) return { dx: off.dx, dy: off.dy };
  }
  return null;
}

/**
 * v1.2.10.7: 向右线性扫描（单节点）—— 螺线覆盖 ~400px 后若失败，
 * 沿自然流动方向（右）逐步搜索空位，避免直接跳到画布最右端。
 * 每步 X 方向递增 step，Y 方向尝试 0 / +step / -step 三个偏移。
 * 扫描范围最大 RIGHTWARD_MAX_RANGE px。
 */
const RIGHTWARD_MAX_RANGE = 3000;

function rightwardScanSingle(
  desired: Rect, existing: Rect[], step: number, gap: number
): { x: number; y: number } | null {
  const maxSteps = Math.ceil(RIGHTWARD_MAX_RANGE / step);
  for (let i = 1; i <= maxSteps; i++) {
    const dx = i * step;
    // 尝试三个 Y 偏移: 正中 / 偏下 / 偏上
    for (const dy of [0, step, -step]) {
      const cand: Rect = { x: desired.x + dx, y: desired.y + dy, w: desired.w, h: desired.h };
      if (!anyIntersect(cand, existing, gap)) {
        return { x: cand.x, y: cand.y };
      }
    }
  }
  return null;
}

function rightwardScanBatch(
  desiredRects: Rect[], existing: Rect[], step: number, gap: number
): { dx: number; dy: number } | null {
  const maxSteps = Math.ceil(RIGHTWARD_MAX_RANGE / step);
  for (let i = 1; i <= maxSteps; i++) {
    const dx = i * step;
    for (const dy of [0, step, -step]) {
      let ok = true;
      for (const r of desiredRects) {
        const cand: Rect = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
        if (anyIntersect(cand, existing, gap)) { ok = false; break; }
      }
      if (ok) return { dx, dy };
    }
  }
  return null;
}

/**
 * 单节点避让 — 期望落点 desired, 现有节点矩形 existing,
 * 螺线找无重叠位置, 失败走向右扫描, 再失败走最右兜底。
 *
 * @returns 最终落点 (x, y) — 节点左上角坐标。
 */
export function resolveSingleSpawn(
  desired: Rect,
  existing: Rect[],
  opts: PlacementOptions = {}
): { x: number; y: number } {
  const gap = opts.gap ?? PLACEMENT_GAP;
  const baseStep = opts.step ?? PLACEMENT_STEP;
  const maxTries = opts.maxTries ?? PLACEMENT_MAX_TRIES;

  // Pass 1: 螺线搜索 (~400px 范围内找紧凑空位)
  const hit = spiralSearchSingle(desired, existing, baseStep, maxTries, gap);
  if (hit) return hit;

  // Pass 2: 向右线性扫描 (覆盖螺线到不了的中远距离空隙)
  const rightHit = rightwardScanSingle(desired, existing, baseStep, gap);
  if (rightHit) return rightHit;

  // Pass 3 兜底: 所有现有节点最右侧 + gap, y 取期望 y
  return fallbackRightmost(desired, existing, gap, opts);
}

/**
 * 整组避让 — N 个 desiredRect 作为一个组, 找到一个公共偏移 (dx,dy)
 * 让整组都不与 existing 相交。保持组内相对布局不变 (适合 9 宫格 / 多链克隆)。
 *
 * @returns 整组要平移的偏移 (dx, dy)。调用方对每个 desiredRect 加上该偏移即可。
 */
export function resolveBatchSpawn(
  desiredRects: Rect[],
  existing: Rect[],
  opts: PlacementOptions = {}
): { dx: number; dy: number } {
  if (desiredRects.length === 0) return { dx: 0, dy: 0 };

  const gap = opts.gap ?? PLACEMENT_GAP;
  const baseStep = opts.step ?? PLACEMENT_STEP;
  const maxTries = opts.maxTries ?? PLACEMENT_MAX_TRIES;

  // Pass 1: 螺线搜索 (~400px 范围内找紧凑空位)
  const hit = spiralSearchBatch(desiredRects, existing, baseStep, maxTries, gap);
  if (hit) return hit;

  // Pass 2: 向右线性扫描 (覆盖螺线到不了的中远距离空隙)
  const rightHit = rightwardScanBatch(desiredRects, existing, baseStep, gap);
  if (rightHit) return rightHit;

  // Pass 3 兜底: 把整组挪到最右边
  const groupBox: Rect = boundingBox(desiredRects);
  const fallback = fallbackRightmost(groupBox, existing, gap, opts);
  return {
    dx: fallback.x - groupBox.x,
    dy: fallback.y - groupBox.y,
  };
}

/** 取一组矩形的包围盒 */
function boundingBox(rects: Rect[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 兜底: 把 desired 放到所有现有节点的最右侧 + gap, y 取期望 y。
 * 若 existing 为空则原位返回。
 * 触发时写日志 + 调用 onFallback 让上层飞镜。
 */
function fallbackRightmost(
  desired: Rect,
  existing: Rect[],
  gap: number,
  opts: PlacementOptions
): { x: number; y: number } {
  if (existing.length === 0) return { x: desired.x, y: desired.y };

  let maxRight = -Infinity;
  for (const r of existing) {
    if (r.x + r.w > maxRight) maxRight = r.x + r.w;
  }
  const finalX = maxRight + gap;
  const finalY = desired.y;

  // 提示 + 飞镜回调
  const src = opts.source || 'placement';
  logBus.warn(`画布密集，新节点已落到最右兜底位置 (${Math.round(finalX)}, ${Math.round(finalY)})`, src);
  if (opts.onFallback) {
    try {
      opts.onFallback({ x: finalX + desired.w / 2, y: finalY + desired.h / 2 });
    } catch (e) {
      // 防御性: onFallback 异常不影响落点
    }
  }

  return { x: finalX, y: finalY };
}

// ===== 便捷封装 =====
/**
 * 一站式: 给定期望左上角 (dx, dy) + 节点类型, 返回最终位置。
 * 内部自动取节点尺寸 + 收集现有矩形 + 走单节点避让。
 */
export function placeSingleNode(
  desiredX: number,
  desiredY: number,
  type: string,
  existingNodes: Node[],
  opts: PlacementOptions = {}
): { x: number; y: number } {
  const sz = defaultSizeOf(type);
  const desired: Rect = { x: desiredX, y: desiredY, w: sz.w, h: sz.h };
  const existing = collectRects(existingNodes);
  // DEBUG: 验证 placement 是否被调用
  console.warn('[placement:single]', {
    desired,
    existingCount: existing.length,
    existingMeasured: existing.filter(r => r.w > 0 && r.h > 0).length,
    source: opts.source,
  });
  const result = resolveSingleSpawn(desired, existing, opts);
  if (result.x !== desiredX || result.y !== desiredY) {
    console.warn('[placement:single] MOVED', { from: { x: desiredX, y: desiredY }, to: result });
  } else {
    console.warn('[placement:single] NO MOVE (desired pos is clear)');
  }
  return result;
}

/**
 * 一站式: 给定 N 个期望矩形 + 现有节点 + 排除集合, 返回应平移的偏移。
 * 适合 9 宫格输出 / 多链克隆 / 通用批量产物。
 */
export function placeBatchNodes(
  desiredRects: Rect[],
  existingNodes: Node[],
  opts: PlacementOptions & { excludeIds?: Set<string> } = {}
): { dx: number; dy: number } {
  const existing = collectRects(existingNodes, opts.excludeIds);
  // reorder-grid 频繁调用，不输出诊断日志避免刷屏
  const _quiet = opts.source === 'placement:reorder-grid';
  if (!_quiet) {
    console.warn('[placement:batch]', {
      desiredCount: desiredRects.length,
      desiredRects: desiredRects.slice(0, 3),
      existingCount: existing.length,
      existingMeasured: existing.filter(r => r.w > 0 && r.h > 0).length,
      source: opts.source,
    });
  }
  const result = resolveBatchSpawn(desiredRects, existing, opts);
  if (result.dx !== 0 || result.dy !== 0) {
    if (!_quiet) console.warn('[placement:batch] MOVED by', result);
  } else if (!_quiet) {
    // 检查是否真的无碰撞
    const gap = opts.gap ?? PLACEMENT_GAP;
    let hasCollision = false;
    for (const r of desiredRects) {
      if (anyIntersect(r, existing, gap)) { hasCollision = true; break; }
    }
    if (hasCollision) {
      console.warn('[placement:batch] NO MOVE ⚠️ BUT COLLISION EXISTS! BUG!');
    } else {
      // 找最近的 existing rect 给调试
      let minDist = Infinity;
      let closestRect: Rect | null = null;
      for (const d of desiredRects) {
        for (const e of existing) {
          const dx = Math.abs((d.x + d.w / 2) - (e.x + e.w / 2));
          const dy = Math.abs((d.y + d.h / 2) - (e.y + e.h / 2));
          const dist = dx + dy;
          if (dist < minDist) { minDist = dist; closestRect = e; }
        }
      }
      console.warn('[placement:batch] NO MOVE (desired pos clear)', {
        desiredRects: desiredRects.map(r => `(${Math.round(r.x)},${Math.round(r.y)} ${r.w}x${r.h})`),
        closestExisting: closestRect ? `(${Math.round(closestRect.x)},${Math.round(closestRect.y)} ${closestRect.w}x${closestRect.h}) dist=${Math.round(minDist)}` : 'none',
      });
    }
  }
  return result;
}
