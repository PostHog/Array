import { useSkills } from "@posthog/ui/features/skills/useSkills";

// Thin wrapper around the skills query for the action editor's skill dropdown.
export function useSkillsForPicker() {
  const query = useSkills();
  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
  };
}
