import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useEffect, useRef } from "react";

const log = logger.scope("github-integration-callback-hook");

const DEFAULT_ERROR_MESSAGE =
  "GitHub install failed. Please try connecting again.";

export interface IntegrationCallbackError {
  message: string;
  code: string | null;
}

interface Options {
  onSuccess: (projectId: number | null) => void;
  onError: (error: IntegrationCallbackError) => void;
  onTimedOut?: () => void;
}

/**
 * Subscribes to GitHub integration deep link callbacks and drains any pending
 * callback that arrived before the subscription was established (cold-start).
 */
export function useGitHubIntegrationCallback({
  onSuccess,
  onError,
  onTimedOut,
}: Options): void {
  const trpcReact = useTRPC();
  const hasConsumedPendingRef = useRef(false);

  const optsRef = useRef({ onSuccess, onError, onTimedOut });
  optsRef.current = { onSuccess, onError, onTimedOut };

  useSubscription(
    trpcReact.githubIntegration.onCallback.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info("Received integration deep link callback", data);
        if (data.status === "error") {
          optsRef.current.onError({
            message: data.errorMessage ?? DEFAULT_ERROR_MESSAGE,
            code: data.errorCode,
          });
          return;
        }
        optsRef.current.onSuccess(data.projectId);
      },
    }),
  );

  useSubscription(
    trpcReact.githubIntegration.onFlowTimedOut.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info("GitHub integration flow timed out", data);
        optsRef.current.onTimedOut?.();
      },
    }),
  );

  useEffect(() => {
    if (hasConsumedPendingRef.current) return;
    hasConsumedPendingRef.current = true;
    void (async () => {
      try {
        const pending =
          await trpcClient.githubIntegration.consumePendingCallback.query();
        if (!pending) return;
        log.info("Consumed pending integration callback on mount", pending);
        if (pending.status === "error") {
          optsRef.current.onError({
            message: pending.errorMessage ?? DEFAULT_ERROR_MESSAGE,
            code: pending.errorCode,
          });
          return;
        }
        optsRef.current.onSuccess(pending.projectId);
      } catch (error) {
        log.error("Failed to consume pending integration callback", error);
      }
    })();
  }, []);
}
