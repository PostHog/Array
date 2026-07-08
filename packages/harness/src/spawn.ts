import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { fileURLToPath } from "node:url";
import { HARNESS_EXTENSION_NAMES } from "./extensions/registry";
import { piCliInvocation, resolvePiCliEntry } from "./pi-cli";

export { resolvePiCliEntry as resolvePiCli };

export function harnessExtensionFiles(): string[] {
  // `./index.js` (not `./extension.js`) so pi's startup banner shows each
  // extension by its directory name instead of `<name>/extension.js`; see
  // `src/extensions/<name>/index.ts`.
  return HARNESS_EXTENSION_NAMES.map((name) =>
    fileURLToPath(new URL(`./extensions/${name}/index.js`, import.meta.url)),
  );
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
  const invocation = piCliInvocation([...extensionArgs, ...args], {
    ...process.env,
    ...env,
  });
  return spawn(invocation.command, invocation.args, {
    stdio,
    ...rest,
    env: invocation.env,
  });
}
