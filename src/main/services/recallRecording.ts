import { PostHogAPIClient } from "@api/posthogClient";
import RecallAiSdk from "@recallai/desktop-sdk";
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";

// Minimal mapping to track windowId -> recordingId for SDK events
// This is needed because Recall SDK events only provide windowId, not our recording ID
const windowToRecordingMap = new Map<string, string>();

// Track if we're currently recording (for deduplication)
// This is the ONLY piece of state we keep in main process
// All other state (segments, participants, etc.) lives in Zustand
let isRecording = false;

let posthogClient: PostHogAPIClient | null = null;
let sdkInitialized = false;
let mainWindow: BrowserWindow | null = null;

/**
 * Call this from main/index.ts after creating the window
 */
export function setMainWindow(window: BrowserWindow) {
  mainWindow = window;
  console.log("[Recall SDK] Main window reference set");
}

/**
 * Follows Recall's official sample pattern
 */
function sendToRenderer(channel: string, data: unknown) {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(channel, data);
    } else {
      console.warn(
        `[Recall SDK] Cannot send to renderer - window not available`,
      );
    }
  } catch (error) {
    console.error(`[Recall SDK] Failed to send message to renderer:`, error);
  }
}

// Support both short and long variants for compatibility
const SUPPORTED_PLATFORMS = new Set([
  "google-meet",
  "meet",
  "microsoft-teams",
  "teams",
  "zoom",
  "slack",
]);

function normalizePlatform(platform: string): string {
  const normalized = platform.toLowerCase();

  const platformMap: Record<string, string> = {
    "google-meet": "meet",
    "microsoft-teams": "teams",
  };

  return platformMap[normalized] || normalized;
}

function generateDefaultTitle(platform: string): string {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const year = now.getFullYear();

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, "0");

  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

  return `${platformName} meeting - ${month}/${day}/${year} ${formattedHours}:${minutes} ${ampm}`;
}

export function isRecallSDKInitialized(): boolean {
  return sdkInitialized;
}

