import { useAuthStore } from "@features/auth/stores/authStore";
import {
  type DefaultRunMode,
  useSettingsStore,
} from "@features/settings/stores/settingsStore";
import { useMeQuery } from "@hooks/useMeQuery";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Switch,
  Text,
} from "@radix-ui/themes";
import type { CloudRegion } from "@shared/types/oauth";
import { useMutation } from "@tanstack/react-query";
import { useThemeStore } from "../../../stores/themeStore";

const REGION_LABELS: Record<CloudRegion, string> = {
  us: "US Cloud",
  eu: "EU Cloud",
  dev: "Development",
};

const REGION_URLS: Record<CloudRegion, string> = {
  us: "us.posthog.com",
  eu: "eu.posthog.com",
  dev: "localhost:8010",
};

export function SettingsView() {
  const { isAuthenticated, cloudRegion, loginWithOAuth, logout } =
    useAuthStore();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const toggleDarkMode = useThemeStore((state) => state.toggleDarkMode);
  const { autoRunTasks, defaultRunMode, setAutoRunTasks, setDefaultRunMode } =
    useSettingsStore();

  const { data: currentUser } = useMeQuery();

  const reauthMutation = useMutation({
    mutationFn: async (region: CloudRegion) => {
      await loginWithOAuth(region);
    },
  });

  const handleReauthenticate = () => {
    if (cloudRegion) {
      reauthMutation.mutate(cloudRegion);
    }
  };

  const handleLogout = () => {
    logout();
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
              </Flex>
            </Card>
          </Flex>

          <Box className="border-gray-6 border-t" />

          {/* Account Section */}
          <Flex direction="column" gap="3">
            <Flex align="center" gap="3">
              <Heading size="3">Account</Heading>
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
                {isAuthenticated && currentUser?.email && (
                  <Flex direction="column" gap="2">
                    <Text size="1" weight="medium">
                      Email
                    </Text>
                    <Text size="1" color="gray">
                      {currentUser.email}
                    </Text>
                  </Flex>
                )}

                {isAuthenticated && currentUser?.team?.name && (
                  <Flex direction="column" gap="2">
                    <Text size="1" weight="medium">
                      Project
                    </Text>
                    <Text size="1" color="gray">
                      {currentUser.team.name}
                    </Text>
                  </Flex>
                )}

                {isAuthenticated && cloudRegion && (
                  <Flex direction="column" gap="2">
                    <Text size="1" weight="medium">
                      PostHog region
                    </Text>
                    <Flex align="center" gap="2">
                      <Badge size="1" variant="soft">
                        {REGION_LABELS[cloudRegion as CloudRegion]}
                      </Badge>
                      <Text size="1" color="gray">
                        {REGION_URLS[cloudRegion as CloudRegion]}
                      </Text>
                    </Flex>
                  </Flex>
                )}

                {!isAuthenticated && (
                  <Text size="1" color="gray">
                    You are not currently authenticated. Please sign in from the
                    main screen.
                  </Text>
                )}

                {isAuthenticated && (
                  <Flex gap="2">
                    <Button
                      variant="classic"
                      size="1"
                      onClick={handleReauthenticate}
                      disabled={reauthMutation.isPending}
                      loading={reauthMutation.isPending}
                    >
                      {reauthMutation.isPending
                        ? "Authenticating..."
                        : "Re-authenticate"}
                    </Button>
                    <Button
                      variant="soft"
                      color="red"
                      size="1"
                      onClick={handleLogout}
                    >
                      Sign out
                    </Button>
                  </Flex>
                )}

                {reauthMutation.isError && (
                  <Text size="1" color="red">
                    {reauthMutation.error instanceof Error
                      ? reauthMutation.error.message
                      : "Failed to re-authenticate"}
                  </Text>
                )}
              </Flex>
            </Card>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}
