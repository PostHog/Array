import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNodeShimScript } from "@posthog/shared/node-shim";
import { afterEach, describe, expect, it } from "vitest";
import { ensureNodeShim } from "./node-shim";

const EXEC_PATH = "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code";

describe("ensureNodeShim", () => {
  const dirs: string[] = [];

  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "node-shim-test-"));
    dirs.push(dir);
    return join(dir, "shim");
  }

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes an executable wrapper that sets ELECTRON_RUN_AS_NODE itself", () => {
    const dir = makeDir();
    ensureNodeShim(dir, EXEC_PATH, "darwin");

    const shim = join(dir, "node");
    const content = readFileSync(shim, "utf-8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(content).toContain(`exec "${EXEC_PATH}" "$@"`);
    expect(statSync(shim).mode & 0o111).not.toBe(0);
  });

  it("replaces a legacy symlink shim with the wrapper script", () => {
    const dir = makeDir();
    ensureNodeShim(dir, EXEC_PATH, "darwin");
    const shim = join(dir, "node");
    rmSync(shim);
    symlinkSync(EXEC_PATH, shim);

    ensureNodeShim(dir, EXEC_PATH, "darwin");

    expect(lstatSync(shim).isSymbolicLink()).toBe(false);
    expect(readFileSync(shim, "utf-8")).toBe(buildNodeShimScript(EXEC_PATH));
  });

  it("rewrites the wrapper when the binary path changes", () => {
    const dir = makeDir();
    ensureNodeShim(dir, "/old/location/App", "darwin");

    ensureNodeShim(dir, EXEC_PATH, "darwin");

    expect(readFileSync(join(dir, "node"), "utf-8")).toBe(
      buildNodeShimScript(EXEC_PATH),
    );
  });

  it("leaves an up-to-date wrapper untouched", () => {
    const dir = makeDir();
    ensureNodeShim(dir, EXEC_PATH, "darwin");
    const shim = join(dir, "node");
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(shim, past, past);

    ensureNodeShim(dir, EXEC_PATH, "darwin");

    expect(statSync(shim).mtimeMs).toBe(past.getTime());
  });

  it("replaces a corrupt shim that is not the expected script", () => {
    const dir = makeDir();
    ensureNodeShim(dir, EXEC_PATH, "darwin");
    const shim = join(dir, "node");
    writeFileSync(shim, "not a shim");

    ensureNodeShim(dir, EXEC_PATH, "darwin");

    expect(readFileSync(shim, "utf-8")).toBe(buildNodeShimScript(EXEC_PATH));
  });

  it("keeps the symlink behavior on windows and tolerates an existing link", () => {
    const dir = makeDir();
    ensureNodeShim(dir, EXEC_PATH, "win32");
    ensureNodeShim(dir, EXEC_PATH, "win32");

    const shim = join(dir, "node");
    expect(lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shim)).toBe(EXEC_PATH);
  });

  it("retargets the win32 symlink when the binary path changes", () => {
    const dir = makeDir();
    ensureNodeShim(dir, "/old/location/App.exe", "win32");

    ensureNodeShim(dir, EXEC_PATH, "win32");

    expect(readlinkSync(join(dir, "node"))).toBe(EXEC_PATH);
  });
});
