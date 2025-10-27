import {
  CheckCircleIcon,
  ClockIcon,
  TrashIcon,
  VideoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  ScrollArea,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useEffect } from "react";
import { useNotetakerStore } from "../stores/notetakerStore";

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

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function NotetakerView() {
  const {
    recordings,
    isLoading,
    error,
    fetchRecordings,
    deleteRecording,
    selectedRecordingId,
    setSelectedRecording,
  } = useNotetakerStore();

  useEffect(() => {
    fetchRecordings();
    const interval = setInterval(fetchRecordings, 10000);
    return () => clearInterval(interval);
  }, [fetchRecordings]);

  if (isLoading && recordings.length === 0) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Flex align="center" gap="3">
          <Spinner />
          <Text color="gray">Loading recordings...</Text>
        </Flex>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Flex direction="column" align="center" gap="3">
          <WarningCircleIcon size={32} />
          <Text color="red">{error}</Text>
          <Button onClick={() => fetchRecordings()}>Retry</Button>
        </Flex>
      </Flex>
    );
  }

  if (recordings.length === 0) {
    return (
      <Flex align="center" justify="center" minHeight="200px">
        <Flex direction="column" align="center" gap="3">
          <VideoIcon size={48} weight="duotone" />
          <Text color="gray">No recordings yet</Text>
          <Text size="2" color="gray">
            Join a meeting to start recording
          </Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Box p="4">
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Text size="5" weight="bold">
            Notetaker
          </Text>
          <Text size="2" color="gray">
            {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
          </Text>
        </Flex>

        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: "calc(100vh - 150px)" }}
        >
          <Flex direction="column" gap="2">
            {recordings.map((recording) => (
              <Card
                key={recording.id}
                style={{
                  cursor: "pointer",
                  backgroundColor:
                    selectedRecordingId === recording.id
                      ? "var(--accent-3)"
                      : undefined,
                }}
                onClick={() => setSelectedRecording(recording.id)}
              >
                <Flex justify="between" align="start" gap="3">
                  <Flex direction="column" gap="2" style={{ flex: 1 }}>
                    <Flex align="center" gap="2">
                      <Badge color={getStatusColor(recording.status)} size="1">
                        <Flex align="center" gap="1">
                          {getStatusIcon(recording.status)}
                          {recording.status}
                        </Flex>
                      </Badge>
                      <Badge variant="soft" size="1">
                        {recording.platform}
                      </Badge>
                    </Flex>

                    <Text weight="medium">
                      {recording.title || "Untitled meeting"}
                    </Text>

                    <Flex align="center" gap="3">
                      <Flex align="center" gap="1">
                        <ClockIcon size={14} />
                        <Text size="1" color="gray">
                          {formatDate(recording.created_at)}
                        </Text>
                      </Flex>
                      {recording.duration && (
                        <Text size="1" color="gray">
                          {formatDuration(recording.duration)}
                        </Text>
                      )}
                    </Flex>
                  </Flex>

                  <Button
                    size="1"
                    variant="ghost"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this recording?")) {
                        deleteRecording(recording.id);
                      }
                    }}
                  >
                    <TrashIcon />
                  </Button>
                </Flex>
              </Card>
            ))}
          </Flex>
        </ScrollArea>
      </Flex>
    </Box>
  );
}
