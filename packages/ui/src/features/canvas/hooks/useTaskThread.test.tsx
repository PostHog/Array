import type { TaskThreadMessage } from "@posthog/shared/domain-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  createTaskThreadMessage: vi.fn(),
  createTaskThreadMessageForAgent: vi.fn(),
  sendTaskThreadMessageToAgent: vi.fn(),
}));

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));

import { useTaskThreadMutations } from "./useTaskThread";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function message(overrides?: Partial<TaskThreadMessage>): TaskThreadMessage {
  return {
    id: "message-id",
    task: "task-id",
    content: "@agent investigate this",
    created_at: "2026-07-16T00:00:00Z",
    ...overrides,
  };
}

describe("useTaskThreadMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
  });

  it("posts an @agent message through the combined client operation", async () => {
    mockClient.createTaskThreadMessageForAgent.mockResolvedValue({
      message: message({ forwarded_to_agent_at: "2026-07-16T00:00:01Z" }),
      sendError: null,
    });
    const { result } = renderHook(() => useTaskThreadMutations("task-id"), {
      wrapper,
    });

    await act(async () => {
      await result.current.postMessageToAgent("@agent investigate this");
    });

    expect(mockClient.createTaskThreadMessageForAgent).toHaveBeenCalledWith(
      "task-id",
      "@agent investigate this",
    );
  });

  it("returns a forwarding error after the message has been posted", async () => {
    const sendError = new Error("No active run");
    mockClient.createTaskThreadMessageForAgent.mockResolvedValue({
      message: message(),
      sendError,
    });
    const { result } = renderHook(() => useTaskThreadMutations("task-id"), {
      wrapper,
    });

    let outcome: Awaited<
      ReturnType<typeof result.current.postMessageToAgent>
    > | null = null;
    await act(async () => {
      outcome = await result.current.postMessageToAgent(
        "@agent investigate this",
      );
    });

    expect(outcome).toEqual({ message: message(), sendError });
    expect(mockClient.createTaskThreadMessageForAgent).toHaveBeenCalledTimes(1);
  });
});
