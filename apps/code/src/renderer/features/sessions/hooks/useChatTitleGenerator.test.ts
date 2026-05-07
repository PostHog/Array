import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnrichDescription = vi.hoisted(() =>
  vi.fn().mockImplementation((desc: string) => Promise.resolve(desc)),
);
const mockGenerateTitle = vi.hoisted(() => vi.fn());
const mockGetAuthenticatedClient = vi.hoisted(() => vi.fn());
const mockGetCachedTask = vi.hoisted(() => vi.fn());
const mockUpdateTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetQueriesData = vi.hoisted(() => vi.fn());
const mockUpdateSessionTaskTitle = vi.hoisted(() => vi.fn());
const mockPrompts = vi.hoisted(() => ({ value: [] as string[] }));
const mockSessionStoreSetters = vi.hoisted(() => ({
  updateSession: vi.fn(),
}));

vi.mock("@utils/generateTitle", () => ({
  enrichDescriptionWithFileContent: mockEnrichDescription,
  generateTitleAndSummary: mockGenerateTitle,
}));

vi.mock("@features/auth/hooks/authClient", () => ({
  getAuthenticatedClient: mockGetAuthenticatedClient,
}));

vi.mock("@utils/queryClient", () => ({
  getCachedTask: mockGetCachedTask,
  queryClient: { setQueriesData: mockSetQueriesData },
}));

vi.mock("@utils/session", () => ({
  extractUserPromptsFromEvents: () => mockPrompts.value,
}));

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({
    updateSessionTaskTitle: mockUpdateSessionTaskTitle,
  }),
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@features/sessions/stores/sessionStore", () => {
  const state = {
    taskIdIndex: { "task-1": "run-1" },
    sessions: { "run-1": { events: mockPrompts.value } },
  };
  const fn = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return {
    useSessionStore: fn,
    sessionStoreSetters: mockSessionStoreSetters,
  };
});

import { useChatTitleGenerator } from "./useChatTitleGenerator";

const TASK_ID = "task-1";

describe("useChatTitleGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompts.value = [];
    mockEnrichDescription.mockImplementation((desc: string) =>
      Promise.resolve(desc),
    );
    mockGetAuthenticatedClient.mockResolvedValue({
      updateTask: mockUpdateTask,
    });
    mockGetCachedTask.mockReturnValue(undefined);
  });

  it("does not generate when promptCount is 0", () => {
    renderHook(() => useChatTitleGenerator(TASK_ID));
    expect(mockGenerateTitle).not.toHaveBeenCalled();
  });

  it("generates title on first prompt", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Fix login bug",
      summary: "User is fixing a login issue",
    });
    mockPrompts.value = ["Fix the login bug"];

    renderHook(() => useChatTitleGenerator(TASK_ID));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Fix login bug",
      });
    });
  });

  it("allows first generation even when title_manually_set", async () => {
    mockGetCachedTask.mockReturnValue({
      id: TASK_ID,
      title_manually_set: true,
    });
    mockGenerateTitle.mockResolvedValue({
      title: "Auto title",
      summary: "",
    });
    mockPrompts.value = ["some prompt"];

    renderHook(() => useChatTitleGenerator(TASK_ID));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Auto title",
      });
    });
  });

  it("calls enrichDescriptionWithFileContent before generating", async () => {
    mockEnrichDescription.mockResolvedValue("enriched content");
    mockGenerateTitle.mockResolvedValue({
      title: "Enriched title",
      summary: "",
    });
    mockPrompts.value = ['<file path="/tmp/code.ts" />'];

    renderHook(() => useChatTitleGenerator(TASK_ID));

    await waitFor(() => {
      expect(mockEnrichDescription).toHaveBeenCalledWith(
        '1. <file path="/tmp/code.ts" />',
      );
      expect(mockGenerateTitle).toHaveBeenCalledWith("enriched content");
    });
  });

  it("updates conversation summary when returned", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Some title",
      summary: "User wants to fix auth",
    });
    mockPrompts.value = ["fix auth"];

    renderHook(() => useChatTitleGenerator(TASK_ID));

    await waitFor(() => {
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-1",
        { conversationSummary: "User wants to fix auth" },
      );
    });
  });

  it("does not update when generateTitleAndSummary returns null", async () => {
    mockGenerateTitle.mockResolvedValue(null);
    mockPrompts.value = ["some prompt"];

    renderHook(() => useChatTitleGenerator(TASK_ID));

    await waitFor(() => {
      expect(mockGenerateTitle).toHaveBeenCalled();
    });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});
