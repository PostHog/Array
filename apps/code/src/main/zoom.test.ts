import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const state = { zoomLevel: 0.5 };
  return {
    get: vi.fn(() => state.zoomLevel),
    save: vi.fn((level: number) => {
      state.zoomLevel = level;
    }),
    state,
  };
});

vi.mock("./utils/store", () => ({
  windowStateStore: { get: store.get },
  saveZoomLevel: store.save,
}));

import { adjustWindowZoom, restoreWindowZoom, setupWindowZoom } from "./zoom";

class FakeWebContents extends EventEmitter {
  public zoomLevel = 0;

  public getZoomLevel(): number {
    return this.zoomLevel;
  }

  public setZoomLevel(level: number): void {
    this.zoomLevel = level;
  }
}

class FakeWindow extends EventEmitter {
  public readonly webContents = new FakeWebContents();
}

type ZoomWindow = Parameters<typeof adjustWindowZoom>[0];

function createWindow(): FakeWindow & ZoomWindow {
  return new FakeWindow() as FakeWindow & ZoomWindow;
}

describe("window zoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.state.zoomLevel = 0.5;
    store.get.mockReset();
    store.get.mockImplementation(() => store.state.zoomLevel);
    store.save.mockReset();
    store.save.mockImplementation((level: number) => {
      store.state.zoomLevel = level;
    });
  });

  it("adjusts from the persisted level when Chromium has reset", () => {
    const window = createWindow();
    window.webContents.zoomLevel = 0;

    adjustWindowZoom(window, 0.5);

    expect({
      zoomLevel: window.webContents.zoomLevel,
      saved: store.save.mock.calls,
    }).toEqual({
      zoomLevel: 1,
      saved: [[1]],
    });
  });

  it("restores the persisted level after maximizing", () => {
    const window = createWindow();
    setupWindowZoom(window);
    window.webContents.zoomLevel = 0;

    window.emit("maximize");
    vi.runAllTimers();

    expect(window.webContents.zoomLevel).toBe(0.5);
  });

  it("restores the persisted level after renderer reloads", () => {
    const window = createWindow();
    setupWindowZoom(window);
    window.webContents.zoomLevel = 0;

    window.webContents.emit("did-finish-load");

    expect(window.webContents.zoomLevel).toBe(0.5);
  });

  it("persists wheel zoom after Chromium updates its level", () => {
    const window = createWindow();
    setupWindowZoom(window);

    window.webContents.emit("zoom-changed");
    window.webContents.zoomLevel = 1.5;
    vi.runAllTimers();

    expect(store.save).toHaveBeenCalledWith(1.5);
  });

  it("waits for native zoom before applying a menu adjustment", () => {
    const window = createWindow();
    setupWindowZoom(window);

    window.webContents.emit("zoom-changed");
    window.webContents.zoomLevel = 1.5;
    adjustWindowZoom(window, 0.5);
    vi.runAllTimers();

    expect({
      zoomLevel: window.webContents.zoomLevel,
      saved: store.save.mock.calls,
    }).toEqual({
      zoomLevel: 2,
      saved: [[1.5], [2]],
    });
  });

  it("waits for native zoom before restoring after a reload", () => {
    const window = createWindow();
    setupWindowZoom(window);

    window.webContents.emit("zoom-changed");
    window.webContents.zoomLevel = 1.5;
    window.webContents.emit("did-finish-load");
    vi.runAllTimers();

    expect({
      zoomLevel: window.webContents.zoomLevel,
      saved: store.save.mock.calls,
    }).toEqual({
      zoomLevel: 1.5,
      saved: [[1.5]],
    });
  });

  it("clamps invalid persisted levels before restoring", () => {
    store.get.mockReturnValue(10);
    const window = createWindow();

    restoreWindowZoom(window);

    expect(window.webContents.zoomLevel).toBe(3);
  });
});
