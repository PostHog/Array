import {
  type CloudTaskConfigOption,
  DEFAULT_GATEWAY_MODEL,
  restrictedModelMeta,
} from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  getMobileModelOptions,
  getModelConfigOption,
  getModelLabel,
  resolveAvailableModel,
} from "./options";

const modelOption: CloudTaskConfigOption = {
  id: "model",
  name: "Model",
  type: "select",
  currentValue: DEFAULT_GATEWAY_MODEL,
  options: [
    {
      value: DEFAULT_GATEWAY_MODEL,
      name: "Claude Opus 4.8",
      description: "Default",
    },
    {
      value: "claude-fable-5",
      name: "Claude Fable 5",
      _meta: restrictedModelMeta(),
    },
  ],
  category: "model",
  description: "Choose a model",
};

describe("mobile cloud task model options", () => {
  it("adapts live model options and disables restricted entries", () => {
    expect(getMobileModelOptions(modelOption)).toEqual([
      {
        value: DEFAULT_GATEWAY_MODEL,
        label: "Claude Opus 4.8",
        description: "Default",
        disabled: false,
      },
      {
        value: "claude-fable-5",
        label: "Claude Fable 5",
        description: undefined,
        disabled: true,
      },
    ]);
  });

  it("falls back from restricted or missing selections", () => {
    expect(resolveAvailableModel(modelOption, "claude-fable-5")).toBe(
      DEFAULT_GATEWAY_MODEL,
    );
    expect(resolveAvailableModel(modelOption, "missing-model")).toBe(
      DEFAULT_GATEWAY_MODEL,
    );
  });

  it("reads the live model label and config option", () => {
    expect(getModelConfigOption([modelOption])).toBe(modelOption);
    expect(getModelLabel(modelOption, DEFAULT_GATEWAY_MODEL)).toBe(
      "Claude Opus 4.8",
    );
  });
});
