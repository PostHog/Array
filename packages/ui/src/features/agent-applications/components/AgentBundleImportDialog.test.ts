import { describe, expect, it } from "vitest";
import { parseBundleInput } from "./AgentBundleImportDialog";

describe("parseBundleInput", () => {
  it("returns an error for empty input", () => {
    const out = parseBundleInput("");
    expect(out.ok).toBe(false);
  });

  it("parses a single agent.md block", () => {
    const out = parseBundleInput(
      "--- agent.md ---\nYou are the growth review agent.\n",
    );
    expect(out).toEqual({
      ok: true,
      value: { agent_md: "You are the growth review agent." },
    });
  });

  it("parses multiple skill blocks", () => {
    const out = parseBundleInput(
      [
        "--- skills/research/SKILL.md ---",
        "Research body",
        "--- skills/draft-post/SKILL.md ---",
        "Draft body",
      ].join("\n"),
    );
    expect(out).toEqual({
      ok: true,
      value: {
        skills: [
          { id: "research", body: "Research body" },
          { id: "draft-post", body: "Draft body" },
        ],
      },
    });
  });

  it("parses agent.md plus skills together", () => {
    const out = parseBundleInput(
      [
        "--- agent.md ---",
        "Main prompt",
        "",
        "--- skills/research/SKILL.md ---",
        "Research body",
      ].join("\n"),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.agent_md).toBe("Main prompt");
      expect(out.value.skills).toEqual([
        { id: "research", body: "Research body" },
      ]);
    }
  });

  it("tolerates CRLF line endings", () => {
    const out = parseBundleInput("--- agent.md ---\r\nMain prompt\r\n");
    expect(out).toEqual({ ok: true, value: { agent_md: "Main prompt" } });
  });

  it("rejects an unsupported file path", () => {
    const out = parseBundleInput(
      "--- tools/foo/source.ts ---\nconsole.log('hi')\n",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Unsupported file path/);
  });

  it("rejects skill ids with disallowed characters", () => {
    const out = parseBundleInput("--- skills/Bad Id/SKILL.md ---\nbody\n");
    expect(out.ok).toBe(false);
  });

  it("ignores leading content before the first header", () => {
    const out = parseBundleInput(
      [
        "# notes for myself, not in any block",
        "--- agent.md ---",
        "Prompt",
      ].join("\n"),
    );
    expect(out).toEqual({ ok: true, value: { agent_md: "Prompt" } });
  });
});
