import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useNodeConnections, useNodesData, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Box, Camera, ChevronLeft, ChevronRight, Download, Loader2, RotateCw } from 'lucide-react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { PORT_COLOR } from '../../config/portTypes';
import { useThemeStore } from '../../stores/theme';
import { fileNameFromUrl } from '../../utils/mediaCollection';
import ResizableCorners from './ResizableCorners';
import { useUpdateNodeData } from './useUpdateNodeData';

const MODEL_URL_RE = /\.(glb|gltf|obj|fbx|stl|usdz|zip)(\?|#|$)/i;
type ModelFormat = 'gltf' | 'obj' | 'stl' | 'fbx' | 'usdz' | 'zip' | 'unknown';

const handleStyle: CSSProperties = {
  width: 12,
  height: 12,
  border: 'none',
  zIndex: 20,
};

function pushUniqueUrl(out: string[], value: any) {
  if (typeof value !== 'string') return;
  const url = value.trim();
  if (!url) return;
  if (!MODEL_URL_RE.test(url) && !/^data:model\//i.test(url)) return;
  if (!out.includes(url)) out.push(url);
}

function collectModelUrlsFromData(data: any): string[] {
  const out: string[] = [];
  if (!data) return out;

  pushUniqueUrl(out, data.modelUrl);
  pushUniqueUrl(out, data.directModelUrl);
  for (const field of ['modelUrls', 'directModelUrls', 'urls'] as const) {
    const value = data[field];
    if (Array.isArray(value)) value.forEach((item) => pushUniqueUrl(out, item));
  }

  return out;
}

function toErrorMessage(error: unknown, fallback = '模型加载失败'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  try {
    const text = JSON.stringify(error);
    return text && text !== '{}' ? text : fallback;
  } catch {
    return fallback;
  }
}

function getModelFormat(url: string): ModelFormat {
  if (/^data:model\/gltf/i.test(url)) return 'gltf';
  const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  const ext = String(match?.[1] || '').toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'gltf';
  if (ext === 'obj' || ext === 'stl' || ext === 'fbx' || ext === 'usdz' || ext === 'zip') return ext;
  return 'unknown';
}

function isPreviewableModelFormat(format: ModelFormat): boolean {
  return format === 'gltf' || format === 'obj' || format === 'stl' || format === 'fbx' || format === 'usdz';
}

function loadWithThreeLoader<T>(
  loader: { load: (url: string, onLoad: (value: T) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void) => void },
  url: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (error) => reject(new Error(toErrorMessage(error))));
  });
}

function makeDefaultMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.58,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
}

function applyReadableFallbackMaterial(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
      mesh.material = makeDefaultMaterial();
    }
  });
}

async function loadModelObject(url: string, format: ModelFormat): Promise<THREE.Object3D> {
  if (format === 'gltf') {
    const gltf = await loadWithThreeLoader<any>(new GLTFLoader(), url);
    return gltf.scene;
  }
  if (format === 'obj') {
    const group = await loadWithThreeLoader<THREE.Group>(new OBJLoader(), url);
    applyReadableFallbackMaterial(group);
    return group;
  }
  if (format === 'stl') {
    const geometry = await loadWithThreeLoader<THREE.BufferGeometry>(new STLLoader(), url);
    geometry.computeVertexNormals();
    const material = (geometry as any).hasColors
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.04, side: THREE.DoubleSide })
      : makeDefaultMaterial();
    return new THREE.Mesh(geometry, material);
  }
  if (format === 'fbx') {
    const group = await loadWithThreeLoader<THREE.Group>(new FBXLoader(), url);
    applyReadableFallbackMaterial(group);
    return group;
  }
  if (format === 'usdz') {
    const group = await loadWithThreeLoader<THREE.Group>(new USDLoader(), url);
    applyReadableFallbackMaterial(group);
    return group;
  }
  throw new Error(format === 'zip' ? 'zip 是模型打包容器，当前请下载后解压预览。' : '暂不支持该 3D 模型格式。');
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item?.dispose?.());
    } else if (material && typeof material.dispose === 'function') {
      material.dispose();
    }
  });
}

function clearThreeMount(mount: HTMLDivElement, renderer?: THREE.WebGLRenderer | null) {
  const canvas = renderer?.domElement;
  if (canvas && canvas.parentNode === mount) {
    mount.removeChild(canvas);
    return;
  }
  Array.from(mount.childNodes).forEach((child) => {
    if (child.parentNode === mount) mount.removeChild(child);
  });
}

function disposeRenderer(renderer: THREE.WebGLRenderer) {
  renderer.dispose();
  try {
    renderer.forceContextLoss();
  } catch {
    // Some WebGL contexts do not support explicit context loss; dispose still frees Three resources.
  }
}

