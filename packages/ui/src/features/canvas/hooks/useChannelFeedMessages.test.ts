import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelFeedMessages } from "./useChannelFeedMessages";

vi.mock("@posthog/ui/hooks/useAuthenticatedQuery", () => ({
  useAuthenticatedQuery: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe("useChannelFeedMessages", () => {
  beforeEach(() => {
    vi.mocked(useAuthenticatedQuery).mockClear();
  });

  it("keeps polling after a transient query error", () => {
    renderHook(() => useChannelFeedMessages("channel-id"));

    expect(vi.mocked(useAuthenticatedQuery).mock.calls[0]?.[2]).toMatchObject({
      retry: false,
      refetchInterval: 5_000,
    });
  });
});
