import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../../stores/authStore";

export interface TranscriptSegment {
  timestamp: number; // Milliseconds from start
  speaker: string | null;
  text: string;
  confidence: number | null;
}

interface TranscriptData {
  full_text: string;
  segments: TranscriptSegment[];
}

export function useTranscript(recordingId: string | null) {
  const { client } = useAuthStore();

  return useQuery({
    queryKey: ["notetaker-transcript", recordingId], // Unique key
    queryFn: async () => {
      if (!client || !recordingId)
        throw new Error("Not authenticated or no recording ID");
      const transcript =
        await client.getDesktopRecordingTranscript(recordingId);
      return transcript as TranscriptData;
    },
    enabled: !!client && !!recordingId,
    refetchInterval: 5000, // Poll every 5s to get updates
    staleTime: 2000,
  });
}

export function useUploadTranscript() {
  const { client } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordingId,
      segments,
    }: {
      recordingId: string;
      segments: TranscriptSegment[];
    }) => {
      if (!client) throw new Error("Not authenticated");

      const full_text = segments.map((s) => s.text).join(" ");

      return await client.uploadDesktopRecordingTranscript(recordingId, {
        full_text,
        segments,
      });
    },
    onSuccess: (_data, variables) => {
      // Invalidate transcript query to refetch
      queryClient.invalidateQueries({
        queryKey: ["notetaker-transcript", variables.recordingId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notetaker-recording", variables.recordingId],
      });
      queryClient.invalidateQueries({ queryKey: ["notetaker-recordings"] });
    },
  });
}

/**
 * Hook for managing real-time transcript with local buffering and batched uploads
 */
export function useLiveTranscript(posthogRecordingId: string | null) {
  const [localSegments, setLocalSegments] = useState<TranscriptSegment[]>([]);
  const [pendingUpload, setPendingUpload] = useState<TranscriptSegment[]>([]);
  const uploadMutation = useUploadTranscript();
  const { data: serverTranscript } = useTranscript(posthogRecordingId);

  // Keep track of uploaded segment timestamps to avoid duplicates
  const uploadedTimestamps = useRef(new Set<number>());

  // Merge server transcript with local segments
  const allSegments = [
    ...(serverTranscript?.segments || []),
    ...localSegments,
  ].sort((a, b) => a.timestamp - b.timestamp);

  // Add new segment from IPC
  const addSegment = useCallback((segment: TranscriptSegment) => {
    // Check if already uploaded or in local buffer
    if (uploadedTimestamps.current.has(segment.timestamp)) {
      return;
    }

    setLocalSegments((prev) => {
      // Avoid duplicates in local buffer
      const exists = prev.some((s) => s.timestamp === segment.timestamp);
      if (exists) return prev;
      return [...prev, segment];
    });

    setPendingUpload((prev) => [...prev, segment]);
  }, []);

  const uploadSegments = useCallback(() => {
    if (!posthogRecordingId || pendingUpload.length === 0) return;

    const toUpload = [...pendingUpload];

    uploadMutation.mutate(
      {
        recordingId: posthogRecordingId,
        segments: toUpload,
      },
      {
        onSuccess: () => {
          // Mark as uploaded
          for (const seg of toUpload) {
            uploadedTimestamps.current.add(seg.timestamp);
          }

          // Remove from local buffer after successful upload
          setLocalSegments((prev) =>
            prev.filter(
              (s) => !toUpload.some((u) => u.timestamp === s.timestamp),
            ),
          );

          // Clear pending
          setPendingUpload([]);
        },
        onError: (error) => {
          console.error("[LiveTranscript] Failed to upload segments:", error);
          // Keep in pending for retry
        },
      },
    );
  }, [posthogRecordingId, pendingUpload, uploadMutation]);

  // Batch upload every 10 segments or 10 seconds
  useEffect(() => {
    if (!posthogRecordingId || pendingUpload.length === 0) return;

    const shouldUpload = pendingUpload.length >= 10;

    const timer = setTimeout(() => {
      if (pendingUpload.length > 0) {
        uploadSegments();
      }
    }, 10000); // 10s

    if (shouldUpload) {
      uploadSegments();
    }

    return () => clearTimeout(timer);
  }, [pendingUpload.length, posthogRecordingId, uploadSegments]);

  // Force upload (e.g., when meeting ends)
  const forceUpload = useCallback(() => {
    if (pendingUpload.length > 0) {
      uploadSegments();
    }
  }, [pendingUpload, uploadSegments]);

  // Reset when recording changes
  useEffect(() => {
    setLocalSegments([]);
    setPendingUpload([]);
    uploadedTimestamps.current.clear();
  }, []);

  return {
    segments: allSegments,
    addSegment,
    forceUpload,
    isUploading: uploadMutation.isPending,
    pendingCount: pendingUpload.length,
  };
}
