import { readlinkSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Removes PATH entries that alias `node` to the current executable. The desktop
 * host prepends a shim dir whose `node` symlinks to Electron so claude-code
 * children (which inherit ELECTRON_RUN_AS_NODE=1) can resolve a node binary.
 * Codex children have ELECTRON_RUN_AS_NODE deleted, so anything they spawn via
 * that shim boots a full Electron app that never exits — wedging codex's
 * plugin hooks (and with them every turn) until its 10-minute timeout.
 */
export function stripElectronNodeShimFromPath(
  pathValue: string | undefined,
  execPath: string = process.execPath,
): string | undefined {
  if (!pathValue) return pathValue;
  return pathValue
    .split(delimiter)
    .filter((dir) => {
      if (!dir) return false;
      try {
        return readlinkSync(join(dir, "node")) !== execPath;
      } catch {
        return true;
      }
    })
    .join(delimiter);
}
