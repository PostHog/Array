import type { AcpMessage } from "@posthog/shared";

/**
 * Folds a session event log into running state, processing only the events
 * appended since the last call. The log grows by append during streaming, so
 * re-scanning the whole array on every token is O(history) per render; this
 * keeps a cursor and only visits the new tail.
 *
 * An append is detected by reference identity: the array is the same length or
 * longer, and its first and previous-last elements are still the same objects.
 * Any other shape (prepend, replace, in-place reorder, truncate) breaks that
 * invariant, so the state is discarded and rebuilt from scratch.
 *
 * `processEvent` mutates `state` in place; `getResult` projects it into the
 * value callers consume (and may allocate a fresh object each call so callers
 * never observe `state` mutating underneath a retained result).
 */
export function createAppendOnlyTracker<State, Result>(config: {
  init: () => State;
  processEvent: (state: State, event: AcpMessage) => void;
  getResult: (state: State) => Result;
}) {
  let state = config.init();
  let processedCount = 0;
  let firstEventRef: AcpMessage | null = null;
  let boundaryEventRef: AcpMessage | null = null;

  const update = (events: AcpMessage[]): Result => {
    const isAppend =
      events.length >= processedCount &&
      (processedCount === 0 || events[0] === firstEventRef) &&
      (processedCount === 0 || events[processedCount - 1] === boundaryEventRef);

    if (!isAppend) {
      state = config.init();
      processedCount = 0;
    }

    for (let i = processedCount; i < events.length; i++) {
      config.processEvent(state, events[i]);
    }

    processedCount = events.length;
    firstEventRef = events[0] ?? null;
    boundaryEventRef = events[processedCount - 1] ?? null;

    return config.getResult(state);
  };

  return { update };
}
