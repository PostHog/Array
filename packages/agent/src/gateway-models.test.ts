import { describe, expect, it } from "vitest";
import {
  formatGatewayModelName,
  getClaudeModelTier,
  isBlockedModelId,
} from "./gateway-models";

describe("formatGatewayModelName", () => {
  it("keeps Claude models in friendly title case", () => {
    expect(
      formatGatewayModelName({
        id: "claude-opus-4-8",
        owned_by: "anthropic",
        context_window: 200000,
        supports_streaming: true,
        supports_vision: true,
      }),
    ).toBe("Claude Opus 4.8");
  });

  it("formats OpenAI models as raw lowercase model ids", () => {
    expect(
      formatGatewayModelName({
        id: "GPT-5.5",
        owned_by: "openai",
        context_window: 200000,
        supports_streaming: true,
        supports_vision: true,
      }),
    ).toBe("gpt-5.5");
  });

  it("strips the openai/ prefix from OpenAI model ids", () => {
    expect(
      formatGatewayModelName({
        id: "openai/gpt-5.5",
        owned_by: "openai",
        context_window: 200000,
        supports_streaming: true,
        supports_vision: true,
      }),
    ).toBe("gpt-5.5");
  });

  it("blocks deprecated Claude gateway models", () => {
    expect(isBlockedModelId("claude-opus-4-5")).toBe(true);
    expect(isBlockedModelId("claude-opus-4-6")).toBe(true);
    expect(isBlockedModelId("claude-sonnet-4-5")).toBe(true);
    expect(isBlockedModelId("claude-haiku-4-5")).toBe(true);
    expect(isBlockedModelId("ANTHROPIC/CLAUDE-HAIKU-4-5")).toBe(true);
  });

  it("blocks deprecated Codex gateway models", () => {
    expect(isBlockedModelId("gpt-5.2")).toBe(true);
    expect(isBlockedModelId("gpt-5.3")).toBe(true);
    expect(isBlockedModelId("gpt-5.3-codex")).toBe(true);
    expect(isBlockedModelId("openai/gpt-5.2")).toBe(true);
    expect(isBlockedModelId("OPENAI/GPT-5.3")).toBe(true);
    expect(isBlockedModelId("OPENAI/GPT-5.3-CODEX")).toBe(true);
  });
});

describe("getClaudeModelTier", () => {
  it.each([
    ["claude-opus-4-8", 0],
    ["claude-sonnet-4-6", 1],
    ["claude-haiku-4-5", 2],
    ["claude-fable-5", 3],
  ])("orders %s into tier %i", (modelId, tier) => {
    expect(getClaudeModelTier(modelId)).toBe(tier);
  });

  it("sorts fable last among the available Claude models", () => {
    const ids = ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6"];
    const sorted = [...ids].sort(
      (a, b) => getClaudeModelTier(a) - getClaudeModelTier(b),
    );
    expect(sorted).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-fable-5",
    ]);
  });

  it("produces the full picker display order regardless of gateway order", () => {
    // Models as the gateway might return them — arbitrary order.
    const gatewayOrder = [
      "claude-fable-5",
      "claude-haiku-4-5",
      "claude-mystery-9",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ];
    const displayed = [...gatewayOrder].sort(
      (a, b) => getClaudeModelTier(a) - getClaudeModelTier(b),
    );
    // Picker order: opus → sonnet → haiku → fable → any unknown model last.
    expect(displayed).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-fable-5",
      "claude-mystery-9",
    ]);
  });

  it("sorts unknown models after every known tier", () => {
    expect(getClaudeModelTier("claude-mystery-9")).toBe(4);
    expect(getClaudeModelTier("claude-mystery-9")).toBeGreaterThan(
      getClaudeModelTier("claude-fable-5"),
    );
  });

  it("resolves to the earlier tier when an id matches multiple keywords", () => {
    // Substring match follows CLAUDE_TIER_ORDER: "opus" precedes "fable", so an
    // id containing both pins to the opus tier. This pins the precedence
    // contract so the behaviour is intentional rather than coincidental.
    expect(getClaudeModelTier("claude-opus-fable-experiment")).toBe(0);
  });
});
