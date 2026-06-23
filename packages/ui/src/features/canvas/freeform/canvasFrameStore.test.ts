import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CanvasFrameInputs,
  useCanvasFrameStore,
} from "./canvasFrameStore";

function inputs(code: string): CanvasFrameInputs {
  return { code, refreshKey: 0, onDataRequest: vi.fn() };
}

function reset() {
  useCanvasFrameStore.setState({
    slots: [],
    activeDashboardId: null,
    maxWarmFrames: 2,
  });
}

function slotIndexOf(dashboardId: string): number {
  return useCanvasFrameStore
    .getState()
    .slots.findIndex((s) => s?.dashboardId === dashboardId);
}

describe("canvasFrameStore", () => {
  beforeEach(reset);

  it("assigns each new canvas to its own free slot until the pool is full", () => {
    const { register } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    register("b", inputs("B"));

    const { slots } = useCanvasFrameStore.getState();
    expect(slots.filter(Boolean)).toHaveLength(2);
    expect(slotIndexOf("a")).toBe(0);
    expect(slotIndexOf("b")).toBe(1);
  });

  it("re-registering an existing canvas updates inputs in place (no new slot)", () => {
    const { register } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    register("a", inputs("A2"));

    const { slots } = useCanvasFrameStore.getState();
    expect(slots.filter(Boolean)).toHaveLength(1);
    expect(slots[0]?.inputs.code).toBe("A2");
  });

  it("reuses the least-recently-active slot when the pool is full (warm reuse)", () => {
    const { register, activate } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    activate("a");
    register("b", inputs("B"));
    activate("b");

    // a is now the LRU; opening c must reuse a's physical slot (index 0), not b's.
    register("c", inputs("C"));

    expect(slotIndexOf("a")).toBe(-1);
    expect(slotIndexOf("c")).toBe(0);
    expect(slotIndexOf("b")).toBe(1);
    expect(useCanvasFrameStore.getState().slots.filter(Boolean)).toHaveLength(
      2,
    );
  });

  it("never evicts the active canvas, even if it is the least-recently-active", () => {
    const { register, activate } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    activate("a"); // active, but oldest
    register("b", inputs("B"));
    activate("b");
    activate("a"); // a active again; b is now LRU but a stays active

    // Force a full pool, then deactivate so a is active with the oldest stamp.
    useCanvasFrameStore.setState({ activeDashboardId: "a" });
    register("c", inputs("C"));

    // c must take b's slot, never the active a.
    expect(slotIndexOf("a")).toBe(0);
    expect(slotIndexOf("b")).toBe(-1);
    expect(slotIndexOf("c")).toBe(1);
  });

  it("setRect skips no-op writes (no new slots array)", () => {
    const { register, setRect } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    setRect("a", { top: 1, left: 2, width: 3, height: 4 });
    const after = useCanvasFrameStore.getState().slots;
    setRect("a", { top: 1, left: 2, width: 3, height: 4 });
    expect(useCanvasFrameStore.getState().slots).toBe(after);
  });

  it("deactivate clears the active id only when it matches", () => {
    const { register, activate, deactivate } = useCanvasFrameStore.getState();
    register("a", inputs("A"));
    activate("a");
    deactivate("b");
    expect(useCanvasFrameStore.getState().activeDashboardId).toBe("a");
    deactivate("a");
    expect(useCanvasFrameStore.getState().activeDashboardId).toBeNull();
  });
});
