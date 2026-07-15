import type { TaskCreationInput } from "@posthog/core/task-detail/taskService";
import {
  type InboxCloudTaskInputContext,
  useInboxCloudTaskRunner,
} from "@posthog/ui/features/inbox/hooks/useInboxCloudTaskRunner";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import {
  resolveDefaultCloudRepository,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { useCallback, useMemo, useRef } from "react";
import { buildLoopBuilderPrompt } from "../loopBuilderPrompt";

interface UseLoopBuilderTaskReturn {
  /** Start an auto-mode cloud session that builds a loop from `instructions` and navigate to it. */
  runTask: (instructions: string) => Promise<void>;
  /** True while the session is being created. */
  isRunning: boolean;
}

/**
 * The loops prompt box: start a cloud sandbox agent whose job is to build a Loop
 * with the user (ask clarifying questions, confirm, then create it via the PostHog
 * MCP `loops-create` tool). Mirrors `useScoutChatTask` — a repo-less, auto-mode
 * cloud task seeded with a canned instruction prompt. The user's typed text rides
 * in through a ref so the fixed `buildInput` closure reads the latest submission.
 */
export function useLoopBuilderTask(): UseLoopBuilderTaskReturn {
  const instructionsRef = useRef("");
  const { repositories } = useUserRepositoryIntegration();
  const lastUsedCloudRepository = useSettingsStore(
    (state) => state.lastUsedCloudRepository,
  );

  const cloudRepository = useMemo(
    () => resolveDefaultCloudRepository(repositories, lastUsedCloudRepository),
    [lastUsedCloudRepository, repositories],
  );

  const buildInput = useCallback(
    (ctx: InboxCloudTaskInputContext): TaskCreationInput => {
      const prompt = buildLoopBuilderPrompt({
        instructions: instructionsRef.current,
      });
      return {
        content: prompt,
        taskDescription: prompt,
        repository: ctx.cloudRepository,
        githubUserIntegrationId: ctx.githubUserIntegrationId ?? undefined,
        workspaceMode: "cloud",
        executionMode: "default",
        adapter: ctx.adapter,
        model: ctx.model,
        reasoningLevel: ctx.reasoningLevel,
      };
    },
    [],
  );

  const copy = useMemo(
    () => ({
      loadingTitle: "Starting loop builder...",
      errorTitle: "Failed to start loop builder",
      missingRepository: "Connect a GitHub repository before building a loop",
      missingIntegration: "Connect a GitHub integration to build a loop",
      signedOut: "Sign in to build a loop",
      missingModel:
        "Couldn't resolve a default model. Open a task once and pick a model, then try again.",
    }),
    [],
  );

  const { run, isRunning } = useInboxCloudTaskRunner({
    cloudRepository,
    // Loop creation is pure PostHog-MCP work; a missing repo must not block it.
    allowMissingRepository: true,
    loggerScope: "loop-builder",
    copy,
    buildInput,
  });

  const runTask = useCallback(
    async (instructions: string) => {
      instructionsRef.current = instructions;
      await run();
    },
    [run],
  );

  return { runTask, isRunning };
}
