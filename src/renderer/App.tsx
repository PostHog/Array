import React, { useEffect, useState } from 'react';
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
      <div className="flex items-center justify-center h-screen bg-dark-bg">
        <div className="text-dark-text-muted">Loading...</div>
      </div>
    );
  }

  return isAuthenticated ? <MainLayout /> : <AuthScreen />;
}

export default App;