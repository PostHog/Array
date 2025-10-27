import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";

export interface Recording {
  id: string;
  platform: string;
  title: string | null;
  status: "recording" | "uploading" | "processing" | "ready" | "error";
  created_at: string;
  duration: number | null;
  video_url: string | null;
  recall_recording_id: string | null;
}

export function useRecordings() {
  const { client } = useAuthStore();

  return useQuery({
    queryKey: ["notetaker-recordings"], // Unique key to avoid collision with legacy recordings
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      const recordings = await client.listDesktopRecordings();
      return recordings as Recording[];
    },
    enabled: !!client,
    refetchInterval: 10000, // Poll every 10s
    staleTime: 5000, // Consider stale after 5s
  });
}

export function useRecording(recordingId: string | null) {
  const { client } = useAuthStore();

  return useQuery({
    queryKey: ["notetaker-recording", recordingId], // Unique key
    queryFn: async () => {
      if (!client || !recordingId)
        throw new Error("Not authenticated or no recording ID");
      const recording = await client.getDesktopRecording(recordingId);
      return recording as Recording;
    },
    enabled: !!client && !!recordingId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll faster during active states
      if (
        status === "recording" ||
        status === "uploading" ||
        status === "processing"
      ) {
        return 2000; // 2s
      }
      return 30000; // 30s for ready/error
    },
  });
}

export function useDeleteRecording() {
  const { client } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordingId: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deleteDesktopRecording(recordingId);
    },
    onSuccess: () => {
      // Invalidate recordings list
      queryClient.invalidateQueries({ queryKey: ["notetaker-recordings"] });
    },
  });
}
