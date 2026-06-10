import { logger } from "./logger";
import { windowStateStore } from "./store";

const log = logger.scope("zoom");

// Structural subset of BrowserWindow, kept local so this util avoids an
// `electron` import. A real BrowserWindow satisfies it.
interface ZoomableWindow {
  isDestroyed(): boolean;
  webContents: {
    getZoomLevel(): number;
    setZoomLevel(level: number): void;
  };
}

// Half a zoom level ≈ 9.5% per press; clamp to ~58%–173%.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;

function clampZoom(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

export function getSavedZoomLevel(): number {
  return clampZoom(windowStateStore.get("zoomLevel", 0));
}

// Native zoom resets to 100% on every reload, so call this on each
// `did-finish-load`, not just at startup.
export function applySavedZoom(window: ZoomableWindow): void {
  if (window.isDestroyed()) return;
  const level = getSavedZoomLevel();
  window.webContents.setZoomLevel(level);
}

function persistZoom(level: number): void {
  windowStateStore.set("zoomLevel", level);
}

// Set absolute zoom level (0 = 100%) and persist.
export function setZoom(window: ZoomableWindow, level: number): void {
  if (window.isDestroyed()) return;
  const next = clampZoom(level);
  window.webContents.setZoomLevel(next);
  persistZoom(next);
  log.info("zoom set", { level: next });
}

// Adjust zoom by N steps and persist. Baseline comes from the persisted store,
// not the live webContents, which is reset to 0 during reloads.
export function adjustZoom(window: ZoomableWindow, steps: number): void {
  if (window.isDestroyed()) return;
  setZoom(window, getSavedZoomLevel() + steps * ZOOM_STEP);
}
