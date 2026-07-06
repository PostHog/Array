import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_EXTENSION_NAMES } from "./extensions/registry";

export function resolvePiCli(): string {
  const mainEntry = fileURLToPath(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  return join(dirname(mainEntry), "cli.js");
}

/**
 * `pi-mcp-adapter` ships raw TypeScript with no compiled entry point or
 * `main`/`exports` field, so it can only be loaded by file path through
 * pi's own extension loader (the `-e` CLI flag, or `additionalExtensionPaths`
 * in the SDK) rather than statically imported. Resolve its declared
 * extension entry (`./index.ts`, per its `pi.extensions` manifest) from
 * wherever npm installed it.
 */
export function mcpAdapterExtensionFile(): string {
  const pkgJsonPath = fileURLToPath(
    import.meta.resolve("pi-mcp-adapter/package.json"),
  );
  return join(dirname(pkgJsonPath), "index.ts");
}

export function harnessExtensionFiles(): string[] {
  // `./index.js` (not `./extension.js`) so pi's startup banner shows each
  // extension by its directory name instead of `<name>/extension.js`; see
  // `src/extensions/<name>/index.ts`.
  const localFiles = HARNESS_EXTENSION_NAMES.map((name) =>
    fileURLToPath(new URL(`./extensions/${name}/index.js`, import.meta.url)),
  );
  return [...localFiles, mcpAdapterExtensionFile()];
}

export interface SpawnPiOptions extends SpawnOptions {
  extensions?: boolean;
}

export function spawnPiCli(
  args: string[] = [],
  options: SpawnPiOptions = {},
): ChildProcess {
  const { extensions = true, env, stdio = "inherit", ...rest } = options;
  const extensionArgs = extensions
    ? harnessExtensionFiles().flatMap((file) => ["-e", file])
    : [];
  return spawn(process.execPath, [resolvePiCli(), ...extensionArgs, ...args], {
    stdio,
    ...rest,
    env: { ...process.env, ...env },
  });
}
