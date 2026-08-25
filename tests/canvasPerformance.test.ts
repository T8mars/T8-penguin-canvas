import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estimateCanvasHeavyMediaCount,
  isPerformancePinnedNode,
  resolveCanvasPerformanceDecision,
} from '../src/utils/canvasPerformance';
import { resources } from '../src/i18n/resources';
import {
  buildCanvasPerformanceFixture,
  CANVAS_PERFORMANCE_FIXTURE_SIZES,
  evaluateCanvasPerformanceAcceptance,
  parseCanvasPerformanceFixtureSize,
  percentReduction,
  readCanvasPerformanceFixtureSize,
} from '../src/utils/canvasPerformanceFixture';
import {
  evaluateCanvasPerformanceStability,
  type CanvasPerformanceStabilitySample,
} from '../src/utils/canvasPerformanceProbe';

test('manual performance choices remain stable over automatic thresholds', () => {
  assert.equal(resolveCanvasPerformanceDecision('balanced', {
    nodeCount: 1000,
    edgeCount: 1200,
    heavyMediaCount: 200,
  }).effective, 'balanced');
  assert.equal(resolveCanvasPerformanceDecision('performance', {
    nodeCount: 2,
    edgeCount: 1,
    heavyMediaCount: 0,
  }).effective, 'performance');
});

test('auto mode reports an explainable heavy-load reason', () => {
  const huge = resolveCanvasPerformanceDecision('auto', {
    nodeCount: 500,
    edgeCount: 300,
    heavyMediaCount: 0,
  });
  assert.equal(huge.effective, 'performance');
  assert.equal(huge.reason, 'very-large-graph');

  const normal = resolveCanvasPerformanceDecision('auto', {
    nodeCount: 60,
    edgeCount: 50,
    heavyMediaCount: 4,
    hardwareConcurrency: 8,
  });
  assert.equal(normal.effective, 'balanced');
  assert.equal(normal.reason, 'normal-load');
});

test('media estimator is bounded per collection and counts heavy workbenches', () => {
  const count = estimateCanvasHeavyMediaCount([
    { type: 'video-edit', data: { videoUrls: Array.from({ length: 100 }, (_, index) => `v${index}`) } },
    { type: 'output', data: { imageUrls: ['a', 'b'], modelUrl: 'm.glb' } },
  ]);
  assert.equal(count, 17);
});

test('selected and runtime-sensitive nodes remain pinned', () => {
  assert.equal(isPerformancePinnedNode({ selected: true, data: {} }), true);
  assert.equal(isPerformancePinnedNode({ data: { status: 'running' } }), true);
  assert.equal(isPerformancePinnedNode({ data: { taskStatus: 'failed' } }), true);
  assert.equal(isPerformancePinnedNode({ data: { status: 'success' } }), false);
});

test('group proxy hides presentation only and visibility observer preserves mounted nodes', () => {
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const group = readFileSync(new URL('../src/components/nodes/GroupBoxNode.tsx', import.meta.url), 'utf8');
  const visibility = readFileSync(new URL('../src/utils/canvasNodeVisibility.ts', import.meta.url), 'utf8');
  assert.match(canvas, /t8-group-proxy-member/);
  assert.doesNotMatch(canvas, /onlyRenderVisibleElements=/);
  assert.match(group, /performanceCollapsed/);
  assert.match(group, /nodes:group\.proxyNote/);
  assert.match(resources['zh-CN'].nodes.group.proxyNote, /运行、恢复或结果写回/);
  assert.match(resources['en-US'].nodes.group.proxyNote, /runs, recovery, and result writes continue/i);
  assert.match(visibility, /video\.pause\(\)/);
  assert.match(visibility, /CANVAS_NODE_TEMPERATURE_EVENT/);
  assert.doesNotMatch(visibility, /removeChild|\.remove\(\)/);
});

