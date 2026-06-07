import type { IMainWindow } from "@posthog/platform/main-window";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  type ZoomPersistence,
  ZoomServiceEvent,
} from "./schemas";
import { ZoomService } from "./service";

function createMockWindow() {
  return {
    focus: vi.fn(),
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    onFocus: vi.fn(() => () => {}),
    getZoomLevel: vi.fn(() => 0),
    setZoomLevel: vi.fn(),
  } satisfies IMainWindow;
}

function createMockPersistence(initial = 0) {
  let stored = initial;
  return {
    getZoomLevel: vi.fn(() => stored),
    setZoomLevel: vi.fn((level: number) => {
      stored = level;
    }),
  } satisfies ZoomPersistence;
}

describe("ZoomService", () => {
  let window: ReturnType<typeof createMockWindow>;
  let persistence: ReturnType<typeof createMockPersistence>;
  let service: ZoomService;

  beforeEach(() => {
    window = createMockWindow();
    persistence = createMockPersistence(0);
    service = new ZoomService(window, persistence);
  });

  it("starts at 100% (level 0)", () => {
    const state = service.getState();
    expect(state.level).toBe(0);
    expect(state.percent).toBe(100);
  });

  it("zooms in by one step and applies + persists", () => {
    const state = service.zoomIn();
    expect(state.level).toBe(0.5);
    expect(window.setZoomLevel).toHaveBeenCalledWith(0.5);
    expect(persistence.setZoomLevel).toHaveBeenCalledWith(0.5);
  });

  it("zooms out by one step", () => {
    const state = service.zoomOut();
    expect(state.level).toBe(-0.5);
    expect(window.setZoomLevel).toHaveBeenCalledWith(-0.5);
  });

  it("resets to level 0", () => {
    service.zoomIn();
    service.zoomIn();
    const state = service.reset();
    expect(state.level).toBe(0);
    expect(state.percent).toBe(100);
  });

  it("clamps at the maximum level", () => {
    for (let i = 0; i < 100; i++) {
      service.zoomIn();
    }
    const state = service.getState();
    expect(state.level).toBe(MAX_ZOOM_LEVEL);
    expect(state.canZoomIn).toBe(false);
    expect(state.canZoomOut).toBe(true);
  });

  it("clamps at the minimum level", () => {
    for (let i = 0; i < 100; i++) {
      service.zoomOut();
    }
    const state = service.getState();
    expect(state.level).toBe(MIN_ZOOM_LEVEL);
    expect(state.canZoomOut).toBe(false);
    expect(state.canZoomIn).toBe(true);
  });

  it("snaps arbitrary levels to the nearest step", () => {
    const state = service.setLevel(1.3);
    expect(state.level).toBe(1.5);
  });

  it("emits a change event with the new state", () => {
    const listener = vi.fn();
    service.on(ZoomServiceEvent.Changed, listener);
    service.zoomIn();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ level: 0.5, percent: 110 }),
    );
  });

  it("restores the persisted level onto the window", () => {
    const persisted = createMockPersistence(1.5);
    const restored = new ZoomService(window, persisted);
    const state = restored.restore();
    expect(state.level).toBe(1.5);
    expect(window.setZoomLevel).toHaveBeenLastCalledWith(1.5);
  });

  it("reads the persisted level on construction (before restore)", () => {
    const persisted = createMockPersistence(2);
    const fresh = new ZoomService(window, persisted);
    expect(fresh.getState().level).toBe(2);
    expect(fresh.getState().percent).toBe(144);
  });

  it("clamps an out-of-range persisted level on restore", () => {
    const persisted = createMockPersistence(99);
    const restored = new ZoomService(window, persisted);
    const state = restored.restore();
    expect(state.level).toBe(MAX_ZOOM_LEVEL);
    expect(window.setZoomLevel).toHaveBeenLastCalledWith(MAX_ZOOM_LEVEL);
  });

  it("persists the clamped level, not the raw requested one", () => {
    service.setLevel(99);
    expect(persistence.setZoomLevel).toHaveBeenLastCalledWith(MAX_ZOOM_LEVEL);
  });

  it("does not zoom in past the maximum once clamped", () => {
    service.setLevel(MAX_ZOOM_LEVEL);
    persistence.setZoomLevel.mockClear();
    const state = service.zoomIn();
    expect(state.level).toBe(MAX_ZOOM_LEVEL);
  });
});
