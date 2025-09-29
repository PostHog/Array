import React, { useState } from 'react';
import { Container, Flex, Card, Heading, Text, TextField, Button, Callout } from '@radix-ui/themes';
import { useAuthStore } from '../stores/authStore';

export function AuthScreen() {
  const [apiKey, setApiKey] = useState('');
  const [apiHost, setApiHost] = useState('https://app.posthog.com');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { setCredentials } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await setCredentials(apiKey, apiHost);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container size="1">
      <Flex direction="column" align="center" justify="center" minHeight="100vh">
        <Card size="3">
          <Flex direction="column" gap="6" width="25vw">
            <Flex direction="column" gap="2">
              <Heading size="4">Array</Heading>
            </Flex>

            <form onSubmit={handleSubmit}>
              <Flex direction="column" gap="4">
                <Flex direction="column" gap="6">


                  <Flex direction="column" gap="2">
                    <Text as="label" htmlFor="apiKey" size="2" weight="medium" color="gray">
                      Personal API Key
                    </Text>
                    <TextField.Root
                      id="apiKey"
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
                    <Text as="label" htmlFor="apiHost" size="2" weight="medium" color="gray">
                      PostHog Instance URL
                    </Text>
                    <TextField.Root
                      id="apiHost"
                      type="url"
                      value={apiHost}
                      onChange={(e) => setApiHost(e.target.value)}
                      placeholder="https://app.posthog.com"
                      required
                    />
                  </Flex>
                </Flex>

                {error && (
                  <Callout.Root color="red">
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}

                <Button
                  type="submit"
                  disabled={isLoading || !apiKey}
                >
                  {isLoading ? 'Connecting...' : 'Connect'}
                </Button>
              </Flex>
            </form>
          </Flex>
        </Card>
      </Flex>
    </Container>
  );
}