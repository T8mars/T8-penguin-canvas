import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark';
import { normalizeWorldCamera, type WorldCamera, type WorldSceneSource } from '../../utils/worldScene';
import { prepareGaussianSceneBytes } from '../../utils/gaussianSceneBytes';

export interface WorldSceneViewerHandle {
  capture: (signal?: AbortSignal) => Promise<Blob>;
  captureFrame: (signal?: AbortSignal) => Promise<{ blob: Blob; camera: WorldCamera }>;
  getCamera: () => WorldCamera | null;
  setCamera: (camera: WorldCamera) => void;
  reset: () => void;
}
interface Props { source: WorldSceneSource; camera?: WorldCamera | null; onCameraChange?: (camera: WorldCamera) => void; onReady?: (ready: boolean) => void; onError?: (error: Error) => void }
const WorldSceneViewer = forwardRef<WorldSceneViewerHandle, Props>(function WorldSceneViewer({ source, camera: initialCamera, onCameraChange, onReady, onError }, ref) {
  const { t } = useTranslation('creativeUx');
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<Omit<WorldSceneViewerHandle, 'capture' | 'getCamera'> & { getCamera: () => WorldCamera } | null>(null);
  const callbacks = useRef({ onCameraChange, onReady, onError }); callbacks.current = { onCameraChange, onReady, onError };
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  useImperativeHandle(ref, () => ({
    capture: async (signal) => { if (!runtime.current) throw Error(t('world.notReady')); return (await runtime.current.captureFrame(signal)).blob; },
    captureFrame: async (signal) => { if (!runtime.current) throw Error(t('world.notReady')); return runtime.current.captureFrame(signal); },
    getCamera: () => runtime.current?.getCamera() || null,
    setCamera: (camera) => runtime.current?.setCamera(camera), reset: () => runtime.current?.reset(),
  }), [t]);
  useEffect(() => {
    const host = mount.current; if (!host) return;
    const abort = new AbortController();
    let disposed = false, released = false, frame: number | null = null, resize: ResizeObserver | null = null;
    let renderer: THREE.WebGLRenderer | null = null, controls: OrbitControls | null = null;
    let spark: SparkRenderer | null = null, splats: SplatMesh | null = null;
    let camera: THREE.PerspectiveCamera | null = null, scene: THREE.Scene | null = null;
    const keys = new Set<string>();
    const disposers: Array<() => void> = [];
    let lastTime = 0;
    let needsUpdate = true, updating: Promise<void> | null = null;
    let initializing: Promise<unknown> | null = null;
    const changed = () => { const c = runtime.current?.getCamera(); if (c) callbacks.current.onCameraChange?.(c); };
    const schedule = () => { if (!disposed && !released && frame === null && !document.hidden) frame = requestAnimationFrame(draw); };
    const invalidate = () => { needsUpdate = true; schedule(); };
    const assertLive = (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (disposed || released) throw Error(t('world.notReady'));
    };
    // One queue owns every update, screenshot and async readback. Closing a view
    // waits for this queue before disposing its GPU/worker resources.
    const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
      const result = (updating || Promise.resolve()).then(() => { assertLive(); return work(); });
      const settled = result.then(() => undefined, () => undefined);
      updating = settled;
      void settled.then(() => { if (updating === settled) { updating = null; schedule(); } });
      return result;
    };
    const draw = (time: number) => {
      frame = null;
      if (disposed || released || !renderer || !scene || !camera || !controls) return;
      if (keys.size) {
        const delta = Math.min(.05, (time - (lastTime || time)) / 1000), speed = keys.has('shift') ? 8 : 2;
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const movement = new THREE.Vector3();
        if (keys.has('w')) movement.add(forward); if (keys.has('s')) movement.sub(forward);
        if (keys.has('d')) movement.add(right); if (keys.has('a')) movement.sub(right);
        if (keys.has('e')) movement.add(camera.up); if (keys.has('q')) movement.sub(camera.up);
        if (movement.lengthSq()) { movement.normalize().multiplyScalar(delta * speed); camera.position.add(movement); controls.target.add(movement); controls.update(); needsUpdate = true; }
        schedule();
      }
      lastTime = time;
      if (updating) return;
      const currentRenderer = renderer, currentScene = scene, currentCamera = camera;
      if (needsUpdate && spark) {
        needsUpdate = false;
        // Own the async update promise. Spark's implicit onBeforeRender update
        // does not expose its rejection to the host when a view closes mid-sort.
        const currentSpark = spark;
        void enqueue(async () => {
          await currentSpark.update({ scene: currentScene, camera: currentCamera });
          if (!disposed && !released) currentRenderer.render(currentScene, currentCamera);
        }).catch((e) => { if (!disposed && !released) fail(e); });
      } else {
        try { renderer.render(scene, camera); } catch (e) { fail(e); }
      }
    };
    const clearKeys = () => { if (keys.size) changed(); keys.clear(); lastTime = 0; };
    const release = () => {
      if (released) return; released = true; runtime.current = null;
      abort.abort(); if (frame !== null) cancelAnimationFrame(frame); frame = null;
      resize?.disconnect(); controls?.dispose(); disposers.forEach((dispose) => dispose());
      const disposeGpu = () => {
        try { splats?.dispose(); } catch { /* continue releasing remaining resources */ }
        try { spark?.dispose(); } catch { /* release the Three context even if worker cleanup fails */ }
        renderer?.dispose(); try { renderer?.forceContextLoss(); } catch { /* optional */ }
      };
      // Detach immediately, release after an already-started GPU readback/sort
      // settles, rather than destroying its context from under an async update.
      const pending = [updating, initializing].filter(Boolean) as Promise<unknown>[];
      if (pending.length) void Promise.allSettled(pending).then(disposeGpu); else disposeGpu();
      host.replaceChildren(); callbacks.current.onReady?.(false);
    };
    const fail = (e: unknown) => {
      if (disposed || released) return;
      const error = e instanceof Error ? e : Error(String(e));
      setState('error'); setError(error.message); callbacks.current.onError?.(error); release();
    };
    setState('loading'); setError(''); callbacks.current.onReady?.(false);
    void (async () => {
      const url = new URL(source.url, window.location.href);
      // Authenticated API/profile credentials never enter this viewer or go to asset URLs.
      if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin || url.username || url.password) throw Error(t('world.localOnly'));
      const response = await fetch(url.href, { signal: abort.signal, credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw Error(t('world.httpError', { status: response.status }));
      const bytes = await prepareGaussianSceneBytes(await response.arrayBuffer(), abort.signal); if (disposed) return;
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(65, 1, .01, 100000);
      renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x0c1220, 1); renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', t('world.navigate'));
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      disposers.push(() => renderer?.domElement.removeEventListener('webglcontextlost', onLost));
      host.replaceChildren(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
      controls.addEventListener('change', invalidate); controls.addEventListener('end', changed);
      disposers.push(() => { controls?.removeEventListener('change', invalidate); controls?.removeEventListener('end', changed); });
      spark = new SparkRenderer({ renderer, onDirty: schedule, autoUpdate: false, minSortIntervalMs: 0 }); scene.add(spark);
      splats = new SplatMesh({ fileBytes: bytes, fileType: source.format as SplatFileType, fileName: source.name, raycastable: false });
      const loadedSplats = splats;
      scene.add(loadedSplats);
      initializing = loadedSplats.initialized;
      await initializing;
      if (disposed || released) return; // release() owns disposal, including late initialization.
      initializing = null;
      const box = loadedSplats.getBoundingBox(), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 1);
      const fit: WorldCamera = { position: [center.x + span * .6, center.y + span * .3, center.z + span * .8], target: center.toArray() as [number, number, number], fov: 65 };
      const getCamera = (): WorldCamera => ({ position: camera!.position.toArray() as [number, number, number], target: controls!.target.toArray() as [number, number, number], fov: camera!.fov });
      const setCamera = (raw: WorldCamera) => {
        const value = normalizeWorldCamera(raw); if (!value || !camera || !controls) return;
        camera.position.fromArray(value.position); camera.fov = value.fov; camera.updateProjectionMatrix();
        controls.target.fromArray(value.target); controls.update(); invalidate();
      };
      runtime.current = { getCamera, setCamera, reset: () => { setCamera(fit); changed(); },
        captureFrame: (signal) => {
          assertLive(signal);
          if (!renderer || !scene || !camera || !spark) return Promise.reject(Error(t('world.notReady')));
          // Freeze at the click, not after a pending sort. Navigation or selecting
          // another saved view cannot change the image's recorded camera.
          const snapshot = camera.clone(), capturedCamera = getCamera();
          const currentRenderer = renderer, currentScene = scene, currentSpark = spark;
          return enqueue(async () => {
            assertLive(signal);
            await currentSpark.update({ scene: currentScene, camera: snapshot });
            assertLive(signal);
            currentRenderer.render(currentScene, snapshot);
            const blob = await new Promise<Blob>((resolve, reject) => currentRenderer.domElement.toBlob((image) => image ? resolve(image) : reject(Error(t('world.captureFailed'))), 'image/png'));
            assertLive(signal);
            return { blob, camera: capturedCamera };
          }).finally(() => { needsUpdate = true; });
        },
      };
      setCamera(initialCamera || fit);
      const adjust = () => {
        if (!renderer || !camera || released) return;
        const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); invalidate();
      };
      resize = new ResizeObserver(adjust); resize.observe(host); adjust();
      const keyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase(); if (!['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(key)) return;
        event.preventDefault(); event.stopPropagation(); keys.add(key); schedule();
      };
      const keyUp = (event: KeyboardEvent) => { if (keys.delete(event.key.toLowerCase())) { event.stopPropagation(); changed(); } };
      const visibility = () => { if (document.hidden) clearKeys(); else schedule(); };
      renderer.domElement.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
      window.addEventListener('blur', clearKeys); document.addEventListener('visibilitychange', visibility);
      disposers.push(() => { renderer?.domElement.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
        window.removeEventListener('blur', clearKeys); document.removeEventListener('visibilitychange', visibility); });
      setState('ready'); callbacks.current.onReady?.(true); schedule();
    })().catch((e) => { if (!disposed && !abort.signal.aborted) fail(e); });
    function onLost(event: Event) { event.preventDefault(); fail(Error(t('world.contextLost'))); }
    return () => { disposed = true; keys.clear(); release(); };
    // Camera snapshots and callbacks must not rebuild the renderer while navigating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, source.format]);

  return <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280 }} data-world-scene-viewer>
    <div ref={mount} style={{ position: 'absolute', inset: 0 }} />
    {state !== 'ready' && <div role={state === 'error' ? 'alert' : 'status'} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg-secondary, #182336)', color: 'var(--text-primary, white)', overflowWrap: 'anywhere' }}>{state === 'error' ? error : t('world.loading')}</div>}
  </div>;
});
export default WorldSceneViewer;
