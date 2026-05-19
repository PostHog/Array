import { create } from "zustand";

export type SettingsCategory =
  | "general"
  | "plan-usage"
  | "workspaces"
  | "worktrees"
  | "environments"
  | "cloud-environments"
  | "personalization"
  | "claude-code"
  | "shortcuts"
  | "github"
  | "slack"
  | "signals"
  | "updates"
  | "advanced";

interface SettingsDialogContext {
  repoPath?: string;
}

interface SettingsDialogState {
  isOpen: boolean;
  activeCategory: SettingsCategory;
  context: SettingsDialogContext;
  initialAction: string | null;
  formMode: boolean;
}

interface SettingsDialogActions {
  open: (
    category?: SettingsCategory,
    contextOrAction?: SettingsDialogContext | string,
  ) => void;
  close: () => void;
  setCategory: (category: SettingsCategory) => void;
  clearContext: () => void;
  consumeInitialAction: () => string | null;
  setFormMode: (formMode: boolean) => void;
}

type SettingsDialogStore = SettingsDialogState & SettingsDialogActions;

export const useSettingsDialogStore = create<SettingsDialogStore>()(
  (set, get) => ({
    isOpen: false,
    activeCategory: "general",
    context: {},
    initialAction: null,
    formMode: false,

    open: (category, contextOrAction) => {
      if (!get().isOpen) {
        window.history.pushState({ settingsOpen: true }, "");
      }
      const isAction = typeof contextOrAction === "string";
      set({
        isOpen: true,
        activeCategory: category ?? "general",
        context: isAction ? {} : (contextOrAction ?? {}),
        initialAction: isAction ? contextOrAction : null,
        formMode: false,
      });
    },
    close: () => {
      if (get().isOpen && window.history.state?.settingsOpen) {
        window.history.back();
      }
      set({
        isOpen: false,
        context: {},
        initialAction: null,
        formMode: false,
      });
    },
    setCategory: (category) =>
      set({ activeCategory: category, initialAction: null, formMode: false }),
    clearContext: () => set({ context: {} }),
    consumeInitialAction: () => {
      const action = get().initialAction;
      if (action) set({ initialAction: null });
      return action;
    },
    setFormMode: (formMode) => set({ formMode }),
  }),
);
