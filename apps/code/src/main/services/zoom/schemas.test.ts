import { describe, expect, it } from "vitest";
import {
  clampZoomLevel,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  zoomLevelToPercent,
} from "./schemas";

describe("clampZoomLevel", () => {
  it("leaves in-range, on-step values untouched", () => {
    expect(clampZoomLevel(0)).toBe(0);
    expect(clampZoomLevel(0.5)).toBe(0.5);
    expect(clampZoomLevel(-1.5)).toBe(-1.5);
  });

  it("snaps to the nearest 0.5 step", () => {
    expect(clampZoomLevel(1.3)).toBe(1.5);
    expect(clampZoomLevel(1.2)).toBe(1.0);
    expect(clampZoomLevel(-1.3)).toBe(-1.5);
    expect(clampZoomLevel(0.24)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clampZoomLevel(10)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(MAX_ZOOM_LEVEL + 0.5)).toBe(MAX_ZOOM_LEVEL);
  });

  it("clamps below the minimum", () => {
    expect(clampZoomLevel(-10)).toBe(MIN_ZOOM_LEVEL);
    expect(clampZoomLevel(MIN_ZOOM_LEVEL - 0.5)).toBe(MIN_ZOOM_LEVEL);
  });

  it("handles boundary values exactly", () => {
    expect(clampZoomLevel(MAX_ZOOM_LEVEL)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(MIN_ZOOM_LEVEL)).toBe(MIN_ZOOM_LEVEL);
  });
});

describe("zoomLevelToPercent", () => {
  it("returns 100% at level 0", () => {
    expect(zoomLevelToPercent(0)).toBe(100);
  });

  it("computes the 1.2^level factor as a rounded percentage", () => {
    expect(zoomLevelToPercent(1)).toBe(120);
    expect(zoomLevelToPercent(2)).toBe(144);
    expect(zoomLevelToPercent(0.5)).toBe(110);
    expect(zoomLevelToPercent(-1)).toBe(83);
    expect(zoomLevelToPercent(MAX_ZOOM_LEVEL)).toBe(249);
    expect(zoomLevelToPercent(MIN_ZOOM_LEVEL)).toBe(58);
  });
});
