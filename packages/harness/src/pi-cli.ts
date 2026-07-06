/**
 * Locates the pi CLI entry point and builds the invocation needed to run it
 * as a child process. This is the single source of truth for that — both
 * `spawn.ts` (spawning the interactive/print pi CLI) and the `subagent`
 * extension (spawning child pi sessions) go through it, so there is exactly
 * one place that knows how to invoke pi as a subprocess.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePiCliEntry(): string {
  const mainEntry = fileURLToPath(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  return join(dirname(mainEntry), "cli.js");
}

/**
 * Electron's `process.execPath` is the Electron binary, not a plain Node
 * binary — running it against an arbitrary script (like pi's CLI entry)
 * requires `ELECTRON_RUN_AS_NODE=1` so it behaves like Node instead of
 * booting the Electron app. This has no effect (and is safe to always set)
 * when the current process is already plain Node.
 */
export function nodeCompatibleSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

export interface PiCliInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Builds `{ command, args, env }` for spawning pi's CLI with the given
 * arguments, safe to use from a plain Node process or from inside Electron's
 * main process.
 */
export function piCliInvocation(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): PiCliInvocation {
  return {
    command: process.execPath,
    args: [resolvePiCliEntry(), ...args],
    env: nodeCompatibleSpawnEnv(env),
  };
}
