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

export function harnessExtensionFiles(): string[] {
  return HARNESS_EXTENSION_NAMES.map((name) =>
    fileURLToPath(
      new URL(`./extensions/${name}/extension.js`, import.meta.url),
    ),
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
  return spawn(process.execPath, [resolvePiCli(), ...extensionArgs, ...args], {
    stdio,
    ...rest,
    env: { ...process.env, ...env },
  });
}
