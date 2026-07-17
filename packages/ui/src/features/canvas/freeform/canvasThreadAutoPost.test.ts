import type { UserBasic } from "@posthog/shared/domain-types";
import { useAuthStore } from "@posthog/ui/features/auth/store";
import type { TrackedCanvasGeneration } from "@posthog/ui/features/canvas/stores/canvasGenerationTrackerStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCanvasGenerationThreadPosts } from "./canvasThreadAutoPost";

const entry: TrackedCanvasGeneration = {
  taskId: "t1",
  dashboardId: "d1",
  channelId: "c1",
  name: "Signups overview",
  createsCanvas: true,
};

const creator: UserBasic = {
  id: 1,
  uuid: "u1",
  email: "raquel@posthog.com",
  first_name: "Raquel",
  last_name: "Smith",
};

function setCloudRegion(region: "us" | null) {
  useAuthStore.setState((s) => ({
    authState: { ...s.authState, cloudRegion: region },
  }));
}

describe("buildCanvasGenerationThreadPosts", () => {
  beforeEach(() => setCloudRegion("us"));

  it("posts the created comment and a creator-tagging turn-complete note", () => {
    const posts = buildCanvasGenerationThreadPosts(entry, "completed", creator);
    expect(posts).toEqual([
      {
        kind: "canvas_created",
        content:
          "[Signups overview](https://us.posthog.com/code/canvas/c1/d1) has been created",
      },
      {
        kind: "turn_complete",
        content:
          "@[Raquel Smith](raquel@posthog.com) Turn complete — the agent finished generating Signups overview.",
      },
    ]);
  });

  it("skips the created comment when the run edits an existing canvas", () => {
    const posts = buildCanvasGenerationThreadPosts(
      { ...entry, createsCanvas: false },
      "completed",
      creator,
    );
    expect(posts.map((p) => p.kind)).toEqual(["turn_complete"]);
  });

  it("skips the created comment on failure and reports it in the note", () => {
    const posts = buildCanvasGenerationThreadPosts(entry, "failed", creator);
    expect(posts).toEqual([
      {
        kind: "turn_complete",
        content:
          "@[Raquel Smith](raquel@posthog.com) Turn complete — the agent couldn't finish generating Signups overview.",
      },
    ]);
  });

  it("stays silent on cancellation", () => {
    expect(
      buildCanvasGenerationThreadPosts(entry, "cancelled", creator),
    ).toEqual([]);
  });

  it("omits the mention when the creator is unknown", () => {
    const posts = buildCanvasGenerationThreadPosts(entry, "completed", null);
    expect(posts[1]?.content).toBe(
      "Turn complete — the agent finished generating Signups overview.",
    );
  });

  it("sanitizes names that would break the link token and falls back when empty", () => {
    const posts = buildCanvasGenerationThreadPosts(
      { ...entry, name: "[Q3] KPIs" },
      "completed",
      null,
    );
    expect(posts[0]?.content).toBe(
      "[Q3  KPIs](https://us.posthog.com/code/canvas/c1/d1) has been created",
    );
    const unnamed = buildCanvasGenerationThreadPosts(
      { ...entry, name: "  " },
      "completed",
      null,
    );
    expect(unnamed[0]?.content).toBe(
      "[Canvas](https://us.posthog.com/code/canvas/c1/d1) has been created",
    );
  });

  it("degrades to plain text when no share link can be built", () => {
    setCloudRegion(null);
    const posts = buildCanvasGenerationThreadPosts(entry, "completed", null);
    expect(posts[0]?.content).toBe("Signups overview has been created");
  });
});
