import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGatewayModels,
  fetchModelsList,
  formatGatewayModelName,
  type GatewayModel,
  getClaudeModelRecency,
  isAnthropicModel,
  isBlockedModelId,
  isCloudflareModel,
} from "./gateway-models";

const model = (id: string, owned_by = ""): GatewayModel => ({
  id,
  owned_by,
  context_window: 128000,
  supports_streaming: true,
  supports_vision: false,
});

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
    ["claude-sonnet-5", 5000],
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

describe("gateway model fetch timeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Both fetches run inside the Promise.all that gates session-init, so a
  // stalled gateway must degrade to "no models" rather than hang.
  it.each([
    { name: "fetchGatewayModels", fn: fetchGatewayModels },
    { name: "fetchModelsList", fn: fetchModelsList },
  ])(
    "$name bounds the request and returns [] when it times out",
    async ({ fn }) => {
      // Reject the way AbortSignal.timeout would once the deadline passes.
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(
          new DOMException("The operation was aborted.", "TimeoutError"),
        );

      await expect(
        fn({ gatewayUrl: "https://gateway.timeout-test" }),
      ).resolves.toEqual([]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    },
  );
});

describe("isCloudflareModel", () => {
  it.each([
    { id: "@cf/zai-org/glm-5.2", owned_by: "cloudflare", expected: true },
    { id: "claude-opus-4-8", owned_by: "anthropic", expected: false },
    { id: "@cf/zai-org/glm-5.2", owned_by: "", expected: true },
    { id: "gpt-5.5", owned_by: "", expected: false },
    // A Cloudflare-served model can report an upstream owner; the `@cf/` prefix still wins.
    { id: "@cf/openai/gpt-oss", owned_by: "openai", expected: true },
  ])(
    "isCloudflareModel($id, owned_by=$owned_by) → $expected",
    ({ id, owned_by, expected }) => {
      expect(isCloudflareModel(model(id, owned_by))).toBe(expected);
    },
  );

  it("does not classify Cloudflare models as Anthropic", () => {
    // The Claude adapter accepts both, but they must stay distinguishable.
    const glm = model("@cf/zai-org/glm-5.2", "cloudflare");
    expect(isCloudflareModel(glm)).toBe(true);
    expect(isAnthropicModel(glm)).toBe(false);
  });
});
