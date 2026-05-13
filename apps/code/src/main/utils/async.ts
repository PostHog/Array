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
  const timeoutPromise = new Promise<{ result: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ result: "timeout" }), timeoutMs),
  );
  const operationPromise = operation.then((value) => ({
    result: "success" as const,
    value,
  }));
  return Promise.race([operationPromise, timeoutPromise]);
}

/**
 * Races a subscribe-style promise against a timeout. If the timeout wins,
 * any late-arriving subscription is torn down via its `unsubscribe()` method
 * so the underlying resource (e.g. FSEvents/inotify fd, callback closure)
 * does not leak.
 */
export async function subscribeWithTimeout<
  T extends { unsubscribe(): Promise<unknown> },
>(
  subscribePromise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<{ result: "success"; subscription: T } | { result: "timeout" }> {
  const timeoutPromise = new Promise<{ result: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ result: "timeout" }), timeoutMs),
  );
  const successPromise = subscribePromise.then((subscription) => ({
    result: "success" as const,
    subscription,
  }));

  const race = await Promise.race([successPromise, timeoutPromise]);

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
