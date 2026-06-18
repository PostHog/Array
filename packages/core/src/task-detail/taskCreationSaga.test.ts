import type { SessionService } from "@posthog/core/sessions/sessionService";
import type { Task, TaskRun } from "@posthog/shared/domain-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudPromptTransport,
  ITaskCreationHost,
} from "./taskCreationHost";

const mockHost = vi.hoisted(() => ({
  getAuthenticatedClient: vi.fn(),
  getTaskDirectory: vi.fn(),
  getWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getFolders: vi.fn(),
  addFolder: vi.fn(),
  addAdditionalDirectory: vi.fn(),
  removeAdditionalDirectory: vi.fn(),
  getEnvironment: vi.fn(),
  detectRepo: vi.fn(),
  getCloudPromptTransport: vi.fn(),
  uploadRunAttachments: vi.fn(),
  setProvisioningActive: vi.fn(),
  clearProvisioning: vi.fn(),
  dispatchSetupAction: vi.fn(),
}));

import { TaskCreationSaga } from "./taskCreationSaga";

const host = mockHost as unknown as ITaskCreationHost;

const sessionService = {
  connectToTask: vi.fn(),
  disconnectFromTask: vi.fn(),
} as unknown as SessionService;

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
    mockHost.createWorkspace.mockResolvedValue({});
    mockHost.deleteWorkspace.mockResolvedValue(undefined);
    mockHost.getTaskDirectory.mockResolvedValue(null);
    mockHost.getWorkspace.mockResolvedValue(null);
    mockHost.getFolders.mockResolvedValue([]);
    mockHost.uploadRunAttachments.mockResolvedValue([]);
    mockHost.getCloudPromptTransport.mockImplementation(
      (
        prompt: string | unknown[],
        filePaths: string[] = [],
      ): CloudPromptTransport => ({
        filePaths,
        messageText: typeof prompt === "string" ? prompt : undefined,
        promptText: typeof prompt === "string" ? prompt : "",
      }),
    );
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
      host,
      sessionService,
      track: vi.fn(),
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
      prAuthorshipMode: "user",
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
    const sendRunCommandMock = vi.fn();
    const onTaskReady = vi.fn();

    mockHost.getCloudPromptTransport.mockReturnValue({
      filePaths: ["/tmp/test.txt"],
      messageText: "read this file",
      promptText: "read this file\n\nAttached files: test.txt",
    });
    mockHost.uploadRunAttachments.mockResolvedValue(["artifact-1"]);

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
      host,
      sessionService,
      track: vi.fn(),
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
      prAuthorshipMode: "user",
      runSource: "manual",
      signalReportId: undefined,
      initialPermissionMode: "auto",
    });
    expect(mockHost.uploadRunAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "task-123",
      "run-123",
      ["/tmp/test.txt"],
    );
    expect(startTaskRunMock).toHaveBeenCalledWith("task-123", "run-123", {
      pendingUserMessage: "read this file",
      pendingUserArtifactIds: ["artifact-1"],
    });
    expect(sendRunCommandMock).not.toHaveBeenCalled();
    expect(createTaskRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      mockHost.uploadRunAttachments.mock.invocationCallOrder[0],
    );
    expect(
      mockHost.uploadRunAttachments.mock.invocationCallOrder[0],
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
      host,
      sessionService,
      track: vi.fn(),
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

  it("uses user authorship for signal report cloud task creation", async () => {
    const createdTask = createTask({ origin_product: "signal_report" });
    const startedTask = createTask({
      origin_product: "signal_report",
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
      host,
      sessionService,
      track: vi.fn(),
    });

    const result = await saga.run({
      content: "Ship the report",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
      cloudRunSource: "signal_report",
      signalReportId: "report-123",
      githubIntegrationId: 123,
    });

    expect(result.success).toBe(true);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        github_integration: 123,
        github_user_integration: undefined,
        origin_product: "signal_report",
      }),
    );
    expect(createTaskRunMock).toHaveBeenCalledWith(
      "task-123",
      expect.objectContaining({
        prAuthorshipMode: "user",
        runSource: "signal_report",
      }),
    );
  });

  it("does not prefill a task title from the prompt", async () => {
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
      host,
      sessionService,
      track: vi.fn(),
    });

    await saga.run({
      content: "Ship the fix",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Ship the fix",
      }),
    );
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("title");
  });

  it("does not prefill a task title for attachment-only prompts", async () => {
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
      host,
      sessionService,
      track: vi.fn(),
    });

    await saga.run({
      taskDescription: '<file path="/tmp/code.ts" />',
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      branch: "main",
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '<file path="/tmp/code.ts" />',
      }),
    );
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("title");
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
      host,
      sessionService,
      track: vi.fn(),
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
