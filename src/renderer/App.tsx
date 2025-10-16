import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { MainLayout } from "./components/MainLayout";
import { useAuthStore } from "./stores/authStore";

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    useAuthStore
      .getState()
      .checkAuth()
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <Flex align="center" justify="center" minHeight="100vh">
        <Flex align="center" gap="3">
          <Spinner size="3" />
          <Text color="gray">Loading...</Text>
        </Flex>
      </Flex>
    );
  }

  return isAuthenticated ? <MainLayout /> : <AuthScreen />;
}

export default App;
