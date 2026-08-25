import {
  evaluateCanvasPerformanceAcceptance,
  parseCanvasPerformanceFixtureSize,
  type CanvasPerformanceAcceptanceResult,
} from './canvasPerformanceFixture';

export type CanvasPerformanceMark =
  | 'app-shell-visible'
  | 'canvas-catalog-interactive'
  | 'canvas-hydration-start'
  | 'canvas-first-frame'
  | 'canvas-interactive';

export interface CanvasFrameSample {
  durationMs: number;
  frameCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  droppedFrameCount: number;
}

export interface CanvasPerformanceSnapshot {
  capturedAt: string;
  marks: Record<string, number>;
  stageDurations: Record<string, number>;
  longTasks: Array<{ startTime: number; duration: number }>;
  frames: CanvasFrameSample | null;
  canvas: {
    fixtureSize: number | null;
    nodeCount: number;
    edgeCount: number;
    effectiveMode: string;
    requestedMode: string;
    reason: string;
    hotNodes: number;
    coldNodes: number;
    unclassifiedNodes: number;
    groupProxyMembers: number;
  };
  dom: { total: number; nodes: number; edges: number; images: number; videos: number; canvases: number; iframes: number };
  media: { playingVideos: number; decodedImages: number };
  heap: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null;
}

export interface CanvasPerformanceStabilitySample {
  elapsedMs: number;
  domTotal: number;
  nodeCount: number;
  edgeCount: number;
  decodedImages: number;
  playingVideos: number;
  canvases: number;
  iframes: number;
  usedJSHeapSize: number | null;
}

export interface CanvasPerformanceStabilityReport {
  startedAt: string;
  completedAt: string;
  requestedDurationMs: number;
  actualDurationMs: number;
  intervalMs: number;
  cancelled: boolean;
  heapAvailable: boolean;
  samples: CanvasPerformanceStabilitySample[];
  deltas: {
    domTotal: number;
    decodedImages: number;
    playingVideos: number;
    canvases: number;
    iframes: number;
    usedJSHeapSize: number | null;
  };
  pass: boolean | null;
  issues: string[];
}

interface CanvasPerformanceProbeApi {
  mark: typeof markCanvasPerformance;
  reset: () => void;
  sampleFrames: (durationMs?: number) => Promise<CanvasFrameSample>;
  snapshot: () => CanvasPerformanceSnapshot;
  evaluate: () => CanvasPerformanceAcceptanceResult | null;
  sampleStability: (durationMs?: number, intervalMs?: number) => Promise<CanvasPerformanceStabilityReport>;
  cancelStability: () => void;
  stability: () => CanvasPerformanceStabilityReport | null;
}

const marks = new Map<string, number>();
const longTasks: Array<{ startTime: number; duration: number }> = [];
let frameSample: CanvasFrameSample | null = null;
let installed = false;
let longTaskObserver: PerformanceObserver | null = null;
let stabilityAbortController: AbortController | null = null;
let stabilityReport: CanvasPerformanceStabilityReport | null = null;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const MARK_DATASET_KEYS: Record<CanvasPerformanceMark, string> = {
  'app-shell-visible': 't8PerfAppShellVisible',
  'canvas-catalog-interactive': 't8PerfCanvasCatalogInteractive',
  'canvas-hydration-start': 't8PerfCanvasHydrationStart',
  'canvas-first-frame': 't8PerfCanvasFirstFrame',
  'canvas-interactive': 't8PerfCanvasInteractive',
};

function writeProbeDataset(key: string, value: string | number) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset[key] = String(value);
}

export function markCanvasPerformance(name: CanvasPerformanceMark) {
  if (marks.has(name)) return;
  const timestamp = now();
  marks.set(name, timestamp);
  writeProbeDataset(MARK_DATASET_KEYS[name], timestamp);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export function sampleCanvasFrames(durationMs = 5000): Promise<CanvasFrameSample> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve({ durationMs: 0, frameCount: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, droppedFrameCount: 0 });
  }
  const boundedDuration = Math.max(500, Math.min(30_000, durationMs));
  return new Promise((resolve) => {
    const started = now();
    let previous = started;
    const intervals: number[] = [];
    const tick = (timestamp: number) => {
      intervals.push(Math.max(0, timestamp - previous));
      previous = timestamp;
      if (timestamp - started < boundedDuration) {
        requestAnimationFrame(tick);
        return;
      }
      frameSample = {
        durationMs: timestamp - started,
        frameCount: intervals.length,
        p50Ms: percentile(intervals, 0.5),
        p95Ms: percentile(intervals, 0.95),
        maxMs: Math.max(0, ...intervals),
        droppedFrameCount: intervals.filter((value) => value > 33).length,
      };
      writeProbeDataset('t8PerfFrameP50', frameSample.p50Ms);
      writeProbeDataset('t8PerfFrameP95', frameSample.p95Ms);
      writeProbeDataset('t8PerfFrameMax', frameSample.maxMs);
      writeProbeDataset('t8PerfFrameDropped', frameSample.droppedFrameCount);
      resolve(frameSample);
    };
    requestAnimationFrame(tick);
  });
}

