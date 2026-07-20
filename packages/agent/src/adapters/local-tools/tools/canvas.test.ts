import { describe, expect, it } from "vitest";
import { canvasScratchDir, canvasScratchFile } from "./canvas";

// Version composition and the stale-base rejection live server-side in the
// desktop-fs canvas action (and are tested there); the tool's own logic is
// the scratch-file plumbing.
describe("canvas scratch paths", () => {
  it("keys the scratch dir and file by canvas id, outside any workspace", () => {
    expect(canvasScratchDir("dash-1")).toBe("/tmp/posthog-canvas/dash-1");
    expect(canvasScratchFile("dash-1")).toBe(
      "/tmp/posthog-canvas/dash-1/canvas.tsx",
    );
  });
});
