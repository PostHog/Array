import type { Recording } from "@shared/types";
import { useAuthStore } from "@stores/authStore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function useRecordings() {
  const queryClient = useQueryClient();
  const openaiApiKey = useAuthStore((state) => state.openaiApiKey);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["recordings"],
    queryFn: async (): Promise<Recording[]> => {
      return await window.electronAPI.recordingList();
    },
  });

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
    onSuccess: async (newRecording) => {
      queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
        return [newRecording, ...old];
      });

      if (openaiApiKey) {
        try {
          setTranscriptionError(null);

          // Optimistically update to show "processing" status
          queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
            return old.map((r) =>
              r.id === newRecording.id
                ? {
                    ...r,
                    transcription: {
                      status: "processing" as const,
                      text: "",
                    },
                  }
                : r,
            );
          });

          await window.electronAPI.recordingTranscribe(
            newRecording.id,
            openaiApiKey,
          );
          queryClient.invalidateQueries({ queryKey: ["recordings"] });
        } catch (error) {
          console.error("Auto-transcription failed:", error);
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Auto-transcription failed. Please check your OpenAI API key and try again.";
          setTranscriptionError(errorMessage);

          // Update cache to show error state
          queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
            return old.map((r) =>
              r.id === newRecording.id
                ? {
                    ...r,
                    transcription: {
                      status: "error" as const,
                      text: "",
                      error: errorMessage,
                    },
                  }
                : r,
            );
          });
        }
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordingId: string) => {
      return await window.electronAPI.recordingDelete(recordingId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
  });

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
    onMutate: async ({ recordingId }) => {
      // Optimistically update to show "processing" status
      setTranscriptionError(null);
      queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
        return old.map((r) =>
          r.id === recordingId
            ? {
                ...r,
                transcription: {
                  status: "processing" as const,
                  text: "",
                },
              }
            : r,
        );
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error, { recordingId }) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Transcription failed. Please check your OpenAI API key and try again.";
      setTranscriptionError(errorMessage);

      // Update cache to show error state
      queryClient.setQueryData<Recording[]>(["recordings"], (old = []) => {
        return old.map((r) =>
          r.id === recordingId
            ? {
                ...r,
                transcription: {
                  status: "error" as const,
                  text: "",
                  error: errorMessage,
                },
              }
            : r,
        );
      });
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
    transcriptionError,
    clearTranscriptionError: () => setTranscriptionError(null),
  };
}
