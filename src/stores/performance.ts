import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  normalizeCanvasPerformanceMode,
  type CanvasPerformanceMode,
} from '../utils/canvasPerformance';

interface CanvasPerformanceState {
  mode: CanvasPerformanceMode;
  setMode: (mode: CanvasPerformanceMode) => void;
  restoreVisuals: () => void;
}

export const useCanvasPerformanceStore = create<CanvasPerformanceState>()(
  persist(
    (set) => ({
      mode: 'auto',
      setMode: (mode) => set({ mode: normalizeCanvasPerformanceMode(mode) }),
      restoreVisuals: () => set({ mode: 'balanced' }),
    }),
    {
      name: 't8-canvas-performance-v1',
      partialize: (state) => ({ mode: state.mode }),
      merge: (persisted, current) => ({
        ...current,
        mode: normalizeCanvasPerformanceMode((persisted as Partial<CanvasPerformanceState> | undefined)?.mode),
      }),
    },
  ),
);
