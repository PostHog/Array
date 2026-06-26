import { TASKS_PREWARM_SANDBOX_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "posthog-react-native";
import { useEffect, useRef } from "react";
import { warmTask } from "@/features/tasks/api";
import { logger } from "@/lib/logger";

const log = logger.scope("warm-task");

const WARM_DEBOUNCE_MS = 600;

interface UseWarmTaskOptions {
  repository?: string | null;
  githubIntegrationId?: number | null;
  branch?: string | null;
  composerIsEmpty: boolean;
}

export function useWarmTask({
  repository,
  githubIntegrationId,
  branch,
  composerIsEmpty,
}: UseWarmTaskOptions): void {
  const enabled = useFeatureFlag(TASKS_PREWARM_SANDBOX_FLAG);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWarmedKeyRef = useRef<string | null>(null);

  const normalizedBranch = branch ?? null;
  const eligible =
    !!enabled &&
    !!repository &&
    githubIntegrationId != null &&
    !composerIsEmpty;
  const key =
    repository && githubIntegrationId != null
      ? `${githubIntegrationId}:${repository}:${normalizedBranch ?? ""}`
      : null;

  useEffect(() => {
    const clearDebounce = (): void => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };

    if (!eligible || !key || !repository || githubIntegrationId == null) {
      clearDebounce();
      return;
    }
    if (lastWarmedKeyRef.current === key || debounceRef.current) {
      return;
    }

    const repo = repository;
    const githubIntegration = githubIntegrationId;
    const warmBranch = normalizedBranch;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastWarmedKeyRef.current = key;
      void warmTask({
        repository: repo,
        github_integration: githubIntegration,
        branch: warmBranch,
      }).catch((error) => {
        lastWarmedKeyRef.current = null;
        log.warn("Failed to warm task", error);
      });
    }, WARM_DEBOUNCE_MS);

    return clearDebounce;
  }, [eligible, key, repository, githubIntegrationId, normalizedBranch]);
}
