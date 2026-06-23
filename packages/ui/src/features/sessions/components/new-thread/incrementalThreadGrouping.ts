import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  buildThreadGroups,
  type ThreadGrouping,
} from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import type { CollapseMode } from "@posthog/ui/features/sessions/components/new-thread/conversationThreadConfig";

interface Cache {
  items: ConversationItem[];
  mode: CollapseMode;
  overrides: Record<string, boolean>;
  grouping: ThreadGrouping;
  suffixIds: string[];
  stablePrefixItemCount: number;
}

export function createIncrementalThreadGrouper() {
  let cache: Cache | null = null;

  const reset = () => {
    cache = null;
  };

  const update = (
    items: ConversationItem[],
    mode: CollapseMode,
    overrides: Record<string, boolean>,
  ): ThreadGrouping => {
    if (!cache || cache.mode !== mode || cache.overrides !== overrides) {
      const grouping = buildThreadGroups(items, mode, overrides);
      cache = {
        items,
        mode,
        overrides,
        grouping,
        suffixIds: [],
        stablePrefixItemCount: findStablePrefixItemCount(items),
      };
      return grouping;
    }

    if (cache.items === items) {
      return cache.grouping;
    }

    const rebuildStart = Math.min(
      cache.stablePrefixItemCount,
      findStablePrefixItemCount(items),
    );
    if (
      items.length < rebuildStart ||
      (rebuildStart > 0 &&
        cache.items[rebuildStart - 1] !== items[rebuildStart - 1])
    ) {
      const grouping = buildThreadGroups(items, mode, overrides);
      cache = {
        items,
        mode,
        overrides,
        grouping,
        suffixIds: [],
        stablePrefixItemCount: findStablePrefixItemCount(items),
      };
      return grouping;
    }

    const prefixRowCount = getPrefixRowCount(
      cache.grouping,
      items,
      rebuildStart,
    );
    const suffixGrouping = buildThreadGroups(
      items.slice(rebuildStart),
      mode,
      overrides,
    );

    const rows = [
      ...cache.grouping.rows.slice(0, prefixRowCount),
      ...suffixGrouping.rows,
    ];
    const keepMounted = [
      ...cache.grouping.keepMounted.filter((idx) => idx < prefixRowCount),
      ...suffixGrouping.keepMounted.map((idx) => idx + prefixRowCount),
    ];
    const idToRowIndex = cache.grouping.idToRowIndex;
    for (const id of cache.suffixIds) {
      idToRowIndex.delete(id);
    }

    const suffixIds: string[] = [];
    for (const [id, idx] of suffixGrouping.idToRowIndex) {
      idToRowIndex.set(id, idx + prefixRowCount);
      suffixIds.push(id);
    }

    const grouping = { rows, keepMounted, idToRowIndex };
    cache = {
      items,
      mode,
      overrides,
      grouping,
      suffixIds,
      stablePrefixItemCount: findStablePrefixItemCount(items),
    };
    return grouping;
  };

  return { update, reset };
}

function findStablePrefixItemCount(items: ConversationItem[]): number {
  let count = items.length;
  while (count > 0) {
    const item = items[count - 1];
    if (item.type !== "session_update" || item.turnContext.turnComplete) {
      break;
    }
    count--;
  }
  return count;
}

function getPrefixRowCount(
  grouping: ThreadGrouping,
  items: ConversationItem[],
  rebuildStart: number,
): number {
  if (rebuildStart === 0) return 0;

  const boundaryItem = items[rebuildStart];
  const boundaryRowIndex = boundaryItem
    ? grouping.idToRowIndex.get(boundaryItem.id)
    : undefined;
  if (boundaryRowIndex !== undefined) return boundaryRowIndex;

  const lastPrefixItem = items[rebuildStart - 1];
  const lastPrefixRowIndex = lastPrefixItem
    ? grouping.idToRowIndex.get(lastPrefixItem.id)
    : undefined;
  return lastPrefixRowIndex === undefined ? 0 : lastPrefixRowIndex + 1;
}
