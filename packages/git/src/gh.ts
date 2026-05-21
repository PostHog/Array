// Namespace import (not `{ execFile }`) so the renderer's browser bundle can
// resolve this node-only module against vite's `__vite-browser-external` stub,
// which has no named exports. execGh never runs in the browser.
import * as childProcess from "node:child_process";

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface GhExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Written to the child's stdin and then closed. Use with `gh api graphql
   * --input -` (or `gh api --input -`) to pass a JSON request body so complex
   * GraphQL variables are sent as real objects rather than `-F` string scalars.
   */
  input?: string;
}

export function execGh(
  args: string[],
  options: GhExecOptions = {},
): Promise<GhExecResult> {
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  return new Promise<GhExecResult>((resolve) => {
    const child = childProcess.execFile(
      "gh",
      args,
      { cwd: options.cwd, env },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }

        const err = error as Error & {
          code?: number | string;
          stdout?: string;
          stderr?: string;
        };
        const exitCode =
          typeof err.code === "number"
            ? err.code
            : err.code === "ENOENT"
              ? 127
              : 1;

        resolve({
          stdout: stdout ?? err.stdout ?? "",
          stderr: stderr ?? err.stderr ?? "",
          exitCode,
          error: err.message,
        });
      },
    );

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}
