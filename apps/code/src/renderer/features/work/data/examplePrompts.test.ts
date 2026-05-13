import { describe, expect, it } from "vitest";
import { EXAMPLE_PROMPTS } from "./examplePrompts";

describe("EXAMPLE_PROMPTS", () => {
  it("ships at least a handful of examples", () => {
    expect(EXAMPLE_PROMPTS.length).toBeGreaterThanOrEqual(3);
  });

  it("has unique ids", () => {
    const ids = EXAMPLE_PROMPTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a name, description, non-empty prompt, and an icon", () => {
    for (const example of EXAMPLE_PROMPTS) {
      expect(example.name.trim()).not.toBe("");
      expect(example.description.trim()).not.toBe("");
      expect(example.prompt.trim().length).toBeGreaterThan(0);
      expect(example.icon).toBeTruthy();
    }
  });
});