function stageDurations(markRecord: Record<string, number>) {
  const elapsed = (start: string, end: string) => markRecord[start] != null && markRecord[end] != null
    ? Math.max(0, markRecord[end] - markRecord[start])
    : -1;
  return {
    shellToCatalog: elapsed('app-shell-visible', 'canvas-catalog-interactive'),
    hydration: elapsed('canvas-hydration-start', 'canvas-first-frame'),
    firstFrameToInteractive: elapsed('canvas-first-frame', 'canvas-interactive'),
    hydrationToInteractive: elapsed('canvas-hydration-start', 'canvas-interactive'),
    shellToInteractive: elapsed('app-shell-visible', 'canvas-interactive'),
  };
}

export function captureCanvasPerformanceSnapshot(): CanvasPerformanceSnapshot {
  const markRecord = Object.fromEntries(marks.entries());
  const all = typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll('*'));
  const videos = typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll('video'));
  const images = typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll('img'));
  const shell = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.t8-canvas-shell');
  const nodeElements = typeof document === 'undefined'
    ? []
    : Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'));
  const hotNodes = nodeElements.filter((node) => node.dataset.t8ViewportTemperature === 'hot').length;
  const coldNodes = nodeElements.filter((node) => node.dataset.t8ViewportTemperature === 'cold').length;
  const memory = typeof performance === 'undefined'
    ? null
    : (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory || null;
  return {
    capturedAt: new Date().toISOString(),
    marks: markRecord,
    stageDurations: stageDurations(markRecord),
    longTasks: longTasks.slice(),
    frames: frameSample,
    canvas: {
      fixtureSize: shell?.dataset.canvasPerformanceFixture
        ? Number(shell.dataset.canvasPerformanceFixture)
        : null,
      nodeCount: Number(shell?.dataset.canvasNodeCount || nodeElements.length || 0),
      edgeCount: Number(shell?.dataset.canvasEdgeCount || 0),
      effectiveMode: shell?.dataset.canvasPerformance || '',
      requestedMode: shell?.dataset.canvasPerformanceRequested || '',
      reason: shell?.dataset.canvasPerformanceReason || '',
      hotNodes,
      coldNodes,
      unclassifiedNodes: Math.max(0, nodeElements.length - hotNodes - coldNodes),
      groupProxyMembers: nodeElements.filter((node) => node.classList.contains('t8-group-proxy-member')).length,
    },
    dom: {
      total: all.length,
      nodes: typeof document === 'undefined' ? 0 : document.querySelectorAll('.react-flow__node').length,
      edges: typeof document === 'undefined' ? 0 : document.querySelectorAll('.react-flow__edge').length,
      images: images.length,
      videos: videos.length,
      canvases: typeof document === 'undefined' ? 0 : document.querySelectorAll('canvas').length,
      iframes: typeof document === 'undefined' ? 0 : document.querySelectorAll('iframe').length,
    },
    media: {
      playingVideos: videos.filter((video) => !video.paused && !video.ended).length,
      decodedImages: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    },
    heap: memory ? { ...memory } : null,
  };
}

function boundedStabilityDuration(value: number) {
  return Math.max(10_000, Math.min(300_000, Number.isFinite(value) ? value : 300_000));
}

function boundedStabilityInterval(value: number, durationMs: number) {
  return Math.max(1_000, Math.min(Math.min(30_000, durationMs), Number.isFinite(value) ? value : 10_000));
}

function stabilitySample(snapshot: CanvasPerformanceSnapshot, elapsedMs: number): CanvasPerformanceStabilitySample {
  return {
    elapsedMs,
    domTotal: snapshot.dom.total,
    nodeCount: snapshot.canvas.nodeCount,
    edgeCount: snapshot.canvas.edgeCount,
    decodedImages: snapshot.media.decodedImages,
    playingVideos: snapshot.media.playingVideos,
    canvases: snapshot.dom.canvases,
    iframes: snapshot.dom.iframes,
    usedJSHeapSize: snapshot.heap?.usedJSHeapSize ?? null,
  };
}

