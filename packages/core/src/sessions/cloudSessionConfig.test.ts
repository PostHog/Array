import type { StoredLogEntry } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  buildCloudDefaultConfigOptions,
  extractLatestConfigOptionsFromEntries,
} from "./cloudSessionConfig";

function configUpdateEntry(
  configOptions: unknown,
  sessionUpdate = "config_option_update",
): StoredLogEntry {
  return {
    type: "notification",
    notification: {
      method: "session/update",
      params: { update: { sessionUpdate, configOptions } },
    },
  } as unknown as StoredLogEntry;
}

describe("extractLatestConfigOptionsFromEntries", () => {
  it("returns undefined when no config_option_update entries exist", () => {
    expect(extractLatestConfigOptionsFromEntries([])).toBeUndefined();
    expect(
      extractLatestConfigOptionsFromEntries([
        configUpdateEntry([{ id: "mode" }], "agent_message"),
      ]),
    ).toBeUndefined();
  });

  it("returns the latest config options across multiple updates", () => {
    const result = extractLatestConfigOptionsFromEntries([
      configUpdateEntry([{ id: "mode", currentValue: "plan" }]),
      configUpdateEntry([{ id: "mode", currentValue: "auto" }]),
    ]);

    expect(result).toEqual([{ id: "mode", currentValue: "auto" }]);
  });
});

describe("buildCloudDefaultConfigOptions", () => {
  it("includes a mode select with options and the chosen current value", () => {
    const options = buildCloudDefaultConfigOptions("plan");
    const mode = options.find((o) => o.id === "mode");

    expect(mode?.currentValue).toBe("plan");
    if (mode?.type !== "select") {
      throw new Error("expected mode to be a select option");
    }
    expect(mode.options.length).toBeGreaterThan(0);
  });

  it("defaults claude sessions to plan and codex sessions to auto", () => {
    const claude = buildCloudDefaultConfigOptions(undefined, "claude");
    const codex = buildCloudDefaultConfigOptions(undefined, "codex");

    expect(claude.find((o) => o.id === "mode")?.currentValue).toBe("plan");
    expect(codex.find((o) => o.id === "mode")?.currentValue).toBe("auto");
  });

  it("appends extra options after the mode option", () => {
    const extra = [
      {
        id: "model",
        name: "Model",
        type: "select" as const,
        currentValue: "x",
        options: [],
      },
    ];
    const options = buildCloudDefaultConfigOptions("plan", "claude", extra);

    expect(options[0].id).toBe("mode");
    expect(options.at(-1)?.id).toBe("model");
  });
});
