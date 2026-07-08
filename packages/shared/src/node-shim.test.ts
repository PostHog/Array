import { describe, expect, it } from "vitest";
import { buildNodeShimScript } from "./node-shim";

describe("buildNodeShimScript", () => {
  it("sets ELECTRON_RUN_AS_NODE and execs the binary", () => {
    const script = buildNodeShimScript(
      "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code",
    );
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(
      'exec "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code" "$@"',
    );
  });

  it("escapes shell-special characters in the binary path", () => {
    expect(buildNodeShimScript('/odd/pa"th/$app`bin\\x')).toContain(
      'exec "/odd/pa\\"th/\\$app\\`bin\\\\x" "$@"',
    );
  });
});
