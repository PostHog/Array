import { PostHogAPIClient } from "@api/posthogClient";
import RecallAiSdk from "@recallai/desktop-sdk";
import { ipcMain } from "electron";

interface RecordingSession {
  windowId: string;
  recordingId: string;
  platform: string;
  participants: Set<string>;
  firstSegmentTimestamp: number | null;
  lastSegmentTimestamp: number | null;
}

const activeSessions = new Map<string, RecordingSession>();
let posthogClient: PostHogAPIClient | null = null;
let sdkInitialized = false;

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

      // Check if we already have an active session for this window
      const existingSession = activeSessions.get(evt.window.id);
      if (existingSession) {
        console.log(
          `[Recall SDK] Meeting already being recorded for window ${evt.window.id} (recording ID: ${existingSession.recordingId}). Ignoring duplicate meeting-detected event.`,
        );
        return;
      }

      const platform = detectPlatform(evt.window);

      // Skip recording if we can't detect a supported platform
      if (!platform) {
        console.log(`[Recall SDK] Skipping recording - unsupported platform`);
        return;
      }

      const meetingTitle = evt.window.title || evt.window.url || "Meeting";
      const meetingUrl = evt.window.url || null;
      console.log(
        `[Recall SDK] Starting recording: ${platform} - ${meetingTitle}`,
      );

      if (!posthogClient) {
        throw new Error("PostHog client not initialized");
      }

      const response = await posthogClient.createDesktopRecording(platform);
      const upload_token = response.upload_token;
      const recording_id = response.id || response.recording_id;

      await RecallAiSdk.startRecording({
        windowId: evt.window.id,
        uploadToken: upload_token,
      });

      activeSessions.set(evt.window.id, {
        windowId: evt.window.id,
        recordingId: recording_id,
        platform,
        participants: new Set<string>(),
        firstSegmentTimestamp: null,
        lastSegmentTimestamp: null,
      });

      // Immediately update recording metadata with title, URL, and status
      try {
        await posthogClient.updateDesktopRecording(recording_id, {
          status: "recording",
          title: meetingTitle,
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

      console.log(`[Recall SDK] Recording started (ID: ${recording_id})`);
    } catch (error) {
      console.error("[Recall SDK] Error starting recording:", error);
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

      const session = activeSessions.get(evt.window.id);
      if (session && posthogClient) {
        try {
          await posthogClient.updateDesktopRecording(session.recordingId, {
            status: "uploading",
          });
          console.log(
            `[Recall SDK] Updated recording ${session.recordingId} status to uploading`,
          );
        } catch (error) {
          console.error(
            "[Recall SDK] Failed to update recording status:",
            error,
          );
        }
      }

      await RecallAiSdk.uploadRecording({
        windowId: evt.window.id,
      });
    } catch (error) {
      console.error("[Recall SDK] Error uploading recording:", error);

      const session = activeSessions.get(evt.window.id);
      if (session && posthogClient) {
        try {
          await posthogClient.updateDesktopRecording(session.recordingId, {
            status: "error",
          });
        } catch (updateError) {
          console.error(
            "[Recall SDK] Failed to update error status:",
            updateError,
          );
        }
      }
    }
  });

  RecallAiSdk.addEventListener("upload-progress", async (evt) => {
    if (evt.progress === 100) {
      console.log("[Recall SDK] Upload complete");

      const session = activeSessions.get(evt.window.id);
      if (session && posthogClient) {
        try {
          // Calculate duration from first and last transcript segment timestamps
          let duration_seconds = null;
          if (
            session.firstSegmentTimestamp !== null &&
            session.lastSegmentTimestamp !== null
          ) {
            duration_seconds = Math.floor(
              (session.lastSegmentTimestamp - session.firstSegmentTimestamp) /
                1000,
            );
          }

          // Prepare participants array
          const participants = Array.from(session.participants).map((name) => ({
            name,
          }));

          await posthogClient.updateDesktopRecording(session.recordingId, {
            status: "ready",
            ...(duration_seconds && { duration: duration_seconds }),
            ...(participants.length > 0 && { participants }),
          });
          console.log(
            `[Recall SDK] Updated recording ${session.recordingId} to ready with duration (${duration_seconds}s) and ${participants.length} participants`,
          );

          // Notify renderer that meeting ended
          console.log(
            `[Recall SDK] Sending meeting-ended event for ${session.recordingId}`,
          );
          const { BrowserWindow } = await import("electron");
          const allWindows = BrowserWindow.getAllWindows();
          for (const window of allWindows) {
            window.webContents.send("recall:meeting-ended", {
              posthog_recording_id: session.recordingId,
              platform: session.platform,
            });
          }
          console.log(
            `[Recall SDK] Sent meeting-ended to ${allWindows.length} window(s)`,
          );

          // Clean up session after upload complete
          activeSessions.delete(evt.window.id);
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
    // Handle real-time transcript segments from AssemblyAI
    if (evt.event === "transcript.data") {
      const session = activeSessions.get(evt.window.id);
      if (!session) {
        console.warn(
          `[Recall SDK] Received transcript for unknown window: ${evt.window.id}`,
        );
        return;
      }

      // Parse the words array to build the text
      const words = evt.data?.data?.words || [];
      if (words.length === 0) {
        return; // No words in this segment
      }

      const text = words.map((w: { text: string }) => w.text).join(" ");
      const speaker = evt.data?.data?.participant?.name || null;
      const firstWord = words[0];
      const timestamp = firstWord?.start_timestamp?.relative
        ? Math.floor(firstWord.start_timestamp.relative * 1000)
        : 0;

      // Track unique participants
      if (speaker) {
        session.participants.add(speaker);
      }

      // Track first and last segment timestamps for duration calculation
      if (
        session.firstSegmentTimestamp === null ||
        timestamp < session.firstSegmentTimestamp
      ) {
        session.firstSegmentTimestamp = timestamp;
      }
      if (
        session.lastSegmentTimestamp === null ||
        timestamp > session.lastSegmentTimestamp
      ) {
        session.lastSegmentTimestamp = timestamp;
      }

      console.log(
        `[Recall SDK] Transcript segment: "${text}" (speaker: ${speaker}, participants: ${session.participants.size})`,
      );

      // Send transcript segment to renderer via IPC
      const { BrowserWindow } = await import("electron");
      const allWindows = BrowserWindow.getAllWindows();
      for (const window of allWindows) {
        window.webContents.send("recall:transcript-segment", {
          posthog_recording_id: session.recordingId,
          timestamp,
          speaker,
          text,
          confidence: null, // AssemblyAI doesn't provide confidence per segment
          is_final: true, // AssemblyAI sends finalized segments
        });
      }
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

function detectPlatform(window: {
  url?: string;
  title?: string;
}): string | null {
  const urlString = window.url?.toLowerCase() || "";
  const title = window.title?.toLowerCase() || "";

  let hostname = "";
  try {
    if (urlString) {
      const parsedUrl = new URL(urlString);
      hostname = parsedUrl.hostname;
    }
  } catch {
    // Invalid URL, fall back to title-based detection only
  }

  // URL-based detection (most reliable)
  if (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) {
    return "zoom";
  }

  if (
    hostname === "teams.microsoft.com" ||
    hostname.endsWith(".teams.microsoft.com")
  ) {
    return "teams";
  }

  if (hostname === "meet.google.com") {
    return "meet";
  }

  if (hostname === "app.slack.com" || hostname.endsWith(".slack.com")) {
    return "slack";
  }

  // Fallback to title-based detection only if URL is unavailable
  if (!hostname) {
    if (title.includes("zoom")) {
      console.warn(
        "[Recall SDK] Detecting Zoom via window title only (no URL available)",
      );
      return "zoom";
    }

    if (title.includes("teams")) {
      console.warn(
        "[Recall SDK] Detecting Teams via window title only (no URL available)",
      );
      return "teams";
    }

    if (title.includes("google meet")) {
      console.warn(
        "[Recall SDK] Detecting Meet via window title only (no URL available)",
      );
      return "meet";
    }

    if (title.includes("slack")) {
      console.warn(
        "[Recall SDK] Detecting Slack via window title only (no URL available)",
      );
      return "slack";
    }
  }

  // Return null if we can't detect a supported platform
  console.warn(
    `[Recall SDK] Unable to detect supported platform (Zoom/Teams/Meet/Slack) - hostname: ${hostname}, title: ${title}`,
  );
  return null;
}

export function requestRecallPermission(
  permission: "accessibility" | "screen-capture" | "microphone",
) {
  RecallAiSdk.requestPermission(permission);
}

export function shutdownRecallSDK() {
  RecallAiSdk.shutdown();
}

export function getActiveSessions() {
  return Array.from(activeSessions.values());
}

export function registerRecallIPCHandlers() {
  ipcMain.handle(
    "recall:initialize",
    async (_event, recallApiUrl, posthogKey, posthogHost) => {
      initializeRecallSDK(recallApiUrl, posthogKey, posthogHost);
    },
  );

  ipcMain.handle("recall:get-active-sessions", async () => {
    return getActiveSessions();
  });

  ipcMain.handle("recall:request-permission", async (_event, permission) => {
    requestRecallPermission(permission);
  });

  ipcMain.handle("recall:shutdown", async () => {
    shutdownRecallSDK();
  });

  ipcMain.handle("notetaker:get-recordings", async () => {
    if (!posthogClient) {
      throw new Error(
        "PostHog client not initialized. Please authenticate first.",
      );
    }
    if (!sdkInitialized) {
      throw new Error("Recall SDK not initialized");
    }
    return await posthogClient.listDesktopRecordings();
  });

  ipcMain.handle("notetaker:get-recording", async (_event, recordingId) => {
    if (!posthogClient) {
      throw new Error(
        "PostHog client not initialized. Please authenticate first.",
      );
    }
    if (!sdkInitialized) {
      throw new Error("Recall SDK not initialized");
    }
    return await posthogClient.getDesktopRecording(recordingId);
  });

  ipcMain.handle("notetaker:delete-recording", async (_event, recordingId) => {
    if (!posthogClient) {
      throw new Error(
        "PostHog client not initialized. Please authenticate first.",
      );
    }
    if (!sdkInitialized) {
      throw new Error("Recall SDK not initialized");
    }
    return await posthogClient.deleteDesktopRecording(recordingId);
  });
}
