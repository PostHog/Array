import { existsSync } from "node:fs";
import { resolve as resolvePath, sep } from "node:path";

/**
 * Resolve a shared dist asset relative to the compiled adapter location. When
 * bundled into different entry points (dist/agent.js, dist/server/bin.cjs,
 * dist/server/harness/bin.js, the Electron main bundle at .vite/build, etc),
 * `import.meta.dirname` sits at different depths — and is unavailable in the
 * CJS bin bundle, where `__dirname` takes over. Walk up until the script is
 * found so each bundle locates the asset.
 */
export function resolveBundledMcpScript(rel: string): string {
  let dir = import.meta.dirname ?? __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolvePath(dir, rel);
    if (existsSync(candidate)) return toSpawnablePath(candidate);
    dir = resolvePath(dir, "..");
  }
  throw new Error(
    `Could not locate ${rel} relative to ${import.meta.dirname ?? __dirname}.`,
  );
}

/**
 * In the packaged Electron app the main bundle lives inside app.asar, where
 * Electron's patched fs makes the path "exist" — but the script is spawned by
 * an external process (Codex) as a plain Node child, which cannot read inside
 * the archive. asarUnpack mirrors it on disk; return that real path instead.
 */
function toSpawnablePath(candidate: string): string {
  const marker = `${sep}app.asar${sep}`;
  if (!candidate.includes(marker)) return candidate;
  const unpacked = candidate.replace(marker, `${sep}app.asar.unpacked${sep}`);
  return existsSync(unpacked) ? unpacked : candidate;
}
