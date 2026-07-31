import { create } from "zustand";

interface SkillsSelectionState {
  /**
   * A skill name another surface asked to open (by frontmatter `name`).
   * SkillsView consumes it once on load to select the matching skill, then
   * clears it so a later plain visit to /skills opens nothing.
   */
  requestedSkillName: string | null;
  requestedSkill: { source: string; path: string } | null;
}

interface SkillsSelectionActions {
  requestSkill: (skill: { source: string; path: string }) => void;
  requestSkillByName: (name: string) => void;
  clearRequestedSkill: () => void;
}

type SkillsSelectionStore = SkillsSelectionState & {
  actions: SkillsSelectionActions;
};

const useStore = create<SkillsSelectionStore>((set) => ({
  requestedSkillName: null,
  requestedSkill: null,
  actions: {
    requestSkill: (skill) => set({ requestedSkill: skill }),
    requestSkillByName: (name) => set({ requestedSkillName: name }),
    clearRequestedSkill: () =>
      set({ requestedSkill: null, requestedSkillName: null }),
  },
}));

export const useRequestedSkillName = () =>
  useStore((s) => s.requestedSkillName);
export const useRequestedSkill = () => useStore((s) => s.requestedSkill);
export const useSkillsSelectionActions = () => useStore((s) => s.actions);
