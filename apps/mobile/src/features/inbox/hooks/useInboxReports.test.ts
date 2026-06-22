import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth", () => ({
  useAuthStore: () => ({ projectId: 1, oauthAccessToken: "token" }),
}));

const getAvailableSuggestedReviewers = vi.fn(async (_query?: string) => ({
  results: [],
  count: 0,
}));
vi.mock("../api", () => ({
  getAvailableSuggestedReviewers: (query?: string) =>
    getAvailableSuggestedReviewers(query),
}));

import { useAvailableSuggestedReviewers } from "./useInboxReports";

async function renderHook(query?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper() {
    useAvailableSuggestedReviewers({ query });
    return null;
  }
  await act(async () => {
    create(
      createElement(QueryClientProvider, { client }, createElement(Wrapper)),
    );
    await Promise.resolve();
  });
}

describe("useAvailableSuggestedReviewers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards a trimmed query to the server", async () => {
    await renderHook("  alice  ");
    expect(getAvailableSuggestedReviewers).toHaveBeenCalledWith("alice");
  });

  it("omits the query param when empty", async () => {
    await renderHook("   ");
    expect(getAvailableSuggestedReviewers).toHaveBeenCalledWith(undefined);
  });
});
