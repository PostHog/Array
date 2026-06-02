import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";

// Thin wrapper around the skills router for the action editor's skill dropdown.
export function useSkillsForPicker() {
  const trpc = useTRPC();
  const query = useQuery(trpc.skills.list.queryOptions());
  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
  };
}
