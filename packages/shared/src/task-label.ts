import { z } from "zod";

// User-set task labels: a small fixed triage vocabulary. Lives in shared so
// workspace-server (persistence schema), core (sorting/derivation), ui
// (rendering), and the web host all share one source of truth.
export const TASK_LABELS = [
  "high-priority",
  "active",
  "deprioritized",
  "done",
] as const;

export const taskLabelSchema = z.enum(TASK_LABELS);
export type TaskLabel = z.infer<typeof taskLabelSchema>;

export interface TaskLabelMeta {
  displayName: string;
  /** Radix accent CSS variable, rendered as the row dot's background. */
  accent: string;
  /** Sort position for label-aware ordering; unlabeled tasks rank between
   * "active" and "deprioritized" (see {@link taskLabelRank}). */
  rank: number;
}

export const TASK_LABEL_META: Record<TaskLabel, TaskLabelMeta> = {
  "high-priority": {
    displayName: "High priority",
    accent: "var(--orange-9)",
    rank: 0,
  },
  active: { displayName: "Active", accent: "var(--blue-9)", rank: 1 },
  deprioritized: {
    displayName: "Deprioritized",
    accent: "var(--gray-9)",
    rank: 3,
  },
  done: { displayName: "Done", accent: "var(--grass-9)", rank: 4 },
};

const UNLABELED_RANK = 2;

export function taskLabelRank(label: TaskLabel | null): number {
  return label ? TASK_LABEL_META[label].rank : UNLABELED_RANK;
}
