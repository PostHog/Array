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

  it("removes both legacy shim dirs including their contents", () => {
    const root = makeRoot();
    const dev = join(root, "agent-node-dev");
    const prod = join(root, "agent-node-prod");
    mkdirSync(dev, { recursive: true });
    mkdirSync(prod, { recursive: true });
    writeFileSync(join(dev, "node"), "#!/bin/sh\n");
    symlinkSync("/does/not/exist", join(prod, "node"));

    const removed = removeLegacyNodeShimDirs(root);

    expect(removed.sort()).toEqual([dev, prod].sort());
    expect(existsSync(dev)).toBe(false);
    expect(existsSync(prod)).toBe(false);
  });

  it.each(["agent-node-dev", "agent-node-prod"])(
    "removes %s when it is the only leftover",
    (name) => {
      const root = makeRoot();
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "node"), "#!/bin/sh\n");

      expect(removeLegacyNodeShimDirs(root)).toEqual([dir]);
      expect(existsSync(dir)).toBe(false);
    },
  );

  it("returns an empty list when nothing is left to clean", () => {
    expect(removeLegacyNodeShimDirs(makeRoot())).toEqual([]);
  });
});
