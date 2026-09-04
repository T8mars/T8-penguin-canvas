export type CanvasSurfacePhase = 'mounting' | 'empty' | 'document' | 'flow' | 'ready' | 'failed';

export interface CanvasSurfaceReadiness {
  phase: CanvasSurfacePhase;
  canvasId: string | null;
  loadedCanvasId: string | null;
  revision: number;
  flowCanvasId: string | null;
  error: string | null;
}

export type CanvasStartupStage =
  | 'connecting'
  | 'backend-error'
  | 'catalog'
  | 'catalog-error'
  | 'empty'
  | 'document'
  | 'flow'
  | 'canvas-error'
  | 'ready';

export interface CanvasStartupReadinessInput {
  backendStatus: 'checking' | 'ok' | 'error';
  catalogBootstrapped: boolean;
  catalogLoading: boolean;
  catalogError: string | null;
  activeCanvasId: string | null;
  surface: CanvasSurfaceReadiness;
}

export interface CanvasStartupReadiness {
  stage: CanvasStartupStage;
  catalogReady: boolean;
  canCreateCanvas: boolean;
  canAddNodes: boolean;
  error: string | null;
}

export const INITIAL_CANVAS_SURFACE_READINESS: CanvasSurfaceReadiness = {
  phase: 'mounting',
  canvasId: null,
  loadedCanvasId: null,
  revision: 0,
  flowCanvasId: null,
  error: null,
};

export function deriveCanvasStartupReadiness(
  input: CanvasStartupReadinessInput,
): CanvasStartupReadiness {
  if (input.backendStatus === 'checking') {
    return {
      stage: 'connecting',
      catalogReady: false,
      canCreateCanvas: false,
      canAddNodes: false,
      error: null,
    };
  }
  if (input.backendStatus === 'error') {
    return {
      stage: 'backend-error',
      catalogReady: false,
      canCreateCanvas: false,
      canAddNodes: false,
      error: null,
    };
  }

  const catalogReady = input.catalogBootstrapped && !input.catalogLoading;
  if (!catalogReady) {
    const failed = Boolean(input.catalogError) && !input.catalogLoading;
    return {
      stage: failed ? 'catalog-error' : 'catalog',
      catalogReady: false,
      canCreateCanvas: false,
      canAddNodes: false,
      error: failed ? input.catalogError : null,
    };
  }

  if (!input.activeCanvasId) {
    return {
      stage: 'empty',
      catalogReady: true,
      canCreateCanvas: true,
      canAddNodes: false,
      error: null,
    };
  }

  const surfaceMatchesActiveCanvas = input.surface.canvasId === input.activeCanvasId;
  if (surfaceMatchesActiveCanvas && input.surface.phase === 'failed') {
    return {
      stage: 'canvas-error',
      catalogReady: true,
      canCreateCanvas: true,
      canAddNodes: false,
      error: input.surface.error,
    };
  }
  if (!surfaceMatchesActiveCanvas || input.surface.phase === 'mounting' || input.surface.phase === 'document') {
    return {
      stage: 'document',
      catalogReady: true,
      canCreateCanvas: true,
      canAddNodes: false,
      error: null,
    };
  }
  if (input.surface.phase === 'flow') {
    return {
      stage: 'flow',
      catalogReady: true,
      canCreateCanvas: true,
      canAddNodes: false,
      error: null,
    };
  }
  if (input.surface.phase === 'ready') {
    return {
      stage: 'ready',
      catalogReady: true,
      canCreateCanvas: true,
      canAddNodes: true,
      error: null,
    };
  }

  return {
    stage: 'document',
    catalogReady: true,
    canCreateCanvas: true,
    canAddNodes: false,
    error: null,
  };
}
