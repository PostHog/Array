import { describe, expect, it } from "vitest";
import { buildScoutFindingDiscussPrompt } from "./scoutPrompts";

const base = {
  skillName: "signals-scout-error-tracking",
  displayName: "Error tracking",
  findingId: "finding-123",
  description: "Spike in TypeError on /checkout over the last hour.",
  severity: "high",
  confidence: 0.82,
};

describe("buildScoutFindingDiscussPrompt", () => {
  it("includes the finding metadata, description, and scout skill", () => {
    const prompt = buildScoutFindingDiscussPrompt(base);

    expect(prompt).toContain("Error tracking scout");
    expect(prompt).toContain("`signals-scout-error-tracking`");
    expect(prompt).toContain("Finding ID: finding-123");
    expect(prompt).toContain("Severity: high");
    expect(prompt).toContain("Confidence: 82%");
    expect(prompt).toContain(base.description);
    expect(prompt).toContain("exploring-signals-scouts");
  });

  it("leads with the user's question when one is provided", () => {
    const prompt = buildScoutFindingDiscussPrompt({
      ...base,
      question: "  Is this caused by the latest deploy?  ",
    });

    expect(prompt).toContain(
      "Answer this first: Is this caused by the latest deploy?",
    );
    expect(prompt).not.toContain("brief readout");
  });

  it("falls back to a readout when no question is given", () => {
    const prompt = buildScoutFindingDiscussPrompt({ ...base, question: "   " });

    expect(prompt).toContain("brief readout");
    expect(prompt).not.toContain("Answer this first");
  });

  it("omits the severity line when severity is null", () => {
    const prompt = buildScoutFindingDiscussPrompt({ ...base, severity: null });

    expect(prompt).not.toContain("Severity:");
  });
});
