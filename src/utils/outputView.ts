export type OutputViewMode = 'legacy-auto' | 'free' | 'aspect';

export type OutputViewState = {
  version: 1;
  mode: OutputViewMode;
  width?: number;
  height?: number;
};

export function normalizeOutputViewState(raw: unknown): OutputViewState {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mode: OutputViewMode = value.mode === 'free' || value.mode === 'aspect'
    ? value.mode
    : 'legacy-auto';
  const width = Number(value.width);
  const height = Number(value.height);
  return {
    version: 1,
    mode,
    ...(Number.isFinite(width) && width >= 260 ? { width } : {}),
    ...(Number.isFinite(height) && height >= 160 ? { height } : {}),
  };
}

export function resolveOutputGridColumns(count: number, width: number) {
  if (count <= 1) return 1;
  if (width < 420) return 1;
  if (width < 720 || count <= 4) return 2;
  if (width < 980) return 3;
  return 4;
}

export function computeOutputAspectSize(input: {
  rootWidth: number;
  rootHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  aspect: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const minWidth = input.minWidth ?? 260;
  const minHeight = input.minHeight ?? 160;
  const maxWidth = input.maxWidth ?? 1280;
  const maxHeight = input.maxHeight ?? 1440;
  const width = Math.min(maxWidth, Math.max(minWidth, Math.round(input.rootWidth)));
  const safeAspect = Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : 1;
  // The non-media chrome is measured from the live layout. This deliberately
  // avoids a fixed "node height minus N pixels" contract that breaks as labels,
  // languages, themes, or mixed sections change.
  const chromeHeight = Math.max(0, input.rootHeight - input.mediaHeight);
  const mediaWidth = Math.max(1, input.mediaWidth);
  const height = Math.min(maxHeight, Math.max(minHeight, Math.round(chromeHeight + mediaWidth / safeAspect)));
  return { width, height };
}
