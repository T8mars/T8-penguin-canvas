import { createContext, useContext, type ReactNode } from 'react';

export type CanvasNodeRenderMode = 'hot' | 'cold';

const CanvasPerformanceEnabledContext = createContext(false);
const CanvasNodeRenderModeContext = createContext<CanvasNodeRenderMode>('hot');

export function CanvasPerformanceRenderProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <CanvasPerformanceEnabledContext.Provider value={enabled}>
      {children}
    </CanvasPerformanceEnabledContext.Provider>
  );
}

export function CanvasNodeRenderModeProvider({ mode, children }: { mode: CanvasNodeRenderMode; children: ReactNode }) {
  return <CanvasNodeRenderModeContext.Provider value={mode}>{children}</CanvasNodeRenderModeContext.Provider>;
}

export function useCanvasPerformanceRenderingEnabled() {
  return useContext(CanvasPerformanceEnabledContext);
}

export function useCanvasNodeRenderMode() {
  return useContext(CanvasNodeRenderModeContext);
}
