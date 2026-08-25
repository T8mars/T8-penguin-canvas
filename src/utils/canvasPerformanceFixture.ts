export type CanvasPerformanceFixtureSize = 100 | 500 | 1000;

export interface CanvasPerformanceFixture {
  schema: 't8-canvas-performance-fixture-v1';
  seed: 8242026;
  size: CanvasPerformanceFixtureSize;
  nodes: Array<{
    id: string;
    entityUid: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; entityUid: string; source: string; target: string }>;
}

const TYPES = [
  'text', 'image', 'video', 'audio', 'output', 'model-3d-preview',
  'script-master', 'drawing-board', 'llm', 'runninghub',
] as const;

function fixtureEntityUid(kind: 'node' | 'edge', index: number) {
  const prefix = kind === 'node' ? '10000000' : '20000000';
  return `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export function parseCanvasPerformanceFixtureSize(value: unknown): CanvasPerformanceFixtureSize | null {
  const parsed = Number(String(value ?? '').trim());
  return parsed === 100 || parsed === 500 || parsed === 1000 ? parsed : null;
}

/**
 * Diagnostic fixtures are deliberately opt-in and URL scoped. Unknown values
 * fail closed so an ordinary canvas can never be replaced by benchmark data.
 */
export function readCanvasPerformanceFixtureSize(search: string): CanvasPerformanceFixtureSize | null {
  return parseCanvasPerformanceFixtureSize(new URLSearchParams(search).get('canvasPerfFixture'));
}

/** Deterministic, URL-only fixture data. It never performs I/O or starts runs. */
export function buildCanvasPerformanceFixture(size: CanvasPerformanceFixtureSize): CanvasPerformanceFixture {
  const columns = Math.max(10, Math.ceil(Math.sqrt(size)));
  const nodes = Array.from({ length: size }, (_, index) => {
    const type = TYPES[index % TYPES.length];
    const state = index % 97 === 0 ? 'running' : index % 89 === 0 ? 'failed' : 'completed';
    const data: Record<string, unknown> = {
      title: `fixture-${index + 1}`,
      __performanceFixture: true,
      fixtureRunState: state,
      fixtureMediaKind: type === 'image' || type === 'output' || type === 'video' || type === 'audio' || type === 'model-3d-preview'
        ? type
        : undefined,
      prompt: `Deterministic benchmark material ${index + 1}`,
    };
    return {
      id: `perf-node-${index + 1}`,
      entityUid: fixtureEntityUid('node', index),
      type,
      position: { x: (index % columns) * 390, y: Math.floor(index / columns) * 330 },
      data,
    };
  });
  const edges = nodes.slice(1).map((node, index) => ({
    id: `perf-edge-${index + 1}`,
    entityUid: fixtureEntityUid('edge', index),
    source: nodes[index].id,
    target: node.id,
  }));
  return { schema: 't8-canvas-performance-fixture-v1', seed: 8242026, size, nodes, edges };
}

export const CANVAS_PERFORMANCE_FIXTURE_SIZES = [100, 500, 1000] as const;

export interface CanvasPerformanceAcceptanceInput {
  fixtureSize: CanvasPerformanceFixtureSize;
  nodeCount: number;
  hydrationToInteractiveMs: number;
  p95FrameMs: number | null;
  maxLongTaskMs: number;
  playingVideos: number;
}

export interface CanvasPerformanceAcceptanceResult {
  pass: boolean;
  issues: string[];
}

/** Roadmap #24 laboratory gates. Comparative resource reduction is reported separately. */
export function evaluateCanvasPerformanceAcceptance(
  input: CanvasPerformanceAcceptanceInput,
): CanvasPerformanceAcceptanceResult {
  const issues: string[] = [];
  if (input.nodeCount !== input.fixtureSize) {
    issues.push(`node-count:${input.nodeCount}/${input.fixtureSize}`);
  }
  const interactiveTargetMs = input.fixtureSize === 500 ? 3000 : input.fixtureSize === 1000 ? 5000 : null;
  if (interactiveTargetMs != null && (input.hydrationToInteractiveMs < 0 || input.hydrationToInteractiveMs > interactiveTargetMs)) {
    issues.push(`interactive:${input.hydrationToInteractiveMs.toFixed(1)}>${interactiveTargetMs}`);
  }
  if (input.fixtureSize === 500) {
    if (input.p95FrameMs == null) issues.push('frame-sample:missing');
    else if (input.p95FrameMs > 33) issues.push(`frame-p95:${input.p95FrameMs.toFixed(1)}>33`);
  }
  if (input.maxLongTaskMs > 2000) issues.push(`long-task:${input.maxLongTaskMs.toFixed(1)}>2000`);
  if (input.playingVideos > 0) issues.push(`playing-videos:${input.playingVideos}`);
  return { pass: issues.length === 0, issues };
}

export function percentReduction(baseline: number, optimized: number): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(optimized) || baseline <= 0) return null;
  return ((baseline - optimized) / baseline) * 100;
}
