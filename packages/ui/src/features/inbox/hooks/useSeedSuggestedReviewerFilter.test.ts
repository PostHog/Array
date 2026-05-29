import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useInboxSignalsFilterStore } from "../inboxSignalsFilterStore";
import { useSeedSuggestedReviewerFilter } from "./useSeedSuggestedReviewerFilter";

describe("useSeedSuggestedReviewerFilter", () => {
  beforeEach(() => {
    localStorage.clear();
    useInboxSignalsFilterStore.setState({
      suggestedReviewerFilter: [],
      hasInitializedSuggestedReviewerFilter: false,
    });
  });

  it("skips seeding when the user has no GitHub login", () => {
    renderHook(() =>
      useSeedSuggestedReviewerFilter({
        currentUserUuid: "user-uuid",
        githubLogin: null,
      }),
    );
    const state = useInboxSignalsFilterStore.getState();
    expect(state.suggestedReviewerFilter).toEqual([]);
    // Init flag stays false so a later visit can retry once GitHub is connected.
    expect(state.hasInitializedSuggestedReviewerFilter).toBe(false);
  });

  it("seeds with the current user when both UUID and GitHub login are present", () => {
    renderHook(() =>
      useSeedSuggestedReviewerFilter({
        currentUserUuid: "user-uuid",
        githubLogin: "octocat",
      }),
    );
    const state = useInboxSignalsFilterStore.getState();
    expect(state.suggestedReviewerFilter).toEqual(["user-uuid"]);
    expect(state.hasInitializedSuggestedReviewerFilter).toBe(true);
  });

  it("seeds on a later render once the GitHub login resolves", () => {
    const { rerender } = renderHook(
      ({ githubLogin }: { githubLogin: string | null }) =>
        useSeedSuggestedReviewerFilter({
          currentUserUuid: "user-uuid",
          githubLogin,
        }),
      { initialProps: { githubLogin: null as string | null } },
    );
    expect(
      useInboxSignalsFilterStore.getState().suggestedReviewerFilter,
    ).toEqual([]);

    rerender({ githubLogin: "octocat" });
    const state = useInboxSignalsFilterStore.getState();
    expect(state.suggestedReviewerFilter).toEqual(["user-uuid"]);
    expect(state.hasInitializedSuggestedReviewerFilter).toBe(true);
  });
});
