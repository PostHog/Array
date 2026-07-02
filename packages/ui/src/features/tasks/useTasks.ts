import type { Task } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "../../hooks/useAuthenticatedQuery";
import { useMeQuery } from "../auth/useMeQuery";
import { taskKeys } from "./taskKeys";

const TASK_LIST_POLL_INTERVAL_MS = 30_000;

export function useTasks(
  filters?: {
    repository?: string;
    showAllUsers?: boolean;
    originProduct?: string;
  },
  options?: { enabled?: boolean },
) {
  const { data: currentUser } = useMeQuery();
  const createdBy = filters?.showAllUsers ? undefined : currentUser?.id;

  return useAuthenticatedQuery(
    taskKeys.list({
      repository: filters?.repository,
      createdBy,
      originProduct: filters?.originProduct,
    }),
    (client) =>
      client.getTasks({
        repository: filters?.repository,
        createdBy,
        originProduct: filters?.originProduct,
      }) as unknown as Promise<Task[]>,
    {
      enabled: (options?.enabled ?? true) && !!currentUser?.id,
      refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
    },
  );
}
