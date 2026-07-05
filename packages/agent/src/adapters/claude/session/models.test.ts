import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFORT,
  getEffortOptions,
  resolveEffortForModel,
  resolveModelPreference,
  supports1MContext,
  supportsEffort,
  supportsMcpInjection,
  supportsXhighEffort,
  toSdkModelId,
} from "./models";

describe("toSdkModelId", () => {
  it("maps known gateway IDs to SDK aliases", () => {
    expect(toSdkModelId("claude-opus-4-7")).toBe("opus");
    expect(toSdkModelId("claude-opus-4-8")).toBe("opus");
    expect(toSdkModelId("claude-sonnet-4-6")).toBe("sonnet");
  });

  it("passes unknown IDs through unchanged", () => {
    expect(toSdkModelId("custom-model")).toBe("custom-model");
  });

  it("passes claude-fable-5 through unchanged (no SDK alias)", () => {
    expect(toSdkModelId("claude-fable-5")).toBe("claude-fable-5");
  });

  it("passes claude-sonnet-5 through unchanged (no SDK alias)", () => {
    expect(toSdkModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("passes deprecated gateway IDs through unchanged", () => {
    expect(toSdkModelId("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(toSdkModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(toSdkModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});

describe("model capability flags", () => {
  it.each([
    {
      modelId: "claude-opus-4-5",
      oneMContext: false,
      effort: false,
      xhighEffort: false,
      mcpInjection: true,
    },
    {
      modelId: "claude-opus-4-6",
      oneMContext: false,
      effort: false,
      xhighEffort: false,
      mcpInjection: true,
    },
    {
      modelId: "claude-opus-4-7",
      oneMContext: true,
      effort: true,
      xhighEffort: true,
      mcpInjection: true,
    },
    {
      modelId: "claude-opus-4-8",
      oneMContext: true,
      effort: true,
      xhighEffort: true,
      mcpInjection: true,
    },
    {
      modelId: "claude-sonnet-4-6",
      oneMContext: true,
      effort: true,
      xhighEffort: false,
      mcpInjection: true,
    },
    {
      modelId: "claude-sonnet-5",
      oneMContext: true,
      effort: true,
      xhighEffort: true,
      mcpInjection: true,
    },
    {
      modelId: "claude-fable-5",
      oneMContext: true,
      effort: true,
      xhighEffort: true,
      mcpInjection: true,
    },
    {
      modelId: "claude-haiku-4-5",
      oneMContext: false,
      effort: false,
      xhighEffort: false,
      mcpInjection: false,
    },
  ])(
    "$modelId capability flags",
    ({ modelId, oneMContext, effort, xhighEffort, mcpInjection }) => {
      expect(supports1MContext(modelId)).toBe(oneMContext);
      expect(supportsEffort(modelId)).toBe(effort);
      expect(supportsXhighEffort(modelId)).toBe(xhighEffort);
      expect(supportsMcpInjection(modelId)).toBe(mcpInjection);
    },
  );
});

describe("resolveEffortForModel", () => {
  it("defaults the thinking level to high", () => {
    expect(DEFAULT_EFFORT).toBe("high");
  });

  it.each([
    // No explicit effort: effort-capable models fall back to the default.
    ["claude-fable-5", undefined, "high"],
    ["claude-opus-4-8", undefined, "high"],
    ["claude-opus-4-7", undefined, "high"],
    ["claude-sonnet-4-6", undefined, "high"],
    ["claude-sonnet-5", undefined, "high"],
    // Models without effort support stay unset (SDK disables thinking).
    ["claude-haiku-4-5", undefined, undefined],
    ["claude-opus-4-6", undefined, undefined],
    // An explicit choice is always honored, including on adaptive-only models.
    ["claude-opus-4-8", "low", "low"],
    ["claude-fable-5", "max", "max"],
    ["claude-sonnet-5", "max", "max"],
  ] as const)(
    "resolveEffortForModel(%s, %s) === %s",
    (modelId, effort, expected) => {
      expect(resolveEffortForModel(modelId, effort)).toBe(expected);
    },
  );
});

describe("getEffortOptions", () => {
  it("returns null for models without effort support", () => {
    expect(getEffortOptions("claude-haiku-4-5")).toBeNull();
    expect(getEffortOptions("claude-opus-4-6")).toBeNull();
  });

  it("returns low/medium/high for effort-supporting models", () => {
    const opts = getEffortOptions("claude-sonnet-4-6");
    expect(opts?.map((o) => o.value)).toEqual(["low", "medium", "high"]);
  });

  it("appends xhigh and max for xhigh-supporting models", () => {
    const opts = getEffortOptions("claude-opus-4-7");
    expect(opts?.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("resolveModelPreference", () => {
  const options = [
    { value: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { value: "claude-opus-4-7", name: "Claude Opus 4.7" },
    { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ];

  it("returns null for empty preference", () => {
    expect(resolveModelPreference("", options)).toBeNull();
    expect(resolveModelPreference("   ", options)).toBeNull();
  });

  it("matches an exact value", () => {
    expect(resolveModelPreference("claude-opus-4-7", options)).toBe(
      "claude-opus-4-7",
    );
  });

  it("matches case-insensitively on display name", () => {
    expect(resolveModelPreference("claude sonnet 4.6", options)).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("matches by substring", () => {
    expect(resolveModelPreference("sonnet", options)).toBe("claude-sonnet-4-6");
  });

  it("matches by token alias", () => {
    expect(resolveModelPreference("opus[1m]", options)).toBe("claude-opus-4-8");
  });

  it("refuses cross-version alias matches", () => {
    const optionsWithAlias = [
      { value: "opus", name: "Claude Opus 4.8" },
      { value: "claude-opus-4-7", name: "Claude Opus 4.7" },
    ];
    expect(resolveModelPreference("claude-opus-4-7", optionsWithAlias)).toBe(
      "claude-opus-4-7",
    );
  });

  it("returns null when nothing matches", () => {
    expect(resolveModelPreference("gpt-5", options)).toBeNull();
  });

  it("does not inherit a cross-family match from the context hint alone", () => {
    const sonnetOnly = [
      { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (1M context)" },
    ];
    expect(resolveModelPreference("opus[1m]", sonnetOnly)).toBeNull();
  });

  it("resolves a hinted alias to the right family when a family token matches", () => {
    const withHints = [
      { value: "claude-opus-4-8", name: "Claude Opus 4.8 (1M context)" },
      { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (1M context)" },
    ];
    expect(resolveModelPreference("opus[1m]", withHints)).toBe(
      "claude-opus-4-8",
    );
  });

  it("treats `best` and `default` as wildcards (no tokens contribute)", () => {
    expect(resolveModelPreference("best", options)).toBeNull();
    expect(resolveModelPreference("default", options)).toBeNull();
  });
});
