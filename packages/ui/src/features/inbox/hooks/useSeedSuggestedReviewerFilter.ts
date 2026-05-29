import { useEffect } from "react";
import { useInboxSignalsFilterStore } from "../inboxSignalsFilterStore";

/**
 * Seeds the inbox suggested-reviewer filter with the current user on first
 * visit. Skips when no GitHub login is available — the backend resolves the
 * UUID through it, so the filter would return 0 reports. Skipping leaves the
 * init flag false so we try again once the user connects GitHub.
 */
export function useSeedSuggestedReviewerFilter({
  currentUserUuid,
  githubLogin,
}: {
  currentUserUuid: string | null | undefined;
  githubLogin: string | null | undefined;
}) {
  const seed = useInboxSignalsFilterStore(
    (s) => s.seedSuggestedReviewerFilterWithCurrentUser,
  );
  useEffect(() => {
    if (!currentUserUuid || !githubLogin) return;
    seed(currentUserUuid);
  }, [currentUserUuid, githubLogin, seed]);
}
