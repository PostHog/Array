import type { AlwaysOnSkillRef } from "@posthog/shared";
import { create } from "zustand";

export type AlwaysOnSkillsFailureAction =
  | "retry"
  | "continue"
  | "disable"
  | "cancel";

interface AlwaysOnSkillsFailureState {
  isOpen: boolean;
  error: string | null;
  skills: AlwaysOnSkillRef[];
  resolve: ((action: AlwaysOnSkillsFailureAction) => void) | null;
  confirm: (
    error: string,
    skills: AlwaysOnSkillRef[],
  ) => Promise<AlwaysOnSkillsFailureAction>;
  choose: (action: AlwaysOnSkillsFailureAction) => void;
}

export const useAlwaysOnSkillsFailureStore =
  create<AlwaysOnSkillsFailureState>()((set, get) => ({
    isOpen: false,
    error: null,
    skills: [],
    resolve: null,
    confirm: (error, skills) =>
      new Promise((resolve) => {
        get().resolve?.("cancel");
        set({ isOpen: true, error, skills, resolve });
      }),
    choose: (action) => {
      get().resolve?.(action);
      set({ isOpen: false, error: null, skills: [], resolve: null });
    },
  }));
