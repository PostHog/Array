import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";

export interface ExtractedTask {
  title: string;
  description: string;
}

export function useExtractTasks() {
  const openaiApiKey = useAuthStore((state) => state.openaiApiKey);
  const { client } = useAuthStore();
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

      if (!client) {
        throw new Error("Not authenticated");
      }

      // Extract tasks using AI
      const tasks = await window.electronAPI.notetakerExtractTasks(
        transcriptText,
        openaiApiKey,
      );

      // Upload tasks to backend
      await client.uploadDesktopRecordingTranscript(recordingId, {
        full_text: transcriptText,
        segments: [], // Segments already uploaded
        extracted_tasks: tasks,
      });

      return { tasks, recordingId };
    },
    onSuccess: (data) => {
      // Invalidate queries to refetch with new tasks from backend
      queryClient.invalidateQueries({
        queryKey: ["notetaker-recording", data.recordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notetaker-transcript", data.recordingId],
      });
    },
  });
}
