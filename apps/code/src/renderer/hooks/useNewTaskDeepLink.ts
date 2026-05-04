import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { trpcClient, useTRPC } from "@renderer/trpc";
import type { NewTaskLinkPayload } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { useSubscription } from "@trpc/tanstack-react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

const log = logger.scope("new-task-deep-link");

export function useNewTaskDeepLink() {
  const trpcReact = useTRPC();
  const navigateToTaskInput = useNavigationStore(
    (state) => state.navigateToTaskInput,
  );
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const hasFetchedPending = useRef(false);

  const handleAction = useCallback(
    async (payload: NewTaskLinkPayload) => {
      log.info(`Handling deep link action: ${payload.action}`);

      switch (payload.action) {
        case "new":
          return handleNew(payload, navigateToTaskInput);
        case "plan":
          return handlePlan(payload, navigateToTaskInput);
        case "issue":
          return handleIssue(payload, navigateToTaskInput);
      }
    },
    [navigateToTaskInput],
  );

  useEffect(() => {
    if (!isAuthenticated || hasFetchedPending.current) return;

    const fetchPending = async () => {
      hasFetchedPending.current = true;
      try {
        const pending = await trpcClient.deepLink.getPendingNewTaskLink.query();
        if (pending) {
          log.info(`Found pending new task link: action=${pending.action}`);
          handleAction(pending);
        }
      } catch (error) {
        log.error("Failed to check for pending new task link:", error);
      }
    };

    fetchPending();
  }, [isAuthenticated, handleAction]);

  useSubscription(
    trpcReact.deepLink.onNewTaskAction.subscriptionOptions(undefined, {
      onData: (data) => {
        log.info(`Received new task link event: action=${data.action}`);
        handleAction(data).catch((error) => {
          log.error("Failed to handle new task link action:", error);
        });
      },
    }),
  );
}

type NavigateToTaskInput = (options?: {
  folderId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
}) => void;

function handleNew(
  payload: Extract<NewTaskLinkPayload, { action: "new" }>,
  navigateToTaskInput: NavigateToTaskInput,
) {
  navigateToTaskInput({
    initialPrompt: payload.prompt,
    initialCloudRepository: payload.repo,
  });

  track(ANALYTICS_EVENTS.DEEP_LINK_NEW_TASK, {
    has_prompt: !!payload.prompt,
    has_repo: !!payload.repo,
    mode: payload.mode,
    model: payload.model,
  });

  log.info("Navigated to task input from new deep link");
}

function handlePlan(
  payload: Extract<NewTaskLinkPayload, { action: "plan" }>,
  navigateToTaskInput: NavigateToTaskInput,
) {
  navigateToTaskInput({
    initialPrompt: payload.plan,
    initialCloudRepository: payload.repo,
  });

  track(ANALYTICS_EVENTS.DEEP_LINK_PLAN, {
    has_repo: !!payload.repo,
    mode: payload.mode,
    model: payload.model,
    plan_length_chars: payload.plan.length,
  });

  log.info("Navigated to task input from plan deep link");
}

async function handleIssue(
  payload: Extract<NewTaskLinkPayload, { action: "issue" }>,
  navigateToTaskInput: NavigateToTaskInput,
) {
  try {
    const issue = await trpcClient.git.getGithubIssue.query({
      owner: payload.owner,
      repo: payload.issueRepo,
      number: payload.issueNumber,
    });

    if (!issue) {
      toast.error("GitHub issue not found");
      log.warn("GitHub issue not found", {
        owner: payload.owner,
        repo: payload.issueRepo,
        number: payload.issueNumber,
      });
      return;
    }

    const labelsText =
      issue.labels.length > 0 ? `\nLabels: ${issue.labels.join(", ")}` : "";
    const prompt = `GitHub Issue: ${issue.title}\n${issue.url}${labelsText}`;

    const cloudRepo = payload.repo ?? `${payload.owner}/${payload.issueRepo}`;

    navigateToTaskInput({
      initialPrompt: prompt,
      initialCloudRepository: cloudRepo,
    });

    track(ANALYTICS_EVENTS.DEEP_LINK_ISSUE, {
      owner: payload.owner,
      repo: payload.issueRepo,
      issue_number: payload.issueNumber,
      mode: payload.mode,
      model: payload.model,
    });

    log.info("Navigated to task input from issue deep link", {
      issue: issue.title,
    });
  } catch (error) {
    log.error("Failed to fetch GitHub issue:", error);
    toast.error("Failed to fetch GitHub issue");
  }
}
