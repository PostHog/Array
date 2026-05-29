import { beforeEach, describe, expect, it } from "vitest";
import { useInboxSignalsFilterStore } from "./inboxSignalsFilterStore";

describe("inboxSignalsFilterStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useInboxSignalsFilterStore.setState({
      sortField: "total_weight",
      sortDirection: "desc",
      searchQuery: "",
      statusFilter: [
        "ready",
        "pending_input",
        "in_progress",
        "failed",
        "candidate",
        "potential",
      ],
      sourceProductFilter: [],
      suggestedReviewerFilter: [],
      hasInitializedSuggestedReviewerFilter: false,
      priorityFilter: [],
    });
  });

  it("has correct defaults", () => {
    const state = useInboxSignalsFilterStore.getState();
    expect(state.sortField).toBe("total_weight");
    expect(state.sortDirection).toBe("desc");
    expect(state.searchQuery).toBe("");
    expect(state.statusFilter).toEqual([
      "ready",
      "pending_input",
      "in_progress",
      "failed",
      "candidate",
      "potential",
    ]);
    expect(state.sourceProductFilter).toEqual([]);
    expect(state.suggestedReviewerFilter).toEqual([]);
    expect(state.priorityFilter).toEqual([]);
  });

  it("setSort updates field and direction", () => {
    useInboxSignalsFilterStore.getState().setSort("created_at", "asc");
    const state = useInboxSignalsFilterStore.getState();
    expect(state.sortField).toBe("created_at");
    expect(state.sortDirection).toBe("asc");
  });

  it("setSearchQuery updates query", () => {
    useInboxSignalsFilterStore.getState().setSearchQuery("login error");
    expect(useInboxSignalsFilterStore.getState().searchQuery).toBe(
      "login error",
    );
  });

  it("persists sortField and sortDirection", () => {
    useInboxSignalsFilterStore.getState().setSort("created_at", "desc");
    const raw = localStorage.getItem("inbox-signals-filter-storage");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.sortField).toBe("created_at");
    expect(persisted.state.sortDirection).toBe("desc");
  });

  it("does not persist searchQuery", () => {
    useInboxSignalsFilterStore.getState().setSearchQuery("test");
    const raw = localStorage.getItem("inbox-signals-filter-storage");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.searchQuery).toBeUndefined();
  });

  it("toggleSuggestedReviewer adds and removes reviewer ids", () => {
    useInboxSignalsFilterStore.getState().toggleSuggestedReviewer("reviewer-1");
    expect(
      useInboxSignalsFilterStore.getState().suggestedReviewerFilter,
    ).toEqual(["reviewer-1"]);

    useInboxSignalsFilterStore.getState().toggleSuggestedReviewer("reviewer-1");
    expect(
      useInboxSignalsFilterStore.getState().suggestedReviewerFilter,
    ).toEqual([]);
  });

  it("setSuggestedReviewerFilter de-duplicates reviewer ids", () => {
    useInboxSignalsFilterStore
      .getState()
      .setSuggestedReviewerFilter(["reviewer-1", "reviewer-2", "reviewer-1"]);

    expect(
      useInboxSignalsFilterStore.getState().suggestedReviewerFilter,
    ).toEqual(["reviewer-1", "reviewer-2"]);
  });

  it("persists suggestedReviewerFilter", () => {
    useInboxSignalsFilterStore
      .getState()
      .setSuggestedReviewerFilter(["reviewer-1", "reviewer-2"]);

    const raw = localStorage.getItem("inbox-signals-filter-storage");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);

    expect(persisted.state.suggestedReviewerFilter).toEqual([
      "reviewer-1",
      "reviewer-2",
    ]);
  });

  it("togglePriority adds and removes priorities", () => {
    useInboxSignalsFilterStore.getState().togglePriority("P0");
    expect(useInboxSignalsFilterStore.getState().priorityFilter).toEqual([
      "P0",
    ]);

    useInboxSignalsFilterStore.getState().togglePriority("P1");
    expect(useInboxSignalsFilterStore.getState().priorityFilter).toEqual([
      "P0",
      "P1",
    ]);

    useInboxSignalsFilterStore.getState().togglePriority("P0");
    expect(useInboxSignalsFilterStore.getState().priorityFilter).toEqual([
      "P1",
    ]);
  });

  it("setPriorityFilter de-duplicates priorities", () => {
    useInboxSignalsFilterStore.getState().setPriorityFilter(["P0", "P1", "P0"]);

    expect(useInboxSignalsFilterStore.getState().priorityFilter).toEqual([
      "P0",
      "P1",
    ]);
  });

  it("persists priorityFilter", () => {
    useInboxSignalsFilterStore.getState().setPriorityFilter(["P0", "P1"]);

    const raw = localStorage.getItem("inbox-signals-filter-storage");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);

    expect(persisted.state.priorityFilter).toEqual(["P0", "P1"]);
  });

  it("resetFilters restores defaults across all filter fields", () => {
    const store = useInboxSignalsFilterStore.getState();
    store.setSearchQuery("hello");
    store.setStatusFilter(["ready"]);
    store.toggleSourceProduct("github");
    store.setSuggestedReviewerFilter(["reviewer-1"]);
    store.setPriorityFilter(["P0", "P1"]);

    useInboxSignalsFilterStore.getState().resetFilters();

    const state = useInboxSignalsFilterStore.getState();
    expect(state.searchQuery).toBe("");
    expect(state.statusFilter).toEqual([
      "ready",
      "pending_input",
      "in_progress",
      "failed",
      "candidate",
      "potential",
    ]);
    expect(state.sourceProductFilter).toEqual([]);
    expect(state.suggestedReviewerFilter).toEqual([]);
    expect(state.priorityFilter).toEqual([]);
  });

  it("seedSuggestedReviewerFilterWithCurrentUser seeds when empty and uninitialized", () => {
    useInboxSignalsFilterStore
      .getState()
      .seedSuggestedReviewerFilterWithCurrentUser("me-uuid");

    const state = useInboxSignalsFilterStore.getState();
    expect(state.suggestedReviewerFilter).toEqual(["me-uuid"]);
    expect(state.hasInitializedSuggestedReviewerFilter).toBe(true);
  });

  it("seedSuggestedReviewerFilterWithCurrentUser is a no-op once initialized", () => {
    useInboxSignalsFilterStore
      .getState()
      .seedSuggestedReviewerFilterWithCurrentUser("me-uuid");
    useInboxSignalsFilterStore.getState().setSuggestedReviewerFilter([]);

    useInboxSignalsFilterStore
      .getState()
      .seedSuggestedReviewerFilterWithCurrentUser("me-uuid");

    expect(
      useInboxSignalsFilterStore.getState().suggestedReviewerFilter,
    ).toEqual([]);
  });

  it("seedSuggestedReviewerFilterWithCurrentUser preserves an existing non-empty filter", () => {
    useInboxSignalsFilterStore
      .getState()
      .setSuggestedReviewerFilter(["someone-else"]);

    useInboxSignalsFilterStore
      .getState()
      .seedSuggestedReviewerFilterWithCurrentUser("me-uuid");

    const state = useInboxSignalsFilterStore.getState();
    expect(state.suggestedReviewerFilter).toEqual(["someone-else"]);
    expect(state.hasInitializedSuggestedReviewerFilter).toBe(true);
  });

  it("resetFilters preserves sort preferences", () => {
    useInboxSignalsFilterStore.getState().setSort("created_at", "asc");

    useInboxSignalsFilterStore.getState().resetFilters();

    const state = useInboxSignalsFilterStore.getState();
    expect(state.sortField).toBe("created_at");
    expect(state.sortDirection).toBe("asc");
  });
});
