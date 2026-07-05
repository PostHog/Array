export type LayoutPreset = "1x1" | "2x1" | "1x2" | "2x2" | "3x2" | "3x3";

export interface GridDimensions {
  cols: number;
  rows: number;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

export function getGridDimensions(preset: LayoutPreset): GridDimensions {
  const [cols, rows] = preset.split("x").map(Number);
  return { cols, rows };
}

export function getCellCount(preset: LayoutPreset): number {
  const { cols, rows } = getGridDimensions(preset);
  return cols * rows;
}

export function resizeCells(
  current: (string | null)[],
  newCount: number,
): (string | null)[] {
  if (current.length === newCount) return current;
  if (current.length > newCount) return current.slice(0, newCount);
  return [...current, ...Array(newCount - current.length).fill(null)];
}

export function clampZoom(value: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 10) / 10;
}

export function getCellSessionId(cellIndex: number): string {
  return `cc-cell-${cellIndex}`;
}
