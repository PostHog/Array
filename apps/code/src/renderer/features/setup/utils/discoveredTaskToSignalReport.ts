import type { DiscoveredTask } from "@features/setup/types";
import type { SignalReport } from "@shared/types";

export function discoveredTaskToSignalReport(
  task: DiscoveredTask,
): SignalReport {
  const now = new Date().toISOString();
  return {
    id: task.id,
    title: task.title,
    summary: task.description,
    status: "ready",
    total_weight: 0,
    signal_count: 0,
    created_at: now,
    updated_at: now,
    artefact_count: 0,
    priority: null,
    actionability: null,
    already_addressed: null,
    is_suggested_reviewer: false,
    source_products: undefined,
    implementation_pr_url: null,
  };
}
