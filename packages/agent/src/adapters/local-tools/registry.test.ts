import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enabledLocalTools,
  LOCAL_TOOLS,
  LOCAL_TOOLS_MCP_NAME,
  qualifiedLocalToolName,
} from "./index";

describe("local-tools registry", () => {
  const savedSandbox = process.env.IS_SANDBOX;

  beforeEach(() => {
    // isCloudRun also keys off IS_SANDBOX; clear it so meta.taskRunId is the
    // only cloud signal under test.
    delete process.env.IS_SANDBOX;
  });

  afterEach(() => {
    if (savedSandbox === undefined) {
      delete process.env.IS_SANDBOX;
    } else {
      process.env.IS_SANDBOX = savedSandbox;
    }
  });

  it("registers tools with unique names", () => {
    const names = LOCAL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("qualifies tool names under the general server", () => {
    expect(qualifiedLocalToolName("git_signed_commit")).toBe(
      `mcp__${LOCAL_TOOLS_MCP_NAME}__git_signed_commit`,
    );
  });

  it.each([
    { name: "cloud run with a token", taskRunId: "run-1", token: "ghs_x" },
    { name: "cloud run without a token", taskRunId: "run-1", token: undefined },
    { name: "desktop run with a token", taskRunId: undefined, token: "ghs_x" },
    {
      name: "desktop run without a token",
      taskRunId: undefined,
      token: undefined,
    },
  ])(
    "exposes git_signed_commit only in $name when cloud+token",
    ({ taskRunId, token }) => {
      const tools = enabledLocalTools(
        { cwd: "/repo", token },
        taskRunId ? { taskRunId } : undefined,
      );
      const hasSignedCommit = tools.some((t) => t.name === "git_signed_commit");
      expect(hasSignedCommit).toBe(Boolean(taskRunId) && Boolean(token));
    },
  );
});
