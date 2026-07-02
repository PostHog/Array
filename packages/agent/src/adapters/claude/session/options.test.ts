import * as os from "node:os";
import * as path from "node:path";
import type { HookInput, Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../utils/logger";
import { SUBAGENT_REWRITES } from "../hooks";
import { buildSessionOptions } from "./options";
import { SettingsManager } from "./settings";

const GIT_COMMIT_HOOK_INPUT = {
  session_id: "s",
  transcript_path: "/tmp/t",
  cwd: "/tmp",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_1",
  tool_input: { command: "git commit -m x" },
} as HookInput;

async function runPreToolUseHooks(options: Options): Promise<void> {
  const opts = { signal: new AbortController().signal };
  const hooks = (options.hooks?.PreToolUse ?? []).flatMap(
    (entry) => entry.hooks ?? [],
  );
  for (const hook of hooks) {
    await hook(GIT_COMMIT_HOOK_INPUT, undefined, opts);
  }
}

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

  it.each([
    ["a new session", () => makeParams()],
    ["a resumed session", () => ({ ...makeParams(), isResume: true })],
  ])(
    "defaults fallbackModel on %s so refusals and overloads retry on another model",
    (_label, params) => {
      const options = buildSessionOptions(params());

      expect(options.fallbackModel).toBe("claude-opus-4-8");
      // The SDK throws at spawn when fallbackModel equals Options.model.
      expect(options.fallbackModel).not.toBe(options.model);
    },
  );

  it("preserves a caller-provided fallbackModel", () => {
    const options = buildSessionOptions({
      ...makeParams(),
      userProvidedOptions: { fallbackModel: "claude-sonnet-5" },
    });

    expect(options.fallbackModel).toBe("claude-sonnet-5");
  });

  it("threads onEnsureLocalToolsConnected into the signed-commit guard (cloud)", async () => {
    const healSpy = vi.fn().mockResolvedValue(true);
    await runPreToolUseHooks(
      buildSessionOptions({
        ...makeParams(),
        cloudMode: true,
        onEnsureLocalToolsConnected: healSpy,
      }),
    );

    expect(healSpy).toHaveBeenCalledTimes(1);
  });

  it("omits the signed-commit guard outside cloud mode", async () => {
    const healSpy = vi.fn().mockResolvedValue(true);
    await runPreToolUseHooks(
      buildSessionOptions({
        ...makeParams(),
        cloudMode: false,
        onEnsureLocalToolsConnected: healSpy,
      }),
    );

    expect(healSpy).not.toHaveBeenCalled();
  });

  describe("CLAUDE_CODE_EXECUTABLE", () => {
    const originalClaudeExecutable = process.env.CLAUDE_CODE_EXECUTABLE;

    beforeEach(() => {
      delete process.env.CLAUDE_CODE_EXECUTABLE;
    });

    afterEach(() => {
      if (originalClaudeExecutable === undefined) {
        delete process.env.CLAUDE_CODE_EXECUTABLE;
      } else {
        process.env.CLAUDE_CODE_EXECUTABLE = originalClaudeExecutable;
      }
    });

    it.each([
      {
        executablePath: "/tmp/claude",
        expectedPath: "/tmp/claude",
        expectedExecutable: undefined,
        name: "does not force node when Claude executable is a native binary",
      },
      {
        executablePath: "/tmp/cli.js",
        expectedPath: "/tmp/cli.js",
        expectedExecutable: "node",
        name: "uses node when Claude executable is the legacy JavaScript CLI",
      },
      {
        executablePath: undefined,
        expectedPath: undefined,
        expectedExecutable: undefined,
        name: "leaves executable and path unset when CLAUDE_CODE_EXECUTABLE is missing",
      },
      {
        executablePath: "",
        expectedPath: undefined,
        expectedExecutable: undefined,
        name: "leaves executable and path unset when CLAUDE_CODE_EXECUTABLE is empty",
      },
    ])("$name", ({ executablePath, expectedPath, expectedExecutable }) => {
      if (executablePath !== undefined) {
        process.env.CLAUDE_CODE_EXECUTABLE = executablePath;
      }

      const options = buildSessionOptions(makeParams());

      expect(options.pathToClaudeCodeExecutable).toBe(expectedPath);
      expect(options.executable).toBe(expectedExecutable);
    });
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
