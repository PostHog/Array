import { describe, expect, it } from "vitest";
import { isSupportedReasoningEffort } from "./reasoning-effort";

describe("isSupportedReasoningEffort", () => {
  it.each([
    ["codex", "gpt-5.5", "xhigh", true],
    ["codex", "gpt-5.6-sol", "max", true],
    ["codex", "gpt-5.4", "max", false],
    ["claude", "claude-opus-4-8", "xhigh", true],
    ["claude", "claude-opus-5", "high", true],
    ["claude", "claude-opus-5", "max", true],
    ["claude", "claude-sonnet-4-6", "xhigh", false],
    ["claude", "@cf/zai-org/glm-5.2", "high", true],
    ["claude", "@cf/zai-org/glm-5.2", "max", true],
    ["claude", "@cf/zai-org/glm-5.2", "medium", false],
    ["claude", "claude-opus-4-8", "minimal", false],
  ] as const)(
    "validates %s %s effort %s",
    (adapter, modelId, effort, expected) => {
      expect(isSupportedReasoningEffort(adapter, modelId, effort)).toBe(
        expected,
      );
    },
  );
});
