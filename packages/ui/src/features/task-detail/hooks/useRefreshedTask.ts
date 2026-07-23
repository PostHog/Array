import type { Task } from "@posthog/shared/domain-types";
import { useQuery } from "@tanstack/react-query";
import { taskDetailQuery } from "../../tasks/queries";

export function useRefreshedTask(taskId: string, initialTask: Task): Task {
  const { data } = useQuery({
    ...taskDetailQuery(taskId),
    initialData: initialTask,
    refetchOnMount: "always",
  });

  // Guard against `data` being undefined: another observer subscribing to the
  // same query key without `initialData` can create the cache entry first while
  // the fetch is in flight, causing React Query to drop this hook's initialData.
  return data ?? initialTask;
}
