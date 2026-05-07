import type { Task, TaskRun } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWorkspaceCreate = vi.hoisted(() => vi.fn());
const mockWorkspaceDelete = vi.hoisted(() => vi.fn());
const mockGetTaskDirectory = vi.hoisted(() => vi.fn());
const mockReadFileAsBase64 = vi.hoisted(() => vi.fn());
vi.mock("@renderer/trpc", () => ({
  trpcClient: {
    workspace: {
      create: { mutate: mockWorkspaceCreate },
      delete: { mutate: mockWorkspaceDelete },
    },
  },
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    fs: {
      readAbsoluteFile: { query: vi.fn() },
      readFileAsBase64: { query: mockReadFileAsBase64 },
    },
  },
}));

vi.mock("@hooks/useRepositoryDirectory", () => ({
  getTaskDirectory: mockGetTaskDirectory,
}));

vi.mock("@features/provisioning/stores/provisioningStore", () => ({
  useProvisioningStore: {
    getState: () => ({
      setActive: vi.fn(),
      clear: vi.fn(),
    }),
  },
}));

vi.mock("@features/panels/store/panelLayoutStore", () => ({
  usePanelLayoutStore: {
    getState: () => ({
      addActionTab: vi.fn(),
    }),
  },
}));

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({
    connectToTask: vi.fn(),
    disconnectFromTask: vi.fn(),
  }),
}));

vi.mock("@renderer/utils/generateTitle", () => ({
  createFileTagRegex: () => /<file\s+path="([^"]+)"\s*\/>/g,
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

import { TaskCreationSaga } from "./task-creation";

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-123",
  task_number: 1,
  slug: "task-123",
  title: "Test task",
  description: "Ship the fix",
  origin_product: "user_created",
  repository: "posthog/posthog",
  created_at: "2026-04-03T00:00:00Z",
  updated_at: "2026-04-03T00:00:00Z",
  ...overrides,
});

const createRun = (overrides: Partial<TaskRun> = {}): TaskRun => ({
  id: "run-123",
  task: "task-123",
  team: 1,
  branch: "release/remembered-branch",
  environment: "cloud",
  status: "queued",
  log_url: "https://example.com/logs/run-123",
  error_message: null,
  output: null,
  state: {},
  created_at: "2026-04-03T00:00:00Z",
  updated_at: "2026-04-03T00:00:00Z",
  completed_at: null,
  ...overrides,
});

