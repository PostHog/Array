import type { Schemas } from "@api/generated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/renderer/features/auth/stores/authStore";

export type DesktopRecording = Schemas.DesktopRecording;

export function useDesktopRecordings() {
  const client = useAuthStore((state) => state.client);

  const {
    data: recordings = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["desktop-recordings"],
    queryFn: async (): Promise<DesktopRecording[]> => {
      if (!client) {
        throw new Error("PostHog client not initialized");
      }
      return await client.listDesktopRecordings();
    },
    enabled: !!client,
  });

  return {
    recordings,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useDeleteDesktopRecording() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (recordingId: string) => {
      if (!client) {
        throw new Error("PostHog client not initialized");
      }
      return await client.deleteDesktopRecording(recordingId);
    },
    onMutate: async (recordingId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["desktop-recordings"] });

      // Snapshot the previous value
      const previousRecordings = queryClient.getQueryData<DesktopRecording[]>([
        "desktop-recordings",
      ]);

      // Optimistically update to remove the recording
      queryClient.setQueryData<DesktopRecording[]>(
        ["desktop-recordings"],
        (old = []) => old.filter((r) => r.id !== recordingId),
      );

      // Return context with previous value
      return { previousRecordings };
    },
    onError: (_error, _recordingId, context) => {
      // Rollback on error
      if (context?.previousRecordings) {
        queryClient.setQueryData(
          ["desktop-recordings"],
          context.previousRecordings,
        );
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ["desktop-recordings"] });
    },
  });

  return {
    deleteRecording: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
