import { MainLayout } from "@components/MainLayout";
import { AuthScreen } from "@features/auth/components/AuthScreen";
import { useAuthStore } from "@features/auth/stores/authStore";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { useRecordingQuerySync } from "@/renderer/hooks/useRecordingQuerySync";
import {
  initializeRecordingService,
  shutdownRecordingService,
} from "@/renderer/services/recordingService";

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useRecordingQuerySync();

  useEffect(() => {
    checkAuth().finally(() => setIsLoading(false));
  }, [checkAuth]);

  // Initialize recording service when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    console.log("[App] Initializing recording service");
    initializeRecordingService();

    // Cleanup on unmount
    return () => {
      console.log("[App] Shutting down recording service");
      shutdownRecordingService();
    };
  }, [isAuthenticated]);

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
