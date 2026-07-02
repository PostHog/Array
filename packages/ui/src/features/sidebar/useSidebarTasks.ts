import type { Task } from "@posthog/shared/domain-types";
import { useMemo } from "react";
import { useTasks } from "../tasks/useTasks";
import { useSidebarStore } from "./sidebarStore";

// Origins that represent work a person initiated themselves: created in-app
// (`user_created`) or started from a Slack thread (`slack`). Everything else is
// "system-started" (signals, support queue, session summaries, …) and only
// shows when a staff user flips the task-origin filter.
export const USER_STARTED_ORIGIN_PRODUCTS: readonly string[] = [
  "user_created",
  "slack",
];

function isUserStarted(task: Task): boolean {
  // Tasks predating origin tracking have no origin_product; treat them as
  // user-started so they never vanish from the default view.
  return (
    !task.origin_product ||
    USER_STARTED_ORIGIN_PRODUCTS.includes(task.origin_product)
  );
}

// The tasks shown in the sidebar list, scoped to the current task-origin filter.
// Shared by useSidebarData, SidebarMenu, and SidebarNavSection so every consumer
// renders the exact same set.
export function useSidebarTasks(options?: { enabled?: boolean }): {
  tasks: Task[];
  isLoading: boolean;
} {
  const showAllUsers = useSidebarStore((state) => state.showAllUsers);
  const showSystemStarted = useSidebarStore((state) => state.showSystemStarted);
  const baseEnabled = options?.enabled ?? true;

  // Default "User-started" view: fetch each user-facing origin directly so the
  // common list stays small and isn't truncated by the server's page cap.
  const { data: userCreatedTasks = [], isLoading: isUserCreatedLoading } =
    useTasks(
      { showAllUsers, originProduct: "user_created" },
      { enabled: baseEnabled && !showSystemStarted },
    );
  const { data: slackTasks = [], isLoading: isSlackLoading } = useTasks(
    { showAllUsers, originProduct: "slack" },
    { enabled: baseEnabled && !showSystemStarted },
  );

  // Staff-only "System-started" view: one unfiltered fetch, minus the
  // user-started origins, so newly added agent origins appear automatically.
  const { data: allTasks = [], isLoading: isAllLoading } = useTasks(
    { showAllUsers },
    { enabled: baseEnabled && showSystemStarted },
  );

  const tasks = useMemo<Task[]>(() => {
    if (showSystemStarted) {
      return allTasks.filter((task) => !isUserStarted(task));
    }
    return [...userCreatedTasks, ...slackTasks];
  }, [showSystemStarted, allTasks, userCreatedTasks, slackTasks]);

  const isLoading = showSystemStarted
    ? isAllLoading
    : isUserCreatedLoading || isSlackLoading;

  return { tasks, isLoading };
}
