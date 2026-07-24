import type { RawTaskTimestamp } from "@posthog/core/sidebar/taskMeta";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import type { TaskLabel } from "@posthog/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

/**
 * Sets a task's user-set label. Rides the shared getAllTaskTimestamps record
 * (the same per-task metadata the sidebar already subscribes to), so the row
 * updates optimistically and rolls back on failure.
 */
export function useTaskLabel() {
  const trpc = useHostTRPC();
  const hostClient = useHostTRPCClient();
  const queryClient = useQueryClient();
  const timestampsQueryKey = trpc.workspace.getAllTaskTimestamps.queryKey();

  const setLabelMutation = useMutation({
    mutationFn: ({
      taskId,
      label,
    }: {
      taskId: string;
      label: TaskLabel | null;
    }) => hostClient.workspace.setTaskLabel.mutate({ taskId, label }),
    onMutate: async ({ taskId, label }) => {
      await queryClient.cancelQueries({ queryKey: timestampsQueryKey });
      const previous =
        queryClient.getQueryData<Record<string, RawTaskTimestamp>>(
          timestampsQueryKey,
        );
      queryClient.setQueryData<Record<string, RawTaskTimestamp>>(
        timestampsQueryKey,
        (old) => {
          const base = old?.[taskId] ?? {
            pinnedAt: null,
            lastViewedAt: null,
            lastActivityAt: null,
            label: null,
          };
          return { ...old, [taskId]: { ...base, label } };
        },
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(timestampsQueryKey, context.previous);
      }
    },
  });

  const setLabelMutationRef = useRef(setLabelMutation);
  setLabelMutationRef.current = setLabelMutation;

  const setLabel = useCallback(
    async (taskId: string, label: TaskLabel | null) => {
      await setLabelMutationRef.current.mutateAsync({ taskId, label });
    },
    [],
  );

  return { setLabel };
}