const Model3DPreviewNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate } = useTranslation(['nodes', 'common']);
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const updateNodeInternals = useUpdateNodeInternals();
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isLight = theme === 'light';
  const isPixel = themeStyle === 'pixel';
  const d = (data || {}) as any;

  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [size, setSize] = useState<{ w: number; h: number }>(() => (
    d?.size && typeof d.size.w === 'number' && typeof d.size.h === 'number'
      ? { w: d.size.w, h: d.size.h }
      : { w: 520, h: 440 }
  ));

  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(
    () => Array.from(new Set(connections.map((connection) => connection.source).filter(Boolean))),
    [connections],
  );
  const upstreamNodes = useNodesData(upstreamIds);
  const upstreamSignature = useMemo(() => {
    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    return list.map((node: any) => {
      const nodeData = node?.data || {};
      const modelUrls = Array.isArray(nodeData.modelUrls) ? nodeData.modelUrls.join(',') : '';
      const directModelUrls = Array.isArray(nodeData.directModelUrls) ? nodeData.directModelUrls.join(',') : '';
      const urls = Array.isArray(nodeData.urls) ? nodeData.urls.join(',') : '';
      return [node?.id || '', nodeData.modelUrl || '', nodeData.directModelUrl || '', modelUrls, directModelUrls, urls].join('§');
    }).join('|');
  }, [upstreamNodes]);

  const modelUrls = useMemo(() => {
    const out = collectModelUrlsFromData(d);
    const list = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    for (const node of list) {
      collectModelUrlsFromData((node as any)?.data || {}).forEach((url) => {
        if (!out.includes(url)) out.push(url);
      });
    }
    return out;
  }, [d.modelUrl, d.directModelUrl, d.modelUrls, d.directModelUrls, d.urls, upstreamNodes, upstreamSignature]);

  const currentIndex = modelUrls.length
    ? Math.min(Math.max(Number(d.modelPreviewIndex) || 0, 0), modelUrls.length - 1)
    : 0;
  const currentUrl = modelUrls[currentIndex] || '';
  const autoRotate = d.modelPreviewAutoRotate !== false;

  const accent = isPixel ? 'var(--px-blue)' : isLight ? '#2563eb' : '#60a5fa';
  const bg = isPixel ? 'var(--px-surface)' : isLight ? '#ffffff' : 'rgba(9, 12, 22, 0.96)';
  const surface = isPixel ? 'var(--px-muted)' : isLight ? 'rgba(37,99,235,0.08)' : 'rgba(96,165,250,0.10)';
  const surfaceStrong = isPixel ? 'var(--px-yellow)' : isLight ? 'rgba(37,99,235,0.16)' : 'rgba(96,165,250,0.18)';
  const text = isPixel ? 'var(--px-ink)' : isLight ? '#0f172a' : '#eff6ff';
  const subText = isPixel ? 'var(--px-ink-soft)' : isLight ? '#64748b' : 'rgba(239,246,255,0.66)';
  const border = isPixel ? 'var(--px-ink)' : isLight ? 'rgba(37,99,235,0.22)' : 'rgba(96,165,250,0.28)';

  useEffect(() => {
    if (canvasRenderMode === 'cold') return;
    const mount = mountRef.current;
    if (!mount) return;

    clearThreeMount(mount, rendererRef.current);
    rendererRef.current = null;

    if (!currentUrl) {
      setLoadState('idle');
      setMessage('连入 Fal 超市 3D 输出，或在节点 data.modelUrl 写入 glb/gltf/obj/stl/fbx/usdz 地址。');
      return;
    }
    const modelFormat = getModelFormat(currentUrl);
    if (!isPreviewableModelFormat(modelFormat)) {
      setLoadState('error');
      setMessage(modelFormat === 'zip' ? 'zip 是模型打包容器，当前请下载后解压预览。' : '当前链接不是可直接预览的 3D 模型格式。');
      return;
    }

    setLoadState('loading');
    setMessage('加载 3D 模型中...');

    const previewWidth = Math.max(260, size.w - 24);
    const previewHeight = Math.max(210, size.h - 152);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, previewWidth / previewHeight, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(previewWidth, previewHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 4, 5);
    const fill = new THREE.DirectionalLight(0x7dd3fc, 0.8);
    fill.position.set(-4, 1, -3);
    scene.add(ambient, key, fill);

    const grid = new THREE.GridHelper(4, 16, 0x94a3b8, 0x334155);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = isDark ? 0.22 : 0.16;
    scene.add(grid);

    let frame = 0;
    let modelRoot: THREE.Object3D | null = null;
    let disposed = false;

    const render = () => {
      if (disposed) return;
      try {
        frame = window.requestAnimationFrame(render);
        if (modelRoot && autoRotate) modelRoot.rotation.y += 0.008;
        renderer.render(scene, camera);
      } catch (error) {
        disposed = true;
        setLoadState('error');
        setMessage(toErrorMessage(error, '3D 预览渲染失败'));
      }
    };

    loadModelObject(currentUrl, modelFormat)
      .then((loadedRoot) => {
        if (disposed) {
          disposeObject3D(loadedRoot);
          return;
        }
        modelRoot = loadedRoot;
        scene.add(modelRoot);
        const box = new THREE.Box3().setFromObject(modelRoot);
        const center = box.getCenter(new THREE.Vector3());
        const boxSize = box.getSize(new THREE.Vector3());
        if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
          modelRoot.position.sub(center);
        }
        const rawMaxDim = Math.max(boxSize.x, boxSize.y, boxSize.z);
        const maxDim = Number.isFinite(rawMaxDim) && rawMaxDim > 0 ? rawMaxDim : 1;
        camera.near = Math.max(maxDim / 200, 0.001);
        camera.far = maxDim * 200;
        camera.position.set(maxDim * 1.35, maxDim * 0.9, maxDim * 1.65);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        grid.scale.setScalar(Math.max(maxDim / 2, 1));
        setLoadState('ready');
        setMessage(`已加载 ${modelFormat.toUpperCase()}，可开启旋转或点击快照输出当前视角。`);
      })
      .catch((error) => {
        if (disposed) return;
        setLoadState('error');
        setMessage(toErrorMessage(error));
      });

    render();

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (modelRoot) disposeObject3D(modelRoot);
      disposeRenderer(renderer);
      if (rendererRef.current === renderer) rendererRef.current = null;
      clearThreeMount(mount, renderer);
    };
  }, [autoRotate, canvasRenderMode, currentUrl, isDark, size.h, size.w]);

  const onResize = (_event: any, params: { width: number; height: number }) => {
    const next = { w: Math.round(params.width), h: Math.round(params.height) };
    setSize(next);
    update({ size: next });
    updateNodeInternals(id);
  };

  const setIndex = (nextIndex: number) => {
    if (modelUrls.length === 0) return;
    const wrapped = (nextIndex + modelUrls.length) % modelUrls.length;
    update({ modelPreviewIndex: wrapped });
  };

  const handleSnapshot = () => {
    const renderer = rendererRef.current;
    if (!renderer || loadState !== 'ready') {
      update({ status: 'error', error: '模型还没加载完成，无法快照' });
      return;
    }
    try {
      renderer.renderLists.dispose();
      const imageUrl = renderer.domElement.toDataURL('image/png');
      update({
        status: 'success',
        error: '',
        imageUrl,
        imageUrls: [imageUrl],
        urls: [imageUrl],
        outputText: currentUrl ? `3D 模型快照: ${currentUrl}` : '3D 模型快照',
      });
    } catch (error: any) {
      update({ status: 'error', error: error?.message || '快照失败，可能是远端模型贴图没有允许跨域读取' });
    }
  };

  if (canvasRenderMode === 'cold') {
    return (
      <div
        className="t8-node-cold-shell"
        data-t8-node-cold-shell="model-3d-preview"
        style={{ width: size.w, height: size.h, minWidth: 360, minHeight: 300 }}
      >
        <Handle type="target" position={Position.Left} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.model3d, left: -6 }} />
        <Handle type="source" position={Position.Right} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.image, right: -6 }} />
        <div className="t8-node-cold-shell__header">
          <Box size={16} className="shrink-0" style={{ color: accent }} />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate('nodes:model3dPreview.title')}</strong>
            <small>{currentUrl ? fileNameFromUrl(currentUrl) : translate('nodes:model3dPreview.waiting')} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col"
      style={{
        width: size.w,
        height: size.h,
        minWidth: 360,
        minHeight: 300,
        background: bg,
        color: text,
        border: `2px solid ${selected ? accent : border}`,
        borderRadius: isPixel ? 8 : 14,
        boxShadow: isPixel ? (selected ? '5px 5px 0 var(--px-ink)' : '3px 3px 0 var(--px-ink)') : 'var(--t8-node-shadow, 0 12px 30px rgba(0,0,0,0.28))',
        overflow: 'visible',
      }}
    >
      <Handle type="target" position={Position.Left} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.model3d, left: -6 }} />
      <Handle type="source" position={Position.Right} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.image, right: -6 }} />
      <ResizableCorners selected={selected} minWidth={360} minHeight={300} accent={String(accent)} onResize={onResize} onResizeEnd={onResize} />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ borderRadius: isPixel ? 6 : 12 }}>
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ borderBottom: `1px solid ${border}`, background: surfaceStrong }}
        >
          <div
            className="flex items-center justify-center shrink-0"
            style={{ width: 28, height: 28, borderRadius: isPixel ? 6 : 8, color: accent, background: bg, border: `1px solid ${border}` }}
          >
            <Box size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight truncate" style={{ fontSize: 15 }}>3D模型预览</div>
            <div className="text-[10px] truncate" style={{ color: subText }}>
              {currentUrl ? `${currentIndex + 1}/${modelUrls.length} · ${fileNameFromUrl(currentUrl)}` : '接入 glb / gltf / obj / stl / fbx / usdz 预览'}
            </div>
          </div>
          {loadState === 'loading' && <Loader2 size={14} className="animate-spin" style={{ color: accent }} />}
        </div>

        <div className="p-3 flex-1 min-h-0 flex flex-col gap-2 nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="relative flex-1 min-h-0 overflow-hidden rounded"
            style={{
              background: isDark ? 'radial-gradient(circle at 50% 35%, rgba(37,99,235,.18), rgba(3,7,18,.98) 68%)' : 'linear-gradient(180deg, #eff6ff, #dbeafe)',
              border: `1px solid ${border}`,
            }}
          >
            <div ref={mountRef} className="absolute inset-0" aria-hidden="true" />
            {loadState !== 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center text-center px-5 text-[11px]" style={{ color: subText }}>
                {message}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="nodrag inline-flex items-center justify-center rounded"
              onClick={() => setIndex(currentIndex - 1)}
              disabled={modelUrls.length <= 1}
              title="上一个模型"
              style={{ width: 30, height: 28, background: surface, color: text, border: `1px solid ${border}`, opacity: modelUrls.length <= 1 ? 0.45 : 1 }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="nodrag inline-flex items-center justify-center rounded"
              onClick={() => setIndex(currentIndex + 1)}
              disabled={modelUrls.length <= 1}
              title="下一个模型"
              style={{ width: 30, height: 28, background: surface, color: text, border: `1px solid ${border}`, opacity: modelUrls.length <= 1 ? 0.45 : 1 }}
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              className="nodrag inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
              onClick={() => update({ modelPreviewAutoRotate: !autoRotate })}
              title="切换自动旋转"
              style={{ height: 28, background: autoRotate ? accent : surface, color: autoRotate ? (isPixel ? 'var(--px-surface)' : '#07111f') : text, border: `1px solid ${autoRotate ? accent : border}`, fontWeight: autoRotate ? 700 : 500 }}
            >
              <RotateCw size={12} /> 旋转
            </button>
            <button
              type="button"
              className="nodrag inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
              onClick={handleSnapshot}
              disabled={loadState !== 'ready'}
              title="把当前预览角度保存为图片输出"
              style={{ height: 28, background: loadState === 'ready' ? accent : surface, color: loadState === 'ready' ? (isPixel ? 'var(--px-surface)' : '#07111f') : subText, border: `1px solid ${loadState === 'ready' ? accent : border}`, fontWeight: 700 }}
            >
              <Camera size={12} /> 快照
            </button>
            {currentUrl && (
              <a
                className="nodrag ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
                href={currentUrl}
                target="_blank"
                rel="noreferrer"
                download
                title="下载原始模型"
                style={{ height: 28, background: surface, color: text, border: `1px solid ${border}` }}
              >
                <Download size={12} /> 下载
              </a>
            )}
          </div>
          {currentUrl && (
            <div
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px]"
              style={{ background: surface, color: subText, border: `1px solid ${border}` }}
              title={currentUrl}
            >
              <Box size={11} className="shrink-0" style={{ color: accent }} />
              <span className="shrink-0 font-semibold" style={{ color: text }}>下载地址</span>
              <span className="min-w-0 flex-1 truncate">{currentUrl}</span>
              <a
                className="nodrag shrink-0 font-semibold"
                href={currentUrl}
                target="_blank"
                rel="noreferrer"
                download
                onMouseDown={(e) => e.stopPropagation()}
                style={{ color: accent }}
              >
                下载
              </a>
            </div>
          )}
          <div className="text-[10px] leading-relaxed truncate" style={{ color: d.error ? '#f87171' : subText }} title={d.error || message || currentUrl}>
            {d.error || message || currentUrl || '等待上游模型输出'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(Model3DPreviewNode);
