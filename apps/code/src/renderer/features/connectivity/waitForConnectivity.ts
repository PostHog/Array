import { getIsOnline } from "@renderer/stores/connectivityStore";

const DEFAULT_POLL_MS = 1_000;

/**
 * Wait for connectivity to return, polling the cached online status (the
 * connectivity service re-checks in the background every few seconds).
 *
 * Resolves `true` as soon as the device is back online, or `false` if
 * `timeoutMs` elapses while still offline. Nothing is sent or retried here —
 * it's purely a "are we online yet?" gate, so callers can use it before a send
 * (fail fast on a sustained outage) or to bound a reconnect wait.
 */
export async function waitForConnectivity(
  timeoutMs: number,
  pollMs: number = DEFAULT_POLL_MS,
): Promise<boolean> {
  if (getIsOnline()) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (getIsOnline()) return true;
  }
  return getIsOnline();
}
