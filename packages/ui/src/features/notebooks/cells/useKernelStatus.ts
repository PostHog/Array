import type { NotebookKernelStatus } from "@posthog/api-client/posthog-client";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSessionOnlyEndpointError,
  KERNEL_SESSION_ONLY_MESSAGE,
} from "./cellExecution";

const STARTING_POLL_MS = 2000;
const IDLE_POLL_MS = 10_000;

export interface KernelStatusState {
  status: NotebookKernelStatus | null;
  /** True only until the first response arrives. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Optimistically adopt a status returned by a start/stop/restart call. */
  applyStatus: (status: NotebookKernelStatus) => void;
  hasClient: boolean;
}

/**
 * Polls the notebook kernel status while the consuming component (the kernel
 * panel) is mounted: every 2s while the kernel is `starting`, every 10s
 * otherwise. Unmounting stops the polling entirely.
 */
export function useKernelStatus(shortId: string): KernelStatusState {
  const client = useOptionalAuthenticatedClient();
  const [status, setStatus] = useState<NotebookKernelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef(client);
  clientRef.current = client;
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async (): Promise<void> => {
    const activeClient = clientRef.current;
    if (!activeClient) return;
    try {
      const next = await activeClient.notebookKernelStatus(shortId);
      setStatus(next);
      setError(null);
    } catch (fetchError) {
      setError(
        isSessionOnlyEndpointError(fetchError)
          ? KERNEL_SESSION_ONLY_MESSAGE
          : fetchError instanceof Error
            ? fetchError.message
            : "Failed to fetch kernel status",
      );
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await refresh();
      if (cancelled) return;
      const interval =
        statusRef.current?.status === "starting"
          ? STARTING_POLL_MS
          : IDLE_POLL_MS;
      timeoutId = setTimeout(() => void tick(), interval);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [client, refresh]);

  const applyStatus = useCallback((next: NotebookKernelStatus) => {
    setStatus(next);
  }, []);

  return {
    status,
    loading,
    error,
    refresh,
    applyStatus,
    hasClient: client !== null,
  };
}
