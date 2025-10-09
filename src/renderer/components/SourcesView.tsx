import {
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { DataSource } from "@shared/types";
import { useEffect, useId, useState } from "react";
import { useAuthStore } from "../stores/authStore";

export function SourcesView() {
  const {
    enabledSources,
    setEnabledSources,
    apiKey,
    apiHost,
    setCredentials,
    openaiApiKey,
    setOpenaiKey,
  } = useAuthStore();

  const apiKeyId = useId();
  const apiHostId = useId();
  const openaiKeyId = useId();

  const [localSources, setLocalSources] =
    useState<DataSource[]>(enabledSources);
  const [localApiKey, setLocalApiKey] = useState(apiKey || "");
  const [localApiHost, setLocalApiHost] = useState(
    apiHost || "https://app.posthog.com",
  );
  const [localOpenaiKey, setLocalOpenaiKey] = useState(openaiApiKey || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const toggleSource = (source: DataSource) => {
    setLocalSources((prev) =>
      prev.includes(source)
        ? prev.filter((s) => s !== source)
        : [...prev, source],
    );
    setSuccess(false);
  };

  const handleSave = async () => {
    setError("");
    setSuccess(false);
    setIsSaving(true);

    try {
      if (localSources.length === 0) {
        throw new Error("Please select at least one data source");
      }

      // If PostHog is enabled and credentials changed, validate them
      if (localSources.includes("posthog")) {
        if (!localApiKey) {
          throw new Error("PostHog API key is required");
        }
        // Only re-validate if credentials actually changed
        if (localApiKey !== apiKey || localApiHost !== apiHost) {
          await setCredentials(localApiKey, localApiHost);
        }
      }

      // If Call Recording is enabled, require OpenAI API key
      if (localSources.includes("call_recording")) {
        if (!localOpenaiKey) {
          throw new Error("OpenAI API key is required for call recording");
        }
        // Save OpenAI key if changed
        if (localOpenaiKey !== openaiApiKey) {
          await setOpenaiKey(localOpenaiKey);
        }
      }

      // Update enabled sources
      setEnabledSources(localSources);
      setSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    JSON.stringify(localSources.sort()) !==
      JSON.stringify(enabledSources.sort()) ||
    (localSources.includes("posthog") &&
      (localApiKey !== apiKey || localApiHost !== apiHost)) ||
    (localSources.includes("call_recording") &&
      localOpenaiKey !== openaiApiKey);

  return (
    <Box p="6">
      <Flex direction="column" gap="6" maxWidth="600px">
        <Flex direction="column" gap="2">
          <Heading size="6">Data Sources</Heading>
          <Text size="2" color="gray">
            Configure which sources Array should use to generate tasks
          </Text>
        </Flex>

        <Card>
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="3">
              <Text size="2" weight="medium">
                Enabled Sources
              </Text>

              <Flex direction="column" gap="2">
                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={localSources.includes("posthog")}
                      onCheckedChange={() => toggleSource("posthog")}
                    />
                    <Box>
                      <Text weight="medium">PostHog</Text>
                      <Text size="1" color="gray" as="div">
                        Generate tasks from PostHog insights, sessions, and
                        feature flags
                      </Text>
                    </Box>
                  </Flex>
                </Text>

                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={localSources.includes("call_recording")}
                      onCheckedChange={() => toggleSource("call_recording")}
                    />
                    <Box>
                      <Text weight="medium">
                        Call Recording
                      </Text>
                      <Text size="1" color="gray" as="div">
                        Extract product requirements from meeting recordings
                      </Text>
                    </Box>
                  </Flex>
                </Text>
              </Flex>
            </Flex>

            {/* PostHog Configuration */}
            {localSources.includes("posthog") && (
              <Flex direction="column" gap="4" pt="2">
                <Text size="2" weight="medium">
                  PostHog Configuration
                </Text>

                <Flex direction="column" gap="2">
                  <Text as="label" htmlFor={apiKeyId} size="2" color="gray">
                    Personal API Key
                  </Text>
                  <TextField.Root
                    id={apiKeyId}
                    type="password"
                    value={localApiKey}
                    onChange={(e) => {
                      setLocalApiKey(e.target.value);
                      setSuccess(false);
                    }}
                    placeholder="phx_..."
                  />
                </Flex>

                <Flex direction="column" gap="2">
                  <Text as="label" htmlFor={apiHostId} size="2" color="gray">
                    Instance URL
                  </Text>
                  <TextField.Root
                    id={apiHostId}
                    type="url"
                    value={localApiHost}
                    onChange={(e) => {
                      setLocalApiHost(e.target.value);
                      setSuccess(false);
                    }}
                    placeholder="https://app.posthog.com"
                  />
                </Flex>
              </Flex>
            )}

            {/* OpenAI Configuration for Call Recording */}
            {localSources.includes("call_recording") && (
              <Flex direction="column" gap="4" pt="2">
                <Text size="2" weight="medium">
                  OpenAI Configuration
                </Text>

                <Flex direction="column" gap="2">
                  <Text as="label" htmlFor={openaiKeyId} size="2" color="gray">
                    API Key
                  </Text>
                  <TextField.Root
                    id={openaiKeyId}
                    type="password"
                    value={localOpenaiKey}
                    onChange={(e) => {
                      setLocalOpenaiKey(e.target.value);
                      setSuccess(false);
                    }}
                    placeholder="sk-..."
                  />
                  <Text size="1" color="gray">
                    Required for transcribing call recordings using Whisper API
                  </Text>
                </Flex>
              </Flex>
            )}

            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}

            {success && (
              <Text size="2" color="green">
                Settings saved successfully
              </Text>
            )}

            <Flex gap="3" justify="end">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                variant="solid"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </Flex>
          </Flex>
        </Card>
      </Flex>
    </Box>
  );
}