test('offscreen heavy-node shells preserve component hooks and handles while trimming presentation DOM', () => {
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /CanvasPerformanceRenderProvider/);
  assert.match(canvas, /CanvasNodeRenderModeProvider/);
  assert.match(canvas, /<Component \{\.\.\.props\} \/>/);
  assert.doesNotMatch(canvas, /onlyRenderVisibleElements=/);

  for (const file of [
    'VideoNode.tsx',
    'AudioNode.tsx',
    'ImageNode.tsx',
    'OutputNode.tsx',
    'Model3DPreviewNode.tsx',
    'ScriptMasterNode.tsx',
    'DrawingBoardNode.tsx',
    'TextNode.tsx',
    'LLMNode.tsx',
    'RunningHubNode.tsx',
  ]) {
    const source = readFileSync(new URL(`../src/components/nodes/${file}`, import.meta.url), 'utf8');
    assert.match(source, /useCanvasNodeRenderMode\(\)/, file);
    assert.match(source, /data-t8-node-cold-shell=/, file);
    assert.match(source, /<Handle type="target"/, file);
    assert.match(source, /<Handle type="source"/, file);
  }
  const modelPreview = readFileSync(new URL('../src/components/nodes/Model3DPreviewNode.tsx', import.meta.url), 'utf8');
  assert.match(modelPreview, /if \(canvasRenderMode === 'cold'\) return;/);
  assert.match(modelPreview, /disposeRenderer\(renderer\)/);
});

test('edge theme selection count is shared per ReactFlow state instead of rescanning all edges per edge', () => {
  const edge = readFileSync(new URL('../src/components/edges/DeletableEdge.tsx', import.meta.url), 'utf8');
  assert.match(edge, /activeThemeEdgeCountCache/);
  assert.match(edge, /activeThemeEdgeCountCache\.edges === edges/);
  assert.match(edge, /activeThemeEdgeCountCache = \{ edges, nodes, nodeLookup, count \}/);
});

test('performance mode uses a lightweight but still deletable edge renderer', () => {
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const edge = readFileSync(new URL('../src/components/edges/PerformanceEdge.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /performanceEdgeTypes/);
  assert.match(canvas, /performanceDecision\.effective === 'performance' \? performanceEdgeTypes : edgeTypes/);
  assert.match(edge, /<BaseEdge/);
  assert.match(edge, /<EdgeLabelRenderer>/);
  assert.match(edge, /onDoubleClick=\{cut\}/);
  assert.match(edge, /setEdges\(\(current\) => current\.filter/);
  assert.doesNotMatch(edge, /useStore|resolveThemeTemplate|animateMotion/);
});

test('fixed 100/500/1000-node performance fixtures are deterministic and side-effect free', () => {
  for (const size of CANVAS_PERFORMANCE_FIXTURE_SIZES) {
    const first = buildCanvasPerformanceFixture(size);
    const second = buildCanvasPerformanceFixture(size);
    assert.equal(first.nodes.length, size);
    assert.equal(first.edges.length, size - 1);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first).includes('data:'), false);
    assert.equal(first.nodes.some((node) => node.data.fixtureRunState === 'running'), true);
    assert.equal(first.nodes.every((node) => node.data.__performanceFixture === true), true);
    assert.equal(JSON.stringify(first).includes('fixture.invalid'), false);
    assert.equal(new Set(first.nodes.map((node) => node.entityUid)).size, size);
    assert.equal(new Set(first.edges.map((edge) => edge.entityUid)).size, size - 1);
  }
});

test('performance fixture query parsing fails closed and the Canvas harness never persists it', () => {
  assert.equal(parseCanvasPerformanceFixtureSize('500'), 500);
  assert.equal(readCanvasPerformanceFixtureSize('?canvasPerf=1&canvasPerfFixture=1000'), 1000);
  assert.equal(readCanvasPerformanceFixtureSize('?canvasPerfFixture=499'), null);
  assert.equal(readCanvasPerformanceFixtureSize('?canvasPerfFixture=500x'), null);
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /performanceFixtureCanvasId/);
  assert.match(canvas, /buildCanvasPerformanceFixture\(performanceFixtureSize\)/);
  assert.match(canvas, /data-canvas-performance-fixture=\{performanceFixtureSize \|\| undefined\}/);
  assert.match(canvas, /loadedCanvasId !== activeId/);
});

