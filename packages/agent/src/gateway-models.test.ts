import { describe, expect, it } from "vitest";
import {
  formatGatewayModelName,
  getClaudeModelRecency,
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

describe("getClaudeModelRecency", () => {
  it.each([
    ["claude-haiku-4-5", 4005],
    ["claude-sonnet-4-6", 4006],
    ["claude-opus-4-7", 4007],
    ["claude-opus-4-8", 4008],
    ["claude-fable-5", 5000],
  ])("ranks %s by its embedded version (%i)", (modelId, rank) => {
    expect(getClaudeModelRecency(modelId)).toBe(rank);
  });

  it("ignores a trailing date suffix when reading the version", () => {
    expect(getClaudeModelRecency("claude-haiku-4-5-20251001")).toBe(4005);
  });

  it("ranks a model with no recognisable version as newest", () => {
    expect(getClaudeModelRecency("claude-mystery")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(getClaudeModelRecency("claude-mystery")).toBeGreaterThan(
      getClaudeModelRecency("claude-fable-5"),
    );
  });

  it("produces the full picker display order, oldest to newest", () => {
    // Models as the gateway might return them — arbitrary order.
    const gatewayOrder = [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-mystery",
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ];
    const displayed = [...gatewayOrder].sort(
      (a, b) => getClaudeModelRecency(a) - getClaudeModelRecency(b),
    );
    // The menu opens upward, so the newest model (last here) sits closest to
    // the trigger. Unknown/unversioned models rank newest and trail the list.
    expect(displayed).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-mystery",
    ]);
  });
});
