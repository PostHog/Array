import type { Recording } from "@shared/types";
import { create } from "zustand";

const MAX_DURATION_SECONDS = 3 * 60 * 60; // 3 hours

export type RecordingMode = "microphone" | "system-audio" | "both";

interface RecordingState {
  // Recording state
  isRecording: boolean;
  recordingDuration: number;
  recordingId: string | null;
  error: string | null;

  // Recording configuration
  recordingMode: RecordingMode;
  selectedMicId: string;
  availableDevices: MediaDeviceInfo[];

  // MediaRecorder and streams (not persisted)
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  audioContext: AudioContext | null;
  streamsToStop: MediaStream[];

  // Actions
  setRecordingMode: (mode: RecordingMode) => void;
  setSelectedMicId: (deviceId: string) => void;
  setAvailableDevices: (devices: MediaDeviceInfo[]) => void;
  startRecording: () => Promise<void>;
  stopRecording: (
    saveRecording: (params: {
      recordingId: string;
      audioData: Uint8Array;
      duration: number;
    }) => Promise<Recording>,
  ) => Promise<void>;
  incrementDuration: () => void;
  reset: () => void;
}

// Check if system audio capture is supported
function isSystemAudioSupported(): boolean {
  const isChromium = "chrome" in window;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return isChromium && !isMobile;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  recordingDuration: 0,
  recordingId: null,
  error: null,
  recordingMode: "both", // Default: capture both mic and system audio for meetings
  selectedMicId: "",
  availableDevices: [],
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  streamsToStop: [],

  setRecordingMode: (mode) => set({ recordingMode: mode }),
  setSelectedMicId: (deviceId) => set({ selectedMicId: deviceId }),
  setAvailableDevices: (devices) => set({ availableDevices: devices }),

  startRecording: async () => {
    try {
      const { recordingMode, selectedMicId } = get();
      set({ error: null });

      // Check system audio support
      const needsSystemAudio =
        recordingMode === "system-audio" || recordingMode === "both";
      if (needsSystemAudio && !isSystemAudioSupported()) {
        set({
          error:
            "System audio capture is not supported in your browser. " +
            "Please use Chrome/Edge or switch to 'Microphone Only' mode.",
        });
        return;
      }

      // Create audio context for mixing
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const streamsToStop: MediaStream[] = [];

      // Get microphone if needed
      if (recordingMode === "microphone" || recordingMode === "both") {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamsToStop.push(micStream);
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
      }

      // Get system audio if needed - use getDisplayMedia for tab audio capture
      if (recordingMode === "system-audio" || recordingMode === "both") {
        try {
          // Use getDisplayMedia to let user select a tab with audio
          // This works great for browser-based meetings (Google Meet, Zoom web)
          const systemStream = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
            } as MediaTrackConstraints,
            video: {
              displaySurface: "browser",
            } as MediaTrackConstraints,
            // @ts-expect-error - Chromium supports preferCurrentTab
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            systemAudio: "exclude",
            surfaceSwitching: "include",
            monitorTypeSurfaces: "exclude",
          });

          // Stop video tracks immediately (we only want audio)
          systemStream.getVideoTracks().forEach((track) => {
            track.stop();
          });

          // Check for audio tracks
          const audioTracks = systemStream.getAudioTracks();

          if (audioTracks.length > 0) {
            console.log("[Recording] Tab audio captured:", {
              tracks: audioTracks.length,
              state: audioTracks[0].readyState,
              enabled: audioTracks[0].enabled,
              label: audioTracks[0].label,
            });
            streamsToStop.push(systemStream);
            const systemSource =
              audioContext.createMediaStreamSource(systemStream);
            systemSource.connect(destination);
          } else {
            console.warn("[Recording] No audio tracks in tab stream");
            if (recordingMode === "system-audio") {
              set({
                error:
                  "No tab audio captured. Make sure to:\n" +
                  "1. Select a Chrome tab (not entire screen)\n" +
                  "2. Check 'Share tab audio' in the picker\n" +
                  "3. The tab has audio playing (e.g., Google Meet, Zoom)",
              });
              audioContext.close();
              streamsToStop.forEach((stream) => {
                stream.getTracks().forEach((track) => {
                  track.stop();
                });
              });
              return;
            }
          }
        } catch (error) {
          console.error("[Recording] Tab audio error:", error);
          if (recordingMode === "system-audio") {
            set({
              error:
                error instanceof Error && error.name === "NotAllowedError"
                  ? "Screen sharing permission denied. Please allow screen sharing and select a Chrome tab with 'Share tab audio' enabled."
                  : error instanceof Error
                    ? error.message
                    : "Tab audio capture failed. Make sure to select a Chrome tab and enable 'Share tab audio'.",
            });
            audioContext.close();
            streamsToStop.forEach((stream) => {
              stream.getTracks().forEach((track) => {
                track.stop();
              });
            });
            return;
          }
        }
      }

      const combinedStream = destination.stream;
      const audioTrackCount = combinedStream.getAudioTracks().length;

      if (audioTrackCount === 0) {
        throw new Error("No audio tracks available for recording");
      }

      console.log(
        `[Recording] Starting with ${audioTrackCount} audio track(s)`,
      );

      // Create MediaRecorder with optimized settings
      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 64000, // 64 kbps for good quality + manageable file size
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const currentChunks = get().audioChunks;
          set({ audioChunks: [...currentChunks, event.data] });
        } else {
          console.warn("[Recording] Empty chunk received");
        }
      };

      // Start recording session in main process
      const { recordingId } = await window.electronAPI.recordingStart();

      // Start capturing
      mediaRecorder.start(1000); // Capture every second

      set({
        isRecording: true,
        recordingDuration: 0,
        recordingId,
        mediaRecorder,
        audioChunks: [], // Start with fresh chunks array
        audioContext,
        streamsToStop,
      });
    } catch (err) {
      console.error("Failed to start recording:", err);
      set({
        error:
          err instanceof Error
            ? err.message
            : "Failed to start recording. Please check permissions.",
      });
    }
  },

  stopRecording: async (saveRecording) => {
    try {
      const {
        mediaRecorder,
        recordingId,
        audioChunks,
        recordingDuration,
        audioContext,
        streamsToStop,
      } = get();

      if (!mediaRecorder || !recordingId) {
        return;
      }

      // Stop the recorder
      mediaRecorder.stop();

      // Wait for onstop event
      await new Promise<void>((resolve) => {
        mediaRecorder.onstop = async () => {
          try {
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            console.log(
              `[Recording] Stopped - ${audioChunks.length} chunks, ${(audioBlob.size / 1024).toFixed(2)} KB total`,
            );

            const arrayBuffer = await audioBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Save recording via mutation (which will invalidate the query)
            await saveRecording({
              recordingId,
              audioData: uint8Array,
              duration: recordingDuration,
            });

            // Cleanup
            streamsToStop.forEach((stream) => {
              stream.getTracks().forEach((track) => {
                track.stop();
              });
            });
            if (audioContext) {
              audioContext.close();
            }

            set({
              isRecording: false,
              recordingDuration: 0,
              recordingId: null,
              mediaRecorder: null,
              audioChunks: [],
              audioContext: null,
              streamsToStop: [],
            });

            resolve();
          } catch (error) {
            console.error("Failed to save recording:", error);
            set({
              error: "Failed to save recording. Please try again.",
              isRecording: false,
            });
            resolve();
          }
        };
      });
    } catch (err) {
      console.error("Failed to stop recording:", err);
      set({
        error: "Failed to stop recording",
        isRecording: false,
      });
    }
  },

  incrementDuration: () => {
    const { recordingDuration } = get();
    // Just increment - let user manually stop if they hit max duration
    if (recordingDuration >= MAX_DURATION_SECONDS) {
      return; // Stop incrementing at max
    }
    set({ recordingDuration: recordingDuration + 1 });
  },

  reset: () =>
    set({
      isRecording: false,
      recordingDuration: 0,
      recordingId: null,
      error: null,
      mediaRecorder: null,
      audioChunks: [],
      audioContext: null,
      streamsToStop: [],
    }),
}));
