import { AsciiArt } from "@components/AsciiArt";
import { useAuthStore } from "@features/auth/stores/authStore";
import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
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
import { useMutation } from "@tanstack/react-query";
import type React from "react";
import { useId, useState } from "react";

export function AuthScreen() {
  const apiKeyId = useId();
  const apiHostId = useId();
  const [apiKey, setApiKey] = useState("");
  const [apiHost, setApiHost] = useState("https://app.posthog.com");
  const [workspace, setWorkspace] = useState("~/workspace");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const { setCredentials, setDefaultWorkspace } = useAuthStore();

  const authMutation = useMutation({
    mutationFn: async ({
      apiKey,
      host,
      workspace,
    }: {
      apiKey: string;
      host: string;
      workspace: string;
    }) => {
      if (!workspace || !workspace.trim()) {
        setWorkspaceError("Please select a workspace directory");
        throw new Error("Workspace is required");
      }

      // Set credentials first
      await setCredentials(apiKey, host);

      // Then save workspace
      setDefaultWorkspace(workspace.trim());
      setWorkspaceError(null);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorkspaceError(null);
    authMutation.mutate({ apiKey, host: apiHost, workspace });
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

                      <Flex direction="column" gap="2">
                        <Text as="label" size="2" weight="medium" color="gray">
                          Default workspace
                        </Text>
                        <FolderPicker
                          value={workspace}
                          onChange={setWorkspace}
                          placeholder="~/workspace"
                          size="2"
                        />
                        <Text size="1" color="gray">
                          Where repositories will be cloned. This should be the
                          folder where you usually store your projects.
                        </Text>
                      </Flex>
                    </Flex>

                    {workspaceError && (
                      <Callout.Root color="red">
                        <Callout.Text>{workspaceError}</Callout.Text>
                      </Callout.Root>
                    )}

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
                      disabled={authMutation.isPending || !apiKey || !workspace}
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
