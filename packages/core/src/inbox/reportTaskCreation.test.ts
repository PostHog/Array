import { describe, expect, it } from "vitest";
import {
  type PreviewConfigOption,
  selectModelFromOptions,
} from "./reportTaskCreation";

function modelOption(
  currentValue: string,
  available: string[],
): PreviewConfigOption {
  return {
    id: "model",
    category: "model",
    type: "select",
    currentValue,
    options: available.map((value) => ({ value })),
  };
}

describe("selectModelFromOptions", () => {
  it("returns the server default when no preferred model is given", () => {
    const options = [modelOption("claude-opus-4-8", ["claude-opus-4-8"])];
    expect(selectModelFromOptions(options)).toBe("claude-opus-4-8");
  });

  it("honours the preferred model when the gateway still offers it", () => {
    const options = [
      modelOption("claude-opus-4-8", ["claude-opus-4-8", "claude-sonnet-4-6"]),
    ];
    expect(selectModelFromOptions(options, "claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("falls back to the server default when the preferred model is no longer offered", () => {
    // The persisted model (e.g. a de-listed fable) is not in the available
    // options, so it must not be returned — otherwise the run 403s.
    const options = [modelOption("claude-opus-4-8", ["claude-opus-4-8"])];
    expect(selectModelFromOptions(options, "claude-fable-5")).toBe(
      "claude-opus-4-8",
    );
  });

  it("ignores an empty preferred model", () => {
    const options = [modelOption("claude-opus-4-8", ["claude-opus-4-8"])];
    expect(selectModelFromOptions(options, "")).toBe("claude-opus-4-8");
    expect(selectModelFromOptions(options, null)).toBe("claude-opus-4-8");
  });

  it("returns undefined when there is no model option", () => {
    const options: PreviewConfigOption[] = [
      { id: "mode", category: "mode", type: "select", currentValue: "plan" },
    ];
    expect(selectModelFromOptions(options, "claude-opus-4-8")).toBeUndefined();
  });
});
