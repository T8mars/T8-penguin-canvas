export type CanvasPerformanceMode = 'auto' | 'balanced' | 'performance';
export type EffectiveCanvasPerformanceMode = Exclude<CanvasPerformanceMode, 'auto'>;

export type CanvasPerformanceMetrics = {
  nodeCount: number;
  edgeCount: number;
  heavyMediaCount: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  prefersReducedMotion?: boolean;
};

export type CanvasPerformanceDecision = {
  requested: CanvasPerformanceMode;
  effective: EffectiveCanvasPerformanceMode;
  reason: 'manual-balanced' | 'manual-performance' | 'very-large-graph' | 'media-heavy' | 'low-power-device' | 'reduced-motion' | 'normal-load';
  reasonLabel: string;
};

export function normalizeCanvasPerformanceMode(value: unknown): CanvasPerformanceMode {
  return value === 'balanced' || value === 'performance' ? value : 'auto';
}

export function resolveCanvasPerformanceDecision(
  requestedValue: unknown,
  metrics: CanvasPerformanceMetrics,
): CanvasPerformanceDecision {
  const requested = normalizeCanvasPerformanceMode(requestedValue);
  if (requested === 'balanced') {
    return { requested, effective: 'balanced', reason: 'manual-balanced', reasonLabel: '用户选择均衡模式，保留完整主题效果' };
  }
  if (requested === 'performance') {
    return { requested, effective: 'performance', reason: 'manual-performance', reasonLabel: '用户选择高性能模式' };
  }

  const nodeCount = Math.max(0, Math.trunc(metrics.nodeCount || 0));
  const edgeCount = Math.max(0, Math.trunc(metrics.edgeCount || 0));
  const heavyMediaCount = Math.max(0, Math.trunc(metrics.heavyMediaCount || 0));
  const hardwareConcurrency = Number(metrics.hardwareConcurrency || 0);
  const deviceMemoryGb = Number(metrics.deviceMemoryGb || 0);

  if (nodeCount >= 500 || edgeCount >= 700) {
    return { requested, effective: 'performance', reason: 'very-large-graph', reasonLabel: `超大画布：${nodeCount} 节点 / ${edgeCount} 连线` };
  }
  if (heavyMediaCount >= 30 || (nodeCount >= 180 && heavyMediaCount >= 12)) {
    return { requested, effective: 'performance', reason: 'media-heavy', reasonLabel: `重媒体负载：约 ${heavyMediaCount} 项媒体` };
  }
  if ((hardwareConcurrency > 0 && hardwareConcurrency <= 4 && nodeCount >= 96)
    || (deviceMemoryGb > 0 && deviceMemoryGb <= 4 && nodeCount >= 72)) {
    return { requested, effective: 'performance', reason: 'low-power-device', reasonLabel: '设备资源较紧张且当前画布较大' };
  }
  if (metrics.prefersReducedMotion && (nodeCount >= 96 || heavyMediaCount >= 12)) {
    return { requested, effective: 'performance', reason: 'reduced-motion', reasonLabel: '系统偏好减少动态效果且画布负载较高' };
  }
  return { requested, effective: 'balanced', reason: 'normal-load', reasonLabel: '当前画布负载适中' };
}

const HEAVY_NODE_TYPES = new Set([
  'video', 'video-edit', 'audio', 'model-3d-preview', 'model-3d', 'panorama-3d',
  'drawing-board', 'browser', 'previs-studio', 'director-storyboard', 'script-master',
  'mv-music-master', 'story', 'grok-oauth-agent',
]);

export function estimateCanvasHeavyMediaCount(nodes: ReadonlyArray<{ type?: unknown; data?: unknown }>) {
  let count = 0;
  for (const node of nodes) {
    const type = String(node.type || '');
    if (HEAVY_NODE_TYPES.has(type)) count += 1;
    const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};
    const arrays = ['imageUrls', 'videoUrls', 'audioUrls', 'urls', 'generatedImages', 'directImageUrls', 'directVideoUrls', 'directAudioUrls'];
    for (const key of arrays) {
      if (Array.isArray(data[key])) count += Math.min(12, data[key].length);
    }
    if (typeof data.imageUrl === 'string' && data.imageUrl) count += 1;
    if (typeof data.videoUrl === 'string' && data.videoUrl) count += 2;
    if (typeof data.audioUrl === 'string' && data.audioUrl) count += 1;
    if (typeof data.modelUrl === 'string' && data.modelUrl) count += 2;
  }
  return count;
}

export function isPerformancePinnedNode(node: { selected?: boolean; data?: unknown }) {
  if (node.selected) return true;
  const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};
  if (data.running === true || data.isRunning === true || data.pendingConfirmation === true) return true;
  const status = String(data.status || data.runStatus || data.taskStatus || data.fixtureRunState || '').toLowerCase();
  return ['running', 'queued', 'pending', 'waiting', 'error', 'failed', 'canceling'].includes(status);
}
