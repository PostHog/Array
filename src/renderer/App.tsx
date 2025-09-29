import React, { useEffect, useState } from 'react';
import { Flex, Text, Spinner } from '@radix-ui/themes';
import { AuthScreen } from './components/AuthScreen';
import { MainLayout } from './components/MainLayout';
import { useAuthStore } from './stores/authStore';

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