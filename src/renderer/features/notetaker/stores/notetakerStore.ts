import { create } from "zustand";

interface SelectedRecording {
  id: string;
  type: "active" | "past";
}

interface NotetakerState {
  selectedRecordingId: SelectedRecording | null;
  setSelectedRecordingId: (selection: SelectedRecording | null) => void;
}

export const useNotetakerStore = create<NotetakerState>()((set) => ({
  selectedRecordingId: null,
  setSelectedRecordingId: (selection) =>
    set({ selectedRecordingId: selection }),
}));
