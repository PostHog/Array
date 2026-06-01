import { useWorkflow } from "@features/home/hooks/useWorkflow";
import {
  SITUATIONS,
  type SituationId,
  type WorkflowAction,
} from "@shared/types/workflow";
import { useMemo } from "react";
import type { HomeWorkstream } from "../utils/buildSnapshot";

export interface BoundAction extends WorkflowAction {
  /** Situation this action came from — used for telemetry + tooltips. */
  situationId: SituationId;
  situationLabel: string;
}

/**
 * Joins a workstream's classified situations against the persisted workflow's
 * bindings and returns the deduped list of actions the user has bound to any
 * matching situation. Order follows the workstream's situations array (which
 * preserves classifier output order), then the action order within each
 * binding list.
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
        // Dedup if the user bound the same action id under multiple
        // situations — shouldn't happen via the editor but be defensive.
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
