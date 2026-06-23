import type { AcpMessage } from "@posthog/shared";

/**
 * Folds a growing session event log into running state, visiting only the tail
 * appended since the last call so streaming stays O(appended), not O(history).
 *
 * An append is detected by reference identity: same-or-greater length with the
 * first and previous-last elements unchanged. Any other shape (prepend, replace,
 * reorder, truncate) discards the state and rebuilds from scratch.
 *
 * `processEvent` mutates `state`; `getResult` projects it, allocating a fresh
 * value so a retained result never sees `state` mutate underneath it.
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
