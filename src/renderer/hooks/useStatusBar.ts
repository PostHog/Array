import { useStatusBarStore } from "@stores/statusBarStore";
import { useEffect } from "react";

interface KeyHint {
  keys: string[];
  description: string;
}

interface UseStatusBarConfig {
  statusText: string;
  keyHints: KeyHint[];
  mode?: "replace" | "append";
}

/**
 * Hook to manage status bar state with automatic cleanup
 *
 * Automatically sets the status bar when the component mounts or dependencies change,
 * and resets the status bar when the component unmounts.
 *
 * @param config - Status bar configuration
 * @param deps - Optional dependency array to control when status bar updates
 */
export function useStatusBar(
  config: UseStatusBarConfig,
  deps: React.DependencyList = [],
) {
  const { setStatusBar, reset } = useStatusBarStore();

  useEffect(() => {
    setStatusBar(config);
    return reset;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatusBar, reset, ...deps, config]);
}
