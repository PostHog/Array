import { create } from "zustand";

interface LongTask {
  id: number;
  durationMs: number;
  name: string;
  startedAt: number;
}

interface MainThreadHealthState {
  fps: number;
  longTasks: LongTask[];
  longTaskCount: number;
  recordLongTask: (durationMs: number, name: string) => void;
  setFps: (fps: number) => void;
  reset: () => void;
}

const LONG_TASK_BUFFER = 50;

export const useMainThreadHealthStore = create<MainThreadHealthState>()(
  (set) => ({
    fps: 60,
    longTasks: [],
    longTaskCount: 0,
    recordLongTask: (durationMs, name) =>
      set((state) => {
        const task: LongTask = {
          id: state.longTaskCount + 1,
          durationMs,
          name,
          startedAt: Date.now(),
        };
        const next = [...state.longTasks, task];
        return {
          longTasks:
            next.length > LONG_TASK_BUFFER
              ? next.slice(next.length - LONG_TASK_BUFFER)
              : next,
          longTaskCount: state.longTaskCount + 1,
        };
      }),
    setFps: (fps) => set({ fps }),
    reset: () => set({ longTasks: [], longTaskCount: 0, fps: 60 }),
  }),
);

let installed = false;
let stopFpsLoop: (() => void) | null = null;
let observer: PerformanceObserver | null = null;

export function installMainThreadHealth(): () => void {
  if (installed) return () => undefined;
  installed = true;

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        useMainThreadHealthStore
          .getState()
          .recordLongTask(entry.duration, entry.name || "longtask");
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // Browsers without longtask support — silently ignore
  }

  let frames = 0;
  let lastSecond = performance.now();
  let raf = 0;
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - lastSecond >= 1000) {
      useMainThreadHealthStore
        .getState()
        .setFps(Math.round((frames * 1000) / (now - lastSecond)));
      frames = 0;
      lastSecond = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  stopFpsLoop = () => cancelAnimationFrame(raf);

  return () => {
    installed = false;
    observer?.disconnect();
    observer = null;
    stopFpsLoop?.();
    stopFpsLoop = null;
  };
}
