import type { AcpMessage } from "@posthog/shared";
import type {
  BuildConversationOptions,
  BuildResult,
} from "@posthog/ui/features/sessions/components/buildConversationItems";
import { createIncrementalConversationBuilder } from "@posthog/ui/features/sessions/components/incrementalConversationItems";
import {
  type ConversationBuildCache,
  type ConversationCacheKey,
  getConversationBuildCache,
} from "@posthog/ui/features/sessions/hooks/conversationDerivedCache";
import { useRef } from "react";

/**
 * Builds conversation items incrementally: each event is parsed once and
 * completed turns are reused by reference, so a streamed token costs work
 * proportional to the active turn rather than the whole thread. Results are
 * memoized on the (events, pending, debug) triple so unrelated re-renders
 * don't re-derive.
 *
 * Without `persistKey` the builder lives in a ref and dies with the component,
 * so every remount re-parses the full transcript. Pass a `persistKey` to keep
 * it in a module-level cache instead, making re-opening a task cheap.
 */
export function useConversationItems(
  events: AcpMessage[],
  isPromptPending: boolean | null,
  options?: BuildConversationOptions,
  persistKey?: ConversationCacheKey,
): BuildResult {
  const ref = useRef<ConversationBuildCache | null>(null);
  let cache: ConversationBuildCache;
  if (persistKey) {
    cache = getConversationBuildCache(persistKey);
  } else {
    ref.current ??= {
      impl: createIncrementalConversationBuilder(),
      events: null,
      pending: null,
      debug: undefined,
      result: null,
    };
    cache = ref.current;
  }
  const debug = options?.showDebugLogs;

  if (
    cache.result &&
    cache.events === events &&
    cache.pending === isPromptPending &&
    cache.debug === debug
  ) {
    return cache.result;
  }

  const result = cache.impl.update(events, isPromptPending, options);
  cache.events = events;
  cache.pending = isPromptPending;
  cache.debug = debug;
  cache.result = result;
  return result;
}
