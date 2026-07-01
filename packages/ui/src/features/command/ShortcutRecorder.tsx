import { Keycap } from "@posthog/ui/primitives/Keycap";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  findConflict,
  MAX_CUSTOM_BINDINGS,
  splitBindings,
  useKeybindingsStore,
} from "@posthog/ui/shell/keybindingsStore";
import { ContextMenu, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConfigurableShortcutId,
  DEFAULT_KEYBINDINGS,
  formatHotkeyParts,
  KEYBOARD_SHORTCUTS,
  recordingEventToCombo,
} from "./keyboard-shortcuts";

// Pencil SVG icon (16×16)
function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      viewBox="0 0 16 16"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81 3.558 11H3.75v.25h.25v-.192l6.19-6.19.999.999v-.617ZM2.979 12.971l-.929 3.251.93-.266 2.321-.666V15h-.25v-.25H4.8l-.25.25h-.25v-.25l.25-.25V14h.25v.25l-.25.25H4.3v.25h-.25l.25-.25h.25v.25l-2 .571.571-2h.25v.25h-.25v-.25h.25v.25l-.25.25-.25-.25v-.25h.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface InlineRecorderProps {
  shortcutId: ConfigurableShortcutId;
  onSave: (combo: string) => void;
  onCancel: () => void;
}

function InlineRecorder({ shortcutId, onSave, onCancel }: InlineRecorderProps) {
  const [captured, setCaptured] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        if (captured && !conflict) onSave(captured);
        return;
      }

      const result = recordingEventToCombo(e);
      if (!result) return;

      if (result.isPartial) {
        setPartial(result.combo);
        setCaptured(null);
        setConflict(null);
      } else {
        setPartial(null);
        const { description } = findConflict(result.combo, shortcutId);
        setCaptured(result.combo);
        setConflict(description);
      }
    };

    const keyupHandler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        setPartial(null);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("keyup", keyupHandler);
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("keyup", keyupHandler);
    };
  }, [captured, conflict, shortcutId, onSave, onCancel]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  const displayCombo = partial ?? captured;
  const displayParts = displayCombo ? formatHotkeyParts(displayCombo) : null;

  return (
    <div ref={containerRef} className="flex w-full flex-col">
      <div
        className={`flex min-h-[28px] items-center justify-center gap-[3px] rounded-(--radius-2) border px-2 py-[3px] ${
          conflict
            ? "border-(--amber-7) bg-(--amber-2) ring-(--amber-6) ring-1"
            : "border-(--accent-7) bg-(--accent-2) ring-(--accent-6) ring-1"
        }`}
      >
        {displayParts ? (
          <Flex gap="1" align="center" justify="center">
            {displayParts.map((part) => (
              <Keycap key={part} label={part} size="sm" />
            ))}
            {partial && (
              <span className="animate-pulse text-(--gray-10) text-sm">…</span>
            )}
          </Flex>
        ) : (
          <span className="text-center text-(--gray-9) text-[11px]">
            Press a key combination...
          </span>
        )}
      </div>
      {conflict ? (
        <Text className="mt-1 block text-center text-(--amber-11) text-[10px]">
          Conflicts with &quot;{conflict}&quot;.
        </Text>
      ) : (
        <Text className="mt-1 block text-center text-(--gray-10) text-[10px]">
          Press Enter to save · Escape to cancel
        </Text>
      )}
    </div>
  );
}

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
          className="group/chip flex cursor-pointer items-center gap-[2px] rounded-(--radius-1) p-[2px]"
        >
          <span className="flex items-center gap-[3px]">
            {parts.map((part) => (
              <Keycap key={part} label={part} />
            ))}
          </span>
          <span className="text-(--gray-8) opacity-0 transition-opacity group-hover/chip:opacity-100">
            <PencilIcon />
          </span>
        </button>
      </ContextMenu.Trigger>

      <ContextMenu.Content size="1">
        {canAddMore ? (
          <ContextMenu.Item onClick={() => onStartRecording({ type: "add" })}>
            Add another binding
          </ContextMenu.Item>
        ) : (
          <Tooltip
            content={`Maximum of ${MAX_CUSTOM_BINDINGS} bindings per shortcut`}
            side="left"
          >
            <span>
              <ContextMenu.Item disabled className="cursor-default!">
                Add another binding
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
        {canRemove ? (
          <ContextMenu.Item onClick={onRemove}>Remove binding</ContextMenu.Item>
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
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

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
  const updateKeybinding = useKeybindingsStore((s) => s.updateKeybinding);
  const hasCustom = customs.length > 0;

  const shortcutEntry = KEYBOARD_SHORTCUTS.find((s) => s.id === id);

  const defaultBindings = splitBindings(DEFAULT_KEYBINDINGS[id]);
  const effectiveBindings = hasCustom ? customs : defaultBindings;
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

  const handleSave = useCallback(
    (combo: string) => {
      if (recordingMode?.type === "edit") {
        updateKeybinding(id, recordingMode.key, combo);
      } else {
        addKeybinding(id, combo);
      }
      stopRecording();
    },
    [recordingMode, id, updateKeybinding, addKeybinding, stopRecording],
  );

  if (!shortcutEntry) return null;

  const commandLabel = shortcutEntry.description;
  const isAtDefault = !hasCustom;

  // While recording (edit or add), show only the recorder — hide all binding chips
  if (recordingMode !== null) {
    return (
      <InlineRecorder
        shortcutId={id}
        onSave={handleSave}
        onCancel={stopRecording}
      />
    );
  }

  return (
    <div className="flex min-w-0 shrink-0 items-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Flex gap="1" align="center" className="shrink-0">
        {effectiveBindings.map((key, i) => (
          <Flex key={key} gap="1" align="center" className="shrink-0">
            {i > 0 && (
              <Text color="gray" className="mr-[14px] shrink-0 text-sm">
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
  );
}
