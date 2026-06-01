import { useNavigationStore } from "@stores/navigationStore";
import { toast } from "@utils/toast";
import { useCallback } from "react";
import type { HomeWorkstream } from "../utils/buildSnapshot";
import type { BoundAction } from "./useBoundActions";

// Routes a bound workflow action into the new-task screen with the prompt
// prefilled, rather than firing `taskService.createTask` directly: the user
// still picks skill/branch/model on that screen, and we don't want to
// duplicate that picker logic here.
export function useRunWorkstreamAction() {
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);

  return useCallback(
    (action: BoundAction, workstream: HomeWorkstream) => {
      navigateToTaskInput({
        initialPrompt: action.prompt,
        initialCloudRepository: workstream.repoName ?? undefined,
      });
      toast.info(
        action.label,
        `Pick the "${action.skillId}" skill on the next screen — prompt is prefilled.`,
      );
    },
    [navigateToTaskInput],
  );
}
