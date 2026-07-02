import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function escapeForDoubleQuotes(path: string): string {
  return path.replace(/([$`"\\])/g, "\\$1");
}

export function buildNodeShimScript(execPath: string): string {
  return [
    "#!/bin/sh",
    "export ELECTRON_RUN_AS_NODE=1",
    `exec "${escapeForDoubleQuotes(execPath)}" "$@"`,
    "",
  ].join("\n");
}

/**
 * Writes the `node` shim agents resolve via PATH. On POSIX this is a wrapper
 * script that sets ELECTRON_RUN_AS_NODE itself before exec'ing the app binary,
 * so the shim stays a node runtime even when a layer in between (user dotfiles,
 * direnv/flox, shell snapshots, MCP clients with cleaned envs) strips the var.
 * A bare symlink relied on every descendant preserving the env and booted the
 * full desktop app whenever one didn't. Replaces a stale legacy symlink or a
 * wrapper pointing at a moved binary; no-op when already current.
 */
export function ensureNodeShim(
  mockNodeDir: string,
  execPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  mkdirSync(mockNodeDir, { recursive: true });
  const shimPath = join(mockNodeDir, "node");

  if (platform === "win32") {
    try {
      symlinkSync(execPath, shimPath);
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
    }
    return;
  }

  const script = buildNodeShimScript(execPath);
  if (currentShimContent(shimPath) === script) return;

  const tmpPath = `${shimPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, script);
  chmodSync(tmpPath, 0o755);
  renameSync(tmpPath, shimPath);
}

function currentShimContent(shimPath: string): string | null {
  try {
    if (lstatSync(shimPath).isSymbolicLink()) return null;
    return readFileSync(shimPath, "utf-8");
  } catch {
    return null;
  }
}
