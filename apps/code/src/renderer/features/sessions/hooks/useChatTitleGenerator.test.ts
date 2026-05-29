import type { Task } from "@shared/types";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnrichDescription = vi.hoisted(() =>
  vi.fn().mockImplementation((desc: string) => Promise.resolve(desc)),
);
const mockGenerateTitle = vi.hoisted(() => vi.fn());
const mockGetAuthenticatedClient = vi.hoisted(() => vi.fn());
const mockGetCachedTask = vi.hoisted(() => vi.fn());
const mockIsAuthenticated = vi.hoisted(() => ({ value: true }));
const mockUpdateTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetQueriesData = vi.hoisted(() => vi.fn());
const mockSetQueryData = vi.hoisted(() => vi.fn());
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

vi.mock("@features/auth/hooks/authQueries", () => ({
  useAuthStateValue: (
    selector: (state: {
      status: string;
      cloudRegion: string | null;
    }) => unknown,
  ) =>
    selector(
      mockIsAuthenticated.value
        ? { status: "authenticated", cloudRegion: "us-east-1" }
        : { status: "anonymous", cloudRegion: null },
    ),
}));

vi.mock("@utils/queryClient", () => ({
  getCachedTask: mockGetCachedTask,
  queryClient: {
    setQueriesData: mockSetQueriesData,
    setQueryData: mockSetQueryData,
  },
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

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    task_number: 1,
    slug: "task-1",
    title: "Fix the login bug",
    description: "Fix the login bug",
    created_at: "2026-05-28T00:00:00.000Z",
    updated_at: "2026-05-28T00:00:00.000Z",
    origin_product: "user_created",
    ...overrides,
  };
}

describe("useChatTitleGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.value = true;
    mockPrompts.value = [];
    mockEnrichDescription.mockImplementation((desc: string) =>
      Promise.resolve(desc),
    );
    mockGetCachedTask.mockReturnValue(undefined);
    mockGetAuthenticatedClient.mockResolvedValue({
      updateTask: mockUpdateTask,
    });
  });

  it("does not generate when promptCount is 0 and the task already has a custom title", () => {
    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "Custom task title",
        }),
      ),
    );
    expect(mockGenerateTitle).not.toHaveBeenCalled();
  });

  it("generates title from the saved task description before prompt events arrive", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Fix login bug",
      summary: "User is fixing a login issue",
    });

    renderHook(() => useChatTitleGenerator(createTask()));

    await waitFor(() => {
      expect(mockEnrichDescription).toHaveBeenCalledWith("Fix the login bug");
    });
    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Fix login bug",
      });
    });
  });

  it("generates title when the task has no title yet", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Fix login bug",
      summary: "User is fixing a login issue",
    });

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "",
        }),
      ),
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Fix login bug",
      });
    });
  });

  it("regenerates title when title_manually_set is true but the title still matches the fallback", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Fix login bug",
      summary: "User is fixing a login issue",
    });
    mockGetCachedTask.mockReturnValue(
      createTask({
        title_manually_set: true,
      }),
    );

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title_manually_set: true,
        }),
      ),
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Fix login bug",
      });
    });
  });

  it("generates title on first prompt", async () => {
    mockGenerateTitle.mockResolvedValue({
      title: "Fix login bug",
      summary: "User is fixing a login issue",
    });
    mockPrompts.value = ["Fix the login bug"];

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "Raw prompt title",
        }),
      ),
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(TASK_ID, {
        title: "Fix login bug",
      });
    });
    expect(mockSetQueriesData).toHaveBeenCalledWith(
      { queryKey: ["tasks", "list"] },
      expect.any(Function),
    );
    expect(mockSetQueriesData).toHaveBeenCalledWith(
      { queryKey: ["tasks", "summaries"] },
      expect.any(Function),
    );
  });

  it.each([
    { name: "no summary", summary: "", expectsSummaryUpdate: false },
    {
      name: "with summary",
      summary: "User wants to fix auth",
      expectsSummaryUpdate: true,
    },
  ])(
    "skips title update when title_manually_set ($name)",
    async ({ summary, expectsSummaryUpdate }) => {
      mockGetCachedTask.mockReturnValue(
        createTask({
          title: "Custom auth title",
          description: "fix auth",
          title_manually_set: true,
        }),
      );
      mockGenerateTitle.mockResolvedValue({
        title: "Auto title",
        summary,
      });
      mockPrompts.value = ["fix auth"];

      renderHook(() =>
        useChatTitleGenerator(
          createTask({
            title: "Custom auth title",
            description: "fix auth",
            title_manually_set: true,
          }),
        ),
      );

      await waitFor(() => {
        expect(mockGenerateTitle).toHaveBeenCalled();
      });
      expect(mockUpdateTask).not.toHaveBeenCalled();

      if (expectsSummaryUpdate) {
        await waitFor(() => {
          expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
            "run-1",
            { conversationSummary: summary },
          );
        });
      } else {
        expect(mockSessionStoreSetters.updateSession).not.toHaveBeenCalled();
      }
    },
  );

  it("calls enrichDescriptionWithFileContent before generating", async () => {
    mockEnrichDescription.mockResolvedValue("enriched content");
    mockGenerateTitle.mockResolvedValue({
      title: "Enriched title",
      summary: "",
    });
    mockPrompts.value = ['<file path="/tmp/code.ts" />'];

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "Code file prompt",
          description: "Code file prompt",
        }),
      ),
    );

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

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "Auth prompt",
          description: "fix auth",
        }),
      ),
    );

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

    renderHook(() =>
      useChatTitleGenerator(
        createTask({
          title: "Some prompt",
          description: "some prompt",
        }),
      ),
    );

    await waitFor(() => {
      expect(mockGenerateTitle).toHaveBeenCalled();
    });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("waits for authentication before generating", () => {
    mockIsAuthenticated.value = false;

    renderHook(() => useChatTitleGenerator(createTask()));

    expect(mockGenerateTitle).not.toHaveBeenCalled();
  });
});
