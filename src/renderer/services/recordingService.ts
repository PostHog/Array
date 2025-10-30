import { useActiveRecordingStore } from "@renderer/stores/activeRecordingStore";
import { useAuthStore } from "@/renderer/features/auth/stores/authStore";

// Batch upload configuration
const BATCH_SIZE = 10; // Upload every 10 segments
const BATCH_TIMEOUT_MS = 10000; // Or every 10 seconds

interface UploadBatch {
  recordingId: string;
  timer: ReturnType<typeof setTimeout> | null;
  segmentCount: number;
}

const uploadBatches = new Map<string, UploadBatch>();

let isInitialized = false;

/**
 * Initialize the recording service
 * Sets up IPC listeners for Recall SDK events
 * Call this once when the app starts (outside React component lifecycle)
 */
export function initializeRecordingService() {
  if (isInitialized) {
    console.warn("[RecordingService] Already initialized, skipping");
    return;
  }

  console.log("[RecordingService] Initializing...");
  isInitialized = true;

  const authStore = useAuthStore.getState();
  if (authStore.client) {
    handleCrashRecovery();
  } else {
    console.warn(
      "[RecordingService] Skipping crash recovery - auth client not ready yet",
    );
  }

  window.electronAPI.onRecallRecordingStarted((recording) => {
    console.log("[RecordingService] Recording started:", recording);

    const store = useActiveRecordingStore.getState();
    store.addRecording(recording);

    uploadBatches.set(recording.id, {
      recordingId: recording.id,
      timer: null,
      segmentCount: 0,
    });
  });

  window.electronAPI.onRecallTranscriptSegment((data) => {
    const store = useActiveRecordingStore.getState();

    store.addSegment(data.posthog_recording_id, {
      timestamp: data.timestamp,
      speaker: data.speaker,
      text: data.text,
      confidence: data.confidence,
      is_final: data.is_final,
    });

    const batch = uploadBatches.get(data.posthog_recording_id);
    if (batch) {
      batch.segmentCount++;

      if (!batch.timer) {
        batch.timer = setTimeout(() => {
          uploadPendingSegments(data.posthog_recording_id);
        }, BATCH_TIMEOUT_MS);
      }

      if (batch.segmentCount >= BATCH_SIZE) {
        if (batch.timer) {
          clearTimeout(batch.timer);
          batch.timer = null;
        }
        uploadPendingSegments(data.posthog_recording_id);
      }
    }
  });

  window.electronAPI.onRecallMeetingEnded((data) => {
    console.log("[RecordingService] Meeting ended:", data);

    const batch = uploadBatches.get(data.posthog_recording_id);
    if (batch?.timer) {
      clearTimeout(batch.timer);
    }
    uploadBatches.delete(data.posthog_recording_id);

    uploadPendingSegments(data.posthog_recording_id).then(async () => {
      const store = useActiveRecordingStore.getState();

      const recording = store.getRecording(data.posthog_recording_id);
      if (recording) {
        const participants = [
          ...new Set(
            recording.segments
              .map((s) => s.speaker)
              .filter((s): s is string => s !== null && s !== undefined),
          ),
        ];

        if (participants.length > 0) {
          console.log(
            `[RecordingService] Extracted ${participants.length} participants:`,
            participants,
          );

          try {
            const authStore = useAuthStore.getState();
            const client = authStore.client;

            if (client) {
              await client.updateDesktopRecording(data.posthog_recording_id, {
                participants,
              });
              console.log(
                `[RecordingService] Updated recording with participants`,
              );
            }
          } catch (error) {
            console.error(
              "[RecordingService] Failed to update participants:",
              error,
            );
          }
        }
      }

      store.updateStatus(data.posthog_recording_id, "uploading");
    });
  });

  window.electronAPI.onRecallRecordingReady((data) => {
    console.log("[RecordingService] Recording ready:", data);

    const store = useActiveRecordingStore.getState();
    store.updateStatus(data.posthog_recording_id, "ready");
    store.clearRecording(data.posthog_recording_id);
  });

  console.log("[RecordingService] Initialized successfully");
}

async function uploadPendingSegments(recordingId: string): Promise<void> {
  const store = useActiveRecordingStore.getState();
  const recording = store.getRecording(recordingId);

  if (!recording) {
    console.warn(`[RecordingService] Recording ${recordingId} not found`);
    return;
  }

  const pendingSegments = store.getPendingSegments(recordingId);
  if (pendingSegments.length === 0) {
    console.log(`[RecordingService] No pending segments for ${recordingId}`);
    return;
  }

  console.log(
    `[RecordingService] Uploading ${pendingSegments.length} segments for ${recordingId}`,
  );

  try {
    const authStore = useAuthStore.getState();
    const client = authStore.client;

    if (!client) {
      throw new Error("PostHog client not initialized");
    }

    await client.updateDesktopRecordingTranscript(recordingId, {
      segments: pendingSegments.map((seg) => ({
        timestamp_ms: seg.timestamp,
        speaker: seg.speaker,
        text: seg.text,
        confidence: seg.confidence,
        is_final: seg.is_final,
      })),
    });

    const newIndex =
      recording.lastUploadedSegmentIndex + pendingSegments.length;
    store.updateLastUploadedIndex(recordingId, newIndex);

    console.log(
      `[RecordingService] Successfully uploaded ${pendingSegments.length} segments`,
    );

    const batch = uploadBatches.get(recordingId);
    if (batch) {
      batch.segmentCount = 0;
      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }
    }
  } catch (error) {
    console.error(
      `[RecordingService] Failed to upload segments for ${recordingId}:`,
      error,
    );
    store.setError(
      recordingId,
      error instanceof Error ? error.message : "Failed to upload segments",
    );
  }
}

/**
 * Handle crash recovery - upload any pending segments and clear from IDB
 *
 * Tradeoff: Might lose last ~10 segments if upload fails during crash recovery.
 * Acceptable because backend already has 90%+ from batched uploads during meeting.
 */
function handleCrashRecovery() {
  const store = useActiveRecordingStore.getState();
  const activeRecordings = store.activeRecordings;

  if (activeRecordings.length === 0) {
    console.log("[RecordingService] No interrupted recordings found");
    return;
  }

  console.log(
    `[RecordingService] Found ${activeRecordings.length} interrupted recording(s), uploading and clearing...`,
  );

  for (const recording of activeRecordings) {
    console.log(
      `[RecordingService] Uploading pending segments for ${recording.id} (best effort)`,
    );

    uploadPendingSegments(recording.id).catch((error) => {
      console.error(
        `[RecordingService] Failed to upload segments during recovery (acceptable):`,
        error,
      );
    });

    store.clearRecording(recording.id);
    console.log(`[RecordingService] Cleared ${recording.id} from IDB`);
  }
}

export function shutdownRecordingService() {
  console.log("[RecordingService] Shutting down...");

  for (const batch of uploadBatches.values()) {
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
  }
  uploadBatches.clear();

  isInitialized = false;

  console.log("[RecordingService] Shutdown complete");
}
