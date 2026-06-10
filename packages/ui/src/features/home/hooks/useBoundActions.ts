import type { HomeWorkstream } from "@posthog/core/home/schemas";
import {
  SITUATIONS,
  type SituationId,
  type WorkflowAction,
} from "@posthog/core/workflow/schemas";
import { useWorkflow } from "@posthog/ui/features/home/hooks/useWorkflow";
import { useMemo } from "react";

export interface BoundAction extends WorkflowAction {
  /** Situation this action came from — used for telemetry + tooltips. */
  situationId: SituationId;
  situationLabel: string;
}

/**
 * Joins a workstream's situations against the workflow bindings and returns the
 * deduped actions bound to any matching situation, in situation then binding order.
 */
export function useBoundActions(workstream: HomeWorkstream): BoundAction[] {
  const { workflow } = useWorkflow();
  return useMemo(() => {
    if (!workflow) return [];
    const bindings = workflow.bindings;
    const seen = new Set<string>();
    const out: BoundAction[] = [];
    for (const sid of workstream.situations) {
      const actions = bindings?.[sid] ?? [];
      const meta = SITUATIONS.find((s) => s.id === sid);
      for (const action of actions) {
        // Dedup the same action bound under multiple situations.
        const dedupKey = `${action.skillId}::${action.label}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push({
          ...action,
          situationId: sid,
          situationLabel: meta?.label ?? sid,
        });
      }
    }
    return out;
  }, [workflow, workstream.situations]);
}
