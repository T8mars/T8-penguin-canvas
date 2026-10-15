/**
 * 图像变换 service - /api/image/*
 */
import type { GridComposeRequest } from '../utils/gridEditor';

async function postOp<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(`/api/image/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const isHtml = /^\s*</.test(text || '');
    throw new Error(isHtml ? '图像处理接口未就绪，请重启后端服务后重试' : `接口返回异常: ${text.slice(0, 120)}`);
  }
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export const opResize = (imageUrl: string, width?: number, height?: number, fit?: string) =>
  postOp<{ imageUrl: string }>('resize', { imageUrl, width, height, fit });

export const opResizeLongEdge = (imageUrl: string, longEdge: 1024 | 2048) =>
  postOp<{
    imageUrl: string;
    width: number;
    height: number;
    longEdge: 1024 | 2048;
    resized: boolean;
  }>('resize-long-edge', { imageUrl, longEdge });

export const opUpscale = (imageUrl: string, scale: number) =>
  postOp<{ imageUrl: string; scale: number }>('upscale', { imageUrl, scale });

export const opTrimBorder = (
  imageUrl: string,
  options?: {
    mode?: 'black' | 'white' | 'transparent' | 'auto';
    axis?: 'vertical' | 'horizontal' | 'all';
    threshold?: number;
    strategy?: 'auto' | 'manual';
    manual?: { top?: number; right?: number; bottom?: number; left?: number };
  },
) =>
  postOp<{
    imageUrl: string;
    crop: {
      x: number;
      y: number;
      w: number;
      h: number;
      originalWidth: number;
      originalHeight: number;
      removed: { top: number; right: number; bottom: number; left: number };
      strategy: 'auto' | 'manual';
      mode: 'black' | 'white' | 'transparent' | 'auto';
      axis: 'vertical' | 'horizontal' | 'all';
      threshold: number;
    };
  }>('trim-border', {
    imageUrl,
    ...(options || {}),
  });

export const opPadCanvas = (
  imageUrl: string,
  options?: { ratio?: string; background?: string },
) =>
  postOp<{ imageUrl: string; width: number; height: number }>('pad-canvas', {
    imageUrl,
    ...(options || {}),
  });

export const opConvert = (
  imageUrl: string,
  options?: { format?: 'png' | 'jpg' | 'webp'; quality?: number },
) =>
  postOp<{ imageUrl: string; format: string }>('convert', {
    imageUrl,
    ...(options || {}),
  });

/**
 * 单矩形裁剪
 * @param imageUrl 原图 URL
 * @param x natural 像素 起点 X
 * @param y natural 像素 起点 Y
 * @param w natural 像素 宽
 * @param h natural 像素 高
 */
export const opCrop = (
  imageUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
) => postOp<{ imageUrl: string }>('crop', { imageUrl, x, y, w, h });

/**
 * 宫格切分
 * - 等分模式: 传 rows/cols/gap
 * - 自定义模式: 传 rectsPx (外部已计算好的 natural 像素矩形)
 */
export const opGridCrop = (
  imageUrl: string,
  rows: number,
  cols: number,
  gap?: number,
  rectsPx?: Array<{ x: number; y: number; w: number; h: number; row?: number; col?: number }>,
  options?: {
    orderMode?: 'row' | 'column' | 'snake' | 'reverse';
    exportIndexes?: number[] | string;
  },
) =>
  postOp<{
    urls: string[];
    rows: number;
    cols: number;
    gap: number;
    orderMode?: string;
    exportIndexes?: number[];
    totalTiles?: number;
    layout: { rows: number; cols: number; gap: number; orderMode?: string };
  }>(
    'grid-crop',
    { imageUrl, rows, cols, gap, rectsPx, ...(options || {}) },
  );

export const opGridCompose = (request: GridComposeRequest) =>
  postOp<{
    imageUrl: string;
    rows: number;
    cols: number;
    width: number;
    height: number;
    gap: number;
  }>('grid-compose', request);

export const opCombine = (imageUrls: string[], direction: 'horizontal' | 'vertical') =>
  postOp<{ imageUrl: string }>('combine', { imageUrls, direction });

export const opCompare = (
  imageAUrl: string,
  imageBUrl: string,
  mode: 'slider' | 'side-by-side' | 'overlay' | 'blink' | 'heatmap' | 'focus',
  options?: {
    align?: 'contain' | 'cover' | 'fill';
    split?: number;
    opacity?: number;
    threshold?: number;
  },
) =>
  postOp<{
    imageUrl: string;
    metrics: {
      width: number;
      height: number;
      imageA: { width: number; height: number };
      imageB: { width: number; height: number };
      meanDiff: number;
      maxDiff: number;
      changedRatio: number;
      threshold: number;
    };
  }>('compare', { imageAUrl, imageBUrl, mode, ...(options || {}) });

export const opRemoveBg = (imageUrl: string) =>
  postOp<{ imageUrl: string; warning?: string }>('remove-bg', { imageUrl });

/**
 * 将 dataURL (base64) 上传到后端 → 返回本地 url (/files/output/xxx)
 * 用于：图像编辑器 mask / brush 模式产物落地
 */
export async function uploadDataUrl(dataUrl: string, prefix: string = 'edit'): Promise<string> {
  const r = await fetch('/api/files/upload-base64', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, prefix }),
  });
  const json = await r.json();
  if (!r.ok || !json.success) throw new Error(json?.error || `HTTP ${r.status}`);
  return json.data.url as string;
}

/**
 * 将 File / Blob 上传 (multipart) → 返回本地 url
 * 用于：图像编辑器 compose 模式 拖入文件 / Ctrl+V 粘贴文件 作为新图层
 */
export interface LocalFileUploadReceipt { url: string; filename: string; size: number; mime: string; assetId?: string | null }
export async function uploadFileBlobReceipt(file: File | Blob, filename?: string, options: {
  signal?: AbortSignal; canvasId?: string; sourceNodeId?: string; sourceNodeType?: string;
} = {}): Promise<LocalFileUploadReceipt> {
  const fd = new FormData();
  const fname = filename || (file instanceof File ? file.name : `compose-${Date.now()}.png`);
  fd.append('file', file, fname);
  for (const field of ['canvasId', 'sourceNodeId', 'sourceNodeType'] as const) if (options[field]) fd.append(field, options[field]!);
  const r = await fetch('/api/files/upload', { method: 'POST', body: fd, signal: options.signal });
  const json = await r.json();
  if (!r.ok || !json.success) throw new Error(json?.error || `HTTP ${r.status}`);
  if (!json.data || typeof json.data.url !== 'string' || !json.data.url) throw new Error('上传结果缺少文件地址');
  return json.data as LocalFileUploadReceipt;
}
export async function uploadFileBlob(file: File | Blob, filename?: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  return (await uploadFileBlobReceipt(file, filename, options)).url;
}

export async function copyFileToOutput(
  url: string,
  filename: string,
  subdir: string = 'batch',
  options: { signal?: AbortSignal } = {},
): Promise<{ url: string; filename: string; path?: string; size?: number; exist?: boolean }> {
  const r = await fetch('/api/files/copy-to-output', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, filename, subdir }),
    signal: options.signal,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const isHtml = /^\s*</.test(text || '');
    if (isHtml) {
      throw new Error('批处理归档接口未就绪，请重启后端服务后重试');
    }
    throw new Error(`批处理归档接口返回异常: ${text.slice(0, 120)}`);
  }
  if (!r.ok || !json?.success) throw new Error(json?.error || `HTTP ${r.status}`);
  return json.data;
}

export async function openOutputFolder(
  subdir: string = 'batch',
): Promise<{ subdir: string; path: string; url: string; opened: boolean }> {
  const nativeOpenPath = typeof window !== 'undefined' ? window.t8pc?.openPath : undefined;
  const r = await fetch('/api/files/open-output-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdir, ...(nativeOpenPath ? { dryRun: true } : {}) }),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const isHtml = /^\s*</.test(text || '');
    if (isHtml) {
      throw new Error('打开输出文件夹接口未就绪，请重启后端服务后重试');
    }
    throw new Error(`打开输出文件夹接口返回异常: ${text.slice(0, 120)}`);
  }
  if (!r.ok || !json?.success) throw new Error(json?.error || `HTTP ${r.status}`);
  const data = json.data as { subdir: string; path: string; url: string; opened: boolean };
  if (nativeOpenPath && data.path) {
    const opened = await window.t8pc?.openPath(data.path);
    if (!opened?.success) {
      throw new Error(opened?.message || '系统打开输出文件夹失败');
    }
    return { ...data, opened: true };
  }
  return data;
}

export async function openLocalPath(
  targetPath: string,
  options: { selectFile?: boolean } = {},
): Promise<{ path: string; targetPath?: string; selectFile?: boolean; opened: boolean }> {
  const cleanPath = String(targetPath || '').trim();
  if (!cleanPath) throw new Error('缺少要打开的本地目录');
  const nativeOpenPath = typeof window !== 'undefined' ? window.t8pc?.openPath : undefined;
  if (nativeOpenPath && !options.selectFile) {
    const opened = await nativeOpenPath(cleanPath);
    if (opened?.success) {
      return { path: opened.path || cleanPath, opened: true };
    }
    // Electron 的安全白名单可能不包含刚恢复的旧画布原始目录，继续交给本地后端打开。
  }
  const r = await fetch('/api/files/open-local-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: cleanPath, selectFile: options.selectFile === true }),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const isHtml = /^\s*</.test(text || '');
    if (isHtml) {
      throw new Error('打开本地目录接口未就绪，请重启后端服务后重试');
    }
    throw new Error(`打开本地目录接口返回异常: ${text.slice(0, 120)}`);
  }
  if (!r.ok || !json?.success) throw new Error(json?.error || `HTTP ${r.status}`);
  return json.data as { path: string; targetPath?: string; selectFile?: boolean; opened: boolean };
}
