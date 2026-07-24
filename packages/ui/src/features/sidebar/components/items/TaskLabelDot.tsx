import { TASK_LABEL_META, type TaskLabel } from "@posthog/shared";
import { Tooltip } from "../../../../primitives/Tooltip";

/**
 * Subtle colored dot for a task's user-set label. Reused wherever a task row
 * renders (sidebar today; channel feed cards can adopt it later). Renders
 * nothing when the task is unlabeled.
 */
export function TaskLabelDot({ label }: { label: TaskLabel | null }) {
  if (!label) return null;
  const meta = TASK_LABEL_META[label];
  return (
    <Tooltip content={meta.displayName} side="top">
      <span
        role="img"
        aria-label={`Label: ${meta.displayName}`}
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: meta.accent }}
      />
    </Tooltip>
  );
}
