import type { RecordingItem } from "@renderer/features/notetaker/hooks/useAllRecordings";
import { create } from "zustand";

interface NotetakerState {
  selectedRecording: RecordingItem | null;
  setSelectedRecording: (recording: RecordingItem | null) => void;
}

export const useNotetakerStore = create<NotetakerState>()((set) => ({
  selectedRecording: null,
  setSelectedRecording: (recording) => set({ selectedRecording: recording }),
}));
