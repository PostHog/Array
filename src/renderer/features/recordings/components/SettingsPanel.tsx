import { Key, MicrophoneIcon, X } from "@phosphor-icons/react";
import {
  Button,
  Flex,
  IconButton,
  Kbd,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useAuthStore } from "../../../stores/authStore";
import type { RecordingMode } from "../stores/recordingStore";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  recordingMode: RecordingMode;
  availableDevices: MediaDeviceInfo[];
  selectedMicId: string;
  onRecordingModeChange: (mode: RecordingMode) => void;
  onMicrophoneChange: (deviceId: string) => void;
}

export function SettingsPanel({
  open,
  onClose,
  recordingMode,
  availableDevices,
  selectedMicId,
  onRecordingModeChange,
  onMicrophoneChange,
}: SettingsPanelProps) {
  const { openaiApiKey, setOpenAIKey } = useAuthStore();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) {
      alert("Please enter a valid API key");
      return;
    }
    try {
      await setOpenAIKey(apiKeyInput);
      setIsEditing(false);
      setApiKeyInput("");
    } catch (error) {
      console.error("Failed to save API key:", error);
      alert("Failed to save API key. Please try again.");
    }
  }, [apiKeyInput, setOpenAIKey]);

  useHotkeys(
    "escape",
    () => {
      onClose();
    },
    { enabled: open, enableOnFormTags: true },
    [onClose, open],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />

      <aside
        className="fixed top-0 right-0 bottom-0 z-50 w-[600px] overflow-y-auto border-gray-6 border-l bg-gray-1 shadow-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
      >
        <Flex direction="column" height="100%">
          <Flex
            justify="between"
            align="center"
            p="4"
            className="border-gray-6 border-b"
          >
            <Flex align="center" gap="2">
              <Text id="settings-title" size="4" weight="medium">
                Settings
              </Text>
            </Flex>
            <Flex align="center" gap="2">
              <Kbd size="1">ESC</Kbd>
              <IconButton
                size="2"
                variant="ghost"
                color="gray"
                onClick={onClose}
                aria-label="Close settings"
                highContrast
              >
                <X size={20} />
              </IconButton>
            </Flex>
          </Flex>

          <Flex direction="column" p="6" gap="6">
            <Flex direction="column" gap="3">
              <Text size="4" weight="bold">
                Recording Settings
              </Text>
              <Text size="2" color="gray">
                Configure microphone and recording preferences
              </Text>
            </Flex>

            <Flex
              direction="column"
              gap="4"
              p="5"
              className="rounded-3 bg-gray-2"
            >
              <Flex align="center" gap="3">
                <MicrophoneIcon size={24} weight="duotone" />
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="3" weight="medium">
                    Recording Mode
                  </Text>
                  <Text size="2" color="gray">
                    Choose what audio to capture
                  </Text>
                </Flex>
              </Flex>

              <Select.Root
                value={recordingMode}
                onValueChange={(value) =>
                  onRecordingModeChange(value as RecordingMode)
                }
                size="2"
              >
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="microphone">Microphone Only</Select.Item>
                  <Select.Item value="system-audio">
                    System Audio Only
                  </Select.Item>
                  <Select.Item value="both">
                    Microphone + System Audio
                  </Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>

            {availableDevices.length > 0 && (
              <Flex
                direction="column"
                gap="4"
                p="5"
                className="rounded-3 bg-gray-2"
              >
                <Flex align="center" gap="3">
                  <MicrophoneIcon size={24} weight="duotone" />
                  <Flex direction="column" gap="1" style={{ flex: 1 }}>
                    <Text size="3" weight="medium">
                      Microphone
                    </Text>
                    <Text size="2" color="gray">
                      Select your input device
                    </Text>
                  </Flex>
                </Flex>

                <Select.Root
                  value={selectedMicId}
                  onValueChange={onMicrophoneChange}
                  size="2"
                >
                  <Select.Trigger
                    placeholder="Select microphone"
                    style={{ width: "100%" }}
                  />
                  <Select.Content>
                    {availableDevices.map((device) => (
                      <Select.Item
                        key={device.deviceId}
                        value={device.deviceId}
                      >
                        {device.label ||
                          `Microphone ${device.deviceId.slice(0, 8)}`}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>

                <Text size="1" color="gray">
                  {availableDevices.length} microphone
                  {availableDevices.length === 1 ? "" : "s"} detected
                </Text>
              </Flex>
            )}

            <Flex direction="column" gap="3">
              <Text size="4" weight="bold">
                API Keys
              </Text>
              <Text size="2" color="gray">
                Configure API keys for transcription services
              </Text>
            </Flex>

            <Flex
              direction="column"
              gap="4"
              p="5"
              className="rounded-3 bg-gray-2"
            >
              <Flex align="center" gap="3">
                <Key size={24} weight="duotone" />
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="3" weight="medium">
                    OpenAI API Key
                  </Text>
                  <Text size="2" color="gray">
                    Required for Whisper transcription
                  </Text>
                </Flex>
              </Flex>

              {openaiApiKey && !isEditing ? (
                <Flex direction="column" gap="3">
                  <Flex align="center" gap="2">
                    <Text size="2" color="green">
                      ✓
                    </Text>
                    <Text size="2" color="gray">
                      API key configured and encrypted
                    </Text>
                  </Flex>
                  <Flex>
                    <Button
                      size="2"
                      variant="surface"
                      onClick={() => setIsEditing(true)}
                    >
                      Update Key
                    </Button>
                  </Flex>
                </Flex>
              ) : (
                <Flex direction="column" gap="3">
                  <TextField.Root
                    size="3"
                    placeholder="sk-proj-..."
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSaveApiKey();
                      }
                    }}
                  />
                  <Flex gap="2">
                    <Button size="2" onClick={handleSaveApiKey}>
                      Save Key
                    </Button>
                    {openaiApiKey && (
                      <Button
                        size="2"
                        variant="soft"
                        color="gray"
                        onClick={() => {
                          setIsEditing(false);
                          setApiKeyInput("");
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </Flex>
                </Flex>
              )}

              <Text size="1" color="gray">
                Your API key is encrypted and stored locally.{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--accent-9)",
                    textDecoration: "underline",
                  }}
                >
                  Get your key from OpenAI →
                </a>
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </aside>
    </>
  );
}
