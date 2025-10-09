import {
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Container,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { DataSource } from "@shared/types";
import type React from "react";
import { useId, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { AsciiArt } from "./AsciiArt";

export function AuthScreen() {
  const apiKeyId = useId();
  const apiHostId = useId();
  const [selectedSources, setSelectedSources] = useState<DataSource[]>([
    "posthog",
  ]);
  const [apiKey, setApiKey] = useState("");
  const [apiHost, setApiHost] = useState("https://app.posthog.com");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { setCredentials, setEnabledSources } = useAuthStore();

  const toggleSource = (source: DataSource) => {
    setSelectedSources((prev) =>
      prev.includes(source)
        ? prev.filter((s) => s !== source)
        : [...prev, source],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (selectedSources.length === 0) {
        throw new Error("Please select at least one data source");
      }

      // Save enabled sources
      setEnabledSources(selectedSources);

      // If PostHog is selected, validate credentials
      if (selectedSources.includes("posthog")) {
        if (!apiKey) {
          throw new Error("PostHog API key is required");
        }
        await setCredentials(apiKey, apiHost);
      }

      // For non-PostHog sources or successful PostHog auth, reload the page
      // to trigger the authentication check
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authenticate");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Flex height="100vh">
      {/* Left pane - Auth form */}
      <Box width="50%" className="border-gray-6 border-r">
        <Container size="1">
          <Flex
            direction="column"
            align="center"
            justify="center"
            height="100vh"
          >
            <Card size="3">
              <Flex direction="column" gap="6" width="25vw">
                <Flex direction="column" gap="2">
                  <Heading size="4">Array</Heading>
                </Flex>

                <form onSubmit={handleSubmit}>
                  <Flex direction="column" gap="4">
                    {/* Data Source Selection */}
                    <Flex direction="column" gap="3">
                      <Text size="2" weight="medium" color="gray">
                        Select Data Sources
                      </Text>
                      <Flex direction="column" gap="2">
                        <Text as="label" size="2">
                          <Flex gap="2" align="center">
                            <Checkbox
                              checked={selectedSources.includes("posthog")}
                              onCheckedChange={() => toggleSource("posthog")}
                            />
                            PostHog
                          </Flex>
                        </Text>
                        <Text as="label" size="2">
                          <Flex gap="2" align="center">
                            <Checkbox
                              checked={selectedSources.includes(
                                "call_recording",
                              )}
                              onCheckedChange={() =>
                                toggleSource("call_recording")
                              }
                            />
                            Call Recording
                          </Flex>
                        </Text>
                      </Flex>
                    </Flex>

                    {/* PostHog Credentials - only show if PostHog is selected */}
                    {selectedSources.includes("posthog") && (
                      <Flex direction="column" gap="6">
                        <Flex direction="column" gap="2">
                          <Text
                            as="label"
                            htmlFor="apiKey"
                            size="2"
                            weight="medium"
                            color="gray"
                          >
                            Personal API Key
                          </Text>
                          <TextField.Root
                            id={apiKeyId}
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="phx_..."
                            required={selectedSources.includes("posthog")}
                          />
                          <Text size="1" color="gray">
                            Get your API key from PostHog settings
                          </Text>
                        </Flex>

                        <Flex direction="column" gap="2">
                          <Text
                            as="label"
                            htmlFor="apiHost"
                            size="2"
                            weight="medium"
                            color="gray"
                          >
                            PostHog Instance URL
                          </Text>
                          <TextField.Root
                            id={apiHostId}
                            type="url"
                            value={apiHost}
                            onChange={(e) => setApiHost(e.target.value)}
                            placeholder="https://app.posthog.com"
                            required={selectedSources.includes("posthog")}
                          />
                        </Flex>
                      </Flex>
                    )}

                    {error ? (
                      <Callout.Root color="red">
                        <Callout.Text>{error}</Callout.Text>
                      </Callout.Root>
                    ) : null}

                    <Button
                      type="submit"
                      disabled={
                        isLoading ||
                        selectedSources.length === 0 ||
                        (selectedSources.includes("posthog") && !apiKey)
                      }
                      variant="classic"
                      size="3"
                      mt="4"
                    >
                      {isLoading ? "Connecting..." : "Continue"}
                    </Button>
                  </Flex>
                </form>
              </Flex>
            </Card>
          </Flex>
        </Container>
      </Box>

      {/* Right pane - ASCII Art */}
      <Box width="50%" height="100%">
        <AsciiArt scale={1} />
      </Box>
    </Flex>
  );
}
