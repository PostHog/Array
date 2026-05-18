import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useEffect, useRef } from "react";

const log = logger.scope("slack-integration-callback-hook");

const DEFAULT_ERROR_MESSAGE =
  "Slack connection failed. Please try connecting again.";

export interface SlackCallbackError {
  message: string;
  code: string | null;
}

interface Options {
  onSuccess: (projectId: number | null, integrationId: number | null) => void;
  onError: (error: SlackCallbackError) => void;
  onTimedOut?: () => void;
}

/**
 * Subscribes to Slack integration deep link callbacks and drains any pending
 * callback that arrived before the subscription was established (cold-start).
 */
export function useSlackIntegrationCallback({
  onSuccess,
  onError,
  onTimedOut,
}: Options): void {
  const trpcReact = useTRPC();
  const hasConsumedPendingRef = useRef(false);

  const optsRef = useRef({ onSuccess, onError, onTimedOut });
  optsRef.current = { onSuccess, onError, onTimedOut };

  useSubscription(
    trpcReact.slackIntegration.onCallback.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info("Received Slack integration deep link callback", data);
        if (data.status === "error") {
          optsRef.current.onError({
            message: data.errorMessage ?? DEFAULT_ERROR_MESSAGE,
            code: data.errorCode,
          });
          return;
        }
        optsRef.current.onSuccess(data.projectId, data.integrationId);
      },
    }),
  );

  useSubscription(
    trpcReact.slackIntegration.onFlowTimedOut.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info("Slack integration flow timed out", data);
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
          await trpcClient.slackIntegration.consumePendingCallback.query();
        if (!pending) return;
        log.info(
          "Consumed pending Slack integration callback on mount",
          pending,
        );
        if (pending.status === "error") {
          optsRef.current.onError({
            message: pending.errorMessage ?? DEFAULT_ERROR_MESSAGE,
            code: pending.errorCode,
          });
          return;
        }
        optsRef.current.onSuccess(pending.projectId, pending.integrationId);
      } catch (error) {
        log.error(
          "Failed to consume pending Slack integration callback",
          error,
        );
      }
    })();
  }, []);
}