test('roadmap #24 acceptance gates are explicit and comparative reductions are measurable', () => {
  assert.deepEqual(evaluateCanvasPerformanceAcceptance({
    fixtureSize: 500,
    nodeCount: 500,
    hydrationToInteractiveMs: 2999,
    p95FrameMs: 32.9,
    maxLongTaskMs: 1999,
    playingVideos: 0,
  }), { pass: true, issues: [] });
  const failed = evaluateCanvasPerformanceAcceptance({
    fixtureSize: 1000,
    nodeCount: 999,
    hydrationToInteractiveMs: 5001,
    p95FrameMs: null,
    maxLongTaskMs: 2001,
    playingVideos: 2,
  });
  assert.equal(failed.pass, false);
  assert.deepEqual(failed.issues, [
    'node-count:999/1000',
    'interactive:5001.0>5000',
    'long-task:2001.0>2000',
    'playing-videos:2',
  ]);
  assert.equal(percentReduction(1000, 600), 40);
  assert.equal(percentReduction(0, 0), null);
});

function stabilitySample(
  elapsedMs: number,
  overrides: Partial<CanvasPerformanceStabilitySample> = {},
): CanvasPerformanceStabilitySample {
  return {
    elapsedMs,
    domTotal: 10_000,
    nodeCount: 500,
    edgeCount: 499,
    decodedImages: 0,
    playingVideos: 0,
    canvases: 0,
    iframes: 0,
    usedJSHeapSize: 200 * 1024 * 1024,
    ...overrides,
  };
}

test('five-minute stability evidence passes only with complete heap and bounded resource growth', () => {
  const result = evaluateCanvasPerformanceStability([
    stabilitySample(0),
    stabilitySample(150_000, { domTotal: 10_080, usedJSHeapSize: 220 * 1024 * 1024 }),
    stabilitySample(300_000, { domTotal: 10_120, usedJSHeapSize: 215 * 1024 * 1024 }),
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.heapAvailable, true);
  assert.deepEqual(result.issues, []);
});

test('stability evidence is inconclusive without browser heap instead of claiming success', () => {
  const result = evaluateCanvasPerformanceStability([
    stabilitySample(0, { usedJSHeapSize: null }),
    stabilitySample(300_000, { usedJSHeapSize: null }),
  ]);
  assert.equal(result.pass, null);
  assert.equal(result.heapAvailable, false);
  assert.deepEqual(result.issues, []);
});

test('stability evidence fails closed on incomplete duration or retained media and DOM growth', () => {
  const result = evaluateCanvasPerformanceStability([
    stabilitySample(0),
    stabilitySample(60_000, { domTotal: 11_000, playingVideos: 1, canvases: 1 }),
  ]);
  assert.equal(result.pass, false);
  assert.ok(result.issues.includes('duration:60000<300000'));
  assert.ok(result.issues.includes('dom-growth:1000>500'));
  assert.ok(result.issues.includes('playing-videos:1'));
  assert.ok(result.issues.includes('canvas-growth:1>0'));
});

test('stability evidence fails when complete heap samples keep growing beyond the bounded allowance', () => {
  const result = evaluateCanvasPerformanceStability([
    stabilitySample(0, { usedJSHeapSize: 200 * 1024 * 1024 }),
    stabilitySample(300_000, { usedJSHeapSize: 300 * 1024 * 1024 }),
  ]);
  assert.equal(result.heapAvailable, true);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((issue) => issue.startsWith('heap-growth:')));
});
