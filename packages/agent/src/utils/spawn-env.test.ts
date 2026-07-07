import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripElectronNodeShimFromPath } from "./spawn-env";

const EXEC_PATH = "/fake/Electron.app/Contents/MacOS/Electron";

function makeDir(kind: "shim" | "other-symlink" | "real-node" | "empty") {
  const dir = mkdtempSync(join(tmpdir(), "spawn-env-"));
  if (kind === "shim") symlinkSync(EXEC_PATH, join(dir, "node"));
  if (kind === "other-symlink") symlinkSync("/usr/bin/true", join(dir, "node"));
  if (kind === "real-node") writeFileSync(join(dir, "node"), "");
  return dir;
}

describe("stripElectronNodeShimFromPath", () => {
  it("removes only dirs whose node symlinks to the executable", () => {
    const shim = makeDir("shim");
    const other = makeDir("other-symlink");
    const real = makeDir("real-node");
    const empty = makeDir("empty");
    const input = [shim, other, real, empty].join(delimiter);
    expect(stripElectronNodeShimFromPath(input, EXEC_PATH)).toBe(
      [other, real, empty].join(delimiter),
    );
  });

  it("passes through undefined and empty values", () => {
    expect(stripElectronNodeShimFromPath(undefined, EXEC_PATH)).toBeUndefined();
    expect(stripElectronNodeShimFromPath("", EXEC_PATH)).toBe("");
  });
});
