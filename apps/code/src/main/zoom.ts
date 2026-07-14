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

function clampZoomLevel(level: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
}

function getSavedZoomLevel(): number {
  return clampZoomLevel(windowStateStore.get("zoomLevel", 0));
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
  const nextLevel = delta === "reset" ? 0 : getSavedZoomLevel() + delta;
  setWindowZoom(window, nextLevel);
}

export function restoreWindowZoom(window: ZoomWindow): void {
  window.webContents.setZoomLevel(getSavedZoomLevel());
}

export function setupWindowZoom(window: ZoomWindow): void {
  let restoreTimeout: ReturnType<typeof setTimeout> | null = null;

  const scheduleRestore = () => {
    if (restoreTimeout) clearTimeout(restoreTimeout);
    restoreTimeout = setTimeout(() => {
      restoreTimeout = null;
      restoreWindowZoom(window);
    }, 0);
  };

  window.webContents.on("did-finish-load", () => restoreWindowZoom(window));
  window.webContents.on("zoom-changed", () => {
    setTimeout(() => {
      saveZoomLevel(clampZoomLevel(window.webContents.getZoomLevel()));
    }, 0);
  });

  window.on("maximize", scheduleRestore);
  window.on("unmaximize", scheduleRestore);
  window.on("resized", scheduleRestore);
  window.on("enter-full-screen", scheduleRestore);
  window.on("leave-full-screen", scheduleRestore);
}
