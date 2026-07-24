import {
  type CloudTaskConfigOption,
  DEFAULT_GATEWAY_MODEL,
  restrictedModelMeta,
} from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  getComposerModelOptions,
  getMobileExecutionModes,
  resolveComposerPrimaryAction,
} from "./options";

const modelOption: CloudTaskConfigOption = {
  id: "model",
  name: "Model",
  type: "select",
  currentValue: DEFAULT_GATEWAY_MODEL,
  options: [
    { value: DEFAULT_GATEWAY_MODEL, name: "Claude Opus 4.8" },
    {
      value: "claude-fable-5",
      name: "Claude Fable 5",
      _meta: restrictedModelMeta(),
    },
  ],
  category: "model",
  description: "Choose a model",
};

describe("mobile composer options", () => {
  it("hides unrestricted execution modes", () => {
    expect(
      getMobileExecutionModes([
        { id: "plan", name: "Plan", description: "Plan first" },
        {
          id: "bypassPermissions",
          name: "Bypass permissions",
          description: "Allow everything",
        },
        {
          id: "full-access",
          name: "Full access",
          description: "Allow everything",
        },
      ]).map((mode) => mode.id),
    ).toEqual(["plan"]);
  });

  it("adapts live model options for the mobile picker", () => {
    expect(getComposerModelOptions(modelOption)).toEqual([
      {
        value: DEFAULT_GATEWAY_MODEL,
        label: "Claude Opus 4.8",
        description: undefined,
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

  it.each([
    [{ hasContent: true }, "send"],
    [{ canStop: true }, "stop"],
    [{ isRecording: true }, "mic-stop"],
    [{}, "mic"],
  ])("derives the mobile primary action", (overrides, expected) => {
    expect(
      resolveComposerPrimaryAction({
        hasContent: false,
        disabled: false,
        isRecording: false,
        isTranscribing: false,
        canStop: false,
        allowSendWhileRunning: true,
        ...overrides,
      }),
    ).toBe(expected);
  });
});
