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
  Select,
  Text,
} from "@radix-ui/themes";
import type { CloudRegion } from "@shared/types/oauth";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { IS_DEV } from "@/constants/environment";

export const getErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "Failed to authenticate";
  }
  const message = error.message;

  if (message.includes("access_denied")) {
    return "Authorization cancelled.";
  }

  if (message.includes("timed out")) {
    return "Authorization timed out. Please try again.";
  }

  return message;
};
export function AuthScreen() {
  const [region, setRegion] = useState<CloudRegion>("us");
  const [workspace, setWorkspace] = useState("~/workspace");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const { loginWithOAuth, setDefaultWorkspace } = useAuthStore();

  const authMutation = useMutation({
    mutationFn: async ({
      selectedRegion,
      workspace,
    }: {
      selectedRegion: CloudRegion;
      workspace: string;
    }) => {
      if (!workspace || !workspace.trim()) {
        setWorkspaceError("Please select a workspace directory");
        throw new Error("Workspace is required");
      }

      // Login with OAuth first
      await loginWithOAuth(selectedRegion);

      // Then save workspace
      setDefaultWorkspace(workspace.trim());
      setWorkspaceError(null);
    },
  });

  const handleSignIn = () => {
    setWorkspaceError(null);
    authMutation.mutate({ selectedRegion: region, workspace });
  };

  const handleRegionChange = (value: string) => {
    setRegion(value as CloudRegion);
    authMutation.reset();
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
                  <Heading size="4">Welcome to Array</Heading>
                  <Text size="2" color="gray">
                    Sign in with your PostHog account
                  </Text>
                </Flex>

                <Flex direction="column" gap="4">
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium" color="gray">
                      PostHog region
                    </Text>
                    <Select.Root
                      value={region}
                      onValueChange={handleRegionChange}
                      size="3"
                    >
                      <Select.Trigger />
                      <Select.Content>
                        <Select.Item value="us">🇺🇸 US Cloud</Select.Item>
                        <Select.Item value="eu">🇪🇺 EU Cloud</Select.Item>
                        {IS_DEV && (
                          <Select.Item value="dev">🔧 Development</Select.Item>
                        )}
                      </Select.Content>
                    </Select.Root>
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

                  {workspaceError && (
                    <Callout.Root color="red">
                      <Callout.Text>{workspaceError}</Callout.Text>
                    </Callout.Root>
                  )}

                  {authMutation.isError && (
                    <Callout.Root color="red">
                      <Callout.Text>
                        {getErrorMessage(authMutation.error)}
                      </Callout.Text>
                    </Callout.Root>
                  )}

                  {authMutation.isPending && (
                    <Callout.Root color="blue">
                      <Callout.Text>
                        Waiting for authorization in your browser...
                      </Callout.Text>
                    </Callout.Root>
                  )}

                  <Button
                    onClick={handleSignIn}
                    disabled={authMutation.isPending || !workspace}
                    variant="classic"
                    size="3"
                    mt="2"
                    loading={authMutation.isPending}
                  >
                    {authMutation.isPending
                      ? "Waiting for authorization..."
                      : "Sign in with PostHog"}
                  </Button>
                </Flex>
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
