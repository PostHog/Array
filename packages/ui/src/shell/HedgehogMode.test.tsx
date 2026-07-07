import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mount: vi.fn(),
  destroy: vi.fn(),
  captureException: vi.fn(),
  contextLost: false,
}));

const settingsState = vi.hoisted(() => ({
  hedgehogMode: true,
  setHedgehogMode: () => {},
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ mount: mocks.mount }),
}));

vi.mock("../features/auth/useMeQuery", () => ({
  useMeQuery: () => ({ data: undefined }),
}));

vi.mock("../features/settings/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector(settingsState),
}));

vi.mock("./analytics", () => ({
  captureException: mocks.captureException,
}));

vi.mock("./logger", () => ({
  logger: {
    scope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { HedgehogMode } from "./HedgehogMode";

function mountGameInto(container: HTMLDivElement) {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => ({
    isContextLost: () => mocks.contextLost,
  })) as unknown as HTMLCanvasElement["getContext"];
  container.appendChild(canvas);
  mocks.destroy.mockImplementation(() => canvas.remove());
  return Promise.resolve({ destroy: mocks.destroy });
}

async function loseContext(overlay: HTMLDivElement) {
  const canvas = overlay.querySelector("canvas");
  expect(canvas).not.toBeNull();
  await act(async () => {
    canvas?.dispatchEvent(new Event("webglcontextlost"));
  });
}

async function renderHedgehogMode() {
  const view = render(<HedgehogMode />);
  await act(async () => {});
  return view.container.firstElementChild as HTMLDivElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.mount.mockImplementation(mountGameInto);
  mocks.contextLost = false;
  settingsState.hedgehogMode = true;
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("HedgehogMode", () => {
  it("mounts the game into the overlay container", async () => {
    const overlay = await renderHedgehogMode();

    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).not.toBeNull();
    expect(overlay.style.visibility).toBe("visible");
  });

  it("destroys the game and reports when the WebGL context is lost", async () => {
    const overlay = await renderHedgehogMode();

    await loseContext(overlay);

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: "hedgehog-mode", losses: 1 }),
    );
  });

  it("tears down when polling detects a lost context without an event", async () => {
    const overlay = await renderHedgehogMode();

    mocks.contextLost = true;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).toBeNull();
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it("tears down when a lost context is detected on window focus", async () => {
    const overlay = await renderHedgehogMode();

    mocks.contextLost = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).toBeNull();
  });

  it("remounts the game after the context loss delay", async () => {
    const overlay = await renderHedgehogMode();

    await loseContext(overlay);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(overlay.querySelector("canvas")).not.toBeNull();
    expect(overlay.style.visibility).toBe("visible");
  });

  it("hides the overlay after repeated context losses", async () => {
    const overlay = await renderHedgehogMode();

    for (let loss = 0; loss < 4; loss += 1) {
      await loseContext(overlay);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
    }

    expect(mocks.mount).toHaveBeenCalledTimes(4);
    expect(overlay.querySelector("canvas")).toBeNull();
    expect(overlay.style.visibility).toBe("hidden");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mocks.mount).toHaveBeenCalledTimes(4);
  });

  it("destroys the game on toggle off and remounts armed on re-enable", async () => {
    const view = render(<HedgehogMode />);
    await act(async () => {});
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    const overlay = view.container.firstElementChild as HTMLDivElement;

    settingsState.hedgehogMode = false;
    view.rerender(<HedgehogMode />);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).toBeNull();
    expect(overlay.style.visibility).toBe("hidden");

    settingsState.hedgehogMode = true;
    view.rerender(<HedgehogMode />);
    await act(async () => {});
    expect(mocks.mount).toHaveBeenCalledTimes(2);

    await loseContext(overlay);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector("canvas")).toBeNull();
  });

  it("destroys the game on unmount", async () => {
    const view = render(<HedgehogMode />);
    await act(async () => {});

    view.unmount();

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
