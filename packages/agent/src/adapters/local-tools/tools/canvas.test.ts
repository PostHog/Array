import { describe, expect, it } from "vitest";
import {
  canvasScratchDir,
  canvasScratchFile,
  composePublishedMeta,
} from "./canvas";

describe("canvas scratch paths", () => {
  it("keys the scratch dir and file by canvas id, outside any workspace", () => {
    expect(canvasScratchDir("dash-1")).toBe("/tmp/posthog-canvas/dash-1");
    expect(canvasScratchFile("dash-1")).toBe(
      "/tmp/posthog-canvas/dash-1/canvas.tsx",
    );
  });
});

describe("composePublishedMeta", () => {
  const v1 = { id: "v1", code: "one", createdAt: 1 };
  const v2 = { id: "v2", code: "two", createdAt: 2 };
  const v3 = { id: "v3", code: "three", createdAt: 3 };

  it("appends a new head version when the base matches", () => {
    const result = composePublishedMeta({
      freshMeta: { code: "two", versions: [v1, v2], currentVersionId: "v2" },
      baseVersionId: "v2",
      code: "edited",
      prompt: "tweak the chart",
      now: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.code).toBe("edited");
    expect(result.meta.currentVersionId).toBe(result.versionId);
    expect(result.meta.versions).toHaveLength(3);
    expect(result.meta.versions?.at(-1)).toMatchObject({
      code: "edited",
      prompt: "tweak the chart",
      createdAt: 10,
    });
    expect(result.meta.updatedAt).toBe(10);
  });

  it("preserves unrelated meta keys", () => {
    const result = composePublishedMeta({
      freshMeta: {
        code: "one",
        versions: [v1],
        currentVersionId: "v1",
        templateId: "freeform",
        pinnedAt: 123,
      },
      baseVersionId: "v1",
      code: "edited",
      now: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.templateId).toBe("freeform");
    expect(result.meta.pinnedAt).toBe(123);
  });

  it("rejects when the canvas moved past the base (concurrent edit)", () => {
    const result = composePublishedMeta({
      freshMeta: {
        code: "three",
        versions: [v1, v2, v3],
        currentVersionId: "v3",
      },
      baseVersionId: "v2",
      code: "edited",
      now: 10,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a based publish onto a canvas with no versions", () => {
    const result = composePublishedMeta({
      freshMeta: {},
      baseVersionId: "v1",
      code: "edited",
      now: 10,
    });
    expect(result.ok).toBe(false);
  });

  it("truncates the redo tail when publishing from an undone version", () => {
    // The user undid to v1 (pointer mid-history), then the agent edited from
    // that checkout: the redo tail (v2, v3) is discarded — the same
    // linear-discard the client's undo/redo uses.
    const result = composePublishedMeta({
      freshMeta: {
        code: "one",
        versions: [v1, v2, v3],
        currentVersionId: "v1",
      },
      baseVersionId: "v1",
      code: "edited",
      now: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.versions?.map((v) => v.id)).toEqual([
      "v1",
      result.versionId,
    ]);
  });

  it("seeds an empty canvas as the first version (no base)", () => {
    const result = composePublishedMeta({
      freshMeta: { templateId: "freeform" },
      baseVersionId: undefined,
      code: "first build",
      now: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.versions).toHaveLength(1);
    expect(result.meta.currentVersionId).toBe(result.versionId);
    expect(result.meta.code).toBe("first build");
  });

  it("rejects an un-based publish onto a canvas that gained versions", () => {
    // Checked out empty, but a concurrent first build published meanwhile.
    const result = composePublishedMeta({
      freshMeta: { code: "one", versions: [v1], currentVersionId: "v1" },
      baseVersionId: undefined,
      code: "edited",
      now: 10,
    });
    expect(result.ok).toBe(false);
  });
});
