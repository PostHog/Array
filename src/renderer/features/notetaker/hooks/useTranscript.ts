import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
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
  extracted_tasks?: Array<{
    title: string;
    description: string;
  }>;
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
    refetchInterval: false, // Disabled: we get real-time updates via IPC events
    staleTime: Infinity, // Never consider stale since we update via IPC
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
 * Hook for managing real-time transcript with TanStack Query cache and batched uploads
 */
export function useLiveTranscript(posthogRecordingId: string | null) {
  const queryClient = useQueryClient();
  const uploadMutation = useUploadTranscript();
  const { data: serverTranscript } = useTranscript(posthogRecordingId);

  // Track pending segments for upload
  const pendingSegmentsRef = useRef<TranscriptSegment[]>([]);
  const uploadTimerRef = useRef<number>();
  const posthogRecordingIdRef = useRef(posthogRecordingId);
  posthogRecordingIdRef.current = posthogRecordingId;

  // Upload pending segments helper
  const doUpload = useCallback(() => {
    if (
      !posthogRecordingIdRef.current ||
      pendingSegmentsRef.current.length === 0
    )
      return;

    const toUpload = [...pendingSegmentsRef.current];
    pendingSegmentsRef.current = [];

    if (uploadTimerRef.current) {
      clearTimeout(uploadTimerRef.current);
      uploadTimerRef.current = undefined;
    }

    uploadMutation.mutate({
      recordingId: posthogRecordingIdRef.current,
      segments: toUpload,
    });
  }, [uploadMutation]);

  // Add new segment from IPC - optimistically update cache
  const addSegment = useCallback(
    (segment: TranscriptSegment) => {
      if (!posthogRecordingId) return;

      // Optimistically update TanStack Query cache
      queryClient.setQueryData<TranscriptData>(
        ["notetaker-transcript", posthogRecordingId],
        (old) => {
          const existingSegments = old?.segments || [];

          // Check if segment already exists
          const exists = existingSegments.some(
            (s) => s.timestamp === segment.timestamp,
          );
          if (exists) return old;

          // Add to cache
          const newSegments = [...existingSegments, segment].sort(
            (a, b) => a.timestamp - b.timestamp,
          );

          return {
            full_text: newSegments.map((s) => s.text).join(" "),
            segments: newSegments,
          };
        },
      );

      // Track for batched upload
      const alreadyPending = pendingSegmentsRef.current.some(
        (s) => s.timestamp === segment.timestamp,
      );
      if (!alreadyPending) {
        pendingSegmentsRef.current.push(segment);
      }

      // Clear existing timer
      if (uploadTimerRef.current) {
        clearTimeout(uploadTimerRef.current);
      }

      // Upload immediately if we have 10 segments
      if (pendingSegmentsRef.current.length >= 10) {
        doUpload();
      } else {
        // Otherwise schedule upload in 10 seconds
        uploadTimerRef.current = setTimeout(() => {
          doUpload();
        }, 10000);
      }
    },
    [posthogRecordingId, queryClient, doUpload],
  );

  // Force upload (e.g., when meeting ends)
  const forceUpload = useCallback(() => {
    doUpload();
  }, [doUpload]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (uploadTimerRef.current) {
        clearTimeout(uploadTimerRef.current);
      }
    };
  }, []);

  return {
    segments: serverTranscript?.segments || [],
    addSegment,
    forceUpload,
    isUploading: uploadMutation.isPending,
    pendingCount: pendingSegmentsRef.current.length,
  };
}
