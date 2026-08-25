const NODE_SELECTOR = '.react-flow__node';
const OVERSCAN_MARGIN = '800px';
export const CANVAS_NODE_TEMPERATURE_EVENT = 't8:canvas-node-temperature';

function pauseColdNodeVideos(node: HTMLElement) {
  node.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
    if (video.paused || video.ended) return;
    video.dataset.t8PerformanceAutoPaused = 'true';
    video.pause();
  });
}

function resumeHotNodeVideos(node: HTMLElement) {
  node.querySelectorAll<HTMLVideoElement>('video[data-t8-performance-auto-paused="true"]').forEach((video) => {
    delete video.dataset.t8PerformanceAutoPaused;
    void video.play().catch(() => undefined);
  });
}

function setNodeTemperature(node: HTMLElement, hot: boolean) {
  const pinned = node.classList.contains('selected')
    || node.classList.contains('t8-performance-pinned')
    || node.matches(':focus-within');
  const nextHot = hot || pinned;
  const nextTemperature = nextHot ? 'hot' : 'cold';
  const previousTemperature = node.dataset.t8ViewportTemperature;
  node.dataset.t8ViewportTemperature = nextTemperature;
  if (previousTemperature !== nextTemperature) {
    node.dispatchEvent(new CustomEvent(CANVAS_NODE_TEMPERATURE_EVENT, {
      detail: { temperature: nextTemperature },
    }));
  }
  if (nextHot) resumeHotNodeVideos(node);
  else pauseColdNodeVideos(node);
}

export function installCanvasNodeVisibilityObserver(root: HTMLElement) {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  const observed = new Set<HTMLElement>();
  const intersecting = new WeakMap<HTMLElement, boolean>();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const node = entry.target as HTMLElement;
      intersecting.set(node, entry.isIntersecting);
      setNodeTemperature(node, entry.isIntersecting);
    });
  }, { root, rootMargin: OVERSCAN_MARGIN, threshold: 0 });

  const observe = (node: HTMLElement) => {
    if (observed.has(node)) return;
    observed.add(node);
    observer.observe(node);
  };
  const scan = (scope: ParentNode) => {
    if (scope instanceof HTMLElement && scope.matches(NODE_SELECTOR)) observe(scope);
    scope.querySelectorAll<HTMLElement>(NODE_SELECTOR).forEach(observe);
  };
  scan(root);

  const mutations = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        setNodeTemperature(record.target, intersecting.get(record.target) === true);
        return;
      }
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scan(node);
      });
    });
  });
  mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  return () => {
    mutations.disconnect();
    observer.disconnect();
    observed.forEach((node) => {
      delete node.dataset.t8ViewportTemperature;
      node.querySelectorAll<HTMLVideoElement>('video[data-t8-performance-auto-paused="true"]').forEach((video) => {
        delete video.dataset.t8PerformanceAutoPaused;
      });
    });
    observed.clear();
  };
}
