import { readGithubTokenFromEnv } from "@posthog/git/signed-commit";
import type { Logger } from "./logger";

/**
 * Races an operation against a timeout.
 * Returns success with the value if the operation completes in time,
 * or timeout if the operation takes longer than the specified duration.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<{ result: "success"; value: T } | { result: "timeout" }> {
  const timeoutPromise = new Promise<{ result: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ result: "timeout" }), timeoutMs),
  );
  const operationPromise = operation.then((value) => ({
    result: "success" as const,
    value,
  }));
  return Promise.race([operationPromise, timeoutPromise]);
}

export const IS_ROOT =
  typeof process !== "undefined" &&
  (process.geteuid?.() ?? process.getuid?.()) === 0;

export const ALLOW_BYPASS = !IS_ROOT || !!process.env.IS_SANDBOX;

/**
 * A cloud sandbox run, as opposed to a local desktop session. `taskRunId` is
 * used by both desktop and cloud for persistence, so it must not imply cloud.
 */
export function isCloudRun(
  meta: { environment?: "local" | "cloud" } | undefined,
): boolean {
  if (meta?.environment) {
    return meta.environment === "cloud";
  }
  return !!process.env.IS_SANDBOX;
}

/** The GitHub token available to the sandbox, if any. */
export function resolveGithubToken(): string | undefined {
  return readGithubTokenFromEnv();
}

export function unreachable(value: never, logger: Logger): void {
  let valueAsString: string;
  try {
    valueAsString = JSON.stringify(value);
  } catch {
    valueAsString = String(value);
  }
  logger.error(`Unexpected case: ${valueAsString}`);
}
