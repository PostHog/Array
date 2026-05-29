import { defaultFilter } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";

const DEFAULT_LIMIT = 50;
const MIN_FUZZY_SCORE = 0.1;
const DEBOUNCE_MS = 150;

interface UseComboboxFilterOptions {
  /** Maximum number of items to render. Defaults to 50. */
  limit?: number;
  /** Values pinned to the top regardless of score. */
  pinned?: string[];
  /** Popover open state. Search resets when this becomes false. */
  open?: boolean;
}

interface UseComboboxFilterResult<T> {
  filtered: T[];
  onSearchChange: (value: string) => void;
  hasMore: boolean;
  moreCount: number;
}

/**
 * Fuzzy-filters and caps a list of items for use with Combobox.
 *
 * Prefer passing `items` directly to `Combobox.Content` which handles all
 * wiring automatically. Use this hook directly only when you need custom
 * control over the filtering lifecycle.
 */
export function useComboboxFilter<T>(
  items: T[],
  options?: UseComboboxFilterOptions,
  getValue?: (item: T) => string,
): UseComboboxFilterResult<T> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const pinned = options?.pinned;
  const open = options?.open;
  const [inputValue, setInputValue] = useState("");
  // delay=0 while closed so the next open starts on fresh empty-query results,
  // not a flash of the previous filtered set.
  const search = useDebounce(inputValue, open ? DEBOUNCE_MS : 0);

  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);

  const resolve = useCallback(
    (item: T): string => (getValue ? getValue(item) : String(item)),
    [getValue],
  );

  const { filtered, totalMatches } = useMemo(() => {
    const query = search.trim();

    // Score and filter items. cmdk's fuzzy matcher can produce very low scores
    // for scattered single-character matches (e.g. "vojta" matching v-o-j-t-a
    // across "chore-remoVe-cOhort-Join-aTtempt"), so we require a minimum score
    // to avoid noisy results.
    let scored: Array<{ item: T; score: number }>;
    if (query) {
      scored = [];
      for (const item of items) {
        const score = defaultFilter(resolve(item), query);
        if (score >= MIN_FUZZY_SCORE) scored.push({ item, score });
      }
    } else {
      scored = items.map((item) => ({ item, score: 0 }));
    }

    const total = scored.length;

    // Sort: pinned first (in order), then by score descending (stable for equal scores)
    if (pinned) {
      const pinnedSet = new Set(pinned);
      scored.sort((a, b) => {
        const aVal = resolve(a.item);
        const bVal = resolve(b.item);
        const aPinned = pinnedSet.has(aVal);
        const bPinned = pinnedSet.has(bVal);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        if (aPinned && bPinned) {
          return pinned.indexOf(aVal) - pinned.indexOf(bVal);
        }
        return b.score - a.score;
      });
    } else if (query) {
      scored.sort((a, b) => b.score - a.score);
    }

    return {
      filtered: scored.slice(0, limit).map((s) => s.item),
      totalMatches: total,
    };
  }, [items, search, limit, pinned, resolve]);

  return {
    filtered,
    onSearchChange: setInputValue,
    hasMore: totalMatches > filtered.length,
    moreCount: Math.max(0, totalMatches - filtered.length),
  };
}
