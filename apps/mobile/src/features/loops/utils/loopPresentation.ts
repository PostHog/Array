import type { Loop } from "../types";

export function getLoopRepositoryLabel(
  loop: Pick<Loop, "repositories">,
): string | null {
  const [first] = loop.repositories;
  return first?.full_name ?? null;
}

/** Short secondary line for a loop row: the repository it runs against, or
 *  a note that it's report-only (works purely through connectors). */
export function getLoopSecondaryLabel(
  loop: Pick<Loop, "repositories">,
): string {
  return getLoopRepositoryLabel(loop) ?? "No repository — connectors only";
}

export function getLoopTriggerSummary(loop: Pick<Loop, "triggers">): string {
  if (loop.triggers.length === 0) {
    return "No triggers";
  }

  const counts = new Map<string, number>();
  for (const trigger of loop.triggers) {
    counts.set(trigger.type, (counts.get(trigger.type) ?? 0) + 1);
  }

  const labels: Record<string, string> = {
    schedule: "Schedule",
    github: "GitHub",
    api: "API",
  };

  return Array.from(counts.entries())
    .map(([type, count]) =>
      count > 1 ? `${labels[type] ?? type} ×${count}` : (labels[type] ?? type),
    )
    .join(" · ");
}
