import type { ConversationItem } from "./buildConversationItems";
import { extractChannelContext } from "./session-update/channelContext";

interface MergeConversationItemsArgs {
  conversationItems: ConversationItem[];
  optimisticItems: ConversationItem[];
  isCloud: boolean;
}

// The pinned optimistic bubble is seeded from the bare task description, but the
// echoed `session/prompt` that streams back from the sandbox may additionally
// carry the channel's CONTEXT.md, folded into the prompt at task creation (see
// buildChannelContextText in @posthog/core). Dedupe and upgrade compare on the
// channel-context-stripped text so the echo still matches its placeholder.
function strippedUserContent(content: string): string {
  return extractChannelContext(content)?.stripped ?? content;
}

// Cloud's initial optimistic is pinned to the top so the user's prompt stays
// visible above setup progress. Follow-up optimistics render at the tail until
// the streamed `session/prompt` arrives and replaces them.
//
// Local sessions keep optimistic at the chronological end — they rely on
// `replaceOptimisticWithEvent` to swap optimistic↔real in place.
export function mergeConversationItems({
  conversationItems,
  optimisticItems,
  isCloud,
}: MergeConversationItemsArgs): ConversationItem[] {
  if (!isCloud) {
    return [...conversationItems, ...optimisticItems];
  }

  const pinnedOptimisticItems = optimisticItems.filter(
    (item) => item.type !== "user_message" || item.pinToTop !== false,
  );
  const tailOptimisticItems = optimisticItems.filter(
    (item) => item.type === "user_message" && item.pinToTop === false,
  );
  const pinnedOptimisticUserContents = new Set(
    pinnedOptimisticItems
      .filter(
        (item): item is Extract<typeof item, { type: "user_message" }> =>
          item.type === "user_message",
      )
      .map((item) => strippedUserContent(item.content)),
  );

  // When the echoed prompt matches a pinned optimistic placeholder, drop the
  // echo but remember its content: it may carry the channel CONTEXT.md block the
  // placeholder lacks, so we surface the richer copy on the pinned bubble below.
  const echoedContentByKey = new Map<string, string>();
  const dedupedConversation =
    pinnedOptimisticUserContents.size === 0
      ? conversationItems
      : conversationItems.filter((item) => {
          if (item.type !== "user_message") return true;
          const key = strippedUserContent(item.content);
          if (!pinnedOptimisticUserContents.has(key)) return true;
          if (!echoedContentByKey.has(key)) {
            echoedContentByKey.set(key, item.content);
          }
          return false;
        });

  const resolvedPinnedItems =
    echoedContentByKey.size === 0
      ? pinnedOptimisticItems
      : pinnedOptimisticItems.map((item) => {
          if (item.type !== "user_message") return item;
          const echoed = echoedContentByKey.get(
            strippedUserContent(item.content),
          );
          return echoed !== undefined && echoed !== item.content
            ? { ...item, content: echoed }
            : item;
        });

  return [
    ...resolvedPinnedItems,
    ...dedupedConversation,
    ...tailOptimisticItems,
  ];
}
