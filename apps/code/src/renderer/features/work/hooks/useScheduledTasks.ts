import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { Schemas } from "@renderer/api/generated";
import { queryClient } from "@utils/queryClient";

const SCHEDULED_TASKS_POLL_INTERVAL_MS = 30_000;

export const scheduledTasksKeys = {
  all: ["scheduled-tasks"] as const,
  list: () => [...scheduledTasksKeys.all, "list"] as const,
};

export type ScheduledTaskCreateInput = Pick<
  Schemas.TaskAutomation,
  "name" | "prompt" | "cron_expression" | "repository"
> &
  Partial<
    Pick<
      Schemas.TaskAutomation,
      "github_integration" | "timezone" | "template_id" | "enabled"
    >
  >;

export function useScheduledTasks() {
  return useAuthenticatedQuery(
    scheduledTasksKeys.list(),
    (client) => client.listTaskAutomations(),
    { refetchInterval: SCHEDULED_TASKS_POLL_INTERVAL_MS },
  );
}

export function useCreateScheduledTask() {
  return useAuthenticatedMutation(
    (client, input: ScheduledTaskCreateInput) =>
      client.createTaskAutomation(input),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: scheduledTasksKeys.list(),
        });
      },
    },
  );
}

export function useUpdateScheduledTask() {
  return useAuthenticatedMutation(
    (
      client,
      variables: { id: string; updates: Schemas.PatchedTaskAutomation },
    ) => client.updateTaskAutomation(variables.id, variables.updates),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: scheduledTasksKeys.list(),
        });
      },
    },
  );
}

export function useDeleteScheduledTask() {
  return useAuthenticatedMutation(
    (client, id: string) => client.deleteTaskAutomation(id),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: scheduledTasksKeys.list(),
        });
      },
    },
  );
}

export function useRunScheduledTaskNow() {
  return useAuthenticatedMutation(
    (client, id: string) => client.runTaskAutomationNow(id),
    {
      onSuccess: () => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: scheduledTasksKeys.list(),
          }),
          queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        ]);
      },
    },
  );
}
