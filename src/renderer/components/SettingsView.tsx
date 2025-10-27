import { AsciiArt } from "@components/AsciiArt";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useAuthStore } from "@stores/authStore";
import { useThemeStore } from "@stores/themeStore";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

export function SettingsView() {
  const {
    apiKey: currentApiKey,
    apiHost,
    isAuthenticated,
    setCredentials,
    logout,
  } = useAuthStore();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const toggleDarkMode = useThemeStore((state) => state.toggleDarkMode);
  const [apiKey, setApiKey] = useState("");
  const [host, setHost] = useState(apiHost);
  const [initialHost] = useState(apiHost);

  const updateCredentialsMutation = useMutation({
    mutationFn: async ({ apiKey, host }: { apiKey: string; host: string }) => {
      await setCredentials(apiKey, host);
    },
    onSuccess: () => {
      setApiKey("");
      setTimeout(() => updateCredentialsMutation.reset(), 3000);
    },
  });

  const handleApiKeyBlur = () => {
    // Only update if apiKey was entered (not empty)
    if (apiKey.trim()) {
      updateCredentialsMutation.mutate({ apiKey, host });
    }
  };

  const handleHostBlur = () => {
    // Only update if host changed and is not empty
    if (host.trim() && host !== initialHost) {
      // Need current API key or new one to update
      const keyToUse = apiKey.trim() || currentApiKey;
      if (keyToUse) {
        updateCredentialsMutation.mutate({ apiKey: keyToUse, host });
      }
    }
  };

  const handleLogout = () => {
    logout();
    setApiKey("");
    setHost("https://us.posthog.com");
    updateCredentialsMutation.reset();
  };

  return (
    <Box height="100%">
      <Flex height="100%">
        {/* Left pane - Settings */}
        <Box
          width="50%"
          p="6"
          className="border-gray-6 border-r"
          overflowY="auto"
        >
          <Flex direction="column" gap="6">
            <Flex direction="column" gap="2">
              <Heading size="6">Settings</Heading>
              <Text size="2" color="gray">
                Manage your PostHog connection and preferences
              </Text>
            </Flex>

            {/* Appearance Section */}
            <Flex direction="column" gap="3">
              <Heading size="4">Appearance</Heading>
              <Card>
                <Flex align="center" justify="between">
                  <Text size="2" weight="medium">
                    Dark Mode
                  </Text>
                  <Switch
                    checked={isDarkMode}
                    onCheckedChange={toggleDarkMode}
                    size="2"
                  />
                </Flex>
              </Card>
            </Flex>

            <Box className="border-gray-6 border-t" />

            {/* Authentication Section */}
            <Flex direction="column" gap="3">
              <Flex align="center" gap="3">
                <Heading size="4">Authentication</Heading>
                <Flex align="center" gap="2">
                  <Box
                    width="8px"
                    height="8px"
                    className={`rounded-full ${isAuthenticated ? "bg-green-9" : "bg-red-9"}`}
                  />
                  <Text size="2" color="gray">
                    {isAuthenticated ? "Connected" : "Not connected"}
                  </Text>
                </Flex>
              </Flex>

              <Card>
                <Flex direction="column" gap="3">
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium">
                      API Key
                    </Text>
                    <TextField.Root
                      type="password"
                      placeholder="Enter your PostHog API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onBlur={handleApiKeyBlur}
                      disabled={updateCredentialsMutation.isPending}
                    />
                  </Flex>

                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium">
                      API Host
                    </Text>
                    <TextField.Root
                      type="text"
                      placeholder="https://us.posthog.com"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      onBlur={handleHostBlur}
                      disabled={updateCredentialsMutation.isPending}
                    />
                  </Flex>

                  {updateCredentialsMutation.isError && (
                    <Text size="2" color="red">
                      {updateCredentialsMutation.error instanceof Error
                        ? updateCredentialsMutation.error.message
                        : "Failed to update credentials"}
                    </Text>
                  )}

                  {updateCredentialsMutation.isSuccess && (
                    <Text size="2" color="green">
                      Credentials updated successfully
                    </Text>
                  )}

                  <Box>
                    <Button
                      variant="classic"
                      size="2"
                      onClick={() => {
                        const keyToUse = apiKey.trim() || currentApiKey;
                        if (keyToUse && host.trim()) {
                          updateCredentialsMutation.mutate({
                            apiKey: keyToUse,
                            host,
                          });
                        }
                      }}
                      disabled={updateCredentialsMutation.isPending}
                      loading={updateCredentialsMutation.isPending}
                    >
                      Save credentials
                    </Button>
                  </Box>
                </Flex>
              </Card>
            </Flex>

            {isAuthenticated && <Box className="border-gray-6 border-t" />}

            {/* Account Section */}
            {isAuthenticated && (
              <Flex direction="column" gap="3">
                <Heading size="4">Account</Heading>
                <Card>
                  <Button
                    variant="soft"
                    color="red"
                    onClick={handleLogout}
                    disabled={updateCredentialsMutation.isPending}
                  >
                    Logout
                  </Button>
                </Card>
              </Flex>
            )}
          </Flex>
        </Box>

        {/* Right pane - ASCII Art */}
        <Box
          width="50%"
          height="100%"
          className="bg-panel-solid"
          style={{ position: "relative" }}
        >
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
        </Box>
      </Flex>
    </Box>
  );
}
