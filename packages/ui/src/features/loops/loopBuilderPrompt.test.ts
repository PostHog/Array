import { describe, expect, it } from "vitest";
import { buildLoopBuilderPrompt } from "./loopBuilderPrompt";

describe("buildLoopBuilderPrompt", () => {
  it("embeds the seed instructions when provided", () => {
    const prompt = buildLoopBuilderPrompt({
      instructions: "Summarize failing CI runs",
    });
    expect(prompt).toContain(
      "Here's what I want automated:\n\nSummarize failing CI runs",
    );
    expect(prompt).not.toContain("Start by asking me");
  });

  it.each([
    { name: "absent", instructions: undefined },
    { name: "whitespace-only", instructions: "   \n" },
  ])("asks for ideas when instructions are $name", ({ instructions }) => {
    const prompt = buildLoopBuilderPrompt({ instructions });
    expect(prompt).toContain("Start by asking me what I want automated");
    expect(prompt).not.toContain("Here's what I want automated");
  });

  it("includes the context target block with folder id and team visibility", () => {
    const prompt = buildLoopBuilderPrompt({
      context: { folderId: "folder-9", name: "growth" },
    });
    expect(prompt).toContain('the context "#growth"');
    expect(prompt).toContain(
      '{"folder_id": "folder-9", "name": "growth", "outputs": {"post_to_feed": true}}',
    );
    expect(prompt).toContain("Make it a team loop");
    expect(prompt).not.toContain("Keep it a personal loop");
  });

  it("omits the context block when no context is given", () => {
    expect(buildLoopBuilderPrompt({})).not.toContain("context_target");
  });
});
