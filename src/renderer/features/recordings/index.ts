// Main component

// Sub-components (exported for flexibility if needed elsewhere)
export { AudioPlayer } from "./components/AudioPlayer";
export { RecordingControls } from "./components/RecordingControls";
export { RecordingsView } from "./components/RecordingsView";
export { SettingsPanel } from "./components/SettingsPanel";
export { TranscriptionSection } from "./components/TranscriptionSection";

// Hooks
export { useAudioRecorder } from "./hooks/useAudioRecorder";
export { useRecordings } from "./hooks/useRecordings";
export type { RecordingMode } from "./stores/recordingStore";
// Store
export { useRecordingStore } from "./stores/recordingStore";
