import { describe, expect, it } from "vitest";
import { buildThreadTimeline, hasAgentMention } from "./threadTimeline";

describe("hasAgentMention", () => {
  it.each([
    ["at the start", "@agent investigate this", true],
    ["after other text", "Could you @Agent check this?", true],
    ["inside an email-like token", "person@agent.com", false],
    ["as part of a longer handle", "@agents", false],
    ["without a mention", "human-only note", false],
  ])("detects an agent mention %s", (_name, content, expected) => {
    expect(hasAgentMention(content)).toBe(expected);
  });
});

describe("buildThreadTimeline", () => {
  it("orders human messages chronologically", () => {
    const timeline = buildThreadTimeline({
      humanMessages: [
        {
          id: "second",
          content: "Second",
          createdAt: "1970-01-01T00:00:00.200Z",
        },
        {
          id: "first",
          content: "First",
          createdAt: "1970-01-01T00:00:00.100Z",
        },
      ],
    });

    expect(timeline.map((row) => row.message.id)).toEqual(["first", "second"]);
  });

  it("keeps malformed timestamps at the end", () => {
    const timeline = buildThreadTimeline({
      humanMessages: [
        { id: "invalid", content: "Reply", createdAt: "invalid" },
        {
          id: "valid",
          content: "First",
          createdAt: "1970-01-01T00:00:00.100Z",
        },
      ],
    });

    expect(timeline.map((row) => row.message.id)).toEqual(["valid", "invalid"]);
  });
});
