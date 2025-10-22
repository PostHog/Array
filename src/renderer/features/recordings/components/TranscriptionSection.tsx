import { Box, Button, Callout, Card, Flex, Text } from "@radix-ui/themes";
import type { Recording } from "@shared/types";

interface TranscriptionSectionProps {
  recording: Recording;
  openaiApiKey: string | null;
  isTranscribing: boolean;
  onTranscribe: (recordingId: string) => void;
  onRetryTranscription: (recordingId: string) => void;
  onUpdateApiKey: () => void;
  onCreateTasks: (recording: Recording) => void;
}

export function TranscriptionSection({
  recording,
  openaiApiKey,
  isTranscribing,
  onTranscribe,
  onRetryTranscription,
  onUpdateApiKey,
  onCreateTasks,
}: TranscriptionSectionProps) {
  // No transcription yet - show transcribe button
  if (!recording.transcription) {
    return (
      <Button
        size="2"
        variant="soft"
        disabled={!openaiApiKey || isTranscribing}
        onClick={() => onTranscribe(recording.id)}
      >
        {isTranscribing
          ? "Transcribing..."
          : openaiApiKey
            ? "Transcribe"
            : "Set API Key to Transcribe"}
      </Button>
    );
  }

  // Processing state
  if (recording.transcription.status === "processing") {
    return (
      <Callout.Root color="blue">
        <Callout.Text>Transcribing audio...</Callout.Text>
      </Callout.Root>
    );
  }

  // Error state
  if (recording.transcription.status === "error") {
    const errorMessage = recording.transcription.error || "Unknown error";
    const isApiKeyError =
      errorMessage.includes("invalid_api_key") ||
      errorMessage.includes("Incorrect API key");
    const isQuotaError = errorMessage.includes("insufficient_quota");

    const friendlyError = isApiKeyError
      ? "Invalid OpenAI API key. Please check your API key and try again."
      : isQuotaError
        ? "OpenAI API quota exceeded. Please check your billing at platform.openai.com."
        : errorMessage;

    return (
      <Callout.Root color="red">
        <Flex direction="column" gap="3">
          <Box>
            <Text size="2" weight="medium" mb="1">
              Transcription Failed
            </Text>
            <Text size="2" color="red">
              {friendlyError}
            </Text>
          </Box>
          <Flex gap="2">
            <Button
              size="2"
              variant="soft"
              onClick={() => onRetryTranscription(recording.id)}
            >
              Retry Transcription
            </Button>
            {isApiKeyError && (
              <Button
                size="2"
                variant="soft"
                color="gray"
                onClick={onUpdateApiKey}
              >
                Update API Key
              </Button>
            )}
          </Flex>
        </Flex>
      </Callout.Root>
    );
  }

  // Completed state - show transcript and extracted tasks
  if (recording.transcription.status === "completed") {
    return (
      <Flex direction="column" gap="3">
        {/* Transcript */}
        <Box>
          <Flex justify="between" align="center" mb="1">
            <Text size="2" weight="medium">
              Transcript
            </Text>
            <Button
              size="1"
              variant="ghost"
              color="gray"
              disabled={!openaiApiKey || isTranscribing}
              onClick={() => onRetryTranscription(recording.id)}
            >
              {isTranscribing ? "Transcribing..." : "Re-transcribe"}
            </Button>
          </Flex>
          <Card variant="surface">
            <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
              {recording.transcription.text}
            </Text>
          </Card>
        </Box>

        {/* Extracted Tasks */}
        {recording.transcription.extracted_tasks &&
          recording.transcription.extracted_tasks.length > 0 && (
            <Box>
              <Flex justify="between" align="center" mb="2">
                <Text size="2" weight="medium">
                  Extracted Tasks (
                  {recording.transcription.extracted_tasks.length})
                </Text>
                <Button
                  size="1"
                  variant="soft"
                  onClick={() => onCreateTasks(recording)}
                >
                  Create All Tasks
                </Button>
              </Flex>
              <Flex direction="column" gap="2">
                {recording.transcription.extracted_tasks.map((task) => (
                  <Card
                    key={`${task.title}-${task.description.slice(0, 20)}`}
                    variant="surface"
                  >
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">
                        {task.title}
                      </Text>
                      <Text size="1" color="gray">
                        {task.description}
                      </Text>
                    </Flex>
                  </Card>
                ))}
              </Flex>
            </Box>
          )}
      </Flex>
    );
  }

  return null;
}
