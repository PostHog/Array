import { Trash } from "@phosphor-icons/react";
import { Button, Card, Flex, Text } from "@radix-ui/themes";
import type { Recording } from "@shared/types";
import { formatDistanceToNow } from "date-fns";
import { AudioPlayer } from "./AudioPlayer";
import { TranscriptionSection } from "./TranscriptionSection";

interface RecordingCardProps {
  recording: Recording;
  openaiApiKey: string | null;
  isTranscribing: boolean;
  onDelete: (recordingId: string) => void;
  onTranscribe: (recordingId: string) => void;
  onRetryTranscription: (recordingId: string) => void;
  onUpdateApiKey: () => void;
  onCreateTasks: (recording: Recording) => void;
}

export function RecordingCard({
  recording,
  openaiApiKey,
  isTranscribing,
  onDelete,
  onTranscribe,
  onRetryTranscription,
  onUpdateApiKey,
  onCreateTasks,
}: RecordingCardProps) {
  return (
    <Card>
      <Flex direction="column" gap="3">
        {/* Recording Header */}
        <Flex justify="between" align="start">
          <Flex direction="column" gap="1" style={{ flex: 1 }}>
            <Text size="3" weight="medium">
              {recording.transcription?.summary || recording.filename}
            </Text>
            <Text size="1" color="gray">
              {formatDistanceToNow(new Date(recording.created_at), {
                addSuffix: true,
              })}
            </Text>
          </Flex>
          {/* Delete button */}
          <Button
            size="1"
            variant="ghost"
            color="red"
            onClick={() => {
              if (confirm("Delete this recording?")) {
                onDelete(recording.id);
              }
            }}
          >
            <Trash />
          </Button>
        </Flex>

        {/* Audio Player */}
        <AudioPlayer recordingId={recording.id} duration={recording.duration} />

        {/* Transcription Section */}
        <TranscriptionSection
          recording={recording}
          openaiApiKey={openaiApiKey}
          isTranscribing={isTranscribing}
          onTranscribe={onTranscribe}
          onRetryTranscription={onRetryTranscription}
          onUpdateApiKey={onUpdateApiKey}
          onCreateTasks={onCreateTasks}
        />
      </Flex>
    </Card>
  );
}
