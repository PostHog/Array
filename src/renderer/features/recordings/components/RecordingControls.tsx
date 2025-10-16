import { CircleIcon, MicrophoneIcon } from "@phosphor-icons/react";
import { Button, Flex, Kbd, Select, Text } from "@radix-ui/themes";

interface RecordingControlsProps {
  isRecording: boolean;
  recordingDuration: number;
  recordingMode: "microphone" | "system-audio" | "both";
  availableDevices: MediaDeviceInfo[];
  selectedMicId: string;
  onRecordingModeChange: (mode: "microphone" | "system-audio" | "both") => void;
  onMicrophoneChange: (deviceId: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function RecordingControls({
  isRecording,
  recordingDuration,
  recordingMode,
  availableDevices,
  selectedMicId,
  onRecordingModeChange,
  onMicrophoneChange,
  onStartRecording,
  onStopRecording,
}: RecordingControlsProps) {
  return (
    <Flex direction="column" gap="2" align="end">
      {!isRecording && (
        <Flex gap="2" align="center">
          <MicrophoneIcon size={16} weight="duotone" />
          <Select.Root
            value={recordingMode}
            onValueChange={(value) =>
              onRecordingModeChange(
                value as "microphone" | "system-audio" | "both",
              )
            }
            size="1"
          >
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="microphone">Microphone Only</Select.Item>
              <Select.Item value="system-audio">System Audio Only</Select.Item>
              <Select.Item value="both">Microphone + System Audio</Select.Item>
            </Select.Content>
          </Select.Root>
          {availableDevices.length > 1 && (
            <Select.Root
              value={selectedMicId}
              onValueChange={onMicrophoneChange}
              size="1"
            >
              <Select.Trigger placeholder="Select microphone" />
              <Select.Content>
                {availableDevices.map((device) => (
                  <Select.Item key={device.deviceId} value={device.deviceId}>
                    {device.label ||
                      `Microphone ${device.deviceId.slice(0, 8)}`}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          )}
        </Flex>
      )}
      <Flex gap="3" align="center">
        {isRecording && (
          <Flex align="center" gap="2">
            <CircleIcon
              size={12}
              weight="fill"
              className="animate-pulse text-red-500"
            />
            <Text size="2" color="gray">
              {formatDuration(recordingDuration)}
            </Text>
          </Flex>
        )}
        <Button
          size="2"
          variant="soft"
          color={isRecording ? "red" : "blue"}
          onClick={isRecording ? onStopRecording : onStartRecording}
        >
          <Flex align="center" gap="2">
            <Text size="2">
              {isRecording ? "Stop Recording" : "Start Recording"}
            </Text>
            <Kbd size="1">{isRecording ? "S" : "R"}</Kbd>
          </Flex>
        </Button>
      </Flex>
    </Flex>
  );
}
