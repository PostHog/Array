import { CommandKeyHints } from "../../command/CommandKeyHints";
import type { ConversationItem } from "./buildConversationItems";
import { CalendarBlank, ChatText, X } from "@phosphor-icons/react";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  Dialog,
  DialogContent,
} from "@posthog/quill";
import { Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";

interface MessageJumpPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ConversationItem[];
  onJumpToIndex: (index: number) => void;
}

interface JumpEntry {
  id: string;
  label: string;
  fullText: string;
  timestamp: number;
  index: number;
}

const MAX_LABEL_LENGTH = 120;

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toLocalDateInputValue(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\n+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}…`;
}

export function MessageJumpPicker({
  open,
  onOpenChange,
  items,
  onJumpToIndex,
}: MessageJumpPickerProps) {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDateFrom("");
      setDateTo("");
    }
  }, [open]);

  const entries = useMemo<JumpEntry[]>(() => {
    const result: JumpEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === "user_message") {
        result.push({
          id: item.id,
          label: truncate(item.content, MAX_LABEL_LENGTH),
          fullText: item.content,
          timestamp: item.timestamp,
          index: i,
        });
      }
    }
    return result;
  }, [items]);

  const dateFilterActive = dateFrom !== "" || dateTo !== "";

  const clearDateFilter = useCallback(() => {
    setDateFrom("");
    setDateTo("");
  }, []);

  const visibleEntries = useMemo(() => {
    let filtered = entries;

    if (dateFrom !== "") {
      const fromMs = startOfDay(dateFrom);
      filtered = filtered.filter((e) => e.timestamp >= fromMs);
    }
    if (dateTo !== "") {
      const toMs = endOfDay(dateTo);
      filtered = filtered.filter((e) => e.timestamp <= toMs);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      filtered = filtered.filter((entry) =>
        entry.fullText.toLowerCase().includes(normalizedQuery),
      );
    }

    return filtered;
  }, [entries, query, dateFrom, dateTo]);

  // Derive min/max from actual message timestamps for date picker bounds
  const { minDate, maxDate } = useMemo(() => {
    if (entries.length === 0) return { minDate: undefined, maxDate: undefined };
    const min = Math.min(...entries.map((e) => e.timestamp));
    const max = Math.max(...entries.map((e) => e.timestamp));
    return {
      minDate: toLocalDateInputValue(min),
      maxDate: toLocalDateInputValue(max),
    };
  }, [entries]);

  const handleSelect = useCallback(
    (id: string | null) => {
      if (id === null) return;
      const entry = visibleEntries.find((e) => e.id === id);
      if (!entry) return;
      onJumpToIndex(entry.index);
      onOpenChange(false);
    },
    [visibleEntries, onJumpToIndex, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-180 max-w-[90vw] gap-0 p-0"
        showCloseButton={false}
      >
        <Autocomplete<JumpEntry>
          inline
          defaultOpen
          items={visibleEntries}
          filter={null}
          value={query}
          autoHighlight="always"
          onValueChange={(val, eventDetails) => {
            if (eventDetails.reason !== "input-change") return;
            if (typeof val === "string") {
              setQuery(val);
            }
          }}
        >
          <Flex align="center" gap="2" className="px-3 pt-2 pb-1">
            <div className="flex-1">
              <AutocompleteInput
                placeholder="Jump to message…"
                autoFocus
                showClear
              />
            </div>
          </Flex>

          {/* Date filter row */}
          <Flex
            align="center"
            gap="2"
            className="border-(--gray-4) border-t px-3 py-1.5"
          >
            <CalendarBlank
              size={13}
              className="shrink-0 text-(--gray-10)"
              weight="regular"
            />
            <span className="text-(--gray-10) text-[12px]">Filter by date</span>
            <Flex align="center" gap="1" className="ml-1">
              <input
                type="date"
                value={dateFrom}
                min={minDate}
                max={dateTo || maxDate}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-[22px] rounded-(--radius-1) border border-(--gray-a5) bg-(--gray-a2) px-1.5 text-(--gray-12) text-[12px] tabular-nums outline-none focus:border-(--accent-8) focus:ring-0"
              />
              <span className="text-(--gray-10) text-[11px]">–</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || minDate}
                max={maxDate}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-[22px] rounded-(--radius-1) border border-(--gray-a5) bg-(--gray-a2) px-1.5 text-(--gray-12) text-[12px] tabular-nums outline-none focus:border-(--accent-8) focus:ring-0"
              />
            </Flex>
            {dateFilterActive && (
              <Tooltip content="Clear date filter">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  className="ml-auto"
                  onClick={clearDateFilter}
                >
                  <X size={11} weight="bold" />
                </IconButton>
              </Tooltip>
            )}
          </Flex>

          <AutocompleteList className="max-h-[55vh] pt-1">
            {(entry: JumpEntry) => (
              <AutocompleteItem
                key={entry.id}
                value={entry.id}
                onClick={() => handleSelect(entry.id)}
                className="group/entry h-auto! min-h-7 py-1.5 text-left"
              >
                <ChatText size={14} className="shrink-0 text-(--gray-11)" />
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  title={entry.fullText}
                >
                  {entry.label}
                </span>
                <span className="shrink-0 text-(--gray-10) text-[11px] tabular-nums opacity-0 transition-opacity group-hover/entry:opacity-100">
                  {formatTimestamp(entry.timestamp)}
                </span>
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </Autocomplete>
        <Flex
          align="center"
          justify="between"
          className="border-(--gray-5) border-t px-3 py-2"
        >
          <span className="text-(--gray-11) text-[12px]">
            {visibleEntries.length}{" "}
            {visibleEntries.length === 1 ? "message" : "messages"}
            {dateFilterActive && (
              <span className="ml-1 text-(--gray-10)">
                (date filter active)
              </span>
            )}
          </span>
          <CommandKeyHints />
        </Flex>
      </DialogContent>
    </Dialog>
  );
}
