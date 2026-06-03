import {
  clearAuthScopedQueries,
  fetchAuthState,
  refreshAuthStateQuery,
} from "@features/auth/hooks/authQueries";
import { useAuthUiStateStore } from "@features/auth/stores/authUiStateStore";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { resetSessionService } from "@features/sessions/service/service";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import type { CloudRegion } from "@shared/types/regions";
import { useNavigationStore } from "@stores/navigationStore";
import { useMutation } from "@tanstack/react-query";
import { track } from "@utils/analytics";

function useAuthFlowMutation(
  mutateAuth: (region: CloudRegion) => Promise<{
    state: Awaited<ReturnType<typeof trpcClient.auth.getState.query>>;
  }>,
) {
  return useMutation({
    mutationFn: async (region: CloudRegion) => {
      return await mutateAuth(region);
    },
    onSuccess: async ({ state }, region) => {
      await refreshAuthStateQuery();
      useAuthUiStateStore.getState().clearStaleRegion();
      track(ANALYTICS_EVENTS.USER_LOGGED_IN, {
        project_id: state.currentProjectId?.toString() ?? "",
        region,
      });
    },
  });
}

export function useLoginMutation() {
  return useAuthFlowMutation(async (region) => {
    return await trpcClient.auth.login.mutate({ region });
  });
}

export function useSignupMutation() {
  return useAuthFlowMutation(async (region) => {
    return await trpcClient.auth.signup.mutate({ region });
  });
}

export function useSelectProjectMutation() {
  return useMutation({
    mutationFn: async (projectId: number) => {
      resetSessionService();
      return await trpcClient.auth.selectProject.mutate({ projectId });
    },
    onSuccess: async () => {
      clearAuthScopedQueries();
      await refreshAuthStateQuery();
      useNavigationStore.getState().navigateToTaskInput();
    },
  });
}

export function useSwitchOrgMutation() {
  return useMutation({
    mutationFn: async (orgId: string) => {
      resetSessionService();
      return await trpcClient.auth.switchOrg.mutate({ orgId });
    },
    onSuccess: async () => {
      clearAuthScopedQueries();
      await refreshAuthStateQuery();
    },
  });
}

export function useRedeemInviteCodeMutation() {
  return useMutation({
    mutationFn: async (code: string) =>
      await trpcClient.auth.redeemInviteCode.mutate({ code }),
    onSuccess: async () => {
      await refreshAuthStateQuery();
    },
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: async () => {
      const previousState = await fetchAuthState();

      track(ANALYTICS_EVENTS.USER_LOGGED_OUT);
      resetSessionService();

      return { previousState };
    },
    onSuccess: async ({ previousState }) => {
      clearAuthScopedQueries();
      useAuthUiStateStore.getState().setStaleRegion(previousState.cloudRegion);
      useNavigationStore.getState().navigateToTaskInput();
      useOnboardingStore.getState().resetSelections();

      await trpcClient.auth.logout.mutate();
      await refreshAuthStateQuery();
    },
  });
}
