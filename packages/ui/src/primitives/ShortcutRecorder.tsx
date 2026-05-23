import { Keycap } from "./Keycap";
import { Tooltip } from "./Tooltip";
import { ContextMenu, Flex, Text } from "@radix-ui/themes";
import {
  type ConfigurableShortcutId,
  DEFAULT_KEYBINDINGS,
  eventToCombo,
  formatHotkeyParts,
  KEYBOARD_SHORTCUTS,
} from "../features/command/keyboard-shortcuts";
import {
  findConflict,
  MAX_CUSTOM_BINDINGS,
  splitBindings,
  useKeybindingsStore,
} from "../shell/keybindingsStore";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Key capture
// ---------------------------------------------------------------------------

function formatComboLabel(combo: string): string {
  return formatHotkeyParts(combo).join("+");
}

// ---------------------------------------------------------------------------
// Recording modal
// ---------------------------------------------------------------------------

interface RecordingModalProps {
  commandLabel: string;
  /** null = adding a new binding, string = the binding key being edited */
  editingKey: string | null;
  shortcutId: ConfigurableShortcutId;
  onClose: () => void;
}

export function ShortcutRecordingModal({
  commandLabel,
  editingKey,
  shortcutId,
  onClose,
}: RecordingModalProps) {
  const addKeybinding = useKeybindingsStore((s) => s.addKeybinding);
  const updateKeybinding = useKeybindingsStore((s) => s.updateKeybinding);
  const [captured, setCaptured] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  // Capture at the window level — no focus required on the input element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Enter") {
        if (captured && !conflict) {
          if (editingKey) {
            updateKeybinding(shortcutId, editingKey, captured);
          } else {
            addKeybinding(shortcutId, captured);
          }
          onClose();
        }
        return;
      }

      const combo = eventToCombo(e);
      if (!combo) return;

      const result = findConflict(combo, shortcutId);
      if (result.description) {
        setConflict(result.description);
        setCaptured(combo);
      } else {
        setConflict(null);
        setCaptured(combo);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [
    captured,
    conflict,
    editingKey,
    shortcutId,
    addKeybinding,
    updateKeybinding,
    onClose,
  ]);

  const isAdding = editingKey === null;
  const title = isAdding
    ? `Add new binding for "${commandLabel}"`
    : `Edit binding for "${commandLabel}"`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss pattern — not an interactive widget
    <div
      role="presentation"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backdropFilter: "blur(2px)",
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[360px] overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
        <div className="border-(--gray-4) border-b px-4 py-3">
          <Text className="font-medium text-(--gray-12) text-[13px]">
            {title}
          </Text>
        </div>

        <div className="px-4 py-4">
          {/* Visual input — display only; actual capture happens via window listener */}
          <div
            className={`w-full select-none rounded-(--radius-2) border px-3 py-2 text-center text-[13px] transition-colors ${
              conflict
                ? "border-(--amber-7) bg-(--amber-2) text-(--amber-11) ring-(--amber-6) ring-1"
                : captured
                  ? "border-(--accent-7) bg-(--accent-2) text-(--accent-11) ring-(--accent-6) ring-1"
                  : "border-(--gray-5) bg-(--gray-2) text-(--gray-10)"
            }`}
          >
            {captured ? (
              formatComboLabel(captured)
            ) : (
              <span className="text-(--gray-9)">
                Press a key combination...
              </span>
            )}
          </div>
          {conflict ? (
            <Text className="mt-2 block text-center text-(--amber-11) text-[11px]">
              Conflicts with &quot;{conflict}&quot; — press a different
              combination
            </Text>
          ) : captured ? (
            <Text className="mt-2 block text-center text-(--gray-10) text-[11px]">
              Press Enter to confirm, Escape to cancel
            </Text>
          ) : (
            <Text className="mt-2 block text-center text-(--gray-9) text-[11px]">
              Press Escape to cancel
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Binding chip — single keycap group with click + right-click
// ---------------------------------------------------------------------------

type RecordingMode = { type: "add" } | { type: "edit"; key: string } | null;

interface BindingChipProps {
  combo: string;
  commandLabel: string;
  canRemove: boolean;
  canAddMore: boolean;
  isAtDefault: boolean;
  onStartRecording: (mode: RecordingMode) => void;
  onRemove: () => void;
  onReset: () => void;
}

function BindingChip({
  combo,
  commandLabel,
  canRemove,
  canAddMore,
  isAtDefault,
  onStartRecording,
  onRemove,
  onReset,
}: BindingChipProps) {
  const parts = formatHotkeyParts(combo);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <button
          type="button"
          title={`Click to edit binding for "${commandLabel}"`}
          onClick={() => onStartRecording({ type: "edit", key: combo })}
          className="flex cursor-pointer items-center gap-[3px] rounded-(--radius-1) p-[2px] transition-colors hover:bg-(--gray-4)"
        >
          {parts.map((part) => (
            <Keycap key={part} label={part} />
          ))}
        </button>
      </ContextMenu.Trigger>

      <ContextMenu.Content size="1">
        <ContextMenu.Item
          onClick={() => onStartRecording({ type: "edit", key: combo })}
        >
          Edit binding
        </ContextMenu.Item>
        {canAddMore && (
          <ContextMenu.Item onClick={() => onStartRecording({ type: "add" })}>
            Add another binding
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        {canRemove ? (
          <ContextMenu.Item color="red" onClick={onRemove}>
            Remove binding
          </ContextMenu.Item>
        ) : (
          <Tooltip
            content="Cannot remove the only binding for a shortcut"
            side="left"
          >
            <span>
              <ContextMenu.Item disabled className="cursor-default!">
                Remove binding
              </ContextMenu.Item>
            </span>
          </Tooltip>
        )}
        {isAtDefault ? (
          <Tooltip content="Already using the default binding" side="left">
            <span>
              <ContextMenu.Item disabled className="cursor-default!">
                Reset to default
              </ContextMenu.Item>
            </span>
          </Tooltip>
        ) : (
          <ContextMenu.Item onClick={onReset}>
            Reset to default
          </ContextMenu.Item>
        )}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

// ---------------------------------------------------------------------------
// ShortcutRecorder — main export
// ---------------------------------------------------------------------------

interface ShortcutRecorderProps {
  id: ConfigurableShortcutId;
  onRecordingChange?: (recording: boolean) => void;
}

export function ShortcutRecorder({
  id,
  onRecordingChange,
}: ShortcutRecorderProps) {
  const [recordingMode, setRecordingMode] = useState<RecordingMode>(null);
  const customs = useKeybindingsStore((s) => s.customKeybindings[id] ?? []);
  const removeKeybinding = useKeybindingsStore((s) => s.removeKeybinding);
  const resetShortcut = useKeybindingsStore((s) => s.resetShortcut);
  const addKeybinding = useKeybindingsStore((s) => s.addKeybinding);
  const hasCustom = customs.length > 0;

  const shortcutEntry = KEYBOARD_SHORTCUTS.find((s) => s.id === id);

  // The effective list of individual binding strings to render as chips.
  // When customised: use custom array. When at default: split the default
  // string (e.g. "mod+n,mod+t" → ["mod+n","mod+t"]) so each chip is independent.
  const defaultBindings = splitBindings(DEFAULT_KEYBINDINGS[id]);
  const effectiveBindings = hasCustom ? customs : defaultBindings;
  // canAddMore is based on custom count only — defaults don't consume the budget.
  // A user can always add a first custom binding even if there are 2 defaults.
  const canAddMore = customs.length < MAX_CUSTOM_BINDINGS;

  const startRecording = useCallback(
    (mode: RecordingMode) => {
      setRecordingMode(mode);
      onRecordingChange?.(true);
    },
    [onRecordingChange],
  );

  const stopRecording = useCallback(() => {
    setRecordingMode(null);
    onRecordingChange?.(false);
  }, [onRecordingChange]);

  // Removing a default binding: store the remaining defaults as custom bindings.
  const handleRemoveDefault = useCallback(
    (key: string) => {
      const remaining = defaultBindings.filter((k) => k !== key);
      resetShortcut(id);
      for (const k of remaining) {
        addKeybinding(id, k);
      }
    },
    [id, defaultBindings, resetShortcut, addKeybinding],
  );

  if (!shortcutEntry) return null;

  const commandLabel = shortcutEntry.description;
  const isAtDefault = !hasCustom;

  return (
    <>
      {recordingMode !== null && (
        <ShortcutRecordingModal
          commandLabel={commandLabel}
          editingKey={recordingMode.type === "edit" ? recordingMode.key : null}
          shortcutId={id}
          onClose={stopRecording}
        />
      )}

      {/* Horizontal scroll container — hides overflow without showing a scrollbar */}
      <div className="flex min-w-0 shrink-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Flex gap="1" align="center" className="shrink-0">
          {effectiveBindings.map((key, i) => (
            <Flex key={key} gap="1" align="center" className="shrink-0">
              {i > 0 && (
                <Text color="gray" className="shrink-0 text-[11px]">
                  or
                </Text>
              )}
              <BindingChip
                combo={key}
                commandLabel={commandLabel}
                canRemove={effectiveBindings.length > 1}
                canAddMore={canAddMore}
                isAtDefault={isAtDefault}
                onStartRecording={startRecording}
                onRemove={
                  hasCustom
                    ? () => removeKeybinding(id, key)
                    : () => handleRemoveDefault(key)
                }
                onReset={() => resetShortcut(id)}
              />
            </Flex>
          ))}
        </Flex>
      </div>
    </>
  );
}
