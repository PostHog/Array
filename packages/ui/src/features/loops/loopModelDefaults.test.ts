import { describe, expect, it } from "vitest";
import {
  loopEffectiveModel,
  loopSupportedReasoningEfforts,
} from "./loopModelDefaults";

describe("loopEffectiveModel", () => {
  it.each([
    ["claude", "", "@cf/zai-org/glm-5.2"],
    ["codex", "", "gpt-5"],
    ["claude", "claude-opus-4-8", "claude-opus-4-8"],
    ["codex", "gpt-5.5", "gpt-5.5"],
  ] as const)(
    "resolves adapter %s with model %j to %s",
    (adapter, model, expected) => {
      expect(loopEffectiveModel(adapter, model)).toBe(expected);
    },
  );
});

describe("loopSupportedReasoningEfforts", () => {
  it.each([
    ["claude", "", ["high", "max"]],
    ["claude", "@cf/zai-org/glm-5.2", ["high", "max"]],
    ["claude", "claude-sonnet-4-6", ["low", "medium", "high"]],
    ["claude", "claude-opus-4-8", ["low", "medium", "high", "xhigh", "max"]],
    ["codex", "", ["low", "medium", "high"]],
    ["codex", "gpt-5.5", ["low", "medium", "high", "xhigh"]],
    ["codex", "gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]],
    ["codex", "gpt-unknown", ["low", "medium", "high"]],
    ["claude", "claude-unknown", ["low", "medium", "high", "xhigh", "max"]],
  ] as const)(
    "adapter %s with model %j supports %j",
    (adapter, model, expected) => {
      expect(loopSupportedReasoningEfforts(adapter, model)).toEqual(expected);
    },
  );
});
