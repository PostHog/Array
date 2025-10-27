import { AsciiArt } from "@components/AsciiArt";
import {
  Box,
  Button,
  Callout,
  Card,
  Container,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useAuthStore } from "@stores/authStore";
import { useMutation } from "@tanstack/react-query";
import type React from "react";
import { useId, useState } from "react";

export function AuthScreen() {
  const apiKeyId = useId();
  const apiHostId = useId();
  const [apiKey, setApiKey] = useState("");
  const [apiHost, setApiHost] = useState("https://app.posthog.com");

  const { setCredentials } = useAuthStore();

  const authMutation = useMutation({
    mutationFn: async ({ apiKey, host }: { apiKey: string; host: string }) => {
      await setCredentials(apiKey, host);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    authMutation.mutate({ apiKey, host: apiHost });
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
                          required
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
                          placeholder="https://us.posthog.com"
                          required
                        />
                      </Flex>
                    </Flex>

                    {authMutation.isError && (
                      <Callout.Root color="red">
                        <Callout.Text>
                          {authMutation.error instanceof Error
                            ? authMutation.error.message
                            : "Failed to authenticate"}
                        </Callout.Text>
                      </Callout.Root>
                    )}

                    <Button
                      type="submit"
                      disabled={authMutation.isPending || !apiKey}
                      variant="classic"
                      size="3"
                      mt="4"
                      loading={authMutation.isPending}
                    >
                      {authMutation.isPending ? "Connecting..." : "Connect"}
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
