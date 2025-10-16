import { Key, X } from "@phosphor-icons/react";
import { Button, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useCallback, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useAuthStore } from "../../../stores/authStore";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
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

  // ESC key to close
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />

      {/* Side Panel */}
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
          {/* Header */}
          <Flex
            justify="between"
            align="center"
            p="4"
            className="border-gray-6 border-b"
          >
            <Text id="settings-title" size="4" weight="medium">
              Settings
            </Text>
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

          {/* Content */}
          <Flex direction="column" p="6" gap="6">
            {/* Section: API Keys */}
            <Flex direction="column" gap="3">
              <Text size="4" weight="bold">
                API Keys
              </Text>
              <Text size="2" color="gray">
                Configure API keys for transcription services
              </Text>
            </Flex>

            {/* OpenAI API Key */}
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

            {/* Future: Add more settings sections here */}
            {/* - Recording quality
                - Default recording mode
                - Auto-transcribe toggle
                - Storage location
            */}
          </Flex>
        </Flex>
      </aside>
    </>
  );
}
