import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useSlackIntegrationCallback } from "@features/integrations/hooks/useSlackIntegrationCallback";
import { trpcClient } from "@renderer/trpc/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const POLL_TIMEOUT_MS = 300_000;

export type SlackConnectState = "idle" | "connecting" | "timed-out" | "error";

export interface SlackConnectError {
  message: string;
  code: string | null;
}

interface Result {
  state: SlackConnectState;
  error: SlackConnectError | null;
  isConnecting: boolean;
  isTimedOut: boolean;
  hasError: boolean;
  connect: () => Promise<void>;
  reset: () => void;
}

function invalidateIntegrationQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["integrations", "list"] });
  void queryClient.invalidateQueries({ queryKey: ["integrations"] });
}

/**
 * Drives the "Connect Slack workspace" button:
 *   - kicks off the main-process flow via `slackIntegration.startFlow`,
 *   - listens for the deep-link callback via `useSlackIntegrationCallback`,
 *   - refetches integration queries on success so the rest of the UI updates,
 *   - times out after 5 minutes and refetches as a fallback (a Slack admin who
 *     finishes the install in another browser still surfaces eventually).
 */
export function useSlackConnect(): Result {
  const queryClient = useQueryClient();
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const projectId = useAuthStateValue((s) => s.currentProjectId);

  const [state, setState] = useState<SlackConnectState>("idle");
  const [error, setError] = useState<SlackConnectError | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLocalTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearLocalTimeout, [clearLocalTimeout]);

  // Window-focus fallback — the deep link can occasionally miss (browser
  // setting, OS prompt dismissed), so refetch when the user returns to the
  // app while a connect is in flight.
  useEffect(() => {
    if (state !== "connecting") return;
    const onFocus = () => invalidateIntegrationQueries(queryClient);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state, queryClient]);

  useSlackIntegrationCallback({
    onSuccess: () => {
      clearLocalTimeout();
      setState("idle");
      setError(null);
      invalidateIntegrationQueries(queryClient);
    },
    onError: (cbError) => {
      clearLocalTimeout();
      setState("error");
      setError(cbError);
    },
    onTimedOut: () => {
      clearLocalTimeout();
      setState("timed-out");
      invalidateIntegrationQueries(queryClient);
    },
  });

  const reset = useCallback(() => {
    clearLocalTimeout();
    setError(null);
    setState("idle");
  }, [clearLocalTimeout]);

  const connect = useCallback(async () => {
    if (stateRef.current === "connecting") return;
    if (projectId === null || cloudRegion === null) return;
    clearLocalTimeout();
    setError(null);
    setState("connecting");
    try {
      const res = await trpcClient.slackIntegration.startFlow.mutate({
        region: cloudRegion,
        projectId,
      });
      if (!res.success) {
        throw new Error(res.error ?? "Failed to start Slack connection");
      }
      timeoutRef.current = setTimeout(() => {
        setState("timed-out");
        invalidateIntegrationQueries(queryClient);
      }, POLL_TIMEOUT_MS);
    } catch (e) {
      clearLocalTimeout();
      setError({
        message:
          e instanceof Error ? e.message : "Failed to start Slack connection",
        code: null,
      });
      setState("error");
    }
  }, [cloudRegion, projectId, clearLocalTimeout, queryClient]);

  return useMemo(
    () => ({
      state,
      error,
      isConnecting: state === "connecting",
      isTimedOut: state === "timed-out",
      hasError: state === "error",
      connect,
      reset,
    }),
    [state, error, connect, reset],
  );
}
