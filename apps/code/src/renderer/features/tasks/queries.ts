import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { AUTH_SCOPED_QUERY_META } from "@features/auth/hooks/authQueries";
import { taskKeys } from "@features/tasks/hooks/taskKeys";
import { NotAuthenticatedError } from "@shared/errors";
import type { Task } from "@shared/types";
import { queryOptions } from "@tanstack/react-query";

// Shared query definition so a route `loader` (ensureQueryData) and the
// component (useQuery) hit the same cache entry. The queryFn resolves the
// authenticated client imperatively, so it works outside React (in loaders) as
// well as inside components.
export function taskDetailQuery(taskId: string) {
  return queryOptions({
    queryKey: taskKeys.detail(taskId),
    queryFn: async (): Promise<Task> => {
      const client = await getAuthenticatedClient();
      if (!client) throw new NotAuthenticatedError();
      return (await client.getTask(taskId)) as unknown as Task;
    },
    meta: AUTH_SCOPED_QUERY_META,
  });
}
