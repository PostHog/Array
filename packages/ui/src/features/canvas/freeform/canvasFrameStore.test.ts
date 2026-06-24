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

  // Each op is "reg:<id>" (register) or "act:<id>" (activate); `expected` maps a
  // canvas id to its final slot index (-1 = evicted). The pool size is 2.
  it.each([
    {
      name: "reuses the least-recently-active slot when the pool is full",
      ops: ["reg:a", "act:a", "reg:b", "act:b", "reg:c"],
      expected: { a: -1, b: 1, c: 0 },
    },
    {
      name: "never evicts the active canvas, even if it is the oldest activated",
      ops: ["reg:a", "act:a", "reg:b", "act:b", "act:a", "reg:c"],
      expected: { a: 0, b: -1, c: 1 },
    },
    {
      name: "re-activating keeps a canvas off the eviction block",
      ops: ["reg:a", "act:a", "reg:b", "act:b", "act:a", "act:b", "reg:c"],
      expected: { a: -1, b: 1, c: 0 },
    },
  ])("$name", ({ ops, expected }) => {
    const { register, activate } = useCanvasFrameStore.getState();
    for (const op of ops) {
      const [kind, id] = op.split(":");
      if (kind === "reg") register(id, inputs(id.toUpperCase()));
      else activate(id);
    }
    for (const [id, slot] of Object.entries(expected)) {
      expect(slotIndexOf(id)).toBe(slot);
    }
    expect(useCanvasFrameStore.getState().slots.filter(Boolean)).toHaveLength(
      2,
    );
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