describe("TaskCreationSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceCreate.mockResolvedValue(undefined);
    mockWorkspaceDelete.mockResolvedValue(undefined);
    mockGetTaskDirectory.mockResolvedValue(null);
    mockReadFileAsBase64.mockResolvedValue(null);
  });

  it("waits for the cloud run response before surfacing the task", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);
    const sendRunCommandMock = vi.fn();
    const onTaskReady = vi.fn();

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: sendRunCommandMock,
        updateTask: vi.fn(),
      } as never,
      onTaskReady,
    });

    const result = await saga.run({
      content: "Ship the fix",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "release/remembered-branch",
      adapter: "codex",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected task creation to succeed");
    }

    expect(createTaskRunMock).toHaveBeenCalledWith("task-123", {
      environment: "cloud",
      mode: "interactive",
      branch: "release/remembered-branch",
      adapter: "codex",
      model: "gpt-5.4",
      reasoningLevel: "high",
      sandboxEnvironmentId: undefined,
      prAuthorshipMode: "bot",
      runSource: "manual",
      signalReportId: undefined,
      initialPermissionMode: "auto",
    });
    expect(startTaskRunMock).toHaveBeenCalledWith("task-123", "run-123", {
      pendingUserMessage: "Ship the fix",
      pendingUserArtifactIds: undefined,
    });
    expect(sendRunCommandMock).not.toHaveBeenCalled();
    expect(onTaskReady).toHaveBeenCalledTimes(1);
    expect(onTaskReady.mock.calls[0][0].task.latest_run?.branch).toBe(
      "release/remembered-branch",
    );
    expect(result.data.task.latest_run?.branch).toBe(
      "release/remembered-branch",
    );
    expect(startTaskRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      onTaskReady.mock.invocationCallOrder[0],
    );
  });

  it("uploads initial cloud attachments before starting the run", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);
    const prepareTaskRunArtifactUploadsMock = vi.fn().mockResolvedValue([
      {
        id: "artifact-1",
        name: "test.txt",
        type: "user_attachment",
        size: 5,
        source: "posthog_code",
        content_type: "text/plain",
        storage_path: "tasks/artifacts/test.txt",
        expires_in: 3600,
        presigned_post: {
          url: "https://uploads.example.com",
          fields: { key: "tasks/artifacts/test.txt" },
        },
      },
    ]);
    const finalizeTaskRunArtifactUploadsMock = vi.fn().mockResolvedValue([
      {
        id: "artifact-1",
        name: "test.txt",
        type: "user_attachment",
        size: 5,
        source: "posthog_code",
        content_type: "text/plain",
        storage_path: "tasks/artifacts/test.txt",
        uploaded_at: "2026-04-16T00:00:00Z",
      },
    ]);
    const sendRunCommandMock = vi.fn();
    const onTaskReady = vi.fn();

    mockReadFileAsBase64.mockResolvedValue("aGVsbG8=");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        prepareTaskRunArtifactUploads: prepareTaskRunArtifactUploadsMock,
        finalizeTaskRunArtifactUploads: finalizeTaskRunArtifactUploadsMock,
        sendRunCommand: sendRunCommandMock,
        updateTask: vi.fn(),
      } as never,
      onTaskReady,
    });

    const result = await saga.run({
      content: 'read this file <file path="/tmp/test.txt" />',
      taskDescription: "read this file\n\nAttached files: test.txt",
      filePaths: ["/tmp/test.txt"],
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "release/remembered-branch",
      adapter: "codex",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected task creation to succeed");
    }

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "read this file\n\nAttached files: test.txt",
      }),
    );
    expect(createTaskRunMock).toHaveBeenCalledWith("task-123", {
      environment: "cloud",
      mode: "interactive",
      branch: "release/remembered-branch",
      adapter: "codex",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      sandboxEnvironmentId: undefined,
      prAuthorshipMode: "bot",
      runSource: "manual",
      signalReportId: undefined,
      initialPermissionMode: "auto",
    });
    expect(startTaskRunMock).toHaveBeenCalledWith("task-123", "run-123", {
      pendingUserMessage: "read this file",
      pendingUserArtifactIds: ["artifact-1"],
    });
    expect(sendRunCommandMock).not.toHaveBeenCalled();
    expect(createTaskRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      prepareTaskRunArtifactUploadsMock.mock.invocationCallOrder[0],
    );
    expect(
      prepareTaskRunArtifactUploadsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(startTaskRunMock.mock.invocationCallOrder[0]);
    expect(startTaskRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      onTaskReady.mock.invocationCallOrder[0],
    );
  });

  it("uses the selected user GitHub integration for cloud task creation", async () => {
    const createdTask = createTask({
      github_user_integration: "user-integration-123",
    });
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
    });

    const result = await saga.run({
      content: "Ship the fix",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
      githubUserIntegrationId: "user-integration-123",
    });

    expect(result.success).toBe(true);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "posthog/posthog",
        github_user_integration: "user-integration-123",
        github_integration: undefined,
      }),
    );
    expect(createTaskRunMock).toHaveBeenCalledWith(
      "task-123",
      expect.objectContaining({
        prAuthorshipMode: "user",
        runSource: "manual",
      }),
    );
  });

  it("sets title from plain text when description has text", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
    });

    await saga.run({
      content: "Ship the fix",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ship the fix",
        description: "Ship the fix",
      }),
    );
  });

  it("sets fallback title when description is attachment-only", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
    });

    await saga.run({
      taskDescription: '<file path="/tmp/code.ts" />',
      content: '<file path="/tmp/code.ts" />',
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reading attachment\u2026",
        description: '<file path="/tmp/code.ts" />',
      }),
    );
  });

  it("truncates title to 255 chars", async () => {
    const longText = "x".repeat(300);
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
    });

    await saga.run({
      content: longText,
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
    });

    const calledTitle = createTaskMock.mock.calls[0][0].title;
    expect(calledTitle).toHaveLength(255);
  });

  it("uses user authorship for repo-less cloud tasks with a selected user GitHub integration", async () => {
    const createdTask = createTask({
      repository: null,
      github_user_integration: "user-integration-123",
    });
    const startedTask = createTask({
      repository: null,
      latest_run: createRun(),
    });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: createTaskMock,
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
    });

    const result = await saga.run({
      content: "Clone the private repo",
      workspaceMode: "cloud",
      branch: "main",
      githubUserIntegrationId: "user-integration-123",
    });

    expect(result.success).toBe(true);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: undefined,
        github_user_integration: "user-integration-123",
        github_integration: undefined,
      }),
    );
    expect(createTaskRunMock).toHaveBeenCalledWith(
      "task-123",
      expect.objectContaining({
        prAuthorshipMode: "user",
        runSource: "manual",
      }),
    );
  });
});