export function evaluateCanvasPerformanceStability(
  samples: CanvasPerformanceStabilitySample[],
  options: { cancelled?: boolean; minimumDurationMs?: number } = {},
) {
  const issues: string[] = [];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const actualDurationMs = Math.max(0, Number(last?.elapsedMs || 0));
  const minimumDurationMs = Math.max(0, Number(options.minimumDurationMs ?? 300_000));
  const heapSamples = samples.filter((sample) => sample.usedJSHeapSize != null);
  const heapAvailable = heapSamples.length === samples.length && samples.length > 0;
  const deltas = {
    domTotal: first && last ? last.domTotal - first.domTotal : 0,
    decodedImages: first && last ? last.decodedImages - first.decodedImages : 0,
    playingVideos: first && last ? last.playingVideos - first.playingVideos : 0,
    canvases: first && last ? last.canvases - first.canvases : 0,
    iframes: first && last ? last.iframes - first.iframes : 0,
    usedJSHeapSize: heapAvailable && first?.usedJSHeapSize != null && last?.usedJSHeapSize != null
      ? last.usedJSHeapSize - first.usedJSHeapSize
      : null,
  };
  if (options.cancelled) issues.push('cancelled');
  if (samples.length < 2) issues.push('insufficient-samples');
  if (actualDurationMs < minimumDurationMs) issues.push(`duration:${Math.round(actualDurationMs)}<${Math.round(minimumDurationMs)}`);
  if (first && last) {
    const allowedDomGrowth = Math.max(100, Math.ceil(first.domTotal * 0.05));
    if (deltas.domTotal > allowedDomGrowth) issues.push(`dom-growth:${deltas.domTotal}>${allowedDomGrowth}`);
    if (deltas.decodedImages > 2) issues.push(`decoded-images-growth:${deltas.decodedImages}>2`);
    if (last.playingVideos > 0) issues.push(`playing-videos:${last.playingVideos}`);
    if (deltas.canvases > 0) issues.push(`canvas-growth:${deltas.canvases}>0`);
    if (deltas.iframes > 0) issues.push(`iframe-growth:${deltas.iframes}>0`);
  }
  if (heapAvailable && first?.usedJSHeapSize != null && last?.usedJSHeapSize != null) {
    const allowedHeapGrowth = Math.max(64 * 1024 * 1024, Math.ceil(first.usedJSHeapSize * 0.2));
    if ((deltas.usedJSHeapSize || 0) > allowedHeapGrowth) {
      issues.push(`heap-growth:${deltas.usedJSHeapSize}>${allowedHeapGrowth}`);
    }
  }
  return {
    heapAvailable,
    deltas,
    issues,
    pass: issues.length > 0 ? false : heapAvailable ? true : null,
  };
}

function waitForStabilityInterval(durationMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, durationMs);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function sampleCanvasPerformanceStability(durationMs = 300_000, intervalMs = 10_000) {
  if (typeof window === 'undefined') {
    throw new Error('Canvas performance stability sampling requires a browser window');
  }
  stabilityAbortController?.abort();
  const controller = new AbortController();
  stabilityAbortController = controller;
  const requestedDurationMs = boundedStabilityDuration(durationMs);
  const boundedIntervalMs = boundedStabilityInterval(intervalMs, requestedDurationMs);
  const startedAt = new Date();
  const started = now();
  const samples: CanvasPerformanceStabilitySample[] = [stabilitySample(captureCanvasPerformanceSnapshot(), 0)];
  writeProbeDataset('t8PerfStabilityStatus', 'running');
  writeProbeDataset('t8PerfStabilityDuration', requestedDurationMs);
  while (!controller.signal.aborted && now() - started < requestedDurationMs) {
    await waitForStabilityInterval(Math.min(boundedIntervalMs, requestedDurationMs - (now() - started)), controller.signal);
    if (controller.signal.aborted) break;
    samples.push(stabilitySample(captureCanvasPerformanceSnapshot(), Math.min(requestedDurationMs, now() - started)));
  }
  const actualDurationMs = Math.max(0, now() - started);
  if (!controller.signal.aborted && (samples.at(-1)?.elapsedMs || 0) < requestedDurationMs) {
    samples.push(stabilitySample(captureCanvasPerformanceSnapshot(), requestedDurationMs));
  }
  const evaluation = evaluateCanvasPerformanceStability(samples, {
    cancelled: controller.signal.aborted,
    minimumDurationMs: requestedDurationMs,
  });
  stabilityReport = {
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    requestedDurationMs,
    actualDurationMs,
    intervalMs: boundedIntervalMs,
    cancelled: controller.signal.aborted,
    samples,
    ...evaluation,
  };
  if (stabilityAbortController === controller) stabilityAbortController = null;
  writeProbeDataset('t8PerfStabilityStatus', stabilityReport.cancelled ? 'cancelled' : stabilityReport.pass === true ? 'passed' : stabilityReport.pass === false ? 'failed' : 'inconclusive');
  writeProbeDataset('t8PerfStabilitySamples', samples.length);
  writeProbeDataset('t8PerfStabilityHeapAvailable', String(evaluation.heapAvailable));
  return stabilityReport;
}

