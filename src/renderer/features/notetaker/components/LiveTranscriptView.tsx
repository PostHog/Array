import { Badge, Box, Card, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useLiveTranscript } from "../hooks/useTranscript";

interface LiveTranscriptViewProps {
  posthogRecordingId: string; // PostHog UUID
}

export function LiveTranscriptView({
  posthogRecordingId,
}: LiveTranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const { segments, addSegment, forceUpload, pendingCount } =
    useLiveTranscript(posthogRecordingId);

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

  // Listen for meeting-ended event to force upload remaining segments
  useEffect(() => {
    console.log(
      `[LiveTranscript] Setting up meeting-ended listener for ${posthogRecordingId}`,
    );

    const cleanup = window.electronAPI.onMeetingEnded((event) => {
      if (event.posthog_recording_id === posthogRecordingId) {
        console.log(`[LiveTranscript] Meeting ended, force uploading segments`);
        forceUpload();
      }
    });

    return cleanup;
  }, [posthogRecordingId, forceUpload]);

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
        <Flex direction="column" gap="2">
          {segments.map((segment, idx) => (
            <Card
              key={`${segment.timestamp}-${idx}`}
              style={{
                opacity: 1,
              }}
            >
              <Flex direction="column" gap="1">
                <Flex align="center" gap="2">
                  {segment.speaker && (
                    <Text size="1" weight="bold" color="gray">
                      {segment.speaker}
                    </Text>
                  )}
                  <Text size="1" color="gray">
                    {formatTimestamp(segment.timestamp)}
                  </Text>
                </Flex>
                <Text size="2">{segment.text}</Text>
              </Flex>
            </Card>
          ))}
        </Flex>
      </ScrollArea>

      {!autoScroll && (
        <Box mt="2">
          <Text size="1" color="gray">
            Scroll to bottom to enable auto-scroll
          </Text>
        </Box>
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
