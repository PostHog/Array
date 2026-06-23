import { useHostTRPC } from "@posthog/host-router/react";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { navigateToApproval } from "@posthog/ui/router/navigationBridge";
import { logger } from "@posthog/ui/shell/logger";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect } from "react";

const log = logger.scope("approval-deep-link");

/**
 * Hook that handles agent approval deep links (`<scheme>://approval/{requestId}`,
 * e.g. `posthog-code://approval/ar_...` in production and `posthog-code-dev://…`
 * in local dev) and opens the fleet approvals inbox focused on that request. The
 * agent-runner emits these on a gated tool call so non-PostHog-Code clients
 * (Slack, MCP) can land on the approval.
 *
 * Mirrors `useScoutDeepLink`: drains any link that arrived before the renderer
 * was ready (the main process clears its pending entry on read) and also
 * subscribes for links delivered while the app is already running.
 */
export function useApprovalDeepLink() {
  const trpcReact = useHostTRPC();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );

  const pendingDeepLink = useQuery(
    trpcReact.deepLink.getPendingApprovalLink.queryOptions(undefined, {
      enabled: isAuthenticated,
      // Drain once per session – the main process clears its pending entry on read.
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
  );

  const openApproval = useCallback((requestId: string) => {
    log.info(`Opening approval from deep link: requestId=${requestId}`);
    navigateToApproval(requestId);
  }, []);

  useEffect(() => {
    if (pendingDeepLink.data?.requestId) {
      openApproval(pendingDeepLink.data.requestId);
    }
  }, [pendingDeepLink.data, openApproval]);

  useSubscription(
    trpcReact.deepLink.onOpenApproval.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data?.requestId) openApproval(data.requestId);
      },
    }),
  );
}
