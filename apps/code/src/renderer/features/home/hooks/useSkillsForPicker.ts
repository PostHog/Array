import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";

// Thin wrapper around the existing skills router — used by the workflow
// action editor to populate the skill dropdown so the user picks a real
// skill instead of typing an id.
export function useSkillsForPicker() {
  const trpc = useTRPC();
  const query = useQuery(trpc.skills.list.queryOptions());
  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
  };
}
