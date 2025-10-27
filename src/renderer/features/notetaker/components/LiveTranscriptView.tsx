import { ListChecksIcon, SparkleIcon } from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  ScrollArea,
  Separator,
  Text,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { useExtractTasks } from "../hooks/useExtractTasks";
import { useLiveTranscript, useTranscript } from "../hooks/useTranscript";

interface LiveTranscriptViewProps {
  posthogRecordingId: string; // PostHog UUID
}

export function LiveTranscriptView({
  posthogRecordingId,
}: LiveTranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const openaiApiKey = useAuthStore((state) => state.openaiApiKey);

  const { segments, addSegment, forceUpload, pendingCount } =
    useLiveTranscript(posthogRecordingId);

  const { data: transcriptData } = useTranscript(posthogRecordingId);
  const extractTasksMutation = useExtractTasks();

  const handleExtractTasks = () => {
    const fullText = segments.map((s) => s.text).join(" ");
    extractTasksMutation.mutate({
      recordingId: posthogRecordingId,
      transcriptText: fullText,
    });
  };

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current && segments.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments.length, autoScroll]);

  // Listen for new transcript segments from IPC
  useEffect(() => {
    console.log(
      `[LiveTranscript] Setting up listener for recording ${posthogRecordingId}`,
    );

    const cleanup = window.electronAPI.onTranscriptSegment((segment) => {
      console.log(
        `[LiveTranscript] Received segment for ${segment.posthog_recording_id}:`,
        segment.text,
      );

      if (segment.posthog_recording_id !== posthogRecordingId) {
        console.log(
          `[LiveTranscript] Ignoring segment - not for this recording (${posthogRecordingId})`,
        );
        return; // Not for this recording
      }

      console.log("[LiveTranscript] Adding segment to local buffer");

      // Add to local buffer
      addSegment({
        timestamp: segment.timestamp,
        speaker: segment.speaker,
        text: segment.text,
        confidence: segment.confidence,
      });
    });

    return cleanup;
  }, [posthogRecordingId, addSegment]);

  // Listen for meeting-ended event to force upload remaining segments and extract tasks
  useEffect(() => {
    console.log(
      `[LiveTranscript] Setting up meeting-ended listener for ${posthogRecordingId}`,
    );

    const cleanup = window.electronAPI.onMeetingEnded((event) => {
      if (event.posthog_recording_id === posthogRecordingId) {
        console.log(
          `[LiveTranscript] Meeting ended, force uploading segments and extracting tasks`,
        );
        forceUpload();

        // Automatically extract tasks when meeting ends (if OpenAI key is configured)
        if (openaiApiKey && segments.length > 0) {
          console.log(
            `[LiveTranscript] Auto-extracting tasks for ${segments.length} segments`,
          );
          const fullText = segments.map((s) => s.text).join(" ");
          extractTasksMutation.mutate({
            recordingId: posthogRecordingId,
            transcriptText: fullText,
          });
        }
      }
    });

    return cleanup;
  }, [
    posthogRecordingId,
    forceUpload,
    openaiApiKey,
    segments,
    extractTasksMutation,
  ]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  if (!segments || segments.length === 0) {
    return (
      <Box p="4">
        <Card>
          <Text color="gray" size="2">
            Waiting for transcript...
          </Text>
        </Card>
      </Box>
    );
  }

  return (
    <Box
      p="4"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Flex justify="between" mb="3">
        <Text size="2" weight="bold">
          Live transcript
        </Text>
        <Flex gap="2">
          {pendingCount > 0 && (
            <Badge color="blue" radius="full">
              {pendingCount} pending upload
            </Badge>
          )}
          <Badge color="green" radius="full">
            {segments.length} segments
          </Badge>
        </Flex>
      </Flex>

      <ScrollArea
        type="auto"
        scrollbars="vertical"
        style={{ flex: 1, maxHeight: "60vh" }} // Limited height
        ref={scrollRef as never}
        onScroll={handleScroll}
      >
        <Flex direction="column" gap="1">
          {segments.map((segment, idx) => {
            const prevSegment = idx > 0 ? segments[idx - 1] : null;
            const isSameSpeaker = prevSegment?.speaker === segment.speaker;

            return (
              <Flex
                key={`${segment.timestamp}-${idx}`}
                gap="2"
                py="1"
                px="2"
                style={{
                  backgroundColor:
                    idx % 2 === 0 ? "var(--gray-2)" : "transparent",
                }}
              >
                {/* Speaker name (only show if different from previous) */}
                <Box style={{ minWidth: "100px", flexShrink: 0 }}>
                  {!isSameSpeaker && segment.speaker && (
                    <Text
                      size="1"
                      weight="bold"
                      style={{ color: getSpeakerColor(segment.speaker) }}
                    >
                      {segment.speaker}
                    </Text>
                  )}
                </Box>

                {/* Timestamp + Text */}
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Flex align="baseline" gap="2">
                    <Text
                      size="1"
                      color="gray"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatTimestamp(segment.timestamp)}
                    </Text>
                    <Text size="2" style={{ lineHeight: "1.5" }}>
                      {segment.text}
                    </Text>
                  </Flex>
                </Flex>
              </Flex>
            );
          })}
        </Flex>
      </ScrollArea>

      {!autoScroll && (
        <Box mt="2">
          <Text size="1" color="gray">
            Scroll to bottom to enable auto-scroll
          </Text>
        </Box>
      )}

      {/* Extract Tasks Section */}
      {segments.length > 0 && (
        <>
          <Separator size="4" my="4" />
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Heading size="4">
                <Flex align="center" gap="2">
                  <ListChecksIcon size={20} />
                  Extracted tasks
                </Flex>
              </Heading>
              <Button
                size="2"
                onClick={handleExtractTasks}
                disabled={extractTasksMutation.isPending || !openaiApiKey}
              >
                <SparkleIcon />
                {extractTasksMutation.isPending
                  ? "Extracting..."
                  : "Extract tasks"}
              </Button>
            </Flex>

            {!openaiApiKey && !transcriptData?.extracted_tasks && (
              <Card>
                <Text size="2" color="gray">
                  Add OpenAI API key in settings to extract tasks
                </Text>
              </Card>
            )}

            {transcriptData?.extracted_tasks &&
              transcriptData.extracted_tasks.length > 0 && (
                <Flex direction="column" gap="2">
                  {transcriptData.extracted_tasks.map((task, idx) => (
                    <Card key={`${task.title}-${idx}`}>
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
              )}

            {transcriptData?.extracted_tasks &&
              transcriptData.extracted_tasks.length === 0 && (
                <Card>
                  <Text size="2" color="gray">
                    No tasks found in transcript
                  </Text>
                </Card>
              )}

            {extractTasksMutation.isError && (
              <Card>
                <Text size="2" color="red">
                  Failed to extract tasks:{" "}
                  {extractTasksMutation.error instanceof Error
                    ? extractTasksMutation.error.message
                    : "Unknown error"}
                </Text>
              </Card>
            )}
          </Flex>
        </>
      )}
    </Box>
  );
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Consistent color assignment for speakers
function getSpeakerColor(speaker: string): string {
  const colors = [
    "var(--blue-11)",
    "var(--green-11)",
    "var(--orange-11)",
    "var(--purple-11)",
    "var(--pink-11)",
    "var(--cyan-11)",
  ];

  // Simple hash function to consistently map speaker to color
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
