import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useIsOrgAdmin } from "@features/auth/hooks/useOrgRole";
import { useGitHubIntegrationCallback } from "@features/integrations/hooks/useGitHubIntegrationCallback";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { trpcClient } from "@renderer/trpc/client";
import { IS_DEV } from "@shared/constants/environment";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000;

export type GithubUserConnectState =
  | "idle"
  | "connecting"
  | "timed-out"
  | "error";

export interface GithubUserConnectError {
  message: string;
  code: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "You declined access on GitHub. Try again to grant the permissions PostHog Code needs.",
  github_oauth_error: "GitHub returned an error during sign-in. Please retry.",
  missing_params: "GitHub returned an incomplete response. Please retry.",
  invalid_state:
    "The connection link expired before you finished. Please retry.",
  invalid_installation:
    "This GitHub installation isn't reachable from your account. Try a different account or org.",
  invalid_team:
    "Your project access changed during sign-in. Please retry from the current project.",
  invalid_installation_id:
    "GitHub returned an invalid installation. Please retry.",
  exchange_failed:
    "Couldn't exchange the GitHub authorization code. Please retry.",
  installation_verify_failed:
    "Couldn't verify your access to this GitHub installation. Please retry.",
  installation_not_authorized:
    "Your GitHub account isn't authorized for this installation. Ask the org admin to grant access, or sign in with a different GitHub account.",
  installation_fetch_failed:
    "Couldn't fetch installation details from GitHub. Please retry.",
  installation_token_failed:
    "Couldn't get an access token from GitHub. Please retry.",
  integration_create_failed:
    "Couldn't save the GitHub connection. Please retry.",
};

