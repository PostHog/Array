import { CommandKeyHints } from "../../command/CommandKeyHints";
import type { ConversationItem } from "./buildConversationItems";
import { ChatText } from "@phosphor-icons/react";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  Dialog,
  DialogContent,
} from "@posthog/quill";
import { Flex } from "@radix-ui/themes";
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

  useEffect(() => {
    if (!open) {
      setQuery("");
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

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) =>
      entry.fullText.toLowerCase().includes(normalizedQuery),
    );
  }, [entries, query]);

  const allEntries = visibleEntries;

  const handleSelect = useCallback(
    (id: string | null) => {
      if (id === null) return;
      const entry = allEntries.find((e) => e.id === id);
      if (!entry) return;
      onJumpToIndex(entry.index);
      onOpenChange(false);
    },
    [allEntries, onJumpToIndex, onOpenChange],
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
          <AutocompleteList className="max-h-[60vh] pt-1">
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
            {visibleEntries.length} messages
          </span>
          <CommandKeyHints />
        </Flex>
      </DialogContent>
    </Dialog>
  );
}
