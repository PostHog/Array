import type { Schemas } from "@api/generated";
import { del, get, set } from "idb-keyval";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

function isValidRecordingId(id: string): boolean {
  if (!id || typeof id !== "string") {
    return false;
  }
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tempIdRegex =
    /^temp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) || tempIdRegex.test(id);
}

// Transcript segment from Recall SDK real-time events
export interface TranscriptSegment {
  timestamp: number; // Milliseconds from recording start
  speaker: string | null;
  text: string;
  confidence: number | null;
  is_final: boolean;
}

// AI analysis status
export type AnalysisStatus =
  | "pending" // Not started yet
  | "analyzing_summary" // Generating summary
  | "analyzing_tasks" // Extracting tasks
  | "completed" // All analysis done
  | "error" // Analysis failed
  | "skipped"; // Skipped (no OpenAI key)

// AI-extracted task
export interface ExtractedTask {
  title: string;
  description: string;
}

// Active recording state - extends backend DesktopRecording with client-only fields
export interface ActiveRecording extends Schemas.DesktopRecording {
  // Client-only fields for real-time state
  segments: TranscriptSegment[]; // Live segments (for upload batching)
  notes: string; // User's scratchpad notes
  uploadRetries: number; // Retry tracking
  errorMessage?: string; // Error details
  lastUploadedSegmentIndex: number; // Track which segments have been uploaded

  // AI analysis fields
  analysisStatus: AnalysisStatus;
  summary?: string; // AI-generated 3-7 word title
  extractedTasks?: ExtractedTask[]; // AI-extracted action items
  analysisError?: string; // Error message if analysis failed
}

interface ActiveRecordingState {
  activeRecordings: ActiveRecording[];

  // Core methods
  addRecording: (recording: Schemas.DesktopRecording) => void;
  addSegment: (recordingId: string, segment: TranscriptSegment) => void;
  updateStatus: (
    recordingId: string,
    status: ActiveRecording["status"],
  ) => void;
  updateNotes: (recordingId: string, notes: string) => void;
  updateLastUploadedIndex: (recordingId: string, index: number) => void;
  setError: (recordingId: string, errorMessage: string) => void;
  clearRecording: (recordingId: string) => void;
  getRecording: (recordingId: string) => ActiveRecording | undefined;
  getPendingSegments: (recordingId: string) => TranscriptSegment[];

  // AI analysis methods
  setAnalysisStatus: (recordingId: string, status: AnalysisStatus) => void;
  setSummary: (recordingId: string, summary: string) => void;
  setExtractedTasks: (recordingId: string, tasks: ExtractedTask[]) => void;
  setAnalysisError: (recordingId: string, error: string) => void;
}

// Custom storage adapter for idb-keyval
const storage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

export const useActiveRecordingStore = create<ActiveRecordingState>()(
  persist(
    (set, get) => ({
      activeRecordings: [],

      addRecording: (recording) => {
        const existing = get().activeRecordings.find(
          (r) => r.id === recording.id,
        );
        if (existing) {
          console.warn(
            `[ActiveRecording] Recording ${recording.id} already exists`,
          );
          return;
        }

        set((state) => ({
          activeRecordings: [
            ...state.activeRecordings,
            {
              ...recording,
              segments: [],
              notes: "",
              uploadRetries: 0,
              lastUploadedSegmentIndex: -1,
              analysisStatus: "pending",
            },
          ],
        }));
        console.log(`[ActiveRecording] Added recording ${recording.id}`);
      },

      addSegment: (recordingId, segment) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId
              ? { ...r, segments: [...r.segments, segment] }
              : r,
          ),
        }));
      },

      updateStatus: (recordingId, status) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId ? { ...r, status } : r,
          ),
        }));
        console.log(
          `[ActiveRecording] Updated ${recordingId} status to ${status}`,
        );
      },

      updateNotes: (recordingId, notes) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId ? { ...r, notes } : r,
          ),
        }));
      },

      updateLastUploadedIndex: (recordingId, index) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId
              ? { ...r, lastUploadedSegmentIndex: index }
              : r,
          ),
        }));
      },

      setError: (recordingId, errorMessage) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId
              ? {
                  ...r,
                  status: "error",
                  errorMessage,
                  uploadRetries: r.uploadRetries + 1,
                }
              : r,
          ),
        }));
        console.error(
          `[ActiveRecording] Error for ${recordingId}: ${errorMessage}`,
        );
      },

      clearRecording: (recordingId) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.filter(
            (r) => r.id !== recordingId,
          ),
        }));
        console.log(
          `[ActiveRecording] Cleared recording ${recordingId} from IDB`,
        );
      },

      getRecording: (recordingId) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return undefined;
        }
        return get().activeRecordings.find((r) => r.id === recordingId);
      },

      getPendingSegments: (recordingId) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return [];
        }
        const recording = get().activeRecordings.find(
          (r) => r.id === recordingId,
        );
        if (!recording) return [];

        return recording.segments.slice(recording.lastUploadedSegmentIndex + 1);
      },

      setAnalysisStatus: (recordingId, status) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId ? { ...r, analysisStatus: status } : r,
          ),
        }));
        console.log(`[ActiveRecording] Analysis status: ${status}`);
      },

      setSummary: (recordingId, summary) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId ? { ...r, summary } : r,
          ),
        }));
        console.log(`[ActiveRecording] Summary set: "${summary}"`);
      },

      setExtractedTasks: (recordingId, tasks) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId ? { ...r, extractedTasks: tasks } : r,
          ),
        }));
        console.log(`[ActiveRecording] ${tasks.length} tasks extracted`);
      },

      setAnalysisError: (recordingId, error) => {
        if (!isValidRecordingId(recordingId)) {
          console.error(
            `[ActiveRecording] Invalid recording ID: ${recordingId}`,
          );
          return;
        }
        set((state) => ({
          activeRecordings: state.activeRecordings.map((r) =>
            r.id === recordingId
              ? { ...r, analysisStatus: "error", analysisError: error }
              : r,
          ),
        }));
        console.error(`[ActiveRecording] Analysis error: ${error}`);
      },
    }),
    {
      name: "active-recordings", // IDB key
      storage: createJSONStorage(() => storage),
    },
  ),
);
