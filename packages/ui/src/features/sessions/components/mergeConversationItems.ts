import type { ConversationItem } from "./buildConversationItems";

interface MergeConversationItemsArgs {
  conversationItems: ConversationItem[];
  optimisticItems: ConversationItem[];
  isCloud: boolean;
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
      .map((item) => item.content),
  );
  const dedupedConversation =
    pinnedOptimisticUserContents.size === 0
      ? conversationItems
      : conversationItems.filter((item) => {
          if (item.type !== "user_message") return true;
          return !pinnedOptimisticUserContents.has(item.content);
        });
  return [
    ...pinnedOptimisticItems,
    ...dedupedConversation,
    ...tailOptimisticItems,
  ];
}
