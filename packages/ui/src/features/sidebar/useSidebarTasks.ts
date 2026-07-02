import type { Task } from "@posthog/shared/domain-types";
import { useMemo } from "react";
import { useTasks } from "../tasks/useTasks";
import { useSidebarStore } from "./sidebarStore";

// The task list only shows work a person initiated themselves: tasks created
// in-app (`user_created`) and tasks started from a Slack thread (`slack`).
// Agent-provisioned origins — signals, support queue, session summaries, etc. —
// are deliberately excluded so they never show up in a user's task list. Slack
// tasks keep their `slack` origin so the sidebar brands them with a Slack icon.
export function useSidebarTasks(options?: { enabled?: boolean }): {
  tasks: Task[];
  isLoading: boolean;
} {
  const showAllUsers = useSidebarStore((state) => state.showAllUsers);

  const { data: userCreatedTasks = [], isLoading: isUserCreatedLoading } =
    useTasks({ showAllUsers, originProduct: "user_created" }, options);
  const { data: slackTasks = [], isLoading: isSlackLoading } = useTasks(
    { showAllUsers, originProduct: "slack" },
    options,
  );

  const tasks = useMemo<Task[]>(
    () => [...userCreatedTasks, ...slackTasks],
    [userCreatedTasks, slackTasks],
  );

  return { tasks, isLoading: isUserCreatedLoading || isSlackLoading };
}
