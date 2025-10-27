import {
  ArrowClockwiseIcon,
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
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useState } from "react";
import { useDeleteRecording, useRecordings } from "../hooks/useRecordings";
import { useUploadTranscript } from "../hooks/useTranscript";
import { LiveTranscriptView } from "./LiveTranscriptView";

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
  const { data: recordings = [], isLoading, error, refetch } = useRecordings();
  const deleteMutation = useDeleteRecording();
  const uploadTranscriptMutation = useUploadTranscript();
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(
    null,
  );

  const handleRetry = (recordingId: string) => {
    // For retry, we need to fetch local segments and upload
    // Since we're now backend-first, this will trigger a re-sync
    uploadTranscriptMutation.mutate({
      recordingId,
      segments: [], // Empty will fetch from backend
    });
  };

  const handleDelete = (recordingId: string) => {
    if (confirm("Delete this recording?")) {
      deleteMutation.mutate(recordingId, {
        onSuccess: () => {
          if (selectedRecordingId === recordingId) {
            setSelectedRecordingId(null);
          }
        },
      });
    }
  };

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
          <Text color="red">{String(error)}</Text>
          <Button onClick={() => refetch()}>Retry</Button>
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

  const selectedRecording = recordings.find(
    (r) => r.id === selectedRecordingId,
  );

  return (
    <Flex style={{ height: "100vh" }}>
      {/* Left sidebar: Recordings list */}
      <Box
        p="4"
        style={{
          width: selectedRecordingId ? "350px" : "100%",
          borderRight: selectedRecordingId ? "1px solid var(--gray-5)" : "none",
          overflowY: "auto",
        }}
      >
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text size="5" weight="bold">
              Notetaker
            </Text>
            <Text size="2" color="gray">
              {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
            </Text>
          </Flex>

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
                onClick={() => setSelectedRecordingId(recording.id)}
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

                  <Flex gap="1">
                    {recording.status === "error" && (
                      <Button
                        size="1"
                        variant="ghost"
                        color="blue"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(recording.id);
                        }}
                      >
                        <ArrowClockwiseIcon />
                      </Button>
                    )}
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(recording.id);
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        </Flex>
      </Box>

      {/* Right panel: Live transcript view */}
      {selectedRecordingId && selectedRecording && (
        <Box style={{ flex: 1, overflowY: "auto" }}>
          <LiveTranscriptView posthogRecordingId={selectedRecordingId} />
        </Box>
      )}
    </Flex>
  );
}
