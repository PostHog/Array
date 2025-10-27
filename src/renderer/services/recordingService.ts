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

// Track initialization to prevent double-initialization
let isInitialized = false;

/**
 * Initialize the recording service
 * Sets up IPC listeners for Recall SDK events
 * Call this once when the app starts (outside React component lifecycle)
 */
export function initializeRecordingService() {
  // Prevent double-initialization
  if (isInitialized) {
    console.warn("[RecordingService] Already initialized, skipping");
    return;
  }

  console.log("[RecordingService] Initializing...");
  isInitialized = true;

  // Handle crash recovery after checking auth client is ready
  // This prevents the race condition where recovery tries to upload before client exists
  const authStore = useAuthStore.getState();
  if (authStore.client) {
    handleCrashRecovery();
  } else {
    console.warn(
      "[RecordingService] Skipping crash recovery - auth client not ready yet",
    );
  }

  // Listen for recording started events
  window.electronAPI.onRecallRecordingStarted((recording) => {
    console.log("[RecordingService] Recording started:", recording);

    const store = useActiveRecordingStore.getState();
    // Pass full DesktopRecording object to store
    store.addRecording(recording);

    // Initialize upload batch tracker
    uploadBatches.set(recording.id, {
      recordingId: recording.id,
      timer: null,
      segmentCount: 0,
    });
  });

  // Listen for transcript segments
  window.electronAPI.onRecallTranscriptSegment((data) => {
    const store = useActiveRecordingStore.getState();

    // Add segment to store
    store.addSegment(data.posthog_recording_id, {
      timestamp: data.timestamp,
      speaker: data.speaker,
      text: data.text,
      confidence: data.confidence,
      is_final: data.is_final,
    });

    // Track batch for upload
    const batch = uploadBatches.get(data.posthog_recording_id);
    if (batch) {
      batch.segmentCount++;

      // Start timer if not already running
      if (!batch.timer) {
        batch.timer = setTimeout(() => {
          uploadPendingSegments(data.posthog_recording_id);
        }, BATCH_TIMEOUT_MS);
      }

      // Upload if batch size reached
      if (batch.segmentCount >= BATCH_SIZE) {
        if (batch.timer) {
          clearTimeout(batch.timer);
          batch.timer = null;
        }
        uploadPendingSegments(data.posthog_recording_id);
      }
    }
  });

  // Listen for meeting ended events
  window.electronAPI.onRecallMeetingEnded((data) => {
    console.log("[RecordingService] Meeting ended:", data);

    const batch = uploadBatches.get(data.posthog_recording_id);
    if (batch?.timer) {
      clearTimeout(batch.timer);
    }
    uploadBatches.delete(data.posthog_recording_id);

    // Upload any pending segments, then update status to uploading
    uploadPendingSegments(data.posthog_recording_id).then(() => {
      const store = useActiveRecordingStore.getState();
      store.updateStatus(data.posthog_recording_id, "uploading");
    });
  });

  // Listen for recording ready events
  window.electronAPI.onRecallRecordingReady((data) => {
    console.log("[RecordingService] Recording ready:", data);

    const store = useActiveRecordingStore.getState();
    store.updateStatus(data.posthog_recording_id, "ready");
    store.clearRecording(data.posthog_recording_id);
  });

  console.log("[RecordingService] Initialized successfully");
}

/**
 * Upload pending transcript segments to backend
 */
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

    // Upload segments to backend
    await client.updateDesktopRecordingTranscript(recordingId, {
      segments: pendingSegments.map((seg) => ({
        timestamp_ms: seg.timestamp,
        speaker: seg.speaker,
        text: seg.text,
        confidence: seg.confidence,
        is_final: seg.is_final,
      })),
    });

    // Update last uploaded index
    const newIndex =
      recording.lastUploadedSegmentIndex + pendingSegments.length;
    store.updateLastUploadedIndex(recordingId, newIndex);

    console.log(
      `[RecordingService] Successfully uploaded ${pendingSegments.length} segments`,
    );

    // Reset batch tracker
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
 * Called on app startup. Keeps things simple: save what we have and move on.
 *
 * Tradeoff: Might lose last ~10 segments if upload fails during crash recovery.
 * Acceptable because: (1) Backend already has 90%+ from batched uploads during meeting
 * (2) Crashes are rare, (3) Crash + upload failure is even rarer
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

    // Upload pending segments in background (best effort, don't block startup)
    uploadPendingSegments(recording.id).catch((error) => {
      console.error(
        `[RecordingService] Failed to upload segments during recovery (acceptable):`,
        error,
      );
    });

    // Clear from IDB immediately - recording is already in backend
    store.clearRecording(recording.id);
    console.log(`[RecordingService] Cleared ${recording.id} from IDB`);
  }
}

/**
 * Clean up the recording service
 * Call this when the app shuts down
 */
export function shutdownRecordingService() {
  console.log("[RecordingService] Shutting down...");

  // Clear all upload batch timers
  for (const batch of uploadBatches.values()) {
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
  }
  uploadBatches.clear();

  // Reset initialization flag to allow re-initialization after logout/login
  isInitialized = false;

  console.log("[RecordingService] Shutdown complete");
}
