import { CircleIcon } from "@phosphor-icons/react";
import { Button, Flex, Kbd, Text } from "@radix-ui/themes";

interface RecordingControlsProps {
  isRecording: boolean;
  recordingDuration: number;
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
  onStartRecording,
  onStopRecording,
}: RecordingControlsProps) {
  return (
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
  );
}
