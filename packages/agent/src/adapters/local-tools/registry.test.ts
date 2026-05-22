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
    // isCloudRun also keys off IS_SANDBOX; clear it so meta.environment is the
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
    {
      name: "cloud run with a token",
      meta: { taskRunId: "run-1", environment: "cloud" as const },
      token: "ghs_x",
      expected: true,
    },
    {
      name: "cloud run without a token",
      meta: { taskRunId: "run-1", environment: "cloud" as const },
      token: undefined,
      expected: false,
    },
    {
      name: "desktop run with a token",
      meta: { environment: "local" as const },
      token: "ghs_x",
      expected: false,
    },
    {
      name: "desktop run without a token",
      meta: { environment: "local" as const },
      token: undefined,
      expected: false,
    },
    {
      name: "desktop run with taskRunId and token",
      meta: { taskRunId: "run-1", environment: "local" as const },
      token: "ghs_x",
      expected: false,
    },
  ])(
    "exposes git_signed_commit only in $name when cloud+token",
    ({ meta, token, expected }) => {
      const tools = enabledLocalTools({ cwd: "/repo", token }, meta);
      const hasSignedCommit = tools.some((t) => t.name === "git_signed_commit");
      expect(hasSignedCommit).toBe(expected);
    },
  );
});
