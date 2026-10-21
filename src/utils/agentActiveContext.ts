export interface CanvasActiveContextSource {
  loaded: boolean;
  canvasId: string | null;
  currentCanvasId: string | null;
  loadedCanvasId: string | null;
  initializedCanvasId: string | null;
  projectId: string | null;
  revision: number | undefined;
}

export function registerCanvasActiveContext(
  bridge: NonNullable<Window['t8pc']>['agentControl'] | undefined,
  read: () => CanvasActiveContextSource,
) {
  return bridge?.onActiveContextRequest?.(() => {
    const source = read();
    if (!source.loaded || !source.canvasId || source.canvasId !== source.currentCanvasId
      || source.canvasId !== source.loadedCanvasId || source.canvasId !== source.initializedCanvasId) {
      return { ready: false };
    }
    return { ready: true, projectId: source.projectId, canvasId: source.canvasId, revision: source.revision };
  });
}
