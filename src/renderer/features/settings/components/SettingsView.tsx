import { useAuthStore } from "@features/auth/stores/authStore";
import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
import {
  type DefaultRunMode,
  useSettingsStore,
} from "@features/settings/stores/settingsStore";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
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
    defaultWorkspace,
    setDefaultWorkspace,
  } = useAuthStore();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const toggleDarkMode = useThemeStore((state) => state.toggleDarkMode);
  const {
    autoRunTasks,
    defaultRunMode,
    createPR,
    setAutoRunTasks,
    setDefaultRunMode,
    setCreatePR,
  } = useSettingsStore();
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
    <Box height="100%" overflowY="auto">
      <Box p="6" style={{ maxWidth: "600px", margin: "0 auto" }}>
        <Flex direction="column" gap="6">
          <Flex direction="column" gap="2">
            <Heading size="4">Settings</Heading>
            <Text size="1" color="gray">
              Manage your PostHog connection and preferences
            </Text>
          </Flex>

          {/* Appearance Section */}
          <Flex direction="column" gap="3">
            <Heading size="3">Appearance</Heading>
            <Card>
              <Flex align="center" justify="between">
                <Text size="1" weight="medium">
                  Dark mode
                </Text>
                <Switch
                  checked={isDarkMode}
                  onCheckedChange={toggleDarkMode}
                  size="1"
                />
              </Flex>
            </Card>
          </Flex>

          <Box className="border-gray-6 border-t" />

          {/* Task Execution Section */}
          <Flex direction="column" gap="3">
            <Heading size="3">Task execution</Heading>
            <Card>
              <Flex direction="column" gap="4">
                <Flex align="center" justify="between">
                  <Flex direction="column" gap="1">
                    <Text size="1" weight="medium">
                      Auto-run new tasks
                    </Text>
                    <Text size="1" color="gray">
                      Automatically start tasks after creation
                    </Text>
                  </Flex>
                  <Switch
                    checked={autoRunTasks}
                    onCheckedChange={setAutoRunTasks}
                    size="1"
                  />
                </Flex>

                <Flex direction="column" gap="2">
                  <Text size="1" weight="medium">
                    Default run environment
                  </Text>
                  <Select.Root
                    value={defaultRunMode}
                    onValueChange={(value) =>
                      setDefaultRunMode(value as DefaultRunMode)
                    }
                    size="1"
                  >
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="local">Local</Select.Item>
                      <Select.Item value="cloud">Cloud</Select.Item>
                      <Select.Item value="last_used">Last used</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <Text size="1" color="gray">
                    Choose which environment to use when running tasks
                  </Text>
                </Flex>

                <Flex align="center" justify="between">
                  <Flex direction="column" gap="1">
                    <Text size="1" weight="medium">
                      Create PR for local runs
                    </Text>
                    <Text size="1" color="gray">
                      Automatically create a pull request when local tasks
                      complete
                    </Text>
                  </Flex>
                  <Switch
                    checked={createPR}
                    onCheckedChange={setCreatePR}
                    size="1"
                  />
                </Flex>
              </Flex>
            </Card>
          </Flex>

          <Box className="border-gray-6 border-t" />

          {/* Workspace Section */}
          <Flex direction="column" gap="3">
            <Heading size="3">Workspace</Heading>
            <Card>
              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Text size="1" weight="medium">
                    Default workspace
                  </Text>
                  <FolderPicker
                    value={defaultWorkspace || ""}
                    onChange={setDefaultWorkspace}
                    placeholder="~/workspace"
                    size="1"
                  />
                  <Text size="1" color="gray">
                    Default directory where repositories will be cloned. This
                    should be the folder where you usually store your projects.
                  </Text>
                </Flex>
              </Flex>
            </Card>
          </Flex>

          <Box className="border-gray-6 border-t" />

          {/* Authentication Section */}
          <Flex direction="column" gap="3">
            <Flex align="center" gap="3">
              <Heading size="3">Authentication</Heading>
              <Flex align="center" gap="2">
                <Box
                  width="8px"
                  height="8px"
                  className={`rounded-full ${isAuthenticated ? "bg-green-9" : "bg-red-9"}`}
                />
                <Text size="1" color="gray">
                  {isAuthenticated ? "Connected" : "Not connected"}
                </Text>
              </Flex>
            </Flex>

            <Card>
              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Text size="1" weight="medium">
                    API Key
                  </Text>
                  <TextField.Root
                    size="1"
                    type="password"
                    placeholder="Enter your PostHog API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={handleApiKeyBlur}
                    disabled={updateCredentialsMutation.isPending}
                  />
                </Flex>

                <Flex direction="column" gap="2">
                  <Text size="1" weight="medium">
                    API Host
                  </Text>
                  <TextField.Root
                    size="1"
                    type="text"
                    placeholder="https://us.posthog.com"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    onBlur={handleHostBlur}
                    disabled={updateCredentialsMutation.isPending}
                  />
                </Flex>

                {updateCredentialsMutation.isError && (
                  <Text size="1" color="red">
                    {updateCredentialsMutation.error instanceof Error
                      ? updateCredentialsMutation.error.message
                      : "Failed to update credentials"}
                  </Text>
                )}

                {updateCredentialsMutation.isSuccess && (
                  <Text size="1" color="green">
                    Credentials updated successfully
                  </Text>
                )}

                <Box>
                  <Button
                    variant="classic"
                    size="1"
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
              <Heading size="3">Account</Heading>
              <Card>
                <Button
                  variant="soft"
                  color="red"
                  size="1"
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
    </Box>
  );
}
