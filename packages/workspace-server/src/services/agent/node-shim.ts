import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildNodeShimScript } from "@posthog/shared/node-shim";

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

// Writes the `node` shim agents resolve via PATH. POSIX shims are wrapper
// scripts that set ELECTRON_RUN_AS_NODE themselves, so a descendant that
// strips the var still gets a node runtime instead of a phantom app boot (a
// bare symlink relied on every layer preserving the env). Self-heals legacy
// symlinks and shims pointing at a moved binary; no-op when already current.
export function ensureNodeShim(
  mockNodeDir: string,
  execPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  mkdirSync(mockNodeDir, { recursive: true });
  const shimPath = join(mockNodeDir, "node");

  if (platform === "win32") {
    // No sh on win32, so the shim stays a symlink; the bootstrap
    // internal-child guard is the backstop against phantom boots there.
    if (currentSymlinkTarget(shimPath) === execPath) return;
    rmSync(shimPath, { force: true });
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

function currentSymlinkTarget(shimPath: string): string | null {
  try {
    if (!lstatSync(shimPath).isSymbolicLink()) return null;
    return readlinkSync(shimPath);
  } catch {
    return null;
  }
}

function currentShimContent(shimPath: string): string | null {
  try {
    if (lstatSync(shimPath).isSymbolicLink()) return null;
    return readFileSync(shimPath, "utf-8");
  } catch {
    return null;
  }
}
