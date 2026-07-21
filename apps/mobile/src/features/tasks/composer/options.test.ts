import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  modelSupportsReasoning,
  REASONING_LEVELS,
} from "./options";

describe("task composer options", () => {
  it("uses an eligible non-premium default model", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-4-8");
    expect(DEFAULT_MODEL).not.toContain("fable");
  });

  it("derives reasoning defaults and options from shared policy", () => {
    expect(DEFAULT_REASONING).toBe("high");
    expect(REASONING_LEVELS.map((option) => option.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(modelSupportsReasoning("claude-opus-4-8")).toBe(true);
    expect(modelSupportsReasoning("claude-haiku-4-5")).toBe(false);
  });
});
