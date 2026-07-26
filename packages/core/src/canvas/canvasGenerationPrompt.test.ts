import { describe, expect, it } from "vitest";
import { buildFreeformGenerationPrompt } from "./canvasGenerationPrompt";

describe("buildFreeformGenerationPrompt", () => {
  it("routes every canvas task through the universal application skill", () => {
    const prompt = buildFreeformGenerationPrompt({
      dashboardId: "canvas-1",
      name: "Untitled canvas",
      channelName: "Product",
      instruction: "Build an interactive model",
      currentCode: "export default function Legacy() { return null; }",
    });

    expect(prompt).toContain("$building-canvases");
    expect(prompt).toContain('target canvas ID is "canvas-1"');
    expect(prompt).toContain("canvas-source-publish");
    expect(prompt).not.toContain("desktop-file-system-canvas-partial-update");
    expect(prompt).not.toContain("freeform React canvas");
  });
});
