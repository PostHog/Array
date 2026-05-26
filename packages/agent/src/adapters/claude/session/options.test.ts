import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Logger } from "../../../utils/logger";
import { SUBAGENT_REWRITES } from "../hooks";
import { buildSessionOptions } from "./options";
import { SettingsManager } from "./settings";

function makeParams() {
  const cwd = path.join(os.tmpdir(), `options-test-${Date.now()}`);
  return {
    cwd,
    mcpServers: {},
    permissionMode: "default" as const,
    canUseTool: async () => ({ behavior: "allow" as const, updatedInput: {} }),
    logger: new Logger(),
    sessionId: "test-session",
    isResume: false,
    settingsManager: new SettingsManager(cwd),
    taskState: new Map(),
  };
}

describe("buildSessionOptions", () => {
  it.each(Object.entries(SUBAGENT_REWRITES))(
    'registers rewrite target "%s" → "%s" in options.agents',
    (_source, target) => {
      const options = buildSessionOptions(makeParams());
      const registered = new Set(Object.keys(options.agents ?? {}));

      expect(
        registered.has(target),
        `Rewrite target "${target}" is not registered in options.agents — either register the agent in buildAgents or remove the rewrite.`,
      ).toBe(true);
    },
  );

  it("preserves caller-provided agents alongside defaults", () => {
    const params = makeParams();
    const options = buildSessionOptions({
      ...params,
      userProvidedOptions: {
        agents: {
          "custom-agent": {
            description: "Custom",
            prompt: "Custom prompt",
          },
        },
      },
    });

    expect(options.agents?.["custom-agent"]).toBeDefined();
    expect(options.agents?.["ph-explore"]).toBeDefined();
  });

  it("lets caller-provided agents override defaults by name", () => {
    const params = makeParams();
    const override = {
      description: "Overridden",
      prompt: "Overridden prompt",
    };
    const options = buildSessionOptions({
      ...params,
      userProvidedOptions: {
        agents: {
          "ph-explore": override,
        },
      },
    });

    expect(options.agents?.["ph-explore"]).toEqual(override);
  });
});
