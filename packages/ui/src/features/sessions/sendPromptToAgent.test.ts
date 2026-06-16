import { toast } from "@posthog/ui/primitives/toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_PROMPT_SENDER } from "./agentPromptSender";
import { sendPromptToAgent } from "./sendPromptToAgent";

const { mockSender } = vi.hoisted(() => ({ mockSender: vi.fn() }));

vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@posthog/di/container", () => ({
  resolveService: (token: unknown) => {
    if (token === AGENT_PROMPT_SENDER) return mockSender;
    throw new Error(`resolveService: unmocked token ${String(token)}`);
  },
}));

vi.mock("../code-review/reviewNavigationStore", () => ({
  useReviewNavigationStore: {
    getState: () => ({ getReviewMode: () => "split", setReviewMode: vi.fn() }),
  },
}));

vi.mock("../panels/panelLayoutStore", () => ({
  usePanelLayoutStore: {
    getState: () => ({ taskLayouts: {}, setActiveTab: vi.fn() }),
  },
}));

describe("sendPromptToAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a rejected send as an error toast", async () => {
    mockSender.mockRejectedValueOnce(
      new Error("Agent server is not reachable"),
    );

    sendPromptToAgent("task-1", "hello");

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Agent server is not reachable"),
    );
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockSender.mockRejectedValueOnce("boom");

    sendPromptToAgent("task-1", "hello");

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to send your message to the agent. Please try again.",
      ),
    );
  });

  it("does not toast when the send resolves", async () => {
    mockSender.mockResolvedValueOnce(undefined);

    sendPromptToAgent("task-1", "hello");

    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
