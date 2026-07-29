import { describe, expect, it } from "vitest";
import { buildCloudTaskRunConfig } from "./cloudTaskRunConfig";

describe("buildCloudTaskRunConfig", () => {
  it("forwards the selected Codex configuration to cloud task dispatch", () => {
    expect(
      buildCloudTaskRunConfig({
        adapter: "codex",
        mode: "full-access",
        model: "gpt-5.5",
        reasoning: "high",
      }),
    ).toEqual({
      adapter: "codex",
      initialPermissionMode: "full-access",
      model: "gpt-5.5",
      reasoningLevel: "high",
    });
  });

  it("omits reasoning when the selected model does not support it", () => {
    expect(
      buildCloudTaskRunConfig({
        adapter: "claude",
        mode: "plan",
        model: "claude-haiku-4-5",
        reasoning: "high",
      }).reasoningLevel,
    ).toBeUndefined();
  });
});
