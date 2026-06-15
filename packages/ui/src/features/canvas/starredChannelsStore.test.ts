import { useStarredChannelsStore } from "@posthog/ui/features/canvas/starredChannelsStore";
import { beforeEach, describe, expect, it } from "vitest";

const reset = () => useStarredChannelsStore.setState({ starredIds: [] });

describe("starredChannelsStore", () => {
  beforeEach(reset);

  it("stars a channel that is not yet starred", () => {
    useStarredChannelsStore.getState().toggle("c1");

    expect(useStarredChannelsStore.getState().starredIds).toEqual(["c1"]);
    expect(useStarredChannelsStore.getState().isStarred("c1")).toBe(true);
  });

  it("toggles an already-starred channel back off", () => {
    const { toggle } = useStarredChannelsStore.getState();
    toggle("c1");
    toggle("c1");

    expect(useStarredChannelsStore.getState().starredIds).toEqual([]);
    expect(useStarredChannelsStore.getState().isStarred("c1")).toBe(false);
  });

  it("preserves star order as channels are added", () => {
    const { toggle } = useStarredChannelsStore.getState();
    toggle("c1");
    toggle("c2");

    expect(useStarredChannelsStore.getState().starredIds).toEqual(["c1", "c2"]);
  });

  it("unstar removes a channel and is a no-op when absent", () => {
    const { toggle, unstar } = useStarredChannelsStore.getState();
    toggle("c1");
    toggle("c2");

    unstar("c1");
    expect(useStarredChannelsStore.getState().starredIds).toEqual(["c2"]);

    // Removing a channel that isn't starred leaves the list untouched.
    unstar("missing");
    expect(useStarredChannelsStore.getState().starredIds).toEqual(["c2"]);
  });
});
