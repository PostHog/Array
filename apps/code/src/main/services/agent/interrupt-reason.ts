/**
 * Ensure a cancelled prompt response carries the interrupt reason we passed to
 * `session/cancel`. The agent can finalize a cancelled turn — especially when
 * its upstream request was aborted by a network failure — without echoing that
 * reason back, which would make the UI mislabel the turn as "interrupted by
 * user" instead of, say, "connection lost". Mutates the message in place.
 */
export function applyInterruptReasonToCancelledResponse(
  message: unknown,
  interruptReason: string | undefined,
): void {
  if (!interruptReason) return;
  if (typeof message !== "object" || message === null) return;

  const result = (message as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return;

  const typedResult = result as {
    stopReason?: string;
    _meta?: { interruptReason?: string };
  };
  if (typedResult.stopReason !== "cancelled") return;
  if (typedResult._meta?.interruptReason) return;

  typedResult._meta = { ...typedResult._meta, interruptReason };
}
