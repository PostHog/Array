import { describe, expect, it } from "vitest";
import type { CodeExecutionMode } from "../../execution-mode";
import { isToolAllowedForMode, toSdkPermissionMode } from "./tools";

describe("toSdkPermissionMode", () => {
  // PostHog's "auto" is host-arbitrated (canUseTool auto-approves edits/bash).
  // It must NOT be handed to the SDK's native "auto" mode, whose classifier and
  // org "ask" ceiling can force prompts for the tools we mean to auto-approve.
  it("maps the custom auto mode to the SDK's default mode", () => {
    expect(toSdkPermissionMode("auto")).toBe("default");
  });

  it.each<CodeExecutionMode>([
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
  ])("passes native SDK mode %s through unchanged", (mode) => {
    expect(toSdkPermissionMode(mode)).toBe(mode);
  });
});

describe("isToolAllowedForMode stays authoritative for auto", () => {
  // Even though the SDK is told "default", the host arbiter still treats the
  // session as "auto" and auto-allows edits and shell commands.
  it.each(["Bash", "Edit", "Write", "NotebookEdit", "BashOutput", "KillShell"])(
    "auto-allows %s in auto mode",
    (tool) => {
      expect(isToolAllowedForMode(tool, "auto")).toBe(true);
    },
  );

  it.each(["Bash", "Edit", "Write"])(
    "still gates %s in default mode",
    (tool) => {
      expect(isToolAllowedForMode(tool, "default")).toBe(false);
    },
  );
});
