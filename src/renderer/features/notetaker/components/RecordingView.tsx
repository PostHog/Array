import { Badge, Box, Card, Flex, Text } from "@radix-ui/themes";
import type { RecordingItem } from "@renderer/features/notetaker/hooks/useAllRecordings";
import type { TranscriptSegment } from "@renderer/stores/activeRecordingStore";
import { useEffect, useRef, useState } from "react";

interface RecordingViewProps {
  recordingItem: RecordingItem;
}

export function RecordingView({ recordingItem }: RecordingViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const segments: TranscriptSegment[] =
    recordingItem.type === "active"
      ? recordingItem.recording.segments || []
      : (
          recordingItem.recording.transcript?.segments as Array<{
            timestamp_ms: number;
            speaker: string | null;
            text: string;
            confidence: number | null;
            is_final: boolean;
          }>
        )?.map((seg) => ({
          timestamp: seg.timestamp_ms,
          speaker: seg.speaker,
          text: seg.text,
          confidence: seg.confidence,
          is_final: seg.is_final,
        })) || [];

  useEffect(() => {
    if (autoScroll && scrollRef.current && segments.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  const isPastRecording = recordingItem.type === "past";
  const hasSegments = segments.length > 0;

  return (
    <Box
      p="4"
      className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden"
    >
      {/* Meeting Header */}
      <Flex direction="column" gap="2">
        <Text size="4" weight="bold">
          {recordingItem.recording.meeting_title || "Untitled meeting"}
        </Text>
        <Flex gap="2">
          <Badge color="gray" variant="soft">
            {recordingItem.recording.platform}
          </Badge>
          <Text size="2" color="gray">
            {new Date(
              recordingItem.recording.created_at || new Date(),
            ).toLocaleString()}
          </Text>
        </Flex>
      </Flex>

      {/* Summary - only for past recordings */}
      {isPastRecording && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Summary
          </Text>
          <Card>
            <Flex align="center" justify="center" py="4">
              <Text size="2" color="gray">
                Coming soon
              </Text>
            </Flex>
          </Card>
        </Flex>
      )}

      {/* Action items - only for past recordings */}
      {isPastRecording && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Action items
          </Text>
          <Card>
            <Flex align="center" justify="center" py="4">
              <Text size="2" color="gray">
                Coming soon
              </Text>
            </Flex>
          </Card>
        </Flex>
      )}

      {/* Notes - only for past recordings */}
      {isPastRecording && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Notes
          </Text>
          <Card>
            <Flex align="center" justify="center" py="4">
              <Text size="2" color="gray">
                Coming soon
              </Text>
            </Flex>
          </Card>
        </Flex>
      )}

      {/* Transcript */}
      <Flex direction="column" gap="2">
        <Flex justify="between" align="center">
          <Text size="2" weight="bold">
            {isPastRecording ? "Transcript" : "Live transcript"}
          </Text>
          {hasSegments && (
            <Badge color="gray" radius="full" size="1" variant="soft">
              {segments.length} segments
            </Badge>
          )}
        </Flex>

        {hasSegments ? (
          <Box
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              maxHeight: "300px",
              minHeight: "200px",
              border: "1px solid var(--gray-5)",
              borderRadius: "var(--radius-3)",
              overflowY: "auto",
            }}
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
          </Box>
        ) : (
          <Card>
            <Flex align="center" justify="center" py="4">
              <Text size="2" color="gray">
                {isPastRecording
                  ? "No transcript available"
                  : "Waiting for transcript..."}
              </Text>
            </Flex>
          </Card>
        )}

        {!isPastRecording && !autoScroll && hasSegments && (
          <Text size="1" color="gray">
            Scroll to bottom to enable auto-scroll
          </Text>
        )}
      </Flex>
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
