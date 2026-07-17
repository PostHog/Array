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
});

describe("buildFreeformGenerationPrompt workflow branch", () => {
  const base = {
    dashboardId: "dash-wf-1",
    name: "Untitled canvas",
    channelName: "growth",
    instruction: "Send a welcome email after signup.",
  };
  const firstBuild = () => buildFreeformGenerationPrompt(base);

  it("gates the workflow flow behind an explicit mode decision", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("MODE");
    expect(prompt).toContain("PLAIN CANVAS (default)");
    expect(prompt).toContain("NEVER call any `workflows-*` MCP tool");
    expect(prompt).toContain("<workflow_instructions>");
    expect(prompt).toContain("</workflow_instructions>");
  });

  it("drives the workflow lifecycle: discover, draft, test every branch", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("cdp-function-templates-list");
    expect(prompt).toContain("workflows-create");
    expect(prompt).toContain("workflows-patch-graph");
    expect(prompt).toContain("workflows-test-run");
    expect(prompt.toUpperCase()).toContain("EVERY BRANCH");
    expect(prompt).toContain("DRAFT");
  });

  it("supports tracking an existing workflow without building one", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("TRACK AN EXISTING WORKFLOW");
    expect(prompt).toContain("workflows-list");
    expect(prompt).toContain("workflows-get");
  });

  it("requires blast-radius before any batch dispatch", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("workflows-blast-radius");
  });

  it("builds email templates with neutral branding and never asks mid-build", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("workflows-create-email-template");
    expect(prompt).toContain("neutral defaults");
    expect(prompt).toContain("do NOT ask the user about branding");
    expect(prompt.toLowerCase()).toContain("branding can be edited later");
  });

  it("forbids going live on the agent's own initiative - the human approves & publishes", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("NEVER take the workflow live yourself");
    expect(prompt).toContain("Do NOT call `workflows-enable`");
    expect(prompt).toContain("workflows-run-batch");
    expect(prompt).toContain("workflows-schedule-create");
    expect(prompt.toLowerCase()).toContain("approve");
  });

  it("forbids the agent persisting the workflow link itself", () => {
    const prompt = firstBuild();
    expect(prompt.replace(/\s+/g, " ")).toContain("recorded AUTOMATICALLY");
    expect(prompt).toContain(
      "Do NOT try to write it onto the canvas/dashboard yourself",
    );
  });

  it("publishes the metrics canvas via the canvas MCP tool, keyed to this canvas", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("desktop-file-system-canvas-partial-update");
    expect(prompt).toContain("dash-wf-1");
  });

  it("embeds both starter boards and the adaptive canvas rules", () => {
    const prompt = firstBuild();
    expect(prompt).toContain("[Starter dashboard — HEALTH (deliverability)]");
    expect(prompt).toContain("[Starter dashboard — ENGAGEMENT (email)]");
    // Starter bodies (not just the labels) ride along.
    expect(prompt).toContain("This workflow hasn't fired yet");
    expect(prompt).toContain("This workflow hasn't sent yet");
    // Adaptive rules: health vs engagement, discover-not-hardcode, empty state.
    expect(prompt).toContain("DELIVERABILITY & HEALTH");
    expect(prompt.toLowerCase()).toContain("open-rate");
    expect(prompt).toContain("ph.loadInsight");
    expect(prompt).toContain("NOT-YET-FIRED");
  });

  it("asks for a human-reviewable summary before stopping", () => {
    const prompt = firstBuild();
    expect(prompt.toLowerCase()).toContain("summarise");
    expect(prompt.toLowerCase()).toContain("trigger");
    expect(prompt).toContain("STOP");
  });

  it("still collapses cleanly into the canvas-instructions tag", () => {
    const extracted = extractCanvasInstructions(firstBuild());
    expect(extracted?.stripped).toBe("Send a welcome email after signup.");
    expect(extracted?.body).toContain("<workflow_instructions>");
  });

  it("omits the workflow flow entirely when editing an existing canvas", () => {
    const prompt = buildFreeformGenerationPrompt({
      ...base,
      currentCode: "export const App = () => null;",
    });
    expect(prompt).not.toContain("<workflow_instructions>");
    expect(prompt).not.toContain("workflows-create");
    expect(prompt).not.toContain("MODE");
  });
});
