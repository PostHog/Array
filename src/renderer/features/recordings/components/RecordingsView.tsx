import { Gear, Key, Waveform } from "@phosphor-icons/react";
import {
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  IconButton,
  ScrollArea,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { Recording } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { useStatusBarStore } from "../../../stores/statusBarStore";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useRecordings } from "../hooks/useRecordings";
import { RecordingCard } from "./RecordingCard";
import { RecordingControls } from "./RecordingControls";
import { SettingsPanel } from "./SettingsPanel";

export function RecordingsView() {
  const { openaiApiKey, setOpenAIKey } = useAuthStore();
  const {
    recordings,
    isLoading,
    saveRecording,
    deleteRecording,
    transcribeRecording,
    isTranscribing,
  } = useRecordings();
  const { setStatusBar, reset } = useStatusBarStore();
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

  // Settings panel state
  const [showSettings, setShowSettings] = useState(false);

  // Inline API key prompt (only shown if no key exists)
  const [showInlineApiKeyPrompt, setShowInlineApiKeyPrompt] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");

  // Handle API key save from inline prompt
  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) {
      alert("Please enter a valid API key");
      return;
    }
    try {
      await setOpenAIKey(apiKeyInput);
      setShowInlineApiKeyPrompt(false);
      setApiKeyInput("");
    } catch (error) {
      console.error("Failed to save API key:", error);
      alert("Failed to save API key. Please try again.");
    }
  }, [apiKeyInput, setOpenAIKey]);

  // Handle transcription
  const handleTranscribe = useCallback(
    (recordingId: string) => {
      if (!openaiApiKey) {
        setShowInlineApiKeyPrompt(true);
        return;
      }
      transcribeRecording({ recordingId, apiKey: openaiApiKey });
    },
    [openaiApiKey, transcribeRecording],
  );

  // Handle retry transcription
  const handleRetryTranscription = useCallback(
    (recordingId: string) => {
      if (!openaiApiKey) {
        setShowInlineApiKeyPrompt(true);
        return;
      }
      transcribeRecording({ recordingId, apiKey: openaiApiKey });
    },
    [openaiApiKey, transcribeRecording],
  );

  // TODO (Post-MVP): Implement task creation from extracted tasks
  // When implementing:
  // 1. Use the task creation API from the existing task system
  // 2. Map extracted_tasks to Task objects with proper metadata
  // 3. Link recordings to created tasks for traceability
  // Reference: prd-audio-transcription.md
  const handleCreateTasks = useCallback(async (recording: Recording) => {
    console.log("TODO: Implement task creation", recording);
    alert("Task creation coming soon!");
  }, []);

  // Update status bar with keyboard hints
  useEffect(() => {
    setStatusBar({
      statusText: `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`,
      keyHints: [
        {
          keys: ["R"],
          description: "Start Recording",
        },
        {
          keys: ["S"],
          description: "Stop Recording",
        },
      ],
      mode: "replace",
    });

    return () => {
      reset();
    };
  }, [setStatusBar, reset, recordings.length]);

  return (
    <>
      <Flex direction="column" height="100%" p="4" gap="4">
        {/* Header with Record Button and Settings */}
        <Flex justify="between" align="center">
          <Heading size="6">Recordings</Heading>
          <Flex gap="3" align="center">
            <RecordingControls
              isRecording={isRecording}
              recordingDuration={recordingDuration}
              recordingMode={recordingMode}
              availableDevices={availableDevices}
              selectedMicId={selectedMicId}
              onRecordingModeChange={setRecordingMode}
              onMicrophoneChange={setSelectedMicId}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
            />
            <IconButton
              size="2"
              variant="soft"
              color="gray"
              onClick={() => setShowSettings(true)}
            >
              <Gear size={20} />
            </IconButton>
          </Flex>
        </Flex>

        {/* Tab Audio Instructions */}
        {(recordingMode === "system-audio" || recordingMode === "both") && (
          <Callout.Root color="blue">
            <Flex direction="column" gap="2">
              <Callout.Text>
                <strong>
                  Recording browser tab audio (Google Meet, Zoom web)
                </strong>
              </Callout.Text>
              <Text size="1" color="gray">
                When you start recording, you'll be asked to share your screen.
                To capture meeting audio:
              </Text>
              <Text size="1" color="gray" style={{ paddingLeft: "12px" }}>
                1. Select the <strong>Chrome tab</strong> with your meeting (not
                entire screen)
                <br />
                2. Check the <strong>"Share tab audio"</strong> checkbox
                <br />
                3. Click Share
              </Text>
              <Text size="1" color="gray">
                Note: This captures audio from browser tabs only. For Zoom
                desktop app, use a virtual audio device like BlackHole.
              </Text>
            </Flex>
          </Callout.Root>
        )}

        {/* Inline API Key Prompt - Only shown if NO key exists */}
        {!openaiApiKey && !showInlineApiKeyPrompt ? (
          <Callout.Root color="amber">
            <Flex justify="between" align="center">
              <Callout.Text>
                Configure your OpenAI API key to enable transcription
              </Callout.Text>
              <Button
                size="1"
                variant="soft"
                onClick={() => setShowInlineApiKeyPrompt(true)}
              >
                Add API Key
              </Button>
            </Flex>
          </Callout.Root>
        ) : null}

        {showInlineApiKeyPrompt && (
          <Card>
            <Flex direction="column" gap="4" p="4">
              <Flex align="start" gap="3">
                <Key size={20} weight="duotone" className="mt-1" />
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="2" weight="medium">
                    OpenAI API Key Required
                  </Text>
                  <Text size="1" color="gray">
                    Enter your OpenAI API key to enable transcription with
                    Whisper
                  </Text>
                </Flex>
              </Flex>
              <Flex gap="2">
                <TextField.Root
                  placeholder="sk-..."
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveApiKey();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <Button onClick={handleSaveApiKey}>Save Key</Button>
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => setShowInlineApiKeyPrompt(false)}
                >
                  Cancel
                </Button>
              </Flex>
              <Text size="1" color="gray">
                Your API key is encrypted and stored locally. Get your key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent-9)" }}
                >
                  OpenAI Dashboard
                </a>
              </Text>
            </Flex>
          </Card>
        )}

        {/* Recordings List */}
        <ScrollArea>
          <Flex direction="column" gap="3">
            {isLoading ? (
              <Text size="2" color="gray">
                Loading recordings...
              </Text>
            ) : recordings.length === 0 ? (
              <Card>
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  py="9"
                  gap="2"
                >
                  <Waveform size={48} weight="thin" className="text-gray-500" />
                  <Text size="2" color="gray">
                    No recordings yet. Click "Start Recording" to begin.
                  </Text>
                </Flex>
              </Card>
            ) : (
              recordings.map((recording) => (
                <RecordingCard
                  key={recording.id}
                  recording={recording}
                  openaiApiKey={openaiApiKey}
                  isTranscribing={isTranscribing}
                  onDelete={deleteRecording}
                  onTranscribe={handleTranscribe}
                  onRetryTranscription={handleRetryTranscription}
                  onUpdateApiKey={() => setShowSettings(true)}
                  onCreateTasks={handleCreateTasks}
                />
              ))
            )}
          </Flex>
        </ScrollArea>
      </Flex>

      {/* Settings Panel */}
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
