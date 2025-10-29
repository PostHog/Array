import { AsciiArt } from "@components/AsciiArt";
import { useAuthStore } from "@features/auth/stores/authStore";
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
import { IS_DEV } from "@shared/constants/environment";
import type { CloudRegion } from "@shared/types/oauth";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

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

  const { loginWithOAuth } = useAuthStore();

  const authMutation = useMutation({
    mutationFn: async (selectedRegion: CloudRegion) => {
      await loginWithOAuth(selectedRegion);
    },
  });

  const handleSignIn = () => {
    authMutation.mutate(region);
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
                    disabled={authMutation.isPending}
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
