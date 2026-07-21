import {
  type CloudTaskConfigOption,
  DEFAULT_GATEWAY_MODEL,
} from "@posthog/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCloudTaskConfigOptions, mockUseAuthStore } = vi.hoisted(() => ({
  mockGetCloudTaskConfigOptions: vi.fn(),
  mockUseAuthStore: vi.fn(),
}));

vi.mock("posthog-react-native", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@/features/auth", () => ({
  useAuthStore: mockUseAuthStore,
}));

vi.mock("@/lib/posthogApiClient", () => ({
  getPostHogApiClient: () => ({
    getCloudTaskConfigOptions: mockGetCloudTaskConfigOptions,
  }),
}));

import { getModelConfigOption } from "@posthog/core/task-detail/composerControls";
import { useCloudTaskConfigOptions } from "./useCloudTaskConfigOptions";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

async function renderHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let currentResult: ReturnType<typeof useCloudTaskConfigOptions>;

  function HookProbe() {
    currentResult = useCloudTaskConfigOptions("claude");
    return null;
  }

  const Wrapper = createWrapper(queryClient);
  await act(async () => {
    create(createElement(Wrapper, null, createElement(HookProbe)));
    await Promise.resolve();
  });

  return {
    get current() {
      return currentResult;
    },
  };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const timeoutAt = Date.now() + 2_000;
  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (Date.now() >= timeoutAt) throw error;
    }
  }
}

describe("useCloudTaskConfigOptions", () => {
  beforeEach(() => {
    mockGetCloudTaskConfigOptions.mockReset();
    mockUseAuthStore.mockImplementation((selector) =>
      selector({ oauthAccessToken: "token" }),
    );
  });

  it("uses the authenticated live Claude catalog", async () => {
    const liveOptions: CloudTaskConfigOption[] = [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "claude-sonnet-5",
        options: [{ value: "claude-sonnet-5", name: "Claude Sonnet 5" }],
        category: "model",
        description: "Choose a model",
      },
    ];
    mockGetCloudTaskConfigOptions.mockResolvedValue(liveOptions);

    const result = await renderHook();
    await waitForAssertion(() => {
      expect(result.current.configOptions).toEqual(liveOptions);
      expect(result.current.hasLiveConfig).toBe(true);
    });
    expect(mockGetCloudTaskConfigOptions).toHaveBeenCalledWith("claude");
  });

  it("keeps the shared fallback when unauthenticated", async () => {
    mockUseAuthStore.mockImplementation((selector) =>
      selector({ oauthAccessToken: null }),
    );

    const result = await renderHook();

    expect(
      getModelConfigOption(result.current.configOptions).currentValue,
    ).toBe(DEFAULT_GATEWAY_MODEL);
    expect(mockGetCloudTaskConfigOptions).not.toHaveBeenCalled();
  });
});
