import { extractCanvasInstructions } from "@posthog/ui/features/sessions/components/session-update/canvasInstructions";
import { describe, expect, it } from "vitest";
import { buildFreeformGenerationPrompt } from "./freeformPrompt";

describe("buildFreeformGenerationPrompt", () => {
  const base = {
    dashboardId: "dash-1",
    name: "Signups",
    channelName: "growth",
    instruction: "add a retention chart",
  };

  it("leads with the user's instruction and wraps the contract in a tag", () => {
    const prompt = buildFreeformGenerationPrompt(base);
    // The visible message is the bare instruction; the boilerplate lives in the tag.
    expect(prompt.startsWith("add a retention chart\n\n")).toBe(true);
    expect(prompt).toContain("<canvas_generation_instructions>");
    expect(prompt).toContain("</canvas_generation_instructions>");

    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.stripped).toBe("add a retention chart");
    // The authoring contract + publishing rules are collapsed into the tag body.
    expect(extracted?.body).toContain("PUBLISHING");
    expect(extracted?.body).toContain(
      "desktop-file-system-canvas-partial-update",
    );
  });

  it("folds the current code into the tag when editing", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      currentCode: "export const App = () => null;",
    });
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.stripped).toBe("add a retention chart");
    expect(extracted?.body).toContain("export const App = () => null;");
    expect(extracted?.body).toContain("Edit the freeform React canvas");
  });

  it("switches to the HTML contract for the html template", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      templateId: "html",
      // The React starter is meaningless for a document; must be ignored.
      useStarter: true,
    });
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.body).toContain("Build a HTML document canvas");
    expect(extracted?.body).toContain("```html block");
    expect(extracted?.body).toContain("the COMPLETE standalone HTML document");
    // Static tier: no ph shim, no live-data rules, no React scaffold.
    expect(extracted?.body).toContain("the document is STATIC");
    expect(extracted?.body).not.toContain("Starter scaffold");
    expect(extracted?.body).not.toContain("ph.loadInsight(short_id");
    // Same publish path as React canvases.
    expect(extracted?.body).toContain(
      "desktop-file-system-canvas-partial-update",
    );
  });

  it("fences the current document as html when editing an html canvas", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      templateId: "html",
      currentCode: "<!doctype html><html><body>hi</body></html>",
    });
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.body).toContain("Edit the HTML document canvas");
    expect(extracted?.body).toContain("```html");
    expect(extracted?.body).toContain(
      "<!doctype html><html><body>hi</body></html>",
    );
    expect(extracted?.body).toContain("Rewrite the WHOLE document");
  });
});
