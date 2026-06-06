import { PostHogAPIClient } from "@renderer/api/posthogClient";
import { trpcClient } from "@renderer/trpc/client";
import { NotAuthenticatedError } from "@shared/errors";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useMemo } from "react";
import {
  type AuthState,
  fetchAuthState,
  useAuthStateValue,
} from "./authQueries";

async function getValidAccessToken(): Promise<string> {
  const { accessToken } = await trpcClient.auth.getValidAccessToken.query();
  return accessToken;
}

async function refreshAccessToken(): Promise<string> {
  const { accessToken } = await trpcClient.auth.refreshAccessToken.mutate();
  return accessToken;
}

export function createAuthenticatedClient(
  authState: AuthState | null | undefined,
): PostHogAPIClient | null {
  if (authState?.status !== "authenticated" || !authState.cloudRegion) {
    return null;
  }

  const client = new PostHogAPIClient(
    getCloudUrlFromRegion(authState.cloudRegion),
    getValidAccessToken,
    refreshAccessToken,
    authState.currentProjectId ?? undefined,
  );

  if (authState.currentProjectId) {
    client.setTeamId(authState.currentProjectId);
  }

  return client;
}

export async function getAuthenticatedClient(): Promise<PostHogAPIClient | null> {
  return createAuthenticatedClient(await fetchAuthState());
}

export function useOptionalAuthenticatedClient(): PostHogAPIClient | null {
  const authState = useAuthStateValue((state) => state);

  return useMemo(
    () => createAuthenticatedClient(authState),
    [
      authState.cloudRegion,
      authState.currentProjectId,
      authState.status,
      authState,
    ],
  );
}

export function useAuthenticatedClient(): PostHogAPIClient {
  const client = useOptionalAuthenticatedClient();

  if (!client) {
    throw new NotAuthenticatedError();
  }

  return client;
}
