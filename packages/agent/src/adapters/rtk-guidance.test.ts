import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { appendRtkGuidanceForCodex, buildRtkGuidance } from "./rtk-guidance";

describe("rtk guidance for codex", () => {
  let dir: string;
  let binary: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtk-guidance-test-"));
    binary = path.join(dir, "rtk");
    fs.writeFileSync(binary, "#!/bin/sh\necho 'rtk 0.43.0'\n");
    fs.chmodSync(binary, 0o755);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("buildRtkGuidance", () => {
    test("advertises only dedicated test modes", () => {
      const guidance = buildRtkGuidance("/usr/local/bin/rtk");
      expect(guidance).toContain("`/usr/local/bin/rtk test pnpm test`");
      expect(guidance).toContain("`/usr/local/bin/rtk test python -m pytest`");
      expect(guidance).not.toContain("cargo test");
      expect(guidance).toContain("Do not use RTK for machine-readable");
      expect(guidance).not.toContain("git status");
      expect(guidance).not.toContain("rg --heading");
      expect(guidance).not.toContain("jq -c");
    });

    // A desktop install can resolve a path with spaces; unquoted it would
    // split into multiple shell tokens and every guided command would fail.
    test("shell-quotes a binary path containing spaces", () => {
      const guidance = buildRtkGuidance("/Apps/My Tools/rtk");
      expect(guidance).toContain("`'/Apps/My Tools/rtk' test pnpm test`");
    });
  });

  describe("appendRtkGuidanceForCodex", () => {
    test("appends guidance when rtk is on PATH", () => {
      const result = appendRtkGuidanceForCodex("base instructions", {
        PATH: dir,
      });
      expect(result.startsWith("base instructions\n\n")).toBe(true);
      expect(result).toContain("rtk output compression");
      expect(result).toContain(binary);
    });

    // POSTHOG_RTK=0 is set per run from the cloud kill-switch flag; it must
    // silence the guidance too, which is why the gate is resolveRtkPrefix
    // rather than detectRtkBinary.
    test.each([["0"], ["false"]])(
      "returns instructions unchanged when POSTHOG_RTK is %s",
      (value) => {
        expect(
          appendRtkGuidanceForCodex("base instructions", {
            POSTHOG_RTK: value,
            PATH: dir,
          }),
        ).toBe("base instructions");
      },
    );

    test("returns instructions unchanged when rtk is not installed", () => {
      expect(
        appendRtkGuidanceForCodex("base instructions", {
          PATH: "/nonexistent",
        }),
      ).toBe("base instructions");
    });

    test("does not leave a leading separator when instructions are empty", () => {
      const result = appendRtkGuidanceForCodex("", { PATH: dir });
      expect(result.startsWith("## rtk")).toBe(true);
    });
  });
});
