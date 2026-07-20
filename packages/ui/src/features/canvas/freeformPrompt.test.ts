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
    expect(extracted?.body).toContain("canvas_publish");
  });

  it("routes all builds through checkout → edit file → publish", () => {
    const prompt = buildFreeformGenerationPrompt(base);
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.body).toContain("Build a freeform React canvas");
    expect(extracted?.body).toContain("canvas_checkout");
    expect(extracted?.body).toContain(`id: "dash-1"`);
    // Publishing goes through the local tool; the remote MCP publish tool is
    // named only to steer the agent away from it.
    expect(extracted?.body).toContain("canvas_publish");
    expect(extracted?.body).toContain(
      "`desktop-file-system-canvas-partial-update` directly",
    );
  });

  it("has edits work the scratch file instead of embedding the source", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      currentCode: "export const App = () => null;",
    });
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.stripped).toBe("add a retention chart");
    expect(extracted?.body).toContain("Edit the freeform React canvas");
    // The source is no longer folded into the prompt — canvas_checkout fetches
    // the live code tool-side and the agent edits the scratch file in place.
    expect(extracted?.body).not.toContain("export const App = () => null;");
    expect(extracted?.body).toContain("canvas_checkout");
    expect(extracted?.body).toContain("editing that file");
    // The stale-publish recovery loop is spelled out.
    expect(extracted?.body).toContain("version-conflict");
  });

  it("folds queued annotations into a numbered block, and omits it when empty", () => {
    const withAnnotations = buildFreeformGenerationPrompt({
      ...base,
      currentCode: "export default () => null;",
      annotations: [
        {
          n: 1,
          comment: "make this smaller",
          target: {
            type: "element",
            selector: '[data-attr="refresh"]',
            tag: "button",
            text: "Refresh",
            ariaLabel: null,
            attributes: { "data-attr": "refresh" },
          },
        },
        {
          n: 2,
          comment: "reword this",
          target: {
            type: "text-range",
            text: "weekly active users",
            ancestorSelector: "main > p:nth-of-type(2)",
            ancestorTag: "p",
          },
        },
      ],
    });
    const body = extractCanvasInstructions(withAnnotations)?.body ?? "";
    expect(body).toContain("[Annotations]");
    expect(body).toContain('1. On <button> "Refresh"');
    expect(body).toContain('selector: [data-attr="refresh"]');
    expect(body).toContain("make this smaller");
    expect(body).toContain('2. On the text "weekly active users"');
    expect(body).toContain("reword this");

    const without = buildFreeformGenerationPrompt({
      ...base,
      currentCode: "export default () => null;",
    });
    expect(extractCanvasInstructions(without)?.body).not.toContain(
      "[Annotations]",
    );
  });

  it("seeds the starter scaffold into the checked-out file on a first build", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      useStarter: true,
    });
    const extracted = extractCanvasInstructions(prompt);
    expect(extracted?.body).toContain("[Starter scaffold]");
    expect(extracted?.body).toContain("canvas_checkout");
    // The scaffold rides in the prompt (there is nothing to fetch yet).
    expect(extracted?.body).toContain("```tsx");
  });
});
