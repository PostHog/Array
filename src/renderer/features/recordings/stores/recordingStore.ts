import type { Recording } from "@shared/types";
import { create } from "zustand";

const MAX_DURATION_SECONDS = 3 * 60 * 60;

export type RecordingMode = "microphone" | "system-audio" | "both";

interface RecordingState {
  isRecording: boolean;
  recordingDuration: number;
  recordingId: string | null;
  error: string | null;

  recordingMode: RecordingMode;
  selectedMicId: string;
  availableDevices: MediaDeviceInfo[];

  selectedRecordingId: string | null;

  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  audioContext: AudioContext | null;
  streamsToStop: MediaStream[];

  setRecordingMode: (mode: RecordingMode) => void;
  setSelectedMicId: (deviceId: string) => void;
  setAvailableDevices: (devices: MediaDeviceInfo[]) => void;
  setSelectedRecording: (recordingId: string | null) => void;
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
  cleanup: () => void;
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
  recordingMode: "both",
  selectedMicId: "",
  availableDevices: [],
  selectedRecordingId: null,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  streamsToStop: [],

  setRecordingMode: (mode) => set({ recordingMode: mode }),
  setSelectedMicId: (deviceId) => set({ selectedMicId: deviceId }),
  setAvailableDevices: (devices) => set({ availableDevices: devices }),
  setSelectedRecording: (recordingId) =>
    set({ selectedRecordingId: recordingId }),

  startRecording: async () => {
    try {
      const { recordingMode, selectedMicId } = get();
      set({ error: null });

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

      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const streamsToStop: MediaStream[] = [];

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

      if (recordingMode === "system-audio") {
        console.log(
          "[Recording] System audio mode: Recording from microphone. " +
            "For better audio capture, use speakers or install BlackHole virtual audio device.",
        );
      }

      const combinedStream = destination.stream;
      const audioTrackCount = combinedStream.getAudioTracks().length;

      if (audioTrackCount === 0) {
        throw new Error("No audio tracks available for recording");
      }

      combinedStream.getAudioTracks().forEach((track, idx) => {
        console.log(`[Recording] Audio track ${idx}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings(),
        });
      });

      const analyser = audioContext.createAnalyser();
      const testSource = audioContext.createMediaStreamSource(combinedStream);
      testSource.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      setTimeout(() => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += Math.abs(dataArray[i] - 128);
        }
        const average = sum / dataArray.length;
        console.log(
          `[Recording] Audio activity check: average=${average.toFixed(2)} (>0 means audio is flowing)`,
        );
        if (average < 0.1) {
          console.warn(
            "[Recording] WARNING: Very low or no audio activity detected. Audio may not be capturing properly.",
          );
        }
        testSource.disconnect();
      }, 4000);

      console.log(
        `[Recording] Starting with ${audioTrackCount} audio track(s)`,
      );

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 64000,
      });

      mediaRecorder.ondataavailable = (event) => {
        console.log(
          `[Recording] Chunk received: ${event.data.size} bytes, type: ${event.data.type}`,
        );
        if (event.data.size > 0) {
          const currentChunks = get().audioChunks;
          set({ audioChunks: [...currentChunks, event.data] });
        } else {
          console.warn("[Recording] Empty chunk received");
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("[Recording] MediaRecorder error:", event);
      };

      mediaRecorder.onstart = () => {
        console.log("[Recording] MediaRecorder started");
      };

      mediaRecorder.onstop = () => {
        console.log("[Recording] MediaRecorder stopped");
      };

      const { recordingId } = await window.electronAPI.recordingStart();

      mediaRecorder.start(1000);

      set({
        isRecording: true,
        recordingDuration: 0,
        recordingId,
        mediaRecorder,
        audioChunks: [],
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

      if (mediaRecorder.state === "inactive") {
        console.warn("[Recording] MediaRecorder already stopped");
        return;
      }

      mediaRecorder.stop();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("MediaRecorder stop timeout after 5 seconds"));
        }, 5000);

        mediaRecorder.onstop = async () => {
          clearTimeout(timeout);
          try {
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            console.log(
              `[Recording] Stopped - ${audioChunks.length} chunks, ${(audioBlob.size / 1024).toFixed(2)} KB total`,
            );

            const arrayBuffer = await audioBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            await saveRecording({
              recordingId,
              audioData: uint8Array,
              duration: recordingDuration,
            });

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
    if (recordingDuration >= MAX_DURATION_SECONDS) {
      return;
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

  cleanup: () => {
    const { mediaRecorder, audioContext, streamsToStop } = get();

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.warn(
          "[Recording] Failed to stop MediaRecorder during cleanup:",
          error,
        );
      }
    }

    streamsToStop.forEach((stream) => {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn(
            "[Recording] Failed to stop track during cleanup:",
            error,
          );
        }
      });
    });

    if (audioContext && audioContext.state !== "closed") {
      try {
        audioContext.close();
      } catch (error) {
        console.warn(
          "[Recording] Failed to close AudioContext during cleanup:",
          error,
        );
      }
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
  },
}));
