import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  deriveTaskData,
  type FullTask,
  narrowFullTask,
  type TaskSession,
} from "@posthog/core/sidebar/buildSidebarData";
import type { Task } from "@posthog/shared/domain-types";
import { useSessions } from "@posthog/ui/features/sessions/useSession";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { useMemo } from "react";

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_STRING_MAP: ReadonlyMap<string, string> = new Map();

// Which canvas generation tasks should be shown nested under their canvas in
// the channel tree. A generation task stays pinned under its canvas while it's
// still generating, and afterwards until the user has actually looked at the
// result (i.e. it's unread). Once it's both finished and seen — including when
// the user stops the run from its own view, which clears `isGenerating` and
// marks it read — it drops out and falls back into the channel's regular task
// list.
//
// Derived in bulk from one sessions + timestamps read (rather than per row) so
// the channel can both render the nested rows and dedupe them out of the flat
// task list from a single source of truth, with no chance of the two diverging.
export function useNestedGenerationTaskIds(
  dashboards: DashboardSummary[],
  tasks: Task[] | undefined,
): ReadonlySet<string> {
  const sessions = useSessions();
  const { timestamps } = useTaskViewed();

  return useMemo(() => {
    const generationTaskIds = dashboards
      .map((d) => d.generationTaskId)
      .filter((id): id is string => !!id);
    if (generationTaskIds.length === 0) return EMPTY_SET;

    const sessionByTaskId = new Map<string, (typeof sessions)[string]>();
    for (const session of Object.values(sessions)) {
      if (session.taskId) sessionByTaskId.set(session.taskId, session);
    }
    const taskById = new Map(tasks?.map((t) => [t.id, t]) ?? []);

    const nested = new Set<string>();
    for (const taskId of generationTaskIds) {
      const task = taskById.get(taskId);
      // Tasks are private to their creator; one that isn't in our list can't be
      // shown (or deduped) — leave it out.
      if (!task) continue;
      const data = deriveTaskData(narrowFullTask(task as unknown as FullTask), {
        session: sessionByTaskId.get(taskId) as TaskSession | undefined,
        workspace: undefined,
        timestamp: timestamps[taskId],
        pinnedIds: EMPTY_SET,
        suspendedIds: EMPTY_SET,
        slackTaskIds: EMPTY_SET,
        slackThreadUrlByTaskId: EMPTY_STRING_MAP,
      });
      if (data.isGenerating || data.isUnread) nested.add(taskId);
    }
    return nested;
  }, [dashboards, tasks, sessions, timestamps]);
}
