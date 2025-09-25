import React, { useState } from 'react';
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
    <div className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-dark-text mb-2">Mission Control</h1>
          <p className="text-dark-text-muted">Sign in to your PostHog account</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-dark-text mb-2">
              Personal API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded-md text-dark-text focus:ring-2 focus:ring-posthog-500 focus:border-transparent"
              placeholder="phx_..."
              required
            />
            <p className="mt-1 text-xs text-dark-text-muted">
              Get your API key from PostHog settings
            </p>
          </div>
          
          <div>
            <label htmlFor="apiHost" className="block text-sm font-medium text-dark-text mb-2">
              PostHog Instance URL
            </label>
            <input
              id="apiHost"
              type="url"
              value={apiHost}
              onChange={(e) => setApiHost(e.target.value)}
              className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded-md text-dark-text focus:ring-2 focus:ring-posthog-500 focus:border-transparent"
              placeholder="https://app.posthog.com"
              required
            />
          </div>
          
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-md text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading || !apiKey}
            className="w-full py-2 px-4 bg-posthog-500 hover:bg-posthog-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
          >
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}