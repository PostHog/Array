import { logger } from "./logger";

const log = logger.scope("async-utils");

/**
 * Races an operation against a timeout.
 * Returns success with the value if the operation completes in time,
 * or timeout if the operation takes longer than the specified duration.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<{ result: "success"; value: T } | { result: "timeout" }> {
  let timeoutHandle!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<{ result: "timeout" }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ result: "timeout" }), timeoutMs);
  });
  const operationPromise = operation.then((value) => ({
    result: "success" as const,
    value,
  }));
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Races a subscribe-style promise against a timeout. If the timeout wins,
 * any late-arriving subscription is torn down via its `unsubscribe()` method
 * so the underlying resource (e.g. FSEvents/inotify fd, callback closure)
 * does not leak.
 *
 * The late teardown is fire-and-forget: the caller does not await it. Errors
 * during teardown (or a late rejection of the subscribe promise) are logged
 * at warn level with `label` for diagnostic context.
 */
export async function subscribeWithTimeout<
  T extends { unsubscribe(): Promise<unknown> },
>(
  subscribePromise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<{ result: "success"; subscription: T } | { result: "timeout" }> {
  let timeoutHandle!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<{ result: "timeout" }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ result: "timeout" }), timeoutMs);
  });
  const successPromise = subscribePromise.then((subscription) => ({
    result: "success" as const,
    subscription,
  }));

  const race = await Promise.race([successPromise, timeoutPromise]);
  clearTimeout(timeoutHandle);

  if (race.result === "timeout") {
    subscribePromise
      .then((sub) =>
        sub.unsubscribe().catch((err) => {
          log.warn(`Failed to tear down late subscription (${label}):`, err);
        }),
      )
      .catch((err) => {
        log.warn(`Late subscribe rejected after timeout (${label}):`, err);
      });
    return { result: "timeout" };
  }

  return race;
}
