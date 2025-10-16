import { Flex, Spinner, Text } from "@radix-ui/themes";
import { AuthScreen } from "@renderer/components/AuthScreen";
import { MainLayout } from "@renderer/components/MainLayout";
import { useAuthStore } from "@renderer/stores/authStore";
import { useEffect, useState } from "react";

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth().finally(() => setIsLoading(false));
  }, [checkAuth]);

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