export function initializeRecallSDK(
  recallApiUrl: string,
  posthogKey: string,
  posthogHost: string,
) {
  if (sdkInitialized) {
    console.warn("[Recall SDK] Already initialized, skipping");
    return;
  }

  if (posthogClient) {
    console.warn(
      "[Recall SDK] Client already exists, preventing re-initialization",
    );
    return;
  }

  console.log("[Recall SDK] Initializing...");

  sdkInitialized = true;
  posthogClient = new PostHogAPIClient(posthogKey, posthogHost);

  RecallAiSdk.init({
    apiUrl: recallApiUrl,
    acquirePermissionsOnStartup: [
      "accessibility",
      "screen-capture",
      "microphone",
    ],
    restartOnError: true,
  });

  console.log("[Recall SDK] Ready. Listening for meetings...");

  RecallAiSdk.addEventListener("permissions-granted", async () => {
    console.log("[Recall SDK] Permissions granted");
  });

  RecallAiSdk.addEventListener("permission-status", async (evt) => {
    if (evt.status === "denied" || evt.status === "error") {
      console.warn(`[Recall SDK] Permission ${evt.permission}: ${evt.status}`);
    }
  });

  RecallAiSdk.addEventListener("meeting-detected", async (evt) => {
    try {
      // Log all available metadata to help identify the meeting
      console.log(
        "[Recall SDK] Meeting detected - Available metadata:",
        JSON.stringify(evt, null, 2),
      );

      // Only allow ONE recording at a time to prevent duplicates
      if (isRecording) {
        console.log(
          `[Recall SDK] Already recording. Ignoring duplicate meeting-detected event.`,
        );
        return;
      }

      const platform = (evt.window as { platform?: string }).platform;
      if (!platform) {
        console.log(`[Recall SDK] Skipping recording - no platform provided`);
        return;
      }

      if (!SUPPORTED_PLATFORMS.has(platform.toLowerCase())) {
        console.log(
          `[Recall SDK] Skipping recording - unsupported platform: ${platform}`,
        );
        return;
      }

      const normalizedPlatform = normalizePlatform(platform);
      const meetingTitle =
        evt.window.title || generateDefaultTitle(normalizedPlatform);
      const meetingUrl = evt.window.url || null;
      console.log(
        `[Recall SDK] Starting recording: ${platform} (normalized: ${normalizedPlatform}) - ${meetingTitle}`,
      );

      if (!posthogClient) {
        throw new Error("PostHog client not initialized");
      }

      const response =
        await posthogClient.createDesktopRecording(normalizedPlatform);
      const upload_token = response.upload_token;
      const recording_id = response.id;

      await RecallAiSdk.startRecording({
        windowId: evt.window.id,
        uploadToken: upload_token,
      });

      // Store minimal mapping for SDK events (which only provide windowId)
      windowToRecordingMap.set(evt.window.id, recording_id);
      isRecording = true;

      // Immediately update recording metadata with title, URL, and status
      try {
        await posthogClient.updateDesktopRecording(recording_id, {
          status: "recording",
          meeting_title: meetingTitle,
          ...(meetingUrl && { meeting_url: meetingUrl }),
        });
        console.log(
          `[Recall SDK] Updated recording ${recording_id} with title, URL, and status`,
        );
      } catch (error) {
        console.error(
          "[Recall SDK] Failed to update recording metadata:",
          error,
        );
      }

      // Fetch the updated recording with all fields from API
      const fullRecording =
        await posthogClient.getDesktopRecording(recording_id);

      // Forward full DesktopRecording to renderer
      sendToRenderer("recall:recording-started", fullRecording);

      console.log(`[Recall SDK] Recording started (ID: ${recording_id})`);
    } catch (error) {
      console.error("[Recall SDK] Error starting recording:", error);
      // Reset flag if recording failed to start
      isRecording = false;
    }
  });

  RecallAiSdk.addEventListener("sdk-state-change", async (evt) => {
    const state = evt.sdk.state.code;
    if (state !== "recording") {
      console.log(`[Recall SDK] State: ${state}`);
    }
  });

  RecallAiSdk.addEventListener("recording-ended", async (evt) => {
    try {
      console.log("[Recall SDK] Recording ended, uploading...");

      const recordingId = windowToRecordingMap.get(evt.window.id);
      if (!recordingId) {
        console.warn(
          `[Recall SDK] No recording ID found for window ${evt.window.id}`,
        );
        return;
      }

      // Update backend status
      if (posthogClient) {
        try {
          await posthogClient.updateDesktopRecording(recordingId, {
            status: "uploading",
          });
        } catch (error) {
          console.error(
            "[Recall SDK] Failed to update recording status:",
            error,
          );
        }
      }

      // Forward to renderer
      sendToRenderer("recall:meeting-ended", {
        posthog_recording_id: recordingId,
      });

      await RecallAiSdk.uploadRecording({
        windowId: evt.window.id,
      });
    } catch (error) {
      console.error("[Recall SDK] Error uploading recording:", error);

      const recordingId = windowToRecordingMap.get(evt.window.id);
      if (recordingId && posthogClient) {
        try {
          await posthogClient.updateDesktopRecording(recordingId, {
            status: "error",
          });
        } catch (updateError) {
          console.error(
            "[Recall SDK] Failed to update error status:",
            updateError,
          );
        }

        sendToRenderer("recall:meeting-ended", {
          posthog_recording_id: recordingId,
        });
      }

      // Clear recording flag on error
      isRecording = false;
    }
  });

  RecallAiSdk.addEventListener("upload-progress", async (evt) => {
    if (evt.progress === 100) {
      console.log("[Recall SDK] Upload complete");

      const recordingId = windowToRecordingMap.get(evt.window.id);
      if (!recordingId) {
        console.warn(
          `[Recall SDK] No recording ID found for window ${evt.window.id}`,
        );
        return;
      }

      if (posthogClient) {
        try {
          await posthogClient.updateDesktopRecording(recordingId, {
            status: "ready",
          });
          console.log(`[Recall SDK] Updated recording ${recordingId} to ready`);

          sendToRenderer("recall:recording-ready", {
            posthog_recording_id: recordingId,
          });

          // Clean up state
          windowToRecordingMap.delete(evt.window.id);
          isRecording = false;
        } catch (error) {
          console.error(
            "[Recall SDK] Failed to update recording status:",
            error,
          );
        }
      }
    }
  });

  RecallAiSdk.addEventListener("meeting-closed", async (_evt) => {
    console.log("[Recall SDK] Meeting closed");
    // Note: Session cleanup is now handled in upload-progress listener
    // to ensure we don't delete the session before upload completes
  });

  RecallAiSdk.addEventListener("meeting-updated", async (_evt) => {});

  RecallAiSdk.addEventListener("media-capture-status", async (_evt) => {});

  RecallAiSdk.addEventListener("realtime-event", async (evt) => {
    if (evt.event === "transcript.data") {
      const recordingId = windowToRecordingMap.get(evt.window.id);
      if (!recordingId) {
        console.warn(
          `[Recall SDK] Received transcript for unknown window: ${evt.window.id}`,
        );
        return;
      }

      const words = evt.data?.data?.words || [];
      if (words.length === 0) {
        return;
      }

      const text = words.map((w: { text: string }) => w.text).join(" ");
      const speaker = evt.data?.data?.participant?.name || null;
      const firstWord = words[0];
      const timestamp = firstWord?.start_timestamp?.relative
        ? Math.floor(firstWord.start_timestamp.relative * 1000)
        : 0;

      console.log(
        `[Recall SDK] Transcript segment: "${text}" (speaker: ${speaker})`,
      );

      // Forward to renderer
      sendToRenderer("recall:transcript-segment", {
        posthog_recording_id: recordingId,
        timestamp,
        speaker,
        text,
        confidence: null,
        is_final: true,
      });
    }
  });

  RecallAiSdk.addEventListener("error", async (evt) => {
    console.error(
      `[Recall SDK] Error: ${evt.message}`,
      evt.window?.id ? `(window: ${evt.window.id})` : "",
    );
  });

  RecallAiSdk.addEventListener("shutdown", async (evt) => {
    if (evt.code !== 0) {
      console.warn(
        `[Recall SDK] Unexpected shutdown - code: ${evt.code}, signal: ${evt.signal}`,
      );
    }
  });
}

export function requestRecallPermission(
  permission: "accessibility" | "screen-capture" | "microphone",
) {
  RecallAiSdk.requestPermission(permission);
}

export function shutdownRecallSDK() {
  RecallAiSdk.shutdown();
}

export function registerRecallIPCHandlers() {
  ipcMain.handle(
    "recall:initialize",
    async (_event, recallApiUrl, posthogKey, posthogHost) => {
      initializeRecallSDK(recallApiUrl, posthogKey, posthogHost);
    },
  );

  ipcMain.handle("recall:request-permission", async (_event, permission) => {
    requestRecallPermission(permission);
  });

  ipcMain.handle("recall:shutdown", async () => {
    shutdownRecallSDK();
  });
}
