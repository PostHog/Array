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
  ensureScratchDir: vi.fn(),
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
  importClaudeCliSession: vi.fn(),
  deleteClaudeCliImport: vi.fn(),
  recordClaudeCliImport: vi.fn(),
  deleteClaudeCliImportRecord: vi.fn(),
  linkTaskBranch: vi.fn(),
}));

import { TaskCreationSaga } from "./taskCreationSaga";

const host = mockHost as unknown as ITaskCreationHost;

const sessionService = {
  connectToTask: vi.fn(),
  disconnectFromTask: vi.fn(),
  rememberInitialCloudPrompt: vi.fn(),
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

function makeSaga(
  posthog: Record<string, unknown> = {},
  extra: { onTaskReady?: (output: unknown) => void } = {},
) {
  return new TaskCreationSaga({
    posthogClient: {
      createTask: vi.fn(),
      deleteTask: vi.fn(),
      getTask: vi.fn(),
      createTaskRun: vi.fn(),
      startTaskRun: vi.fn(),
      sendRunCommand: vi.fn(),
      updateTask: vi.fn(),
      ...posthog,
    } as never,
    host,
    sessionService,
    track: vi.fn(),
    ...extra,
  });
}

describe("TaskCreationSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHost.createWorkspace.mockResolvedValue({});
    mockHost.deleteWorkspace.mockResolvedValue(undefined);
    mockHost.getTaskDirectory.mockResolvedValue(null);
    mockHost.ensureScratchDir.mockResolvedValue("/tmp/scratch/task-123");
    mockHost.getWorkspace.mockResolvedValue(null);
    mockHost.getFolders.mockResolvedValue([]);
    mockHost.uploadRunAttachments.mockResolvedValue([]);
    mockHost.linkTaskBranch.mockResolvedValue(undefined);
    mockHost.recordClaudeCliImport.mockResolvedValue(undefined);
    mockHost.deleteClaudeCliImport.mockResolvedValue(undefined);
    mockHost.deleteClaudeCliImportRecord.mockResolvedValue(undefined);
    mockHost.getCloudPromptTransport.mockImplementation(
      (
        prompt: string | unknown[],
        filePaths: string[] = [],
      ): CloudPromptTransport => ({
        filePaths,
        skillBundles: [],
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

    const saga = makeSaga(
      {
        createTask: createTaskMock,
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: sendRunCommandMock,
      },
      { onTaskReady },
    );

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

  it("folds channel CONTEXT.md into the cloud prompt and stashes it for the optimistic placeholder", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);
    vi.mocked(sessionService.rememberInitialCloudPrompt).mockClear();

    const saga = makeSaga({
      createTask: vi.fn().mockResolvedValue(createdTask),
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
    });

    const result = await saga.run({
      content: "Ship the fix",
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      channelContext: "# project-bluebird\n\nReference material.",
      channelName: "project-bluebird",
    });

    expect(result.success).toBe(true);
    const sentMessage = startTaskRunMock.mock.calls[0][2]
      .pendingUserMessage as string;
    // Prompt leads, channel context follows as a tagged block.
    expect(sentMessage).toContain("Ship the fix");
    expect(sentMessage).toContain(
      '<channel_context channel="project-bluebird">',
    );
    // The same context-bearing message is stashed so the optimistic placeholder
    // can show its CONTEXT.md chip immediately, before the sandbox echoes back.
    expect(sessionService.rememberInitialCloudPrompt).toHaveBeenCalledWith(
      "task-123",
      sentMessage,
    );
  });

  it("folds custom personalization into the cloud prompt and stashes it for the optimistic placeholder", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskRunMock = vi.fn().mockResolvedValue(createRun());
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);
    vi.mocked(sessionService.rememberInitialCloudPrompt).mockClear();

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: vi.fn().mockResolvedValue(createdTask),
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
      customInstructions: "Always respond in British English.",
    });

    expect(result.success).toBe(true);
    const sentMessage = startTaskRunMock.mock.calls[0][2]
      .pendingUserMessage as string;
    expect(sentMessage).toContain("Ship the fix");
    expect(sentMessage).toContain("<user_custom_instructions>");
    expect(sentMessage).toContain("Always respond in British English.");
    expect(sessionService.rememberInitialCloudPrompt).toHaveBeenCalledWith(
      "task-123",
      sentMessage,
    );
  });

  it("does not fold personalization into a file-only cloud task with no typed text", async () => {
    // Personalization alone would strip to an empty bubble in the UI and dedup
    // against the sandbox echo, leaving a blank placeholder. With no message
    // text to augment, it must not be folded in or seeded.
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const startTaskRunMock = vi.fn().mockResolvedValue(startedTask);
    vi.mocked(sessionService.rememberInitialCloudPrompt).mockClear();
    // File-only upload: a transport exists (files attached) but messageText is
    // absent because the user typed nothing.
    mockHost.getCloudPromptTransport.mockReturnValue({
      filePaths: ["/tmp/test.txt"],
      messageText: undefined,
      promptText: "",
    });

    const saga = new TaskCreationSaga({
      posthogClient: {
        createTask: vi.fn().mockResolvedValue(createdTask),
        deleteTask: vi.fn(),
        getTask: vi.fn(),
        createTaskRun: vi.fn().mockResolvedValue(createRun()),
        startTaskRun: startTaskRunMock,
        sendRunCommand: vi.fn(),
        updateTask: vi.fn(),
      } as never,
      host,
      sessionService,
      track: vi.fn(),
    });

    const result = await saga.run({
      filePaths: ["/tmp/test.txt"],
      repository: "posthog/posthog",
      workspaceMode: "cloud",
      customInstructions: "Always respond in British English.",
    });

    expect(result.success).toBe(true);
    expect(
      startTaskRunMock.mock.calls[0][2].pendingUserMessage,
    ).toBeUndefined();
    expect(sessionService.rememberInitialCloudPrompt).not.toHaveBeenCalled();
  });

  it("starts a repo-less channel task in a scratch dir (allowNoRepo)", async () => {
    const createdTask = createTask({ repository: undefined });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);

    const saga = makeSaga({ createTask: createTaskMock });

    const result = await saga.run({
      content: "Draft a launch email",
      workspaceMode: "local",
      allowNoRepo: true,
    });

    expect(result.success).toBe(true);
    // No repo selected → no workspace created, but a scratch dir is provisioned
    // and the agent session connects there.
    expect(mockHost.createWorkspace).not.toHaveBeenCalled();
    expect(mockHost.ensureScratchDir).toHaveBeenCalledWith("task-123");
    expect(sessionService.connectToTask).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/tmp/scratch/task-123" }),
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
      skillBundles: [],
      messageText: "read this file",
      promptText: "read this file\n\nAttached files: test.txt",
    });
    mockHost.uploadRunAttachments.mockResolvedValue(["artifact-1"]);

    const saga = makeSaga(
      {
        createTask: createTaskMock,
        createTaskRun: createTaskRunMock,
        startTaskRun: startTaskRunMock,
        sendRunCommand: sendRunCommandMock,
      },
      { onTaskReady },
    );

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
      [],
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

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
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

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
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

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
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

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
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

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: createTaskRunMock,
      startTaskRun: startTaskRunMock,
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

  it("imports a Claude CLI session, records it, and connects with the imported id", async () => {
    const createdTask = createTask();
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const fingerprint = {
      sourceMtimeMs: 1_700_000_000_000,
      sourceSizeBytes: 2048,
      sourceLastEntryUuid: "entry-1",
    };
    mockHost.importClaudeCliSession.mockResolvedValue({
      importedSessionId: "imported-session-id",
      fingerprint,
    });
    mockHost.recordClaudeCliImport.mockResolvedValue(undefined);
    mockHost.addFolder.mockResolvedValue({ id: "folder-1", path: "/repo" });
    mockHost.detectRepo.mockResolvedValue(null);

    const saga = makeSaga({ createTask: createTaskMock });

    const result = await saga.run({
      taskDescription: "Fix the login flow",
      repoPath: "/repo",
      workspaceMode: "local",
      adapter: "codex",
      importedClaudeSession: {
        sourceSessionId: "source-session-id",
        branch: "feature/login",
      },
    });

    expect(result.success).toBe(true);
    expect(mockHost.importClaudeCliSession).toHaveBeenCalledWith({
      repoPath: "/repo",
      sourceSessionId: "source-session-id",
    });
    expect(mockHost.linkTaskBranch).toHaveBeenCalledWith({
      taskId: "task-123",
      branchName: "feature/login",
    });
    expect(mockHost.recordClaudeCliImport).toHaveBeenCalledWith({
      sourceSessionId: "source-session-id",
      importedSessionId: "imported-session-id",
      repoPath: "/repo",
      taskId: "task-123",
      fingerprint,
    });
    expect(sessionService.connectToTask).toHaveBeenCalledWith(
      expect.objectContaining({
        importedSessionId: "imported-session-id",
        adapter: "claude",
      }),
    );
  });

  it("rolls back the import snapshot and tracking row when a later step fails", async () => {
    const createdTask = createTask();
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);
    const deleteTaskMock = vi.fn().mockResolvedValue(undefined);
    const fingerprint = {
      sourceMtimeMs: 1_700_000_000_000,
      sourceSizeBytes: 2048,
      sourceLastEntryUuid: "entry-1",
    };
    mockHost.importClaudeCliSession.mockResolvedValue({
      importedSessionId: "imported-session-id",
      fingerprint,
    });
    mockHost.addFolder.mockResolvedValue({ id: "folder-1", path: "/repo" });
    mockHost.detectRepo.mockResolvedValue(null);
    // Fail the workspace step, which runs after the import and record steps.
    mockHost.createWorkspace.mockRejectedValue(new Error("workspace boom"));

    const saga = makeSaga({
      createTask: createTaskMock,
      deleteTask: deleteTaskMock,
    });

    const result = await saga.run({
      taskDescription: "Fix the login flow",
      repoPath: "/repo",
      workspaceMode: "local",
      importedClaudeSession: { sourceSessionId: "source-session-id" },
    });

    expect(result.success).toBe(false);
    // Record step rollback drops the tracking row...
    expect(mockHost.deleteClaudeCliImportRecord).toHaveBeenCalledWith({
      importedSessionId: "imported-session-id",
    });
    // ...and the import step rollback removes the copied snapshot.
    expect(mockHost.deleteClaudeCliImport).toHaveBeenCalledWith({
      repoPath: "/repo",
      importedSessionId: "imported-session-id",
    });
  });

  it("does not import a Claude CLI session for non-local workspace modes", async () => {
    const createdTask = createTask();
    const startedTask = createTask({ latest_run: createRun() });
    const createTaskMock = vi.fn().mockResolvedValue(createdTask);

    const saga = makeSaga({
      createTask: createTaskMock,
      createTaskRun: vi.fn().mockResolvedValue(createRun()),
      startTaskRun: vi.fn().mockResolvedValue(startedTask),
    });

    await saga.run({
      content: "Ship the fix",
      workspaceMode: "cloud",
      branch: "main",
      importedClaudeSession: { sourceSessionId: "source-session-id" },
    });

    expect(mockHost.importClaudeCliSession).not.toHaveBeenCalled();
    expect(mockHost.recordClaudeCliImport).not.toHaveBeenCalled();
  });
});
