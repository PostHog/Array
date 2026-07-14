import type { Task } from "@posthog/shared/domain-types";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/shell/rendererStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

const sessionService = vi.hoisted(() => ({
  updateQueuedMessage: vi.fn(),
  clearEditingQueuedMessage: vi.fn(),
  sendPrompt: vi.fn(),
}));

vi.mock("@posthog/core/sessions/sessionService", () => ({
  SESSION_SERVICE: Symbol.for("test.session-service"),
}));

vi.mock("@posthog/ui/features/terminal/shellClient", () => ({
  SHELL_CLIENT: Symbol.for("test.shell-client"),
}));

vi.mock("@posthog/di/react", () => ({
  useService: (token: symbol) =>
    token === Symbol.for("test.session-service") ? sessionService : {},
}));

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPCClient: () => ({ skills: { list: { query: async () => [] } } }),
}));

const taskViewed = vi.hoisted(() => ({
  markActivity: vi.fn(),
  markAsViewed: vi.fn(),
}));
vi.mock("@posthog/ui/features/sidebar/useTaskViewed", () => ({
  useTaskViewed: () => taskViewed,
}));

vi.mock("@posthog/ui/features/sessions/hooks/useMessagingMode", () => ({
  useMessagingMode: () => "queue",
}));

// No code command / skill rewrite; the raw text is used as the prompt.
vi.mock("@posthog/ui/features/message-editor/commands", () => ({
  tryExecuteCodeCommand: async () => false,
  rewriteLocalSkillCommandPrompt: () => null,
  resolveLocalSkillPrompt: async (text: string) => text,
}));

const editingIdState = vi.hoisted(() => ({
  editingQueuedId: "q-1" as string | undefined,
}));
vi.mock("@posthog/ui/features/sessions/sessionStore", () => ({
  sessionStoreSetters: {
    getSessionByTaskId: () => editingIdState,
  },
}));

vi.mock("@posthog/ui/router/useAppView", () => ({
  getAppViewSnapshot: () => null,
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: toastError },
}));

import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { useSessionCallbacks } from "./useSessionCallbacks";

const TASK = "task-1";
const task = { id: TASK, latest_run: null } as unknown as Task;

function renderCallbacks() {
  return renderHook(() =>
    useSessionCallbacks({
      taskId: TASK,
      task,
      session: undefined,
      repoPath: "/repo",
    }),
  );
}

describe("useSessionCallbacks.handleSendPrompt — failed queued edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editingIdState.editingQueuedId = "q-1";
    useDraftStore.setState((state) => ({
      ...state,
      drafts: {},
      pendingContent: {},
      _hasHydrated: true,
    }));
  });

  it("keeps the edit hold and does not send when the edit fails", async () => {
    sessionService.updateQueuedMessage.mockRejectedValue(
      new Error("cloud edit failed"),
    );

    const { result } = renderCallbacks();
    await result.current.handleSendPrompt("my edit");

    // The edit was attempted...
    expect(sessionService.updateQueuedMessage).toHaveBeenCalledWith(
      TASK,
      "q-1",
      "my edit",
    );
    // ...and it failed, so the user is told.
    expect(toastError).toHaveBeenCalled();
    // Critically: the hold is NOT released (which would drain and send the
    // original, unedited message) and no fresh prompt is sent.
    expect(sessionService.clearEditingQueuedMessage).not.toHaveBeenCalled();
    expect(sessionService.sendPrompt).not.toHaveBeenCalled();
    // The edited text is restored to the composer so the user can retry.
    expect(useDraftStore.getState().pendingContent[TASK]).toBeDefined();
  });

  it("releases the hold and sends fresh when the target is no longer queued", async () => {
    // updateQueuedMessage resolves false: the message already drained.
    sessionService.updateQueuedMessage.mockResolvedValue(false);
    sessionService.sendPrompt.mockResolvedValue(undefined);

    const { result } = renderCallbacks();
    await result.current.handleSendPrompt("my edit");

    // Stale hold dropped, and the edit is sent as a brand-new message.
    expect(sessionService.clearEditingQueuedMessage).toHaveBeenCalledWith(TASK);
    expect(sessionService.sendPrompt).toHaveBeenCalledWith(TASK, "my edit", {
      steer: false,
    });
  });
});
