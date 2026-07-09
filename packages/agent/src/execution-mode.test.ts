import { describe, expect, it } from "vitest";
import {
  getAvailableCodexModes,
  getAvailableModes,
  resolveCloudInitialPermissionMode,
} from "./execution-mode";

describe("execution modes", () => {
  it("includes auto-accept permissions for claude sessions", () => {
    expect(getAvailableModes().map((mode) => mode.id)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "bypassPermissions",
      "auto",
    ]);
  });

  it("exposes the same presets as a live codex session (incl. plan)", () => {
    expect(getAvailableCodexModes().map((mode) => mode.id)).toEqual([
      "plan",
      "read-only",
      "auto",
      "full-access",
    ]);
  });
});

describe("resolveCloudInitialPermissionMode", () => {
  it.each([
    ["codex", "auto", "auto"],
    ["codex", "read-only", "read-only"],
    ["codex", "full-access", "full-access"],
    ["codex", "plan", "read-only"],
    ["codex", "default", "auto"],
    ["codex", "acceptEdits", "auto"],
    ["codex", "bypassPermissions", "full-access"],
    ["claude", "default", "default"],
    ["claude", "acceptEdits", "acceptEdits"],
    ["claude", "plan", "plan"],
    ["claude", "bypassPermissions", "bypassPermissions"],
    ["claude", "auto", "auto"],
    ["claude", "read-only", "plan"],
    ["claude", "full-access", "bypassPermissions"],
    [undefined, "plan", "plan"],
    [undefined, "read-only", "read-only"],
  ] as const)(
    "resolves %s adapter mode %s to %s",
    (adapter, mode, expected) => {
      expect(resolveCloudInitialPermissionMode(adapter, mode)).toBe(expected);
    },
  );
});
