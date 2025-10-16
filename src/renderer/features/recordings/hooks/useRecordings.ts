import type { Recording } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useRecordings() {
  const queryClient = useQueryClient();

  // Fetch all recordings
  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["recordings"],
    queryFn: async (): Promise<Recording[]> => {
      return await window.electronAPI.recordingList();
    },
    // No polling - we invalidate on mutations instead
  });

  // Save recording (called after stopping)
  const saveRecordingMutation = useMutation({
    mutationFn: async ({
      recordingId,
      audioData,
      duration,
    }: {
      recordingId: string;
      audioData: Uint8Array;
      duration: number;
    }): Promise<Recording> => {
      return await window.electronAPI.recordingStop(
        recordingId,
        audioData,
        duration,
      );
    },
    onSuccess: (newRecording) => {
      // Update cache directly with the new recording instead of invalidating
      queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
        return [newRecording, ...old];
      });
    },
  });

  // Delete recording
  const deleteMutation = useMutation({
    mutationFn: async (recordingId: string) => {
      return await window.electronAPI.recordingDelete(recordingId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
  });

  // Transcribe recording
  const transcribeMutation = useMutation({
    mutationFn: async ({
      recordingId,
      apiKey,
    }: {
      recordingId: string;
      apiKey: string;
    }) => {
      return await window.electronAPI.recordingTranscribe(recordingId, apiKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
  });

  return {
    recordings,
    isLoading,
    saveRecording: saveRecordingMutation.mutateAsync,
    deleteRecording: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    transcribeRecording: transcribeMutation.mutate,
    isTranscribing: transcribeMutation.isPending,
    transcriptionError: transcribeMutation.error,
  };
}