export function installCanvasPerformanceProbe(): CanvasPerformanceProbeApi | null {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  const requested = searchParams.get('canvasPerf') === '1'
    || window.localStorage.getItem('t8-canvas-performance-probe') === '1';
  if (!requested) return null;
  const api: CanvasPerformanceProbeApi = {
    mark: markCanvasPerformance,
    sampleFrames: sampleCanvasFrames,
    snapshot: captureCanvasPerformanceSnapshot,
    evaluate: () => {
      const snapshot = captureCanvasPerformanceSnapshot();
      const fixtureSize = parseCanvasPerformanceFixtureSize(snapshot.canvas.fixtureSize);
      if (fixtureSize == null) return null;
      return evaluateCanvasPerformanceAcceptance({
        fixtureSize,
        nodeCount: snapshot.canvas.nodeCount,
        hydrationToInteractiveMs: snapshot.stageDurations.hydrationToInteractive,
        p95FrameMs: snapshot.frames?.p95Ms ?? null,
        maxLongTaskMs: Math.max(0, ...snapshot.longTasks.map((task) => task.duration)),
        playingVideos: snapshot.media.playingVideos,
      });
    },
    sampleStability: sampleCanvasPerformanceStability,
    cancelStability: () => stabilityAbortController?.abort(),
    stability: () => stabilityReport,
    reset: () => {
      stabilityAbortController?.abort();
      stabilityAbortController = null;
      stabilityReport = null;
      marks.clear();
      longTasks.length = 0;
      frameSample = null;
      if (typeof document !== 'undefined') {
        Object.values(MARK_DATASET_KEYS).forEach((key) => { delete document.documentElement.dataset[key]; });
        [
          't8PerfFrameP50', 't8PerfFrameP95', 't8PerfFrameMax', 't8PerfFrameDropped',
          't8PerfLongTaskCount', 't8PerfLongTaskMax', 't8PerfDomTotal', 't8PerfDomNodes',
          't8PerfDomEdges', 't8PerfDecodedImages', 't8PerfPlayingVideos', 't8PerfHeapUsed',
          't8PerfHeapTotal', 't8PerfHeapLimit', 't8PerfAutoSampleStarted', 't8PerfAutoSampleComplete',
          't8PerfStabilityStatus', 't8PerfStabilityDuration', 't8PerfStabilitySamples', 't8PerfStabilityHeapAvailable',
        ]
          .forEach((key) => { delete document.documentElement.dataset[key]; });
      }
    },
  };
  (window as Window & { __T8_CANVAS_PERFORMANCE__?: CanvasPerformanceProbeApi }).__T8_CANVAS_PERFORMANCE__ = api;
  if (!installed && typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push({ startTime: entry.startTime, duration: entry.duration }));
        writeProbeDataset('t8PerfLongTaskCount', longTasks.length);
        writeProbeDataset('t8PerfLongTaskMax', Math.max(0, ...longTasks.map((task) => task.duration)));
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      longTaskObserver = null;
    }
  }
  installed = true;
  const fixtureSize = parseCanvasPerformanceFixtureSize(searchParams.get('canvasPerfFixture'));
  if (fixtureSize != null && document.documentElement.dataset.t8PerfAutoSampleStarted !== String(fixtureSize)) {
    writeProbeDataset('t8PerfAutoSampleStarted', fixtureSize);
    const waitStartedAt = now();
    const startWhenInteractive = () => {
      const interactive = document.documentElement.dataset.t8PerfCanvasInteractive;
      if (!interactive && now() - waitStartedAt < 30_000) {
        window.setTimeout(startWhenInteractive, 100);
        return;
      }
      // Let IntersectionObserver temperature changes and ReactFlow measurements
      // converge before measuring steady pan/zoom frame cadence.
      window.setTimeout(() => {
        void sampleCanvasFrames(2000).then(() => {
          const snapshot = captureCanvasPerformanceSnapshot();
          writeProbeDataset('t8PerfDomTotal', snapshot.dom.total);
          writeProbeDataset('t8PerfDomNodes', snapshot.dom.nodes);
          writeProbeDataset('t8PerfDomEdges', snapshot.dom.edges);
          writeProbeDataset('t8PerfDecodedImages', snapshot.media.decodedImages);
          writeProbeDataset('t8PerfPlayingVideos', snapshot.media.playingVideos);
          if (snapshot.heap) {
            writeProbeDataset('t8PerfHeapUsed', snapshot.heap.usedJSHeapSize);
            writeProbeDataset('t8PerfHeapTotal', snapshot.heap.totalJSHeapSize);
            writeProbeDataset('t8PerfHeapLimit', snapshot.heap.jsHeapSizeLimit);
          }
          writeProbeDataset('t8PerfAutoSampleComplete', fixtureSize);
        }).catch(() => {
          writeProbeDataset('t8PerfAutoSampleComplete', 'error');
        });
      }, 2000);
    };
    startWhenInteractive();
  }
  return api;
}
