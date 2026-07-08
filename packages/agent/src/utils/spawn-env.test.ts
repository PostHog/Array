import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { buildNodeShimScript } from "@posthog/shared/node-shim";
import { describe, expect, it } from "vitest";
import { stripElectronNodeShimFromPath } from "./spawn-env";

const EXEC_PATH = "/fake/Electron.app/Contents/MacOS/Electron";

function makeDir(
  kind:
    | "symlink-shim"
    | "wrapper-shim"
    | "foreign-wrapper"
    | "other-symlink"
    | "real-node"
    | "empty",
) {
  const dir = mkdtempSync(join(tmpdir(), "spawn-env-"));
  const node = join(dir, "node");
  if (kind === "symlink-shim") symlinkSync(EXEC_PATH, node);
  if (kind === "wrapper-shim")
    writeFileSync(node, buildNodeShimScript(EXEC_PATH));
  if (kind === "foreign-wrapper")
    writeFileSync(node, buildNodeShimScript("/some/other/app"));
  if (kind === "other-symlink") symlinkSync("/usr/bin/true", node);
  if (kind === "real-node") writeFileSync(node, "");
  return dir;
}

describe("stripElectronNodeShimFromPath", () => {
  it("removes only dirs whose node aliases the executable", () => {
    const symlinkShim = makeDir("symlink-shim");
    const wrapperShim = makeDir("wrapper-shim");
    const foreign = makeDir("foreign-wrapper");
    const other = makeDir("other-symlink");
    const real = makeDir("real-node");
    const empty = makeDir("empty");
    const input = [symlinkShim, wrapperShim, foreign, other, real, empty].join(
      delimiter,
    );
    expect(stripElectronNodeShimFromPath(input, EXEC_PATH)).toBe(
      [foreign, other, real, empty].join(delimiter),
    );
  });

  it("passes through undefined and empty values", () => {
    expect(stripElectronNodeShimFromPath(undefined, EXEC_PATH)).toBeUndefined();
    expect(stripElectronNodeShimFromPath("", EXEC_PATH)).toBe("");
  });
});
