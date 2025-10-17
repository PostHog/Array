// Implementation in the next PR

import type { RecordingMode } from "@/renderer/features/recordings/stores/recordingStore";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  recordingMode: RecordingMode;
  availableDevices: MediaDeviceInfo[];
  selectedMicId: string;
  onRecordingModeChange: (mode: RecordingMode) => void;
  onMicrophoneChange: (deviceId: string) => void;
}

export function SettingsPanel(_props: SettingsPanelProps) {
  return <div>SettingsPanel</div>;
}
