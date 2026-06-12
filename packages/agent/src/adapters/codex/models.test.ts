import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { formatCodexModelName, modelIdFromConfigOptions } from "./models";

describe("formatCodexModelName", () => {
  it("uses raw lowercase model ids", () => {
    expect(formatCodexModelName("GPT-5.5")).toBe("gpt-5.5");
  });
});

describe("modelIdFromConfigOptions", () => {
  const modelOption = (currentValue: unknown): SessionConfigOption =>
    ({
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue,
      options: [],
    }) as unknown as SessionConfigOption;

  it("returns the currentValue of the model-category option", () => {
    expect(modelIdFromConfigOptions([modelOption("gpt-5.5-codex")])).toBe(
      "gpt-5.5-codex",
    );
  });

  it("ignores non-model categories", () => {
    const modeOption = {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "auto",
      options: [],
    } as unknown as SessionConfigOption;
    expect(modelIdFromConfigOptions([modeOption])).toBeUndefined();
  });

  it("returns undefined when currentValue is not a string", () => {
    expect(modelIdFromConfigOptions([modelOption(null)])).toBeUndefined();
    expect(modelIdFromConfigOptions([modelOption(123)])).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(modelIdFromConfigOptions(null)).toBeUndefined();
    expect(modelIdFromConfigOptions(undefined)).toBeUndefined();
  });
});
