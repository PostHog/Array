import {
  CheckCircleIcon,
  ClockIcon,
  VideoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Badge, Box, Card, Flex, Spinner, Text } from "@radix-ui/themes";
import { useAllRecordings } from "@renderer/features/notetaker/hooks/useAllRecordings";
import { useNotetakerStore } from "@renderer/features/notetaker/stores/notetakerStore";
import { useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { RecordingView } from "@/renderer/features/notetaker/components/RecordingView";

function getStatusIcon(
  status: "recording" | "uploading" | "processing" | "ready" | "error",
) {
  switch (status) {
    case "recording":
      return <VideoIcon weight="fill" />;
    case "uploading":
    case "processing":
      return <Spinner />;
    case "ready":
      return <CheckCircleIcon weight="fill" />;
    case "error":
      return <WarningCircleIcon weight="fill" />;
  }
}

function getStatusColor(
  status: "recording" | "uploading" | "processing" | "ready" | "error",
) {
  switch (status) {
    case "recording":
      return "red";
    case "uploading":
    case "processing":
      return "blue";
    case "ready":
      return "green";
    case "error":
      return "orange";
  }
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function NotetakerView() {
  const { allRecordings, isLoading } = useAllRecordings();
  const selectedRecordingId = useNotetakerStore(
    (state) => state.selectedRecordingId,
  );
  const setSelectedRecordingId = useNotetakerStore(
    (state) => state.setSelectedRecordingId,
  );

  const selectedRecording = useMemo(
    () =>
      selectedRecordingId
        ? allRecordings.find(
            (item) =>
              item.recording.id === selectedRecordingId.id &&
              item.type === selectedRecordingId.type,
          )
        : null,
    [allRecordings, selectedRecordingId],
  );

  useEffect(() => {
    if (allRecordings.length > 0 && !selectedRecordingId) {
      setSelectedRecordingId({
        id: allRecordings[0].recording.id,
        type: allRecordings[0].type,
      });
    }
  }, [allRecordings, selectedRecordingId, setSelectedRecordingId]);

  useHotkeys(
    "up",
    (e) => {
      e.preventDefault();
      const currentIndex = allRecordings.findIndex(
        (item) =>
          item.recording.id === selectedRecordingId?.id &&
          item.type === selectedRecordingId?.type,
      );

      if (currentIndex === -1 && allRecordings.length > 0) {
        const first = allRecordings[0];
        setSelectedRecordingId({ id: first.recording.id, type: first.type });
      } else if (currentIndex > 0) {
        const prev = allRecordings[currentIndex - 1];
        setSelectedRecordingId({ id: prev.recording.id, type: prev.type });
      }
    },
    [allRecordings, selectedRecordingId, setSelectedRecordingId],
  );

  useHotkeys(
    "down",
    (e) => {
      e.preventDefault();
      const currentIndex = allRecordings.findIndex(
        (item) =>
          item.recording.id === selectedRecordingId?.id &&
          item.type === selectedRecordingId?.type,
      );

      if (currentIndex === -1 && allRecordings.length > 0) {
        const first = allRecordings[0];
        setSelectedRecordingId({ id: first.recording.id, type: first.type });
      } else if (currentIndex < allRecordings.length - 1) {
        const next = allRecordings[currentIndex + 1];
        setSelectedRecordingId({ id: next.recording.id, type: next.type });
      }
    },
    [allRecordings, selectedRecordingId, setSelectedRecordingId],
  );

  if (allRecordings.length === 0 && !isLoading) {
    return (
      <Box p="4">
        <Flex direction="column" gap="4">
          <Text size="5" weight="bold">
            Notetaker
          </Text>
          <Flex align="center" justify="center" minHeight="120px">
            <Flex direction="column" align="center" gap="3">
              <VideoIcon size={48} weight="duotone" />
              <Text color="gray">No recordings</Text>
              <Text size="2" color="gray">
                Join a meeting to start recording
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Box>
    );
  }

  return (
    <Flex style={{ height: "100vh" }}>
      <Box
        p="4"
        style={{
          width: selectedRecording ? "350px" : "100%",
          borderRight: selectedRecording ? "1px solid var(--gray-5)" : "none",
          overflowY: "auto",
        }}
      >
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text size="5" weight="bold">
              Notetaker
            </Text>
            <Flex direction="column" align="end" gap="1">
              <Text size="2" color="gray">
                {allRecordings.length} recording
                {allRecordings.length !== 1 ? "s" : ""}
              </Text>
              <Text size="1" color="gray">
                ↑↓
              </Text>
            </Flex>
          </Flex>

          <Flex direction="column" gap="2">
            {allRecordings.map((item) => {
              const recording = item.recording;
              const status =
                item.type === "active"
                  ? recording.status || "recording"
                  : "ready";
              const title = recording.meeting_title || "Untitled meeting";
              const platform = recording.platform || "unknown";
              const createdAt =
                recording.created_at || new Date().toISOString();
              const errorMessage =
                item.type === "active"
                  ? item.recording.errorMessage
                  : undefined;

              return (
                <Card
                  key={`${item.type}-${recording.id}`}
                  style={{
                    cursor: "pointer",
                    backgroundColor:
                      selectedRecordingId?.id === recording.id &&
                      selectedRecordingId?.type === item.type
                        ? "var(--accent-3)"
                        : undefined,
                  }}
                  onClick={() =>
                    setSelectedRecordingId({
                      id: recording.id,
                      type: item.type,
                    })
                  }
                >
                  <Flex justify="between" align="start" gap="3">
                    <Flex direction="column" gap="2" style={{ flex: 1 }}>
                      <Flex align="center" gap="2">
                        <Badge color={getStatusColor(status)} size="1">
                          <Flex align="center" gap="1">
                            {getStatusIcon(status)}
                            {status}
                          </Flex>
                        </Badge>
                        <Badge variant="soft" size="1">
                          {platform}
                        </Badge>
                      </Flex>

                      <Text weight="medium">{title}</Text>

                      <Flex align="center" gap="1">
                        <ClockIcon size={14} />
                        <Text size="1" color="gray">
                          {formatDate(createdAt)}
                        </Text>
                      </Flex>

                      {errorMessage && (
                        <Text size="1" color="red">
                          {errorMessage}
                        </Text>
                      )}
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        </Flex>
      </Box>

      {selectedRecording && <RecordingView recordingItem={selectedRecording} />}
    </Flex>
  );
}
