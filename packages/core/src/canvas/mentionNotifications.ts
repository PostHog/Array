import type { TaskMention } from "@posthog/shared/domain-types";

/**
 * Watch state for turning the mentions index (`getTaskMentions`) into
 * notifications: what has already been processed, so each poll only surfaces
 * mentions the user hasn't been notified about.
 */
export interface MentionWatchState {
  /** Newest `created_at` already processed; null until the first fetch baselines. */
  seenThrough: string | null;
  /** Message ids already notified, newest first, capped. */
  notifiedMessageIds: readonly string[];
}

export const INITIAL_MENTION_WATCH_STATE: MentionWatchState = {
  seenThrough: null,
  notifiedMessageIds: [],
};

// Bounds the dedupe set so a long-running session can't grow it without limit.
const MAX_TRACKED_MESSAGE_IDS = 500;

/**
 * Absorb the first fetch without notifying: the backlog isn't news. An empty
 * first page baselines to `now` so the next mention to arrive still counts as
 * new rather than becoming the baseline itself.
 */
export function baselineMentionWatch(
  fetched: readonly TaskMention[],
  now: string,
): MentionWatchState {
  const newest = fetched.reduce<string | null>(
    (max, mention) =>
      max === null || mention.created_at > max ? mention.created_at : max,
    null,
  );
  return {
    seenThrough: newest ?? now,
    notifiedMessageIds: fetched
      .slice(0, MAX_TRACKED_MESSAGE_IDS)
      .map((mention) => mention.message_id),
  };
}

/**
 * Fold a poll's results into the state: which mentions to notify (oldest
 * first, deduped by message) and the state to carry forward.
 */
export function advanceMentionWatch(
  state: MentionWatchState,
  fetched: readonly TaskMention[],
): { state: MentionWatchState; toNotify: TaskMention[] } {
  if (fetched.length === 0) return { state, toNotify: [] };
  const alreadyNotified = new Set(state.notifiedMessageIds);
  const toNotify = fetched
    .filter((mention) => !alreadyNotified.has(mention.message_id))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const newestFetched = fetched.reduce(
    (max, mention) => (mention.created_at > max ? mention.created_at : max),
    state.seenThrough ?? "",
  );
  return {
    state: {
      seenThrough: newestFetched,
      notifiedMessageIds: [
        ...toNotify.map((mention) => mention.message_id).reverse(),
        ...state.notifiedMessageIds,
      ].slice(0, MAX_TRACKED_MESSAGE_IDS),
    },
    toNotify,
  };
}
