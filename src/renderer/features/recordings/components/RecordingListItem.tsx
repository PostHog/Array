import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import type { Recording } from "@shared/types";
import { format } from "date-fns";

interface RecordingListItemProps {
  recording: Recording;
  isSelected: boolean;
  onClick: () => void;
}

function getRecordingStatus(
  recording: Recording,
): "recording" | "transcribing" | "transcribed" | "ready" {
  if (recording.transcription?.status === "processing") {
    return "transcribing";
  }
  if (recording.transcription?.status === "completed") {
    return "transcribed";
  }
  return "ready";
}

function getStatusColor(status: string): "blue" | "yellow" | "green" | "gray" {
  switch (status) {
    case "recording":
      return "blue";
    case "transcribing":
      return "yellow";
    case "transcribed":
      return "green";
    default:
      return "gray";
  }
}

export function RecordingListItem({
  recording,
  isSelected,
  onClick,
}: RecordingListItemProps) {
  const status = getRecordingStatus(recording);
  const title =
    recording.transcription?.summary ||
    format(new Date(recording.created_at), "h:mm a");
  const timestamp = format(new Date(recording.created_at), "MMM d, yyyy");

  return (
    <Box
      onClick={onClick}
      style={{
        padding: "12px",
        cursor: "pointer",
        backgroundColor: isSelected ? "var(--accent-3)" : "transparent",
        borderLeft: isSelected
          ? "2px solid var(--accent-9)"
          : "2px solid transparent",
        transition: "all 0.15s ease",
      }}
      className="hover:bg-[var(--accent-2)]"
    >
      <Flex direction="column" gap="1">
        <Flex justify="between" align="center">
          <Text size="2" weight="medium" style={{ flex: 1 }} truncate>
            {title}
          </Text>
          <Badge size="1" color={getStatusColor(status)}>
            {status}
          </Badge>
        </Flex>
        <Text size="1" color="gray">
          {timestamp}
        </Text>
      </Flex>
    </Box>
  );
}
