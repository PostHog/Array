import { windowStateStore } from "./store";

// Zoom levels are integers/halves passed to Electron's
// webContents.setZoomLevel. Chromium clamps to roughly ±9; we mirror
// Electron's default zoom step of 0.5 (matches the native zoomIn/zoomOut
// roles we replace) so the muscle memory stays identical.
export const ZOOM_STEP = 0.5;
export const ZOOM_MIN = -8;
export const ZOOM_MAX = 8;

const STORE_KEY = "zoomLevel";

function clamp(level: number): number {
  if (level > ZOOM_MAX) return ZOOM_MAX;
  if (level < ZOOM_MIN) return ZOOM_MIN;
  return level;
}

export function getSavedZoomLevel(): number {
  const raw = windowStateStore.get(STORE_KEY, 0) as unknown;
  const level = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  return clamp(level);
}

function setSavedZoomLevel(level: number): void {
  windowStateStore.set(STORE_KEY, level);
}

// Structural type — main-process modules outside the allowlist must not
// import from "electron" (see biome.jsonc noRestrictedImports). zoom.ts is
// host-agnostic; the BrowserWindow passed in from window.ts/menu.ts
// satisfies this shape without dragging electron into the type graph.
export interface ZoomableWindow {
  isDestroyed: () => boolean;
  webContents: {
    setZoomLevel: (level: number) => void;
  };
}

export function applyZoom(window: ZoomableWindow, level: number): void {
  if (window.isDestroyed()) return;
  const next = clamp(level);
  window.webContents.setZoomLevel(next);
  setSavedZoomLevel(next);
}

// ponytail: store is the single source of truth for the baseline. Reading
// webContents.getZoomLevel() races with reload — Electron resets the
// webContents zoom to 0 before did-finish-load restores it (PR #2577 review).
export function adjustZoom(window: ZoomableWindow, steps: number): void {
  applyZoom(window, getSavedZoomLevel() + steps * ZOOM_STEP);
}

export function resetZoom(window: ZoomableWindow): void {
  applyZoom(window, 0);
}

export function restoreZoom(window: ZoomableWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.setZoomLevel(getSavedZoomLevel());
}

// Structural type for the load-event seam used by window.ts. Kept narrow on
// purpose so the helper stays host-agnostic and testable without booting
// Electron — BrowserWindow satisfies this shape via TS structural typing.
export interface WindowWithLoadEvent extends ZoomableWindow {
  webContents: ZoomableWindow["webContents"] & {
    on(event: "did-finish-load", listener: () => void): unknown;
  };
}

// Wires zoom restoration to every load — covers crash-recovery auto-reload
// (#2003) and Cmd+Shift+R, both of which reset webContents zoom to 0 (#2959).
export function wireZoomRestoreOnLoad(window: WindowWithLoadEvent): void {
  window.webContents.on("did-finish-load", () => {
    restoreZoom(window);
  });
}

// View-menu click handlers (Reset / Zoom In / Zoom Out). Extracted from menu.ts
// so menu actions are exercised without booting Electron and prove the
// persisted store is the source of truth.
export function makeZoomMenuClickHandlers(
  getFocusedWindow: () => ZoomableWindow | null,
): {
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
} {
  return {
    resetZoom: () => {
      const w = getFocusedWindow();
      if (w) resetZoom(w);
    },
    zoomIn: () => {
      const w = getFocusedWindow();
      if (w) adjustZoom(w, 1);
    },
    zoomOut: () => {
      const w = getFocusedWindow();
      if (w) adjustZoom(w, -1);
    },
  };
}
