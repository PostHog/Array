import { useHostTRPCClient } from "@posthog/host-router/react";
import { BILLING_FLAG } from "@posthog/shared";
import { useSeatStore } from "@posthog/ui/features/billing/seatStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import {
  identifyUser,
  resetUser,
  setUserGroups,
} from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOptionalAuthenticatedClient } from "./authClient";
import {
  type AuthState,
  clearAuthScopedQueries,
  getAuthIdentity,
  refreshAuthStateQuery,
  useAuthStateValue,
  useCurrentUser,
} from "./authQueries";
import { useAuthUiStateStore } from "./authUiStateStore";

const log = logger.scope("auth-session");

function useAuthSubscriptionSync(): void {
  const hostClient = useHostTRPCClient();
  useEffect(() => {
    const subscription = hostClient.auth.onStateChanged.subscribe(undefined, {
      onData: () => {
        void refreshAuthStateQuery();
      },
      onError: (error) => {
        log.error("Auth state subscription error", { error });
      },
    });

    return () => subscription.unsubscribe();
  }, [hostClient]);
}

function useAuthIdentitySync(authState: AuthState): void {
  const authIdentity = getAuthIdentity(authState);
  const cloudRegion = authState.cloudRegion;
  const hostClient = useHostTRPCClient();
  useEffect(() => {
    if (!authIdentity) {
      if (!authState.bootstrapComplete || authState.status === "restoring") {
        return;
      }
      resetUser();
      void hostClient.analytics.resetUser.mutate();
      clearAuthScopedQueries();
      if (cloudRegion) {
        useAuthUiStateStore.getState().setStaleRegion(cloudRegion);
      }
      return;
    }

    useAuthUiStateStore.getState().clearStaleRegion();
  }, [
    authIdentity,
    authState.bootstrapComplete,
    authState.status,
    cloudRegion,
    hostClient,
  ]);
}

function useAuthAnalyticsIdentity(
  authIdentity: string | null,
  authState: AuthState,
  currentUser: ReturnType<typeof useCurrentUser>["data"],
): void {
  const hostClient = useHostTRPCClient();
  useEffect(() => {
    if (!authIdentity || !currentUser) {
      return;
    }

    const distinctId = currentUser.distinct_id || currentUser.email;

    identifyUser(distinctId, {
      email: currentUser.email,
      uuid: currentUser.uuid,
      project_id: authState.currentProjectId?.toString() ?? "",
      region: authState.cloudRegion ?? "",
    });

    setUserGroups(currentUser);

    void hostClient.analytics.setUserId.mutate({
      userId: distinctId,
      properties: {
        email: currentUser.email,
        uuid: currentUser.uuid,
        project_id: authState.currentProjectId?.toString() ?? "",
        region: authState.cloudRegion ?? "",
      },
    });
  }, [
    authIdentity,
    authState.cloudRegion,
    authState.currentProjectId,
    currentUser,
    hostClient,
  ]);
}

function useSeatSync(
  authIdentity: string | null,
  billingEnabled: boolean,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!authIdentity || !billingEnabled) {
      useSeatStore.getState().reset();
      return;
    }

    void useSeatStore.getState().fetchSeat({ autoProvision: true });
    void queryClient.invalidateQueries({ queryKey: [["llmGateway"]] });
  }, [authIdentity, billingEnabled, queryClient]);
}

export function useAuthSession() {
  const authState = useAuthStateValue((state) => state);
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const authIdentity = getAuthIdentity(authState);

  const billingEnabled = useFeatureFlag(BILLING_FLAG);

  useAuthSubscriptionSync();
  useAuthIdentitySync(authState);
  useAuthAnalyticsIdentity(authIdentity, authState, currentUser);
  useSeatSync(authIdentity, billingEnabled);

  return {
    authState,
    isBootstrapped: authState.bootstrapComplete,
  };
}
