import { saveZoomLevel, windowStateStore } from "./utils/store";

export const ZOOM_STEP = 0.5;

const ZOOM_MIN = -3;
const ZOOM_MAX = 3;

interface ZoomWebContents {
  getZoomLevel(): number;
  on(event: "did-finish-load" | "zoom-changed", listener: () => void): void;
  setZoomLevel(level: number): void;
}

interface ZoomWindow {
  on(
    event:
      | "enter-full-screen"
      | "leave-full-screen"
      | "maximize"
      | "resized"
      | "unmaximize",
    listener: () => void,
  ): void;
  webContents: ZoomWebContents;
}

interface ZoomState {
  deferredActions: Array<() => void>;
  nativeZoomTimeout: ReturnType<typeof setTimeout> | null;
}

const zoomStates = new WeakMap<ZoomWindow, ZoomState>();

function clampZoomLevel(level: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
}

function getSavedZoomLevel(): number {
  return clampZoomLevel(windowStateStore.get("zoomLevel", 0));
}

function runAfterNativeZoom(window: ZoomWindow, action: () => void): void {
  const state = zoomStates.get(window);
  if (!state?.nativeZoomTimeout) {
    action();
    return;
  }

  state.deferredActions.push(action);
}

export function setWindowZoom(window: ZoomWindow, level: number): void {
  const nextLevel = clampZoomLevel(level);
  window.webContents.setZoomLevel(nextLevel);
  saveZoomLevel(nextLevel);
}

export function adjustWindowZoom(
  window: ZoomWindow,
  delta: number | "reset",
): void {
  runAfterNativeZoom(window, () => {
    const nextLevel = delta === "reset" ? 0 : getSavedZoomLevel() + delta;
    setWindowZoom(window, nextLevel);
  });
}

export function restoreWindowZoom(window: ZoomWindow): void {
  runAfterNativeZoom(window, () => {
    window.webContents.setZoomLevel(getSavedZoomLevel());
  });
}

export function setupWindowZoom(window: ZoomWindow): void {
  const state: ZoomState = {
    deferredActions: [],
    nativeZoomTimeout: null,
  };
  let restoreTimeout: ReturnType<typeof setTimeout> | null = null;
  zoomStates.set(window, state);

  const scheduleRestore = () => {
    if (restoreTimeout) clearTimeout(restoreTimeout);
    restoreTimeout = setTimeout(() => {
      restoreTimeout = null;
      restoreWindowZoom(window);
    }, 0);
  };

  window.webContents.on("did-finish-load", () => restoreWindowZoom(window));
  window.webContents.on("zoom-changed", () => {
    if (state.nativeZoomTimeout) clearTimeout(state.nativeZoomTimeout);
    state.nativeZoomTimeout = setTimeout(() => {
      state.nativeZoomTimeout = null;
      saveZoomLevel(clampZoomLevel(window.webContents.getZoomLevel()));
      const deferredActions = state.deferredActions.splice(0);
      for (const action of deferredActions) action();
    }, 0);
  });

  window.on("maximize", scheduleRestore);
  window.on("unmaximize", scheduleRestore);
  window.on("resized", scheduleRestore);
  window.on("enter-full-screen", scheduleRestore);
  window.on("leave-full-screen", scheduleRestore);
}
