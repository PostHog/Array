import { Trash, X } from "@phosphor-icons/react";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  IconButton,
  Kbd,
  ScrollArea,
  Separator,
  Text,
} from "@radix-ui/themes";
import type { Recording } from "@shared/types";
import { format } from "date-fns";
import { useHotkeys } from "react-hotkeys-hook";
import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import { useAuthStore } from "../../../stores/authStore";
import { useRecordingStore } from "../stores/recordingStore";
import { AudioPlayer } from "./AudioPlayer";

interface RecordingDetailProps {
  recording: Recording;
  onDelete: (recordingId: string) => void;
  onTranscribe: (params: { recordingId: string; apiKey: string }) => void;
  isTranscribing: boolean;
  isSettingsOpen?: boolean;
}

export function RecordingDetail({
  recording,
  onDelete,
  onTranscribe,
  isTranscribing,
  isSettingsOpen = false,
}: RecordingDetailProps) {
  const { setSelectedRecording } = useRecordingStore();
  const openaiApiKey = useAuthStore((state) => state.openaiApiKey);

  useHotkeys(
    "esc",
    (e) => {
      if (!isSettingsOpen) {
        e.preventDefault();
        setSelectedRecording(null);
      }
    },
    { enableOnFormTags: false },
    [isSettingsOpen],
  );

  const title =
    recording.transcription?.summary ||
    `Recording ${format(new Date(recording.created_at), "h:mm a")}`;

  return (
    <Flex direction="column" style={{ height: "100%" }}>
      <Flex
        justify="between"
        align="center"
        p="4"
        style={{ borderBottom: "1px solid var(--gray-6)" }}
      >
        <Heading size="5">{title}</Heading>
        <Flex gap="2" align="center">
          <Flex align="center" gap="2">
            <Kbd size="1">Del</Kbd>
            <IconButton
              size="2"
              variant="ghost"
              color="red"
              onClick={() => {
                if (confirm("Delete this recording?")) {
                  onDelete(recording.id);
                  setSelectedRecording(null);
                }
              }}
            >
              <Trash />
            </IconButton>
          </Flex>
          <Flex align="center" gap="2">
            <Kbd size="1">ESC</Kbd>
            <IconButton
              size="2"
              variant="ghost"
              color="gray"
              onClick={() => setSelectedRecording(null)}
            >
              <X />
            </IconButton>
          </Flex>
        </Flex>
      </Flex>

      <ScrollArea>
        <Flex direction="column" gap="3" p="3">
          <Text size="2" color="gray">
            {format(new Date(recording.created_at), "MMMM d, yyyy 'at' h:mm a")}{" "}
            • {Math.floor(recording.duration / 60)}:
            {(recording.duration % 60).toString().padStart(2, "0")}
          </Text>

          <Card>
            <Box p="2">
              <AudioPlayer
                recordingId={recording.id}
                duration={recording.duration}
              />
            </Box>
          </Card>

          {recording.transcription?.extracted_tasks &&
            recording.transcription.extracted_tasks.length > 0 && (
              <>
                <Separator size="4" />
                <Flex direction="column" gap="3">
                  <Heading size="4">Extracted Tasks</Heading>
                  <Flex direction="column" gap="2">
                    {recording.transcription.extracted_tasks.map(
                      (task, idx) => (
                        <Card key={`${task.title}-${idx}`}>
                          <Box p="2">
                            <Flex direction="column" gap="1">
                              <Text size="2" weight="medium">
                                {task.title}
                              </Text>
                              <Text size="1" color="gray">
                                {task.description}
                              </Text>
                            </Flex>
                          </Box>
                        </Card>
                      ),
                    )}
                  </Flex>
                </Flex>
              </>
            )}

          {recording.transcription?.notes && (
            <>
              <Separator size="4" />
              <Flex direction="column" gap="3">
                <Heading size="4">Notes</Heading>
                <Card>
                  <Box
                    p="3"
                    style={{
                      fontSize: "var(--font-size-2)",
                      lineHeight: "1.6",
                    }}
                    className="notes-section"
                  >
                    <style>{`
                      .notes-section h2 {
                        font-size: var(--font-size-4) !important;
                        font-weight: 600 !important;
                        margin-top: 1rem !important;
                        margin-bottom: 0.5rem !important;
                        color: var(--gray-12) !important;
                      }
                      .notes-section h2:first-child {
                        margin-top: 0 !important;
                      }
                      .notes-section ul {
                        margin-bottom: 0.75rem !important;
                      }
                      .notes-section li {
                        margin-bottom: 0.25rem !important;
                      }
                    `}</style>
                    <MarkdownRenderer content={recording.transcription.notes} />
                  </Box>
                </Card>
              </Flex>
            </>
          )}

          {recording.transcription?.text && (
            <>
              <Separator size="4" />
              <Flex direction="column" gap="3">
                <Heading size="4">Transcript</Heading>
                <Card>
                  <Box p="2">
                    <Text
                      size="2"
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                    >
                      {recording.transcription.text}
                    </Text>
                  </Box>
                </Card>
              </Flex>
            </>
          )}

          {recording.transcription?.status === "processing" && (
            <Card>
              <Box p="4">
                <Flex direction="column" align="center" gap="2">
                  <Text size="2" color="gray">
                    Transcribing and extracting tasks...
                  </Text>
                </Flex>
              </Box>
            </Card>
          )}

          {!recording.transcription && (
            <Card>
              <Box p="4">
                <Flex direction="column" align="center" gap="2">
                  <Text size="2" color="gray">
                    No transcription yet
                  </Text>
                  {openaiApiKey && (
                    <Button
                      size="2"
                      onClick={() =>
                        onTranscribe({
                          recordingId: recording.id,
                          apiKey: openaiApiKey,
                        })
                      }
                      disabled={isTranscribing}
                    >
                      {isTranscribing ? "Transcribing..." : "Transcribe Now"}
                    </Button>
                  )}
                  {!openaiApiKey && (
                    <Text size="1" color="gray">
                      Add OpenAI API key in settings to transcribe
                    </Text>
                  )}
                </Flex>
              </Box>
            </Card>
          )}

          {recording.transcription?.status === "error" && (
            <Card>
              <Box p="4">
                <Flex direction="column" align="center" gap="2">
                  <Text size="2" color="red" weight="medium">
                    Transcription failed
                  </Text>
                  {recording.transcription.error && (
                    <Text size="1" color="gray" style={{ textAlign: "center" }}>
                      {recording.transcription.error}
                    </Text>
                  )}
                  {openaiApiKey && (
                    <Button
                      size="2"
                      onClick={() =>
                        onTranscribe({
                          recordingId: recording.id,
                          apiKey: openaiApiKey,
                        })
                      }
                      disabled={isTranscribing}
                    >
                      {isTranscribing ? "Retrying..." : "Retry Transcription"}
                    </Button>
                  )}
                </Flex>
              </Box>
            </Card>
          )}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}
