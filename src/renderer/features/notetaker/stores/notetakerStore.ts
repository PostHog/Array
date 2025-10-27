import { create } from "zustand";

export interface DesktopRecording {
  id: string;
  platform: string;
  title: string | null;
  status: "recording" | "uploading" | "processing" | "ready" | "error";
  duration: number | null;
  created_at: string;
  video_url: string | null;
  recall_recording_id: string | null;
}

interface NotetakerState {
  recordings: DesktopRecording[];
  isLoading: boolean;
  error: string | null;
  selectedRecordingId: string | null;

  fetchRecordings: () => Promise<void>;
  setSelectedRecording: (id: string | null) => void;
  deleteRecording: (id: string) => Promise<void>;
  refreshRecording: (id: string) => Promise<void>;
}

export const useNotetakerStore = create<NotetakerState>((set, get) => ({
  recordings: [],
  isLoading: false,
  error: null,
  selectedRecordingId: null,

  fetchRecordings: async () => {
    set({ isLoading: true, error: null });
    try {
      const recordings = await window.electronAPI.notetakerGetRecordings();
      set({ recordings, isLoading: false });
    } catch (error) {
      console.error("[Notetaker] Failed to fetch recordings:", error);
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch recordings",
        isLoading: false,
      });
    }
  },

  setSelectedRecording: (id) => set({ selectedRecordingId: id }),

  deleteRecording: async (id: string) => {
    try {
      await window.electronAPI.notetakerDeleteRecording(id);
      const { recordings } = get();
      set({
        recordings: recordings.filter((r) => r.id !== id),
        selectedRecordingId:
          get().selectedRecordingId === id ? null : get().selectedRecordingId,
      });
    } catch (error) {
      console.error("[Notetaker] Failed to delete recording:", error);
      set({
        error:
          error instanceof Error ? error.message : "Failed to delete recording",
      });
    }
  },

  refreshRecording: async (id: string) => {
    try {
      const recording = await window.electronAPI.notetakerGetRecording(id);
      const { recordings } = get();
      set({
        recordings: recordings.map((r) => (r.id === id ? recording : r)),
      });
    } catch (error) {
      console.error("[Notetaker] Failed to refresh recording:", error);
    }
  },
}));
