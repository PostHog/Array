import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of windowStateStore (electron-store). Reproduces the
// only API surface zoom.ts depends on: get(key, default?) / set(key, value).
// Hoisted so vi.mock can reference it (vi.mock is moved to top of file).
const fakeStore = vi.hoisted(() => {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn((key: string, fallback?: unknown) =>
      key in data ? data[key] : fallback,
    ),
    set: vi.fn((key: string, value: unknown) => {
      data[key] = value;
    }),
    reset: () => {
      data = {};
    },
  };
});

vi.mock("./store", () => ({
  windowStateStore: fakeStore,
}));

import {
  adjustZoom,
  applyZoom,
  getSavedZoomLevel,
  makeZoomMenuClickHandlers,
  resetZoom,
  restoreZoom,
  wireZoomRestoreOnLoad,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "./zoom";

interface FakeWebContents {
  zoomLevel: number;
  setZoomLevel: ReturnType<typeof vi.fn>;
}
interface FakeWindow {
  webContents: FakeWebContents;
  isDestroyed: () => boolean;
}

const makeWindow = (initial = 0): FakeWindow => {
  const wc: FakeWebContents = {
    zoomLevel: initial,
    setZoomLevel: vi.fn((level: number) => {
      wc.zoomLevel = level;
    }),
  };
  return {
    webContents: wc,
    isDestroyed: () => false,
  };
};

beforeEach(() => {
  fakeStore.reset();
  fakeStore.get.mockClear();
  fakeStore.set.mockClear();
});

describe("getSavedZoomLevel", () => {
  it("returns 0 when nothing has been persisted", () => {
    expect(getSavedZoomLevel()).toBe(0);
  });

  it("returns the persisted zoom level", () => {
    fakeStore.set("zoomLevel", 1.5);
    expect(getSavedZoomLevel()).toBe(1.5);
  });

  it("clamps obviously bogus persisted values into the supported range", () => {
    fakeStore.set("zoomLevel", 9999);
    expect(getSavedZoomLevel()).toBe(ZOOM_MAX);
    fakeStore.set("zoomLevel", -9999);
    expect(getSavedZoomLevel()).toBe(ZOOM_MIN);
  });

  it("falls back to 0 if the persisted value is not a finite number", () => {
    fakeStore.set("zoomLevel", "broken");
    expect(getSavedZoomLevel()).toBe(0);
    fakeStore.set("zoomLevel", Number.NaN);
    expect(getSavedZoomLevel()).toBe(0);
  });
});

describe("applyZoom", () => {
  it("writes the level to webContents and persists it", () => {
    const win = makeWindow();
    applyZoom(win as never, 2);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(2);
    expect(fakeStore.set).toHaveBeenCalledWith("zoomLevel", 2);
  });

  it("clamps to ZOOM_MIN/ZOOM_MAX before applying", () => {
    const win = makeWindow();
    applyZoom(win as never, 999);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(ZOOM_MAX);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", ZOOM_MAX);

    applyZoom(win as never, -999);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(ZOOM_MIN);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", ZOOM_MIN);
  });

  it("is a no-op when the window is destroyed", () => {
    const win = { ...makeWindow(), isDestroyed: () => true };
    applyZoom(win as never, 1);
    expect(win.webContents.setZoomLevel).not.toHaveBeenCalled();
    expect(fakeStore.set).not.toHaveBeenCalled();
  });
});

describe("adjustZoom", () => {
  it("steps up by ZOOM_STEP from the persisted baseline", () => {
    fakeStore.set("zoomLevel", 0.5);
    const win = makeWindow(0); // webContents reset to 0 (simulates post-reload race)
    adjustZoom(win as never, 1);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(0.5 + ZOOM_STEP);
    expect(fakeStore.set).toHaveBeenLastCalledWith(
      "zoomLevel",
      0.5 + ZOOM_STEP,
    );
  });

  it("uses the store, NOT webContents.getZoomLevel, as the baseline (race guard)", () => {
    // Critical: if reload reset webContents to 0 mid-flight, baseline must come
    // from the store (single source of truth) — see PR #2577 Greptile review.
    fakeStore.set("zoomLevel", 1);
    const win = makeWindow(0);
    adjustZoom(win as never, 1);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(1 + ZOOM_STEP);
  });

  it("steps down by ZOOM_STEP", () => {
    fakeStore.set("zoomLevel", 1);
    const win = makeWindow();
    adjustZoom(win as never, -1);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(1 - ZOOM_STEP);
  });

  it("clamps so users cannot push past ZOOM_MAX/MIN by spamming the shortcut", () => {
    fakeStore.set("zoomLevel", ZOOM_MAX);
    const win = makeWindow();
    adjustZoom(win as never, 1);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(ZOOM_MAX);
  });
});

describe("resetZoom", () => {
  it("applies and persists 0", () => {
    fakeStore.set("zoomLevel", 2);
    const win = makeWindow(2);
    resetZoom(win as never);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(0);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", 0);
  });
});

describe("restoreZoom", () => {
  it("applies the persisted level to webContents without re-persisting noise", () => {
    fakeStore.set("zoomLevel", 1.5);
    const win = makeWindow(0); // simulate fresh reload
    restoreZoom(win as never);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(1.5);
  });

  it("is a no-op when the window is destroyed", () => {
    fakeStore.set("zoomLevel", 1.5);
    const win = { ...makeWindow(0), isDestroyed: () => true };
    restoreZoom(win as never);
    expect(win.webContents.setZoomLevel).not.toHaveBeenCalled();
  });
});

// Regression coverage for the window.ts wiring: if the did-finish-load hook is
// removed, the zoom level resets to 0 on every reload (issue #2959). The seam
// is a tiny function so we can prove the hook exists and re-applies the
// persisted level without booting Electron.
describe("wireZoomRestoreOnLoad", () => {
  interface FakeWindowWithLoadEvent extends FakeWindow {
    webContents: FakeWebContents & {
      on: ReturnType<typeof vi.fn>;
      listeners: Map<string, Array<() => void>>;
    };
  }

  const makeWindowWithLoadEvent = (initial = 0): FakeWindowWithLoadEvent => {
    const base = makeWindow(initial);
    const listeners = new Map<string, Array<() => void>>();
    const on = vi.fn((event: string, listener: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    });
    return {
      ...base,
      webContents: { ...base.webContents, on, listeners },
    };
  };

  it("registers a did-finish-load listener that restores the persisted zoom", () => {
    fakeStore.set("zoomLevel", 2);
    const win = makeWindowWithLoadEvent(0);

    wireZoomRestoreOnLoad(win as never);
    expect(win.webContents.on).toHaveBeenCalledWith(
      "did-finish-load",
      expect.any(Function),
    );

    // Simulate a reload firing the load event — Chromium has reset zoom to 0.
    const callbacks = win.webContents.listeners.get("did-finish-load") ?? [];
    expect(callbacks).toHaveLength(1);
    for (const cb of callbacks) cb();

    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(2);
  });

  it("re-applies the persisted level every time the load event fires", () => {
    fakeStore.set("zoomLevel", 1);
    const win = makeWindowWithLoadEvent(0);
    wireZoomRestoreOnLoad(win as never);

    const [cb] = win.webContents.listeners.get("did-finish-load") ?? [];
    cb?.();
    cb?.();
    expect(win.webContents.setZoomLevel).toHaveBeenCalledTimes(2);
    expect(win.webContents.setZoomLevel).toHaveBeenNthCalledWith(1, 1);
    expect(win.webContents.setZoomLevel).toHaveBeenNthCalledWith(2, 1);
  });
});

// Regression coverage for menu.ts: the View menu Reset/Zoom In/Zoom Out
// handlers replaced the native roles so the level is persisted (#2959). If a
// future refactor restores the native roles, these tests fail because the
// store stops updating.
describe("makeZoomMenuClickHandlers", () => {
  it("Reset Zoom click persists 0", () => {
    fakeStore.set("zoomLevel", 2);
    const win = makeWindow(2);
    const handlers = makeZoomMenuClickHandlers(() => win as never);

    handlers.resetZoom();

    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(0);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", 0);
  });

  it("Zoom In click steps the persisted level up by ZOOM_STEP", () => {
    fakeStore.set("zoomLevel", 0);
    const win = makeWindow(0);
    const handlers = makeZoomMenuClickHandlers(() => win as never);

    handlers.zoomIn();

    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(ZOOM_STEP);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", ZOOM_STEP);
  });

  it("Zoom Out click steps the persisted level down by ZOOM_STEP", () => {
    fakeStore.set("zoomLevel", 0);
    const win = makeWindow(0);
    const handlers = makeZoomMenuClickHandlers(() => win as never);

    handlers.zoomOut();

    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(-ZOOM_STEP);
    expect(fakeStore.set).toHaveBeenLastCalledWith("zoomLevel", -ZOOM_STEP);
  });

  it("is a no-op when no window is focused (e.g. background app)", () => {
    const handlers = makeZoomMenuClickHandlers(() => null);
    handlers.resetZoom();
    handlers.zoomIn();
    handlers.zoomOut();
    expect(fakeStore.set).not.toHaveBeenCalled();
  });
});

// Source-level regression guards: the zoom helpers and their tests above
// only prove the helpers work. They do NOT prove window.ts and menu.ts
// actually invoke them — without booting Electron there is no other way to
// catch a future refactor that drops the wiring (the original blocker on
// #2959 spec review). These tests read the production source and fail if
// the wiring disappears. ponytail: source-string guard, upgrade to an
// integration test if/when an Electron-aware test runner exists.
describe("window.ts wiring (#2959 regression)", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const windowSrc = readFileSync(
    path.join(__dirname, "..", "window.ts"),
    "utf8",
  );

  it("imports wireZoomRestoreOnLoad from ./utils/zoom", () => {
    expect(windowSrc).toMatch(
      /import\s*{[^}]*\bwireZoomRestoreOnLoad\b[^}]*}\s*from\s*["']\.\/utils\/zoom["']/,
    );
  });

  it("calls wireZoomRestoreOnLoad on the main BrowserWindow", () => {
    // The call must reference the window — bare `wireZoomRestoreOnLoad()` with
    // no argument would type-error, but a stray top-level call with the wrong
    // window would still pass type check. Require mainWindow specifically.
    expect(windowSrc).toMatch(/wireZoomRestoreOnLoad\(\s*mainWindow\s*\)/);
  });
});

describe("menu.ts wiring (#2959 regression)", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const menuSrc = readFileSync(path.join(__dirname, "..", "menu.ts"), "utf8");

  it("imports makeZoomMenuClickHandlers from ./utils/zoom", () => {
    expect(menuSrc).toMatch(
      /import\s*{[^}]*\bmakeZoomMenuClickHandlers\b[^}]*}\s*from\s*["']\.\/utils\/zoom["']/,
    );
  });

  it("calls makeZoomMenuClickHandlers to build the View menu zoom items", () => {
    expect(menuSrc).toMatch(/makeZoomMenuClickHandlers\(/);
  });

  it("does NOT use the native zoom roles (they bypass the persisted store)", () => {
    // If a future refactor restores `{ role: "zoomIn" }` etc., the level stops
    // being persisted and #2959 regresses. The custom click handlers are the
    // only path that writes through windowStateStore.
    expect(menuSrc).not.toMatch(/role:\s*["']zoomIn["']/);
    expect(menuSrc).not.toMatch(/role:\s*["']zoomOut["']/);
    expect(menuSrc).not.toMatch(/role:\s*["']resetZoom["']/);
  });
});