export function describeGithubConnectError(
  error: GithubUserConnectError | null,
): string {
  if (!error) return "";
  if (error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  return error.message;
}

interface Options {
  projectId: number | null;
}

interface Result {
  state: GithubUserConnectState;
  error: GithubUserConnectError | null;
  isConnecting: boolean;
  isTimedOut: boolean;
  hasError: boolean;
  connect: () => Promise<void>;
  reset: () => void;
}

export function invalidateGithubQueries(
  queryClient: QueryClient,
  projectId: number | null = null,
): void {
  if (projectId !== null) {
    void queryClient.invalidateQueries({
      queryKey: ["integrations", projectId],
    });
  }
  void queryClient.invalidateQueries({
    queryKey: ["integrations", "list"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["user-github-integrations"],
  });
  void queryClient.invalidateQueries({ queryKey: ["github_login"] });
}

export async function openUrlInBrowser(url: string): Promise<void> {
  try {
    await trpcClient.os.openExternal.mutate({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

interface StateMachine {
  state: GithubUserConnectState;
  error: GithubUserConnectError | null;
  stateRef: React.MutableRefObject<GithubUserConnectState>;
  beginConnecting: () => void;
  finishWithError: (error: GithubUserConnectError) => void;
  reset: () => void;
  scheduleUserFlowTimeout: () => void;
  scheduleDevPolling: () => void;
}

function useConnectStateMachine(projectId: number | null): StateMachine {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GithubUserConnectState>("idle");
  const [error, setError] = useState<GithubUserConnectError | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const invalidate = useCallback(
    (pid: number | null) => invalidateGithubQueries(queryClient, pid),
    [queryClient],
  );

  useEffect(() => stopPolling, [stopPolling]);

  // Window-focus fallback: deep link from PostHog Cloud may not fire reliably,
  // so refetch when the user returns to the app while a connect is in flight.
  useEffect(() => {
    if (state !== "connecting") return;
    const onFocus = () => invalidate(projectId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state, projectId, invalidate]);

  useGitHubIntegrationCallback({
    onSuccess: (callbackProjectId) => {
      stopPolling();
      setState("idle");
      setError(null);
      invalidate(callbackProjectId ?? projectId);
    },
    onError: (cbError) => {
      stopPolling();
      setState("error");
      setError(cbError);
    },
    onTimedOut: () => {
      stopPolling();
      setState("timed-out");
      invalidate(projectId);
    },
  });

  const beginConnecting = useCallback(() => {
    stopPolling();
    setError(null);
    setState("connecting");
  }, [stopPolling]);

  const finishWithError = useCallback(
    (e: GithubUserConnectError) => {
      stopPolling();
      setError(e);
      setState("error");
    },
    [stopPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setError(null);
    setState("idle");
  }, [stopPolling]);

  const scheduleUserFlowTimeout = useCallback(() => {
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setState("timed-out");
    }, POLL_TIMEOUT_MS);
  }, [stopPolling]);

  const scheduleDevPolling = useCallback(() => {
    if (!IS_DEV) return;
    pollTimerRef.current = setInterval(
      () => invalidate(projectId),
      POLL_INTERVAL_MS,
    );
  }, [invalidate, projectId]);

  return useMemo(
    () => ({
      state,
      error,
      stateRef,
      beginConnecting,
      finishWithError,
      reset,
      scheduleUserFlowTimeout,
      scheduleDevPolling,
    }),
    [
      state,
      error,
      beginConnecting,
      finishWithError,
      reset,
      scheduleUserFlowTimeout,
      scheduleDevPolling,
    ],
  );
}

function machineToResult(
  machine: StateMachine,
  connect: () => Promise<void>,
): Result {
  return {
    state: machine.state,
    error: machine.error,
    isConnecting: machine.state === "connecting",
    isTimedOut: machine.state === "timed-out",
    hasError: machine.state === "error",
    connect,
    reset: machine.reset,
  };
}

async function runUserFlow(
  client: PostHogAPIClient,
  projectId: number,
): Promise<void> {
  const res = await client.startGithubUserIntegrationConnect(projectId);
  const installUrl = res.install_url?.trim() ?? "";
  if (!installUrl) {
    throw new Error("GitHub connection did not return a URL");
  }
  await openUrlInBrowser(installUrl);
}

export function useGithubUserConnect({ projectId }: Options): Result {
  const client = useOptionalAuthenticatedClient();
  const machine = useConnectStateMachine(projectId);

  const connect = useCallback(async () => {
    if (machine.stateRef.current === "connecting") return;
    if (projectId === null || !client) return;
    machine.beginConnecting();
    try {
      await runUserFlow(client, projectId);
      machine.scheduleDevPolling();
      machine.scheduleUserFlowTimeout();
    } catch (e) {
      machine.finishWithError({
        message:
          e instanceof Error ? e.message : "Failed to start GitHub connection",
        code: null,
      });
    }
  }, [client, projectId, machine]);

  return machineToResult(machine, connect);
}

interface ConnectOptions extends Options {
  /** Whether `projectId` already has a team-level GitHub Integration. Required
   *  because the relevant project is not always the auth project (e.g.
   *  onboarding picks a project from a list). Admins on projects where this
   *  is `false` get the team-level OAuth flow (Cloud also seeds their
   *  `UserIntegration` in the same round-trip). */
  projectHasTeamIntegration: boolean | null;
}

/**
 * Single "Connect GitHub" button for surfaces that should respect the
 * team-vs-user distinction. Picks the team-level flow only for admins on
 * projects with no team integration yet; everyone else gets the user-level
 * flow. For purely user-scoped surfaces ("Add another GitHub org") use
 * `useGithubUserConnect` directly.
 */
export function useGithubConnect({
  projectId,
  projectHasTeamIntegration,
}: ConnectOptions): Result {
  const client = useOptionalAuthenticatedClient();
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const { isAdmin } = useIsOrgAdmin();
  const machine = useConnectStateMachine(projectId);

  const shouldUseTeamFlow =
    isAdmin === true &&
    projectHasTeamIntegration === false &&
    cloudRegion != null;

  const connect = useCallback(async () => {
    if (machine.stateRef.current === "connecting") return;
    if (projectId === null || !client) return;
    machine.beginConnecting();
    try {
      if (shouldUseTeamFlow && cloudRegion) {
        const res = await trpcClient.githubIntegration.startFlow.mutate({
          region: cloudRegion,
          projectId,
        });
        if (!res.success) {
          throw new Error(res.error ?? "Failed to start GitHub connection");
        }
        // Team flow's URL launch + timeout live in the main process and route
        // back through the shared callback subscription.
      } else {
        await runUserFlow(client, projectId);
        machine.scheduleDevPolling();
        machine.scheduleUserFlowTimeout();
      }
    } catch (e) {
      machine.finishWithError({
        message:
          e instanceof Error ? e.message : "Failed to start GitHub connection",
        code: null,
      });
    }
  }, [client, projectId, shouldUseTeamFlow, cloudRegion, machine]);

  return machineToResult(machine, connect);
}
