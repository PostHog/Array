import { create } from "zustand";

const MAX_DURATION_SECONDS = 3 * 60 * 60; // 3 hours

interface RecordingState {
  // Recording state
  isRecording: boolean;
  recordingDuration: number;
  error: string | null;
  recordingId: string | null;

  // MediaRecorder and chunks (not persisted)
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];

  // Actions
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ success: boolean; recording?: any }>;
  incrementDuration: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  recordingDuration: 0,
  error: null,
  recordingId: null,
  mediaRecorder: null,
  audioChunks: [],

  startRecording: async () => {
    try {
      set({ error: null });

      // Get audio stream from user's microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Start recording session in main process
      const { recordingId } = await window.electronAPI.recordingStart();

      // Create MediaRecorder to capture audio with lower bitrate
      // 64 kbps provides good voice quality while keeping file sizes manageable
      // This allows ~3-4 hours of recording within OpenAI's 25 MB limit
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: 64000, // 64 kbps
      });

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          set({ audioChunks: [...audioChunks] });
        }
      };

      mediaRecorder.start(1000); // Capture data every second

      set({
        isRecording: true,
        recordingDuration: 0,
        recordingId,
        mediaRecorder,
        audioChunks,
      });
    } catch (err) {
      console.error("Failed to start recording:", err);
      set({
        error: err instanceof Error ? err.message : "Failed to start recording",
      });
    }
  },

  stopRecording: async (): Promise<{ success: boolean; recording?: any }> => {
    try {
      const { mediaRecorder, recordingId, audioChunks, recordingDuration } =
        get();

      if (!mediaRecorder || !recordingId) {
        return { success: false };
      }

      // Stop the recorder
      mediaRecorder.stop();

      // Stop all tracks
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());

      // Return a promise that resolves when recording is saved
      return await new Promise((resolve) => {
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, {
            type: "audio/webm",
          });

          // Convert blob to buffer and send to main process
          const arrayBuffer = await audioBlob.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);

          // Send audio data and duration to main process
          const recording = await window.electronAPI.recordingStop(
            recordingId,
            buffer,
            recordingDuration,
          );

          set({
            isRecording: false,
            recordingDuration: 0,
            mediaRecorder: null,
            recordingId: null,
            audioChunks: [],
          });

          resolve({ success: true, recording });
        };
      });
    } catch (err) {
      console.error("Failed to stop recording:", err);
      set({
        error: "Failed to stop recording",
        isRecording: false,
      });
      return { success: false };
    }
  },

  incrementDuration: () => {
    const { recordingDuration, stopRecording } = get();
    if (recordingDuration >= MAX_DURATION_SECONDS) {
      stopRecording();
      return;
    }
    set({ recordingDuration: recordingDuration + 1 });
  },

  setError: (error: string | null) => set({ error }),

  reset: () =>
    set({
      isRecording: false,
      recordingDuration: 0,
      error: null,
      recordingId: null,
      mediaRecorder: null,
      audioChunks: [],
    }),
}));
