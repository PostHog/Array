import type { Workspace } from "@posthog/shared";
import type { Task, TaskRun } from "@posthog/shared/domain-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITaskCreationHost } from "./taskCreationHost";
import { TaskForkService } from "./taskForkService";
import type { TaskService } from "./taskService";

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: "source-task",
  task_number: 1,
  slug: "source-task",
  title: "Fork task",
  description: "Preserve the existing context",
  origin_product: "user_created",
  repository: "PostHog/code",
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  latest_run: createRun(),
  ...overrides,
});

const createRun = (overrides: Partial<TaskRun> = {}): TaskRun => ({
  id: "source-run",
  task: "source-task",
  team: 1,
  branch: "main",
  environment: "local",
  status: "completed",
  log_url: "https://example.com/logs/source-run",
  error_message: null,
  output: null,
  state: {},
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  completed_at: "2026-07-21T00:01:00Z",
  ...overrides,
});

const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  taskId: "source-task",
  folderId: "folder-1",
  folderPath: "/repos/code",
  mode: "worktree",
  worktreePath: "/worktrees/source-task",
  worktreeName: "source-task",
  branchName: "posthog-code/source-task",
  baseBranch: "main",
  linkedBranch: null,
  createdAt: "2026-07-21T00:00:00Z",
  ...overrides,
});

describe("TaskForkService", () => {
  const getTaskRun = vi.fn();
  const host = {
    getAuthenticatedClient: vi.fn(() => ({ getTaskRun })),
    getWorkspace: vi.fn(),
    getAdditionalDirectories: vi.fn(),
  } as unknown as ITaskCreationHost;
  const taskService = {
    createTask: vi.fn(),
  } as unknown as TaskService;
  const service = new TaskForkService(host, taskService);

  beforeEach(() => {
    vi.clearAllMocks();
    getTaskRun.mockResolvedValue(createRun());
    vi.mocked(host.getWorkspace).mockResolvedValue(createWorkspace());
    vi.mocked(host.getAdditionalDirectories).mockResolvedValue([]);
    vi.mocked(taskService.createTask).mockResolvedValue({
      success: true,
      data: {} as never,
    });
  });

  it("rejects an active cloud run", async () => {
    const task = createTask({
      latest_run: createRun({ environment: "cloud", status: "in_progress" }),
    });

    const result = await service.forkTask(task, {
      source: {
        kind: "cloud",
        taskRunId: "source-run",
        status: "in_progress",
      },
    });

    expect(result).toEqual({
      success: false,
      error: "Wait for the cloud run to finish before forking it",
      failedStep: "validation",
    });
  });

  it("uses the effective cloud status when the persisted run is stale", async () => {
    vi.mocked(host.getWorkspace).mockResolvedValue(
      createWorkspace({ mode: "cloud", folderPath: "" }),
    );
    const task = createTask({
      latest_run: createRun({ environment: "cloud", status: "in_progress" }),
    });

    const result = await service.forkTask(task, {
      source: {
        kind: "cloud",
        taskRunId: "source-run",
        status: "completed",
      },
    });

    expect(result.success).toBe(true);
    expect(taskService.createTask).toHaveBeenCalledOnce();
  });

  it("creates a local worktree fork", async () => {
    vi.mocked(host.getAdditionalDirectories).mockResolvedValue([
      "/repos/shared",
    ]);
    const task = createTask({ latest_run: undefined });

    await service.forkTask(task, { source: { kind: "local" } });

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Preserve the existing context",
        repoPath: "/repos/code",
        repository: "PostHog/code",
        workspaceMode: "worktree",
        branch: null,
        additionalDirectories: ["/repos/shared"],
        forkFrom: { kind: "local", taskId: "source-task" },
      }),
      undefined,
    );
    expect(getTaskRun).not.toHaveBeenCalled();
  });

  it("uses the live cloud run instead of a stale local latest run", async () => {
    getTaskRun.mockResolvedValue(
      createRun({
        id: "live-cloud-run",
        environment: "cloud",
        status: "completed",
      }),
    );
    const task = createTask({
      latest_run: createRun({ id: "stale-local-run", environment: "local" }),
    });

    const result = await service.forkTask(task, {
      source: {
        kind: "cloud",
        taskRunId: "live-cloud-run",
        status: "completed",
      },
    });

    expect(result.success).toBe(true);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "cloud",
        repoPath: undefined,
        forkFrom: {
          kind: "cloud",
          taskId: "source-task",
          taskRunId: "live-cloud-run",
        },
      }),
      undefined,
    );
    expect(host.getAdditionalDirectories).not.toHaveBeenCalled();
  });

  it("preserves cloud runtime and sandbox options", async () => {
    vi.mocked(host.getWorkspace).mockResolvedValue(
      createWorkspace({ mode: "cloud", folderPath: "" }),
    );
    const task = createTask({
      github_integration: 12,
      github_user_integration: "integration-1",
      latest_run: createRun({
        environment: "cloud",
        branch: "posthog-code/source",
        runtime_adapter: "claude",
        model: "claude-sonnet-4-5",
        reasoning_effort: "medium",
        state: {
          auto_publish: true,
          custom_image_id: "image-1",
          initial_permission_mode: "acceptEdits",
          pr_authorship_mode: "bot",
          rtk_enabled: false,
          run_source: "signal_report",
          sandbox_environment_id: "environment-1",
        },
      }),
    });

    await service.forkTask(task, {
      source: {
        kind: "cloud",
        taskRunId: "source-run",
        status: "completed",
      },
    });

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "cloud",
        branch: "posthog-code/source",
        githubIntegrationId: 12,
        githubUserIntegrationId: "integration-1",
        executionMode: "acceptEdits",
        adapter: "claude",
        model: "claude-sonnet-4-5",
        reasoningLevel: "medium",
        sandboxEnvironmentId: "environment-1",
        customImageId: "image-1",
        cloudAutoPublish: true,
        cloudRtkEnabled: false,
        cloudRunSource: "signal_report",
        cloudPrAuthorshipMode: "bot",
        forkFrom: {
          kind: "cloud",
          taskId: "source-task",
          taskRunId: "source-run",
        },
      }),
      undefined,
    );
  });

  it("keeps signal-report forks bot-authored by default", async () => {
    vi.mocked(host.getWorkspace).mockResolvedValue(
      createWorkspace({ mode: "cloud", folderPath: "" }),
    );
    const task = createTask({
      latest_run: createRun({
        environment: "cloud",
        state: { run_source: "signal_report" },
      }),
    });

    await service.forkTask(task, {
      source: {
        kind: "cloud",
        taskRunId: "source-run",
        status: "completed",
      },
    });

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudRunSource: "signal_report",
        cloudPrAuthorshipMode: "bot",
      }),
      undefined,
    );
  });
});
