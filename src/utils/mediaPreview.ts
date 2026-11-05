const LOCAL_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(?:[?#].*)?$/i;
const LOCAL_FILE_PREFIX_RE = /^\/(?:files\/(?:input|output)|input|output)\//;

export function canUseLocalImageThumbnail(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const clean = url.trim();
  if (!clean || !LOCAL_FILE_PREFIX_RE.test(clean)) return false;
  // Thumbnail generation decodes a single frame. Keep animated GIF originals.
  if (/\.gif(?:[?#].*)?$/i.test(clean)) return false;
  return LOCAL_IMAGE_RE.test(clean.split('?')[0].split('#')[0]);
}

export function previewImageUrl(url: string, size = 360): string {
  if (/\.svg(?:[?#].*)?$/i.test(url)) return originalImageDisplayUrl(url);
  if (!canUseLocalImageThumbnail(url)) return url;
  const safeSize = Math.max(96, Math.min(1024, Math.round(size || 360)));
  return `/api/files/thumbnail?size=${safeSize}&url=${encodeURIComponent(url)}`;
}
export function originalImageDisplayUrl(url:string):string {
  const match=/^\/files\/output\/([^/?#]+\.svg)(?:[?#].*)?$/i.exec(url);
  return match?`/api/files/vector/${encodeURIComponent(match[1])}`:url;
}
/** Export the original bytes; canvas re-encoding would flatten GIF and SVG. */
export async function downloadOriginalImage(url:string):Promise<void> {
  const response=await fetch(originalImageDisplayUrl(url));
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=objectUrl;anchor.download=url.split(/[?#]/)[0].split('/').pop()||'image';
  document.body.appendChild(anchor);
  try{anchor.click();}finally{anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);}
}
