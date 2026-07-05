import {
  SITUATION_IDS,
  type SituationId,
  type ValidationDiagnostic,
  type ValidationResult,
  type WorkflowDraft,
} from "./schemas";

export function validateWorkflow(draft: WorkflowDraft): ValidationResult {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const sid of SITUATION_IDS) {
    const actions = draft.bindings[sid] ?? [];
    const seenIds = new Set<string>();
    for (const action of actions) {
      if (seenIds.has(action.id)) {
        diagnostics.push({
          severity: "error",
          code: "duplicate_action_id",
          message: `Duplicate action id "${action.id}" in ${sid}`,
          situationId: sid as SituationId,
          actionId: action.id,
        });
        continue;
      }
      seenIds.add(action.id);

      if (action.label.trim() === "") {
        diagnostics.push({
          severity: "error",
          code: "action_empty_label",
          message: `An action in ${sid} has no label`,
          situationId: sid as SituationId,
          actionId: action.id,
        });
      }
      if (action.prompt.trim() === "") {
        diagnostics.push({
          severity: "error",
          code: "action_empty_prompt",
          message: `Action "${action.label}" in ${sid} has an empty prompt`,
          situationId: sid as SituationId,
          actionId: action.id,
        });
      }
    }
  }

  const canSave = !diagnostics.some((d) => d.severity === "error");
  return { diagnostics, canSave };
}
