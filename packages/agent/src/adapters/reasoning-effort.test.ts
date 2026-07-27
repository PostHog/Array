import { describe, expect, it } from "vitest";
import { isSupportedReasoningEffort } from "./reasoning-effort";

describe("isSupportedReasoningEffort", () => {
  it("accepts xhigh for the codex gpt-5.5 family", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.5", "xhigh")).toBe(true);
    expect(isSupportedReasoningEffort("codex", "gpt-5.5-codex", "xhigh")).toBe(
      true,
    );
  });

  it("rejects xhigh for other codex models", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.3-codex", "xhigh")).toBe(
      false,
    );
  });

  it("accepts xhigh and max for the codex gpt-5.6 family", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.6-luna", "xhigh")).toBe(
      true,
    );
    expect(isSupportedReasoningEffort("codex", "gpt-5.6-sol", "max")).toBe(
      true,
    );
  });

  it("rejects unknown effort values", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.5", "ultra")).toBe(false);
    expect(isSupportedReasoningEffort("codex", "gpt-5.6-sol", "ultra")).toBe(
      false,
    );
  });

  it("gates xhigh on Claude models by id", () => {
    expect(
      isSupportedReasoningEffort("claude", "claude-opus-4-8", "xhigh"),
    ).toBe(true);
    expect(
      isSupportedReasoningEffort("claude", "claude-sonnet-4-6", "xhigh"),
    ).toBe(false);
  });

  it.each([
    ["high", true],
    ["max", true],
    ["low", false],
    ["medium", false],
    ["xhigh", false],
  ])("validates GLM 5.2 effort %s", (effort, expected) => {
    expect(
      isSupportedReasoningEffort("claude", "@cf/zai-org/glm-5.2", effort),
    ).toBe(expected);
  });

  it.each([
    ["claude-opus-4-8", "ultracode", true],
    ["claude-sonnet-4-6", "ultracode", false],
    ["@cf/zai-org/glm-5.2", "ultracode", false],
  ])("gates ultracode on Claude model %s (%s)", (modelId, effort, expected) => {
    expect(isSupportedReasoningEffort("claude", modelId, effort)).toBe(
      expected,
    );
  });

  it("never offers ultracode on codex models", () => {
    expect(
      isSupportedReasoningEffort("codex", "gpt-5.6-sol", "ultracode"),
    ).toBe(false);
  });
});
