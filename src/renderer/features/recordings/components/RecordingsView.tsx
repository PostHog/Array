import { RecordingControls } from "@features/recordings/components/RecordingControls";
import { RecordingDetail } from "@features/recordings/components/RecordingDetail";
import { RecordingsList } from "@features/recordings/components/RecordingsList";
import { SettingsPanel } from "@features/recordings/components/SettingsPanel";
import { useAudioRecorder } from "@features/recordings/hooks/useAudioRecorder";
import { useRecordings } from "@features/recordings/hooks/useRecordings";
import { useRecordingStore } from "@features/recordings/stores/recordingStore";
import { Gear, X } from "@phosphor-icons/react";
import {
  Box,
  Callout,
  Flex,
  Heading,
  IconButton,
  Text,
} from "@radix-ui/themes";
import { useStatusBarStore } from "@stores/statusBarStore";
import { useEffect, useState } from "react";

export function RecordingsView() {
  const {
    recordings,
    isLoading,
    saveRecording,
    deleteRecording,
    transcribeRecording,
    isTranscribing,
    transcriptionError,
    clearTranscriptionError,
  } = useRecordings();
  const { setStatusBar, reset } = useStatusBarStore();
  const { selectedRecordingId, cleanup } = useRecordingStore();
  const {
    isRecording,
    recordingDuration,
    recordingMode,
    availableDevices,
    selectedMicId,
    setRecordingMode,
    setSelectedMicId,
    startRecording,
    stopRecording,
  } = useAudioRecorder(saveRecording);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    setStatusBar({
      statusText: `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`,
      keyHints: [
        { keys: ["↑/↓"], description: "Navigate" },
        { keys: ["R"], description: "Record" },
        { keys: ["S"], description: "Stop" },
        { keys: ["ESC"], description: "Close" },
        { keys: ["Del"], description: "Delete" },
      ],
      mode: "replace",
    });
    return reset;
  }, [setStatusBar, reset, recordings.length]);

  const selectedRecording = recordings.find(
    (r) => r.id === selectedRecordingId,
  );

  return (
    <Flex direction="column" style={{ height: "100%" }}>
      <Flex
        justify="between"
        align="center"
        px="4"
        py="3"
        style={{ borderBottom: "1px solid var(--gray-6)" }}
      >
        <Heading size="6">Recordings</Heading>
        <Flex gap="3" align="center">
          <RecordingControls
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
          />
          <IconButton
            size="2"
            variant="soft"
            color="gray"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
          >
            <Gear size={20} />
          </IconButton>
        </Flex>
      </Flex>

      {transcriptionError && (
        <Box px="4" pt="3">
          <Callout.Root color="red" size="1">
            <Callout.Icon>
              <X />
            </Callout.Icon>
            <Callout.Text>
              <strong>Transcription failed:</strong> {transcriptionError}
            </Callout.Text>
            <IconButton
              size="1"
              variant="ghost"
              color="red"
              onClick={clearTranscriptionError}
              style={{ marginLeft: "auto" }}
            >
              <X size={14} />
            </IconButton>
          </Callout.Root>
        </Box>
      )}

      <Flex style={{ flex: 1, overflow: "hidden" }}>
        <Box
          style={{
            flex: 1,
            borderRight: "1px solid var(--gray-6)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isLoading ? (
            <Flex align="center" justify="center" style={{ flex: 1 }}>
              <Text size="2" color="gray">
                Loading...
              </Text>
            </Flex>
          ) : (
            <RecordingsList
              recordings={recordings}
              onDelete={deleteRecording}
            />
          )}
        </Box>

        <Box style={{ flex: 1, overflow: "hidden" }}>
          {selectedRecording ? (
            <RecordingDetail
              recording={selectedRecording}
              onDelete={deleteRecording}
              onTranscribe={transcribeRecording}
              isTranscribing={isTranscribing}
              isSettingsOpen={isSettingsOpen}
            />
          ) : (
            <Flex
              direction="column"
              align="center"
              justify="center"
              gap="2"
              style={{ height: "100%" }}
            >
              <Text size="3" color="gray">
                Select a recording to view details
              </Text>
              <Text size="1" color="gray">
                Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate
              </Text>
            </Flex>
          )}
        </Box>
      </Flex>

      <SettingsPanel
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        recordingMode={recordingMode}
        availableDevices={availableDevices}
        selectedMicId={selectedMicId}
        onRecordingModeChange={setRecordingMode}
        onMicrophoneChange={setSelectedMicId}
      />
    </Flex>
  );
}
