import { Keycap } from "./Keycap";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { Tooltip } from "./Tooltip";
import { useShortcut } from "./hooks/useShortcut";
import { Box, Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useCallback, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  CATEGORY_LABELS,
  type ConfigurableShortcutId,
  formatHotkeyParts,
  getShortcutsByCategory,
  type KeyboardShortcut,
  type ShortcutCategory,
} from "../features/command/keyboard-shortcuts";
import {
  resolveKey,
  splitBindings,
  useKeybindingsStore,
} from "../shell/keybindingsStore";

interface KeyboardShortcutsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ComboSearch {
  combo: string;
  isPartial: boolean;
}

const CATEGORY_ORDER: ShortcutCategory[] = [
  "general",
  "navigation",
  "panels",
  "editor",
];

function eventToSearchCombo(e: KeyboardEvent): ComboSearch | null {
  const isModifierKey = ["Meta", "Control", "Shift", "Alt"].includes(e.key);
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
  if (!hasModifier) return null;

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  if (!isModifierKey) {
    parts.push(e.key.toLowerCase().replace(/^arrow/, ""));
    return { combo: parts.join("+"), isPartial: false };
  }
  return parts.length > 0 ? { combo: parts.join("+"), isPartial: true } : null;
}

function shortcutMatchesText(
  shortcut: KeyboardShortcut,
  query: string,
): boolean {
  const q = query.toLowerCase();
  return (
    shortcut.description.toLowerCase().includes(q) ||
    (shortcut.context?.toLowerCase().includes(q) ?? false)
  );
}

function shortcutMatchesCombo(
  shortcut: KeyboardShortcut,
  customKeybindings: Partial<Record<ConfigurableShortcutId, string[]>>,
  { combo, isPartial }: ComboSearch,
): boolean {
  let bindingStr: string;
  if (shortcut.configurable) {
    bindingStr = resolveKey(
      customKeybindings,
      shortcut.id as ConfigurableShortcutId,
    );
  } else {
    bindingStr = shortcut.keys;
    if (shortcut.alternateKeys) bindingStr += `,${shortcut.alternateKeys}`;
  }
  return splitBindings(bindingStr).some((b) =>
    isPartial ? b === combo || b.startsWith(`${combo}+`) : b === combo,
  );
}

interface ShortcutsSearchBarProps {
  searchText: string;
  comboSearch: ComboSearch | null;
  onTextChange: (text: string) => void;
  onComboChange: (combo: ComboSearch | null) => void;
  onClear: () => void;
}

