import { describe, expect, it } from "vitest";
import { isModelExcludedFromDefault } from "./models";

describe("isModelExcludedFromDefault", () => {
  it.each([
    ["claude-fable-5", true],
    ["anthropic/claude-fable-5", true],
    ["CLAUDE-FABLE-5", true],
    ["claude-fable-5-20260601", true],
    ["claude-opus-4-8", false],
    ["claude-sonnet-5", false],
    ["gpt-5.5", false],
    ["@cf/zai-org/glm-5.2", false],
    ["", false],
    [null, false],
    [undefined, false],
  ] as const)("%s -> %s", (modelId, expected) => {
    expect(isModelExcludedFromDefault(modelId)).toBe(expected);
  });
});
