import { beforeEach, describe, expect, it } from "vitest";
import { useQuickActionStore } from "./quickActionStore";

describe("quickActionStore", () => {
  beforeEach(() => {
    useQuickActionStore.setState({ inFlight: {} });
  });

  it("marks a workstream in flight and clears it", () => {
    const { start, finish } = useQuickActionStore.getState();

    start("ws_1");
    expect(useQuickActionStore.getState().inFlight.ws_1).toBe(true);

    finish("ws_1");
    expect(useQuickActionStore.getState().inFlight.ws_1).toBeUndefined();
  });

  it("tracks workstreams independently so distinct ones can run concurrently", () => {
    const { start, finish } = useQuickActionStore.getState();

    start("ws_1");
    start("ws_2");
    finish("ws_1");

    const { inFlight } = useQuickActionStore.getState();
    expect(inFlight.ws_1).toBeUndefined();
    expect(inFlight.ws_2).toBe(true);
  });
});
