import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  describe("ANTHROPIC_CUSTOM_HEADERS", () => {
    const originalProjectId = process.env.POSTHOG_PROJECT_ID;
    const originalCustomHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS;

    beforeEach(() => {
      delete process.env.POSTHOG_PROJECT_ID;
      delete process.env.ANTHROPIC_CUSTOM_HEADERS;
    });

    afterEach(() => {
      for (const [key, value] of [
        ["POSTHOG_PROJECT_ID", originalProjectId],
        ["ANTHROPIC_CUSTOM_HEADERS", originalCustomHeaders],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it.each([
      {
        name: "omits the team_id header when POSTHOG_PROJECT_ID is unset",
        projectId: undefined,
        existingHeaders: undefined,
        expected: "x-posthog-use-bedrock-fallback: true",
      },
      {
        name: "forwards POSTHOG_PROJECT_ID as the team_id attribution header",
        projectId: "42",
        existingHeaders: undefined,
        expected: [
          "x-posthog-property-team_id: 42",
          "x-posthog-use-bedrock-fallback: true",
        ].join("\n"),
      },
      {
        name: "preserves pre-existing custom headers ahead of the team_id header",
        projectId: "42",
        existingHeaders: "x-posthog-property-task_id: task-abc",
        expected: [
          "x-posthog-property-task_id: task-abc",
          "x-posthog-property-team_id: 42",
          "x-posthog-use-bedrock-fallback: true",
        ].join("\n"),
      },
    ])("$name", ({ projectId, existingHeaders, expected }) => {
      if (projectId !== undefined) {
        process.env.POSTHOG_PROJECT_ID = projectId;
      }
      if (existingHeaders !== undefined) {
        process.env.ANTHROPIC_CUSTOM_HEADERS = existingHeaders;
      }

      const headers = buildSessionOptions(makeParams()).env
        ?.ANTHROPIC_CUSTOM_HEADERS;

      expect(headers).toBe(expected);
    });
  });
});
