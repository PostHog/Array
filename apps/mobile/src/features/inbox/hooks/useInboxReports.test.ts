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

import type { SignalReport, SignalReportsResponse } from "../types";
import {
  getReportsNextPageParam,
  useAvailableSuggestedReviewers,
} from "./useInboxReports";

function page(count: number, resultCount: number): SignalReportsResponse {
  return {
    count,
    results: Array.from({ length: resultCount }, () => ({}) as SignalReport),
  };
}

describe("getReportsNextPageParam", () => {
  it("returns the next offset while more reports remain", () => {
    const first = page(250, 100);
    expect(getReportsNextPageParam(first, [first])).toBe(100);

    const second = page(250, 100);
    expect(getReportsNextPageParam(second, [first, second])).toBe(200);
  });

  it("returns undefined once every report is loaded", () => {
    const first = page(150, 100);
    const second = page(150, 50);
    expect(getReportsNextPageParam(second, [first, second])).toBeUndefined();
  });

  it("returns undefined when the first page already holds everything", () => {
    const only = page(40, 40);
    expect(getReportsNextPageParam(only, [only])).toBeUndefined();
  });
});

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

  it.each([
    { name: "forwards a trimmed query", query: "  alice  ", expected: "alice" },
    {
      name: "omits a whitespace-only query",
      query: "   ",
      expected: undefined,
    },
    { name: "omits an undefined query", query: undefined, expected: undefined },
  ])("$name to the server", async ({ query, expected }) => {
    await renderHook(query);
    expect(getAvailableSuggestedReviewers).toHaveBeenCalledWith(expected);
  });
});
