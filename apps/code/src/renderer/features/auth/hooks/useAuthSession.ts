import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  type AuthState,
  clearAuthScopedQueries,
  getAuthIdentity,
  refreshAuthStateQuery,
  useAuthStateValue,
  useCurrentUser,
} from "@features/auth/hooks/authQueries";
import { useAuthUiStateStore } from "@features/auth/stores/authUiStateStore";
import { useSeatStore } from "@features/billing/stores/seatStore";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { trpcClient } from "@renderer/trpc/client";
import { BILLING_FLAG } from "@shared/constants";
import { identifyUser, resetUser, setUserGroups } from "@utils/analytics";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { useEffect } from "react";

const log = logger.scope("auth-session");

function useAuthSubscriptionSync(): void {
  useEffect(() => {
    const subscription = trpcClient.auth.onStateChanged.subscribe(undefined, {
      onData: () => {
        void refreshAuthStateQuery();
      },
      onError: (error) => {
        log.error("Auth state subscription error", { error });
      },
    });

    return () => subscription.unsubscribe();
  }, []);
}

function useAuthIdentitySync(
  authIdentity: string | null,
  cloudRegion: "us" | "eu" | "dev" | null,
): void {
  useEffect(() => {
    if (!authIdentity) {
      resetUser();
      void trpcClient.analytics.resetUser.mutate();
      clearAuthScopedQueries();
      if (cloudRegion) {
        useAuthUiStateStore.getState().setStaleRegion(cloudRegion);
      }
      return;
    }

    useAuthUiStateStore.getState().clearStaleRegion();
  }, [authIdentity, cloudRegion]);
}

function useAuthAnalyticsIdentity(
  authIdentity: string | null,
  authState: AuthState,
  currentUser: ReturnType<typeof useCurrentUser>["data"],
): void {
  useEffect(() => {
    if (!authIdentity || !currentUser) {
      return;
    }

    const distinctId = currentUser.distinct_id || currentUser.email;

    identifyUser(distinctId, {
      email: currentUser.email,
      uuid: currentUser.uuid,
      project_id: authState.projectId?.toString() ?? "",
      region: authState.cloudRegion ?? "",
    });

    setUserGroups(currentUser);

    void trpcClient.analytics.setUserId.mutate({
      userId: distinctId,
      properties: {
        email: currentUser.email,
        uuid: currentUser.uuid,
        project_id: authState.projectId?.toString() ?? "",
        region: authState.cloudRegion ?? "",
      },
    });
  }, [authIdentity, authState.cloudRegion, authState.projectId, currentUser]);
}

function useSeatSync(
  authIdentity: string | null,
  billingEnabled: boolean,
): void {
  useEffect(() => {
    if (!authIdentity || !billingEnabled) {
      useSeatStore.getState().reset();
      return;
    }

    void useSeatStore.getState().fetchSeat({ autoProvision: true });
    void queryClient.invalidateQueries({ queryKey: [["llmGateway"]] });
  }, [authIdentity, billingEnabled]);
}

export function useAuthSession() {
  const authState = useAuthStateValue((state) => state);
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const authIdentity = getAuthIdentity(authState);

  const billingEnabled = useFeatureFlag(BILLING_FLAG);

  useAuthSubscriptionSync();
  useAuthIdentitySync(authIdentity, authState.cloudRegion);
  useAuthAnalyticsIdentity(authIdentity, authState, currentUser);
  useSeatSync(authIdentity, billingEnabled);

  return {
    authState,
    isBootstrapped: authState.bootstrapComplete,
  };
}
