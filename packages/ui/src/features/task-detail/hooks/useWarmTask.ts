import {
  TASKS_PREWARM_SANDBOX_FLAG,
  type WorkspaceMode,
} from "@posthog/shared";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useEffect, useRef } from "react";
import { logger } from "../../../shell/logger";

const log = logger.scope("warm-task");

const WARM_DEBOUNCE_MS = 600;

interface UseWarmTaskOptions {
  workspaceMode: WorkspaceMode;
  selectedRepository?: string | null;
  githubIntegrationId?: number;
  branch?: string | null;
  editorIsEmpty: boolean;
}

export function useWarmTask({
  workspaceMode,
  selectedRepository,
  githubIntegrationId,
  branch,
  editorIsEmpty,
}: UseWarmTaskOptions): void {
  const enabled = useFeatureFlag(TASKS_PREWARM_SANDBOX_FLAG);
  const client = useOptionalAuthenticatedClient();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWarmedKeyRef = useRef<string | null>(null);

  const isCloud = workspaceMode === "cloud";
  const normalizedBranch = branch ?? null;
  const eligible =
    enabled &&
    isCloud &&
    !!client &&
    !!selectedRepository &&
    githubIntegrationId !== undefined &&
    !editorIsEmpty;
  const key =
    selectedRepository && githubIntegrationId !== undefined
      ? `${githubIntegrationId}:${selectedRepository}:${normalizedBranch ?? ""}`
      : null;

  useEffect(() => {
    const clearDebounce = (): void => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };

    if (!eligible || !key || !selectedRepository || !client) {
      clearDebounce();
      return;
    }
    if (lastWarmedKeyRef.current === key || debounceRef.current) {
      return;
    }

    const repository = selectedRepository;
    const githubIntegration = githubIntegrationId as number;
    const warmBranch = normalizedBranch;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastWarmedKeyRef.current = key;
      void client
        .warmTask({
          repository,
          github_integration: githubIntegration,
          branch: warmBranch,
        })
        .catch((error) => {
          lastWarmedKeyRef.current = null;
          log.warn("Failed to warm task", { error });
        });
    }, WARM_DEBOUNCE_MS);

    return clearDebounce;
  }, [
    eligible,
    key,
    client,
    selectedRepository,
    githubIntegrationId,
    normalizedBranch,
  ]);
}
