import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";

export interface ExtractedTask {
  title: string;
  description: string;
}

export function useExtractTasks() {
  const openaiApiKey = useAuthStore((state) => state.openaiApiKey);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordingId,
      transcriptText,
    }: {
      recordingId: string;
      transcriptText: string;
    }) => {
      if (!openaiApiKey) {
        throw new Error("OpenAI API key not configured");
      }

      const tasks = await window.electronAPI.notetakerExtractTasks(
        transcriptText,
        openaiApiKey,
      );

      return { tasks, recordingId };
    },
    onSuccess: (data) => {
      // Invalidate recording query to refetch with new tasks
      queryClient.invalidateQueries({
        queryKey: ["notetaker-recording", data.recordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notetaker-transcript", data.recordingId],
      });
    },
  });
}
