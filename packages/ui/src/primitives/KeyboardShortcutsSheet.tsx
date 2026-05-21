import { Keycap } from "./Keycap";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { Box, Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  CATEGORY_LABELS,
  type ConfigurableShortcutId,
  formatHotkeyParts,
  getShortcutsByCategory,
  type ShortcutCategory,
} from "../features/command/keyboard-shortcuts";
import { useKeybindingsStore } from "../shell/keybindingsStore";

interface KeyboardShortcutsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsSheet({
  open,
  onOpenChange,
}: KeyboardShortcutsSheetProps) {
  useHotkeys("escape", () => onOpenChange(false), {
    enabled: open,
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxWidth="600px"
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-h-[80vh] overflow-hidden"
      >
        <Flex align="start" justify="between" className="relative">
          <ShortcutsHeader />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 cursor-pointer [all:unset]"
          >
            <Keycap label="Esc" size="sm" />
          </button>
        </Flex>

        <Box className="max-h-[calc(80vh-120px)] overflow-y-auto pr-[8px]">
          <KeyboardShortcutsList />
        </Box>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ShortcutsHeader() {
  const triggerParts = formatHotkeyParts("mod+/");

  return (
    <Box mb="4">
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

export function KeyboardShortcutsList() {
  const shortcutsByCategory = useMemo(() => getShortcutsByCategory(), []);
  const hasCustomBindings = useKeybindingsStore((s) =>
    Object.keys(s.customKeybindings).some(
      (k) =>
        (s.customKeybindings[k as ConfigurableShortcutId]?.length ?? 0) > 0,
    ),
  );
  const resetAll = useKeybindingsStore((s) => s.resetAll);

  const categoryOrder: ShortcutCategory[] = [
    "general",
    "navigation",
    "panels",
    "editor",
  ];

  return (
    <Flex direction="column" gap="5">
      {categoryOrder.map((category) => {
        const shortcuts = shortcutsByCategory[category];
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
                  px="3"
                  className="group border-b border-b-(--gray-4) pt-[6px] pb-[6px] last:border-b-0 odd:bg-(--gray-2) even:bg-(--gray-1)"
                >
                  <Flex direction="column" gap="0">
                    <Text className="text-sm">{shortcut.description}</Text>
                    {shortcut.context && (
                      <Text color="gray" className="text-[11px]">
                        {shortcut.context}
                      </Text>
                    )}
                  </Flex>
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
                </Flex>
              ))}
            </Box>
          </Flex>
        );
      })}

      {hasCustomBindings && (
        <Flex justify="end">
          <Button
            variant="soft"
            color="gray"
            size="1"
            onClick={resetAll}
            className="cursor-pointer"
          >
            Reset all shortcuts to defaults
          </Button>
        </Flex>
      )}
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
  if (!alternateKeys) {
    return <SingleShortcutKeys keys={keys} />;
  }

  return (
    <Flex gap="1" align="center">
      <SingleShortcutKeys keys={keys} />
      <Text color="gray" className="text-[13px]">
        or
      </Text>
      <SingleShortcutKeys keys={alternateKeys} />
    </Flex>
  );
}
