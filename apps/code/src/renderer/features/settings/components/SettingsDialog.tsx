import { useSettingsPageStore } from "@features/settings/stores/settingsPageStore";
import type { SettingsCategory } from "@features/settings/types";
import { useEffect, useState } from "react";
import { SettingsPanel } from "./SettingsPanel";

/**
 * Modal/overlay form of the settings UI. Used in pre-router shells (e.g.
 * `AiApprovalScreen`) where the routed `/settings/$category` page isn't
 * available because RouterProvider hasn't mounted yet. Inside the main app,
 * settings is a real route — see `routes/settings/$category.tsx`.
 *
 * Open/close is driven by the embedding component via the imperative
 * `openDialog` / `closeDialog` exports below.
 */

interface DialogState {
  isOpen: boolean;
  category: SettingsCategory;
}

let dialogStateListeners: Array<(state: DialogState) => void> = [];
let currentDialogState: DialogState = { isOpen: false, category: "general" };

function publish(next: DialogState): void {
  currentDialogState = next;
  for (const fn of dialogStateListeners) fn(next);
}

export function openSettingsDialog(
  category: SettingsCategory = "general",
): void {
  publish({ isOpen: true, category });
}

export function closeSettingsDialog(): void {
  useSettingsPageStore.getState().reset();
  publish({ isOpen: false, category: currentDialogState.category });
}

export function useSettingsDialogState(): DialogState {
  const [state, setState] = useState(currentDialogState);
  useEffect(() => {
    dialogStateListeners.push(setState);
    return () => {
      dialogStateListeners = dialogStateListeners.filter((l) => l !== setState);
    };
  }, []);
  return state;
}

export function SettingsDialog() {
  const { isOpen, category } = useSettingsDialogState();

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettingsDialog();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex bg-(--color-background)"
      data-overlay="settings"
    >
      <SettingsPanel
        activeCategory={category}
        onClose={closeSettingsDialog}
        onCategoryChange={(cat) => publish({ isOpen: true, category: cat })}
      />
    </div>
  );
}