function ShortcutsSearchBar({
  searchText,
  comboSearch,
  onTextChange,
  onComboChange,
  onClear,
}: ShortcutsSearchBarProps) {
  const isComboMode = comboSearch !== null;
  const parts = comboSearch ? formatHotkeyParts(comboSearch.combo) : [];
  const hasContent = isComboMode || searchText.length > 0;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const inComboMode = comboSearch !== null;

      if (e.key === "Escape") {
        if (comboSearch) {
          e.preventDefault();
          onComboChange(null);
          return;
        }
        if (searchText) {
          e.preventDefault();
          onTextChange("");
          return;
        }
        return;
      }

      // Backspace in combo mode clears the combo search.
      if (e.key === "Backspace" && inComboMode) {
        e.preventDefault();
        onComboChange(null);
        return;
      }

      const result = eventToSearchCombo(e.nativeEvent);
      if (result) {
        e.preventDefault();
        if (!result.isPartial) onTextChange("");
        onComboChange(result);
        return;
      }

      // Typing a regular character in combo mode exits combo mode and starts text search.
      if (inComboMode && e.key.length === 1) {
        e.preventDefault();
        onComboChange(null);
        onTextChange(e.key);
      }
    },
    [comboSearch, searchText, onComboChange, onTextChange],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!comboSearch?.isPartial) return;
      onComboChange(eventToSearchCombo(e.nativeEvent));
    },
    [comboSearch, onComboChange],
  );

  return (
    <div className="relative mb-3 shrink-0">
      <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-(--gray-9)">
        <svg
          aria-hidden="true"
          fill="none"
          height="14"
          viewBox="0 0 15 15"
          width="14"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            clipRule="evenodd"
            d="M10 6.5C10 8.433 8.433 10 6.5 10C4.567 10 3 8.433 3 6.5C3 4.567 4.567 3 6.5 3C8.433 3 10 4.567 10 6.5ZM9.303 10.01C8.536 10.632 7.561 11 6.5 11C4.015 11 2 8.985 2 6.5C2 4.015 4.015 2 6.5 2C8.985 2 11 4.015 11 6.5C11 7.561 10.632 8.536 10.01 9.303L12.853 12.147C13.049 12.342 13.049 12.659 12.853 12.854C12.658 13.049 12.341 13.049 12.146 12.854L9.303 10.01Z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
      </div>

      <input
        // biome-ignore lint/a11y/noAutofocus: search bar should be focused when the shortcuts sheet opens
        autoFocus
        className={`w-full rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) py-1.5 pl-8 text-(--gray-12) text-[13px] outline-none placeholder:text-(--gray-9) focus:border-(--accent-7) focus:ring-(--accent-6) focus:ring-1 ${isComboMode ? "caret-transparent" : ""} ${hasContent ? "pr-8" : "pr-3"}`}
        onChange={(e) => {
          if (!isComboMode) onTextChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        placeholder={isComboMode ? "" : "Search by name or press a key combo…"}
        type="text"
        value={isComboMode ? "" : searchText}
      />

      {isComboMode && (
        <div className="pointer-events-none absolute inset-y-0 left-8 flex items-center gap-[3px] pr-8">
          {parts.map((part) => (
            <Keycap key={part} label={part} />
          ))}
          {comboSearch.isPartial && (
            <Text className="animate-pulse text-(--gray-9) text-[11px]">…</Text>
          )}
        </div>
      )}

      {hasContent && (
        <button
          aria-label="Clear search"
          className="-translate-y-1/2 absolute top-1/2 right-2 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-(--gray-5) text-(--gray-11) text-[10px] hover:bg-(--gray-6)"
          onClick={onClear}
          type="button"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function KeyboardShortcutsSheet({
  open,
  onOpenChange,
}: KeyboardShortcutsSheetProps) {
  const [searchText, setSearchText] = useState("");
  const [comboSearch, setComboSearch] = useState<ComboSearch | null>(null);

  const clearSearch = useCallback(() => {
    setSearchText("");
    setComboSearch(null);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchText("");
        setComboSearch(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange],
  );

  // Escape closes the modal only when the search bar has nothing to clear.
  useHotkeys("escape", () => handleOpenChange(false), {
    enabled: open && !searchText && !comboSearch,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        maxWidth="600px"
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="!pb-0 flex max-h-[80vh] flex-col overflow-hidden"
      >
        <Flex align="start" justify="between" className="shrink-0 pb-1">
          <ShortcutsHeader />
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="shrink-0 cursor-pointer [all:unset]"
          >
            <Keycap label="Esc" />
          </button>
        </Flex>

        <ShortcutsSearchBar
          searchText={searchText}
          comboSearch={comboSearch}
          onTextChange={setSearchText}
          onComboChange={setComboSearch}
          onClear={clearSearch}
        />

        <Box className="min-h-0 flex-1 overflow-y-auto pr-[8px]">
          <KeyboardShortcutsList
            searchText={searchText}
            comboSearch={comboSearch}
          />
          {/* Bottom padding so list content doesn't sit behind the sticky footer */}
          <Box className="h-[56px]" />
        </Box>

        <ResetAllFooter />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ResetAllFooter() {
  const hasCustomBindings = useKeybindingsStore((s) =>
    Object.keys(s.customKeybindings).some(
      (k) =>
        (s.customKeybindings[k as ConfigurableShortcutId]?.length ?? 0) > 0,
    ),
  );
  const resetAll = useKeybindingsStore((s) => s.resetAll);

  if (!hasCustomBindings) return null;

  return (
    <Flex
      justify="center"
      align="center"
      className="shrink-0 border-(--gray-4) border-t py-3"
    >
      <Button
        variant="ghost"
        color="gray"
        size="1"
        onClick={resetAll}
        className="cursor-pointer"
      >
        Reset all shortcuts to defaults
      </Button>
    </Flex>
  );
}

function ShortcutsHeader() {
  const shortcutsKey = useShortcut("shortcuts");
  const triggerParts = formatHotkeyParts(shortcutsKey);

  return (
    <Box mb="2">
      <Flex align="center" gap="3" mb="1">
        <Dialog.Title mb="0" className="text-2xl leading-[1.2]">
          Keyboard Combos
        </Dialog.Title>
        <Flex gap="1" align="center">
          {triggerParts.map((part) => (
            <Keycap key={part} label={part} />
          ))}
        </Flex>
      </Flex>
      <Text color="gray" className="text-sm">
        Your cheat codes for shipping faster
      </Text>
    </Box>
  );
}

interface KeyboardShortcutsListProps {
  searchText?: string;
  comboSearch?: ComboSearch | null;
}

export function KeyboardShortcutsList({
  searchText = "",
  comboSearch = null,
}: KeyboardShortcutsListProps = {}) {
  const customKeybindings = useKeybindingsStore((s) => s.customKeybindings);

  const filteredByCategory = useMemo(() => {
    const base = getShortcutsByCategory();
    if (!searchText && !comboSearch) return base;

    const result: Record<ShortcutCategory, KeyboardShortcut[]> = {
      general: [],
      navigation: [],
      panels: [],
      editor: [],
    };
    for (const category of CATEGORY_ORDER) {
      result[category] = base[category].filter((shortcut) =>
        comboSearch
          ? shortcutMatchesCombo(shortcut, customKeybindings, comboSearch)
          : shortcutMatchesText(shortcut, searchText),
      );
    }
    return result;
  }, [searchText, comboSearch, customKeybindings]);

  const hasResults = CATEGORY_ORDER.some(
    (c) => filteredByCategory[c].length > 0,
  );

  if (!hasResults && (searchText || comboSearch)) {
    return (
      <Flex align="center" justify="center" py="6">
        <Text color="gray" className="text-sm">
          No shortcuts found
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="5">
      {CATEGORY_ORDER.map((category) => {
        const shortcuts = filteredByCategory[category];
        if (shortcuts.length === 0) return null;

        const uniqueShortcuts = shortcuts.reduce(
          (acc, shortcut) => {
            const existing = acc.find(
              (s) => s.description === shortcut.description,
            );
            if (!existing) {
              acc.push(shortcut);
            }
            return acc;
          },
          [] as typeof shortcuts,
        );

        return (
          <Flex key={category} direction="column" gap="2">
            <Text color="gray" className="font-bold text-base">
              {CATEGORY_LABELS[category]}
            </Text>
            <Box className="overflow-hidden rounded-(--radius-2) border border-(--gray-5)">
              {uniqueShortcuts.map((shortcut) => (
                <Flex
                  key={shortcut.id}
                  align="center"
                  justify="between"
                  gap="3"
                  px="3"
                  className="group border-b border-b-(--gray-4) pt-[6px] pb-[6px] last:border-b-0 odd:bg-(--gray-2) even:bg-(--gray-1)"
                >
                  <Flex direction="column" gap="0" className="min-w-0 flex-1">
                    <Text className="text-sm">{shortcut.description}</Text>
                    {shortcut.context && (
                      <Text color="gray" className="text-[11px]">
                        {shortcut.context}
                      </Text>
                    )}
                  </Flex>
                  <div className="shrink-0">
                    {shortcut.configurable ? (
                      <ShortcutRecorder
                        id={shortcut.id as ConfigurableShortcutId}
                      />
                    ) : (
                      <ShortcutKeys
                        keys={shortcut.keys}
                        alternateKeys={shortcut.alternateKeys}
                      />
                    )}
                  </div>
                </Flex>
              ))}
            </Box>
          </Flex>
        );
      })}
    </Flex>
  );
}

function SingleShortcutKeys({ keys }: { keys: string }) {
  const parts = formatHotkeyParts(keys);
  return (
    <Flex gap="1" align="center">
      {parts.map((part) => (
        <Keycap key={part} label={part} />
      ))}
    </Flex>
  );
}

function ShortcutKeys({
  keys,
  alternateKeys,
}: {
  keys: string;
  alternateKeys?: string;
}) {
  const inner = alternateKeys ? (
    <Flex gap="1" align="center">
      <SingleShortcutKeys keys={keys} />
      <Text color="gray" className="text-[13px]">
        or
      </Text>
      <SingleShortcutKeys keys={alternateKeys} />
    </Flex>
  ) : (
    <SingleShortcutKeys keys={keys} />
  );

  return (
    <Tooltip
      content="This shortcut cannot be customized"
      side="left"
      delayDuration={400}
    >
      <div className="cursor-default rounded-(--radius-1) p-[2px] transition-colors hover:bg-(--gray-4)">
        {inner}
      </div>
    </Tooltip>
  );
}
