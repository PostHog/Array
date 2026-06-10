import type { TaskCreationInput } from "@posthog/core/task-detail/taskService";
import {
  type InboxCloudTaskInputContext,
  useInboxCloudTaskRunner,
} from "@posthog/ui/features/inbox/hooks/useInboxCloudTaskRunner";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCallback, useMemo } from "react";

// Templated prompt behind the "How is my scout fleet performing?" CTA. The
// agent leans on the exploring-signals-scouts skill from the PostHog MCP.
const FLEET_OVERVIEW_PROMPT = `How is my scout fleet performing?

Use the exploring-signals-scouts skill from the PostHog MCP to survey the signals scout fleet on this project and give me a high-level overview:

- The fleet: which scouts exist, enabled vs disabled, and their cadences
- Recent run health: success rate, failures and timeouts, anything stuck
- Output: which scouts emitted signals recently, emit rate, signal-to-noise
- Memory: notable scratchpad entries the fleet has learned
- Recommendations: anything misconfigured, noisy, or worth tuning

Lead with a short overall verdict, then per-scout notes only where something is notable. If the skill is unavailable, fall back to the signals-scout MCP tools directly (config list, runs list, scratchpad search).`;

interface UseFleetOverviewTaskReturn {
  /** Create the auto-mode fleet-overview task and navigate to it on success. */
  runFleetOverview: () => Promise<void>;
  /** True while the task is being created. */
  isRunning: boolean;
}

/**
 * One-click fleet-overview task, mirroring the inbox discuss flow: create an
 * auto-mode cloud task and jump straight to it. The repository falls back to
 * the last-used cloud repository, then the first connected one.
 */
export function useFleetOverviewTask(): UseFleetOverviewTaskReturn {
  const { repositories } = useUserRepositoryIntegration();
  const lastUsedCloudRepository = useSettingsStore(
    (state) => state.lastUsedCloudRepository,
  );

  const cloudRepository = useMemo(() => {
    const normalizedLastUsed = lastUsedCloudRepository?.toLowerCase() ?? null;
    if (normalizedLastUsed && repositories.includes(normalizedLastUsed)) {
      return normalizedLastUsed;
    }
    return repositories[0] ?? null;
  }, [lastUsedCloudRepository, repositories]);

  const buildInput = useCallback(
    (ctx: InboxCloudTaskInputContext): TaskCreationInput => ({
      content: FLEET_OVERVIEW_PROMPT,
      taskDescription: FLEET_OVERVIEW_PROMPT,
      repository: ctx.cloudRepository,
      githubUserIntegrationId: ctx.githubUserIntegrationId,
      workspaceMode: "cloud",
      executionMode: "auto",
      adapter: ctx.adapter,
      model: ctx.model,
      reasoningLevel: ctx.reasoningLevel,
    }),
    [],
  );

  const { run, isRunning } = useInboxCloudTaskRunner({
    cloudRepository,
    loggerScope: "scout-fleet-overview",
    copy: {
      loadingTitle: "Starting fleet overview...",
      errorTitle: "Failed to start fleet overview",
      missingRepository:
        "Connect a GitHub repository before starting a fleet overview",
      missingIntegration:
        "Connect a GitHub integration to start a fleet overview",
      signedOut: "Sign in to start a fleet overview",
      missingModel:
        "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
    },
    buildInput,
  });

  return { runFleetOverview: run, isRunning };
}
