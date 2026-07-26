import type { TaskService } from "@posthog/core/task-detail/taskService";
import { describe, expect, it, vi } from "vitest";
import { CanvasGenerationService } from "./canvasGenerationService";

function makeService(options: { model?: string; taskIds?: string[] } = {}) {
  const taskIds = options.taskIds ?? ["task-1"];
  const createTask = vi.fn().mockImplementation(async () => {
    const id = taskIds.shift() ?? "task-next";
    return {
      success: true,
      data: {
        task: { id, title: `Title ${id}`, latest_run: { id: `run-${id}` } },
      },
    };
  });
  const file = vi.fn().mockResolvedValue({});
  const setGenerationTask = vi.fn().mockResolvedValue({});
  const rename = vi.fn().mockResolvedValue({});
  const resolveDefaultModel = vi
    .fn()
    .mockResolvedValue(options.model ?? "model-1");
  const service = new CanvasGenerationService(
    { createTask } as unknown as TaskService,
    { resolveDefaultModel },
    { getState: () => ({ cloudRegion: "us" }) },
    { file },
    { setGenerationTask, rename },
    { generateCanvasName: vi.fn().mockResolvedValue("Generated name") },
  );
  return {
    service,
    createTask,
    file,
    setGenerationTask,
    rename,
    resolveDefaultModel,
  };
}

const input = {
  dashboardId: "canvas-1",
  channelId: "channel-1",
  channelName: "product",
  name: "Untitled canvas",
  instruction: "Show weekly active users",
  backendChannelId: "backend-channel-1",
} as const;

describe("CanvasGenerationService", () => {
  it("starts an attributed cloud task and associates it with the canvas", async () => {
    const { service, createTask, file, setGenerationTask } = makeService();

    await expect(service.generate(input)).resolves.toMatchObject({
      success: true,
      taskId: "task-1",
      taskRunId: "run-task-1",
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceMode: "cloud",
        executionMode: "auto",
        allowNoRepo: true,
        model: "model-1",
      }),
      undefined,
    );
    expect(file).toHaveBeenCalledWith({
      channelId: "channel-1",
      taskId: "task-1",
      taskTitle: "Title task-1",
    });
    expect(setGenerationTask).toHaveBeenCalledWith({
      id: "canvas-1",
      taskId: "task-1",
    });
  });

  it("creates a fresh task and run for every edit", async () => {
    const { service } = makeService({ taskIds: ["task-1", "task-2"] });

    const first = await service.generate(input);
    const second = await service.generate({
      ...input,
      currentCode: "export default function App() { return null; }",
    });

    expect(first).toMatchObject({ taskId: "task-1", taskRunId: "run-task-1" });
    expect(second).toMatchObject({ taskId: "task-2", taskRunId: "run-task-2" });
  });

  it("returns a structured failure when no cloud model is available", async () => {
    const { service, createTask, resolveDefaultModel } = makeService();
    resolveDefaultModel.mockResolvedValue(undefined);

    await expect(service.generate(input)).resolves.toEqual({
      success: false,
      error: "No model is configured for cloud runs.",
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("renames placeholder canvases without blocking generation", async () => {
    const { service, rename } = makeService();
    await service.generate(input);
    await vi.waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        id: "canvas-1",
        name: "Generated name",
      }),
    );
  });
});
