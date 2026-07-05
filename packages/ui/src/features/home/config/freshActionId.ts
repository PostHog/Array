import type { WorkflowAction } from "@posthog/core/workflow/schemas";

// Next unused `action_N` id given the ids already in a situation's binding list.
export function freshActionId(existing: string[]): string {
  let n = 1;
  while (existing.includes(`action_${n}`)) n++;
  return `action_${n}`;
}

export function createDefaultAction(existingIds: string[]): WorkflowAction {
  return {
    id: freshActionId(existingIds),
    label: "Run skill",
    skillId: "",
    prompt: "",
  };
}
