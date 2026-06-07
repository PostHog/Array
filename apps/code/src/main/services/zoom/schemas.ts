import { z } from "zod";

/**
 * Zoom is expressed as an Electron "zoom level": 0 means 100%, and each unit is
 * a 1.2x factor (the same scale `webContents.setZoomLevel` uses). Steps of 0.5
 * give roughly ~10% increments, matching Electron's built-in zoom roles.
 */
export const ZOOM_STEP = 0.5;
export const MIN_ZOOM_LEVEL = -3;
export const MAX_ZOOM_LEVEL = 5;

export const zoomStateSchema = z.object({
  /** Raw Electron zoom level (0 = 100%). */
  level: z.number(),
  /** Human-friendly percentage derived from the level (e.g. 110). */
  percent: z.number(),
  canZoomIn: z.boolean(),
  canZoomOut: z.boolean(),
});

export type ZoomState = z.infer<typeof zoomStateSchema>;

export const setZoomLevelInputSchema = z.object({
  level: z.number(),
});

// Zoom events emitted from main to renderer.
export const ZoomServiceEvent = {
  Changed: "zoom-changed",
} as const;

export interface ZoomServiceEvents {
  [ZoomServiceEvent.Changed]: ZoomState;
}

/** Narrow persistence port so the service stays unit-testable without disk. */
export interface ZoomPersistence {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
}

/** Snap to the nearest step and clamp into the allowed range. */
export function clampZoomLevel(level: number): number {
  const stepped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, stepped));
}

export function zoomLevelToPercent(level: number): number {
  return Math.round(1.2 ** level * 100);
}
