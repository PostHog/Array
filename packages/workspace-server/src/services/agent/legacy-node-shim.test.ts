import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeLegacyNodeShimDirs } from "./legacy-node-shim";

describe("removeLegacyNodeShimDirs", () => {
  const roots: string[] = [];

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "legacy-shim-test-"));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["agent-node-dev", "wrapper-script"],
    ["agent-node-prod", "symlink"],
  ] as const)("removes a leftover %s dir with a %s shim", (name, kind) => {
    const root = makeRoot();
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const shim = join(dir, "node");
    if (kind === "symlink") {
      symlinkSync("/does/not/exist", shim);
    } else {
      writeFileSync(shim, "#!/bin/sh\n");
    }

    expect(removeLegacyNodeShimDirs(root)).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
  });

  it("returns an empty list when nothing is left to clean", () => {
    expect(removeLegacyNodeShimDirs(makeRoot())).toEqual([]);
  });
});
