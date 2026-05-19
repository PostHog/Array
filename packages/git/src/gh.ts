import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export async function execGh(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<GhExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    const exitCode =
      typeof err.code === "number" ? err.code : err.code === "ENOENT" ? 127 : 1;

    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode,
      error: err.message,
    };
  }
}
