import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, test, vi } from "vitest";
import type { FileEnrichmentDeps } from "../../enrichment/file-enricher";

const enrichFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../enrichment/file-enricher", () => ({
  enrichFileForAgent: enrichFileMock,
}));

import { Logger } from "../../utils/logger";
import {
  createPreToolUseHook,
  createReadEnrichmentHook,
  type EnrichedReadCache,
} from "./hooks";
import type {
  PermissionCheckResult,
  SettingsManager,
} from "./session/settings";

const stubDeps = {} as FileEnrichmentDeps;

function buildReadHookInput(
  overrides: Partial<HookInput> & {
    file_path?: string;
    tool_response?: unknown;
  } = {},
): HookInput {
  return {
    session_id: "test-session",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_use_id: "toolu_1",
    tool_input: { file_path: overrides.file_path ?? "/tmp/code.ts" },
    tool_response: overrides.tool_response ?? "raw-content",
    ...overrides,
  } as HookInput;
}

describe("createReadEnrichmentHook", () => {
  test("returns { continue: true } for non-PostToolUse events", async () => {
    enrichFileMock.mockReset();
    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    const result = await hook(
      { hook_event_name: "PreToolUse" } as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ continue: true });
    expect(enrichFileMock).not.toHaveBeenCalled();
  });

  test("returns { continue: true } for non-Read tools", async () => {
    enrichFileMock.mockReset();
    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    const result = await hook(
      buildReadHookInput({ tool_name: "Bash" }),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ continue: true });
    expect(enrichFileMock).not.toHaveBeenCalled();
  });

  test("passes stripped content and file_path into enricher", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce(null);

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    await hook(
      buildReadHookInput({
        file_path: "/tmp/app.ts",
        tool_response: "     1\tconst x = 1;\n     2\tposthog.capture('x');",
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(enrichFileMock).toHaveBeenCalledTimes(1);
    const [, filePath, content] = enrichFileMock.mock.calls[0];
    expect(filePath).toBe("/tmp/app.ts");
    expect(content).toBe("const x = 1;\nposthog.capture('x');");
  });

  test("returns additionalContext when enricher produces annotations", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce(
      "posthog.capture('x'); // [PostHog] Event: \"x\"",
    );

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    const result = await hook(
      buildReadHookInput({ file_path: "/tmp/app.ts" }),
      undefined,
      {
        signal: new AbortController().signal,
      },
    );

    expect(result).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining(
          "posthog.capture('x'); // [PostHog] Event: \"x\"",
        ),
      },
    });
    const context = (
      result as {
        hookSpecificOutput: { additionalContext: string };
      }
    ).hookSpecificOutput.additionalContext;
    expect(context).toContain("/tmp/app.ts");
  });

  test("writes enriched content to cache keyed by tool_use_id", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce(
      "posthog.capture('x'); // [PostHog] Event: \"x\"",
    );

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    await hook(buildReadHookInput({ file_path: "/tmp/app.ts" }), undefined, {
      signal: new AbortController().signal,
    });

    expect(cache.get("toolu_1")).toContain('// [PostHog] Event: "x"');
  });

  test("does not write to cache when tool_use_id is missing", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("enriched");

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    await hook(
      buildReadHookInput({ file_path: "/tmp/app.ts", tool_use_id: undefined }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(cache.size).toBe(0);
  });

  test("handles {type:'text', file:{content}} Read tool_response shape", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("enriched");

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    await hook(
      buildReadHookInput({
        file_path: "/tmp/app.ts",
        tool_response: {
          type: "text",
          file: {
            filePath: "/tmp/app.ts",
            content: "posthog.capture('x');\n",
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    const [, , content] = enrichFileMock.mock.calls[0];
    expect(content).toBe("posthog.capture('x');\n");
  });

  test("handles wrapped [{type:'text', text:'...'}] tool_response shape", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("enriched");

    const cache: EnrichedReadCache = new Map();
    const hook = createReadEnrichmentHook(stubDeps, cache);
    await hook(
      buildReadHookInput({
        tool_response: [{ type: "text", text: "     1\tfoo" }],
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    const [, , content] = enrichFileMock.mock.calls[0];
    expect(content).toBe("foo");
  });
});

function buildPreToolUseHookInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): HookInput {
  return {
    session_id: "test-session",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_use_id: "toolu_1",
    tool_input: toolInput,
  } as HookInput;
}

function buildSettingsManagerStub(
  result: PermissionCheckResult,
): SettingsManager {
  return {
    checkPermission: () => result,
  } as unknown as SettingsManager;
}

describe("createPreToolUseHook", () => {
  const logger = new Logger({ debug: false });

  test("defers destructive PostHog exec sub-tool to canUseTool via ask", async () => {
    const settingsManager = buildSettingsManagerStub({
      decision: "allow",
      rule: "mcp__posthog__exec",
      source: "allow",
    });
    const hook = createPreToolUseHook(settingsManager, logger);
    const result = await hook(
      buildPreToolUseHookInput("mcp__posthog__exec", {
        command: 'call dashboard-update {"id": 1, "name": "x"}',
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    });
  });

  test("allows non-destructive PostHog exec sub-tool via settings rule", async () => {
    const settingsManager = buildSettingsManagerStub({
      decision: "allow",
      rule: "mcp__posthog__exec",
      source: "allow",
    });
    const hook = createPreToolUseHook(settingsManager, logger);
    const result = await hook(
      buildPreToolUseHookInput("mcp__posthog__exec", {
        command: 'call experiment-get {"id": 1}',
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "Allowed by settings rule: mcp__posthog__exec",
      },
    });
  });

  test("allows non-PostHog tool via settings rule unchanged", async () => {
    const settingsManager = buildSettingsManagerStub({
      decision: "allow",
      rule: "Bash(ls:*)",
      source: "allow",
    });
    const hook = createPreToolUseHook(settingsManager, logger);
    const result = await hook(
      buildPreToolUseHookInput("Bash", { command: "ls -la" }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });

  test("defers when destructive rule is partial-update", async () => {
    const settingsManager = buildSettingsManagerStub({
      decision: "allow",
      rule: "mcp__posthog__exec",
      source: "allow",
    });
    const hook = createPreToolUseHook(settingsManager, logger);
    const result = await hook(
      buildPreToolUseHookInput("mcp__posthog__exec", {
        command: 'call cohorts-partial-update {"id": 1}',
      }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      hookSpecificOutput: { permissionDecision: "ask" },
    });
  });
});
