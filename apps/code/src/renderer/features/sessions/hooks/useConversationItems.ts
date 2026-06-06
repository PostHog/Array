import type {
  BuildConversationOptions,
  BuildResult,
} from "@features/sessions/components/buildConversationItems";
import { createIncrementalConversationBuilder } from "@features/sessions/components/incrementalConversationItems";
import type { AcpMessage } from "@shared/types/session-events";
import { useRef } from "react";

interface Cache {
  impl: ReturnType<typeof createIncrementalConversationBuilder>;
  events: AcpMessage[] | null;
  pending: boolean | null;
  debug: boolean | undefined;
  connLostIds: number[] | undefined;
  result: BuildResult | null;
}

/**
 * Builds conversation items incrementally — each event is parsed once and
 * completed turns are reused by reference, so a streamed token costs work
 * proportional to the active turn rather than the whole thread. The persistent
 * builder lives in a ref; results are memoized on the (events, pending, debug)
 * triple so unrelated re-renders don't re-derive.
 */
export function useConversationItems(
  events: AcpMessage[],
  isPromptPending: boolean | null,
  options?: BuildConversationOptions,
): BuildResult {
  const ref = useRef<Cache | null>(null);
  if (!ref.current) {
    ref.current = {
      impl: createIncrementalConversationBuilder(),
      events: null,
      pending: null,
      debug: undefined,
      connLostIds: undefined,
      result: null,
    };
  }
  const cache = ref.current;
  const debug = options?.showDebugLogs;
  // Network-failed turn ids can change without `events` changing (a turn is
  // flagged after its completion event is already in the array), so it must be
  // part of the cache key or the "Failed due to network issue" footer wouldn't
  // re-derive.
  const connLostIds = options?.connectionLostPromptIds;

  if (
    cache.result &&
    cache.events === events &&
    cache.pending === isPromptPending &&
    cache.debug === debug &&
    cache.connLostIds === connLostIds
  ) {
    return cache.result;
  }

  const result = cache.impl.update(events, isPromptPending, options);
  cache.events = events;
  cache.pending = isPromptPending;
  cache.debug = debug;
  cache.connLostIds = connLostIds;
  cache.result = result;
  return result;
}
