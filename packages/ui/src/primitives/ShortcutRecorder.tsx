import { Keycap } from "./Keycap";
import { ArrowCounterClockwise, Plus, X } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import {
  type ConfigurableShortcutId,
  formatHotkeyParts,
  KEYBOARD_SHORTCUTS,
} from "../features/command/keyboard-shortcuts";
import { findConflict, useKeybindingsStore } from "../shell/keybindingsStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function captureCombo(e: KeyboardEvent): string | null {
  const bare = ["Meta", "Control", "Shift", "Alt"];
  if (bare.includes(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  const key = e.key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

interface RecordingInputProps {
  onCapture: (combo: string) => void;
  onCancel: () => void;
}

function RecordingInput({ onCapture, onCancel }: RecordingInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      const combo = captureCombo(e.nativeEvent);
      if (combo) onCapture(combo);
    },
    [onCapture, onCancel],
  );

  return (
    <input
      ref={ref}
      type="text"
      readOnly
      aria-label="Press new shortcut"
      placeholder="Press shortcut…"
      value=""
      onChange={() => {}}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      className="h-[28px] min-w-[120px] cursor-text rounded-[6px] border border-(--accent-8) bg-(--accent-2) px-2 text-center text-(--accent-11) text-[12px] outline-none ring-(--accent-8) ring-1 placeholder:text-(--accent-11)"
    />
  );
}

interface ShortcutRecorderProps {
  id: ConfigurableShortcutId;
}

export function ShortcutRecorder({ id }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const customs = useKeybindingsStore((s) => s.customKeybindings[id] ?? []);
  const addKeybinding = useKeybindingsStore((s) => s.addKeybinding);
  const removeKeybinding = useKeybindingsStore((s) => s.removeKeybinding);
  const resetShortcut = useKeybindingsStore((s) => s.resetShortcut);
  const hasCustom = customs.length > 0;

  const shortcutEntry = KEYBOARD_SHORTCUTS.find((s) => s.id === id);

  const handleCapture = useCallback(
    (combo: string) => {
      const conflict = findConflict(combo, id);
      if (conflict) {
        const conflictEntry = KEYBOARD_SHORTCUTS.find((s) => s.id === conflict);
        toast.error(
          `Already used by "${conflictEntry?.description ?? conflict}"`,
        );
        setRecording(false);
        return;
      }
      addKeybinding(id, combo);
      setRecording(false);
    },
    [id, addKeybinding],
  );

  if (!shortcutEntry) return null;

  return (
    <Flex gap="1" align="center">
      {recording ? (
        <RecordingInput
          onCapture={handleCapture}
          onCancel={() => setRecording(false)}
        />
      ) : hasCustom ? (
        customs.map((key, i) => (
          <Flex key={key} gap="1" align="center">
            {i > 0 && (
              <Text color="gray" className="text-[11px]">
                or
              </Text>
            )}
            <Flex gap="1" align="center">
              {formatHotkeyParts(key).map((part) => (
                <Keycap key={part} label={part} />
              ))}
              <button
                type="button"
                title="Remove binding"
                onClick={() => removeKeybinding(id, key)}
                className="ml-[2px] flex cursor-pointer items-center justify-center rounded-full p-[2px] text-(--gray-9) opacity-0 transition-opacity hover:text-(--gray-12) group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </Flex>
          </Flex>
        ))
      ) : (
        <DefaultKeys shortcutEntry={shortcutEntry} />
      )}

      {!recording && (
        <button
          type="button"
          title="Add binding"
          onClick={() => setRecording(true)}
          className="ml-[2px] flex cursor-pointer items-center justify-center rounded-full p-[2px] text-(--gray-8) opacity-0 transition-opacity hover:text-(--gray-12) group-hover:opacity-100"
        >
          <Plus size={10} />
        </button>
      )}

      {hasCustom && !recording && (
        <button
          type="button"
          title="Reset to default"
          onClick={() => resetShortcut(id)}
          className="flex cursor-pointer items-center justify-center rounded-full p-[2px] text-(--gray-8) opacity-0 transition-opacity hover:text-(--gray-12) group-hover:opacity-100"
        >
          <ArrowCounterClockwise size={10} />
        </button>
      )}
    </Flex>
  );
}

function DefaultKeys({
  shortcutEntry,
}: {
  shortcutEntry: (typeof KEYBOARD_SHORTCUTS)[number];
}) {
  const primaryParts = formatHotkeyParts(shortcutEntry.keys);
  const alternateParts = shortcutEntry.alternateKeys
    ? formatHotkeyParts(shortcutEntry.alternateKeys)
    : null;

  return (
    <Flex gap="1" align="center">
      <Flex gap="1" align="center">
        {primaryParts.map((part) => (
          <Keycap key={part} label={part} />
        ))}
      </Flex>
      {alternateParts && (
        <>
          <Text color="gray" className="text-[11px]">
            or
          </Text>
          <Flex gap="1" align="center">
            {alternateParts.map((part) => (
              <Keycap key={part} label={part} />
            ))}
          </Flex>
        </>
      )}
    </Flex>
  );
}
