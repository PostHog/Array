import { describe, expect, it } from "vitest";
import { displayAgentName } from "./format";

describe("displayAgentName", () => {
  it.each([
    {
      name: "concierge slug → Agent Builder (regardless of backend name)",
      app: { slug: "agent-concierge", name: "Agent concierge" },
      expected: "Agent Builder",
    },
    {
      name: "concierge slug + no name → still Agent Builder",
      app: { slug: "agent-concierge", name: null },
      expected: "Agent Builder",
    },
    {
      name: "non-concierge slug → returns the name",
      app: { slug: "kudos-bot", name: "Kudos bot" },
      expected: "Kudos bot",
    },
    {
      name: "non-concierge slug + no name → undefined",
      app: { slug: "kudos-bot", name: null },
      expected: undefined,
    },
    {
      name: "null app → undefined",
      app: null,
      expected: undefined,
    },
    {
      name: "undefined app → undefined",
      app: undefined,
      expected: undefined,
    },
  ])("$name", ({ app, expected }) => {
    expect(displayAgentName(app)).toBe(expected);
  });
});
