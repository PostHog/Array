import { describe, expect, it, vi } from "vitest";
import {
  CloudTaskCommandController,
  type CloudTaskCommandTransport,
} from "./cloudTaskCommandController";

function createHarness(): {
  controller: CloudTaskCommandController;
  transport: CloudTaskCommandTransport;
} {
  const transport: CloudTaskCommandTransport = {
    sendCommand: vi.fn(async () => {}),
    stopRun: vi.fn(async () => {}),
  };
  return {
    controller: new CloudTaskCommandController(transport),
    transport,
  };
}

describe("CloudTaskCommandController", () => {
  it("dispatches user messages with canonical parameters", async () => {
    const { controller, transport } = createHarness();

    await controller.sendUserMessage(
      { taskId: "task-1", taskRunId: "run-1" },
      "encoded prompt",
    );

    expect(transport.sendCommand).toHaveBeenCalledWith(
      { taskId: "task-1", taskRunId: "run-1" },
      "user_message",
      { content: "encoded prompt" },
    );
  });

  it("dispatches permission responses with canonical parameters", async () => {
    const { controller, transport } = createHarness();

    await controller.respondToPermission(
      { taskId: "task-1", taskRunId: "run-1" },
      {
        requestId: "request-1",
        optionId: "allow",
        answers: { reason: "approved" },
        customInput: "Proceed",
      },
    );

    expect(transport.sendCommand).toHaveBeenCalledWith(
      { taskId: "task-1", taskRunId: "run-1" },
      "permission_response",
      {
        requestId: "request-1",
        optionId: "allow",
        answers: { reason: "approved" },
        customInput: "Proceed",
      },
    );
  });

  it("dispatches prompt cancellation to the active cloud run", async () => {
    const { controller, transport } = createHarness();

    await controller.cancelPrompt({ taskId: "task-1", taskRunId: "run-1" });

    expect(transport.sendCommand).toHaveBeenCalledWith(
      { taskId: "task-1", taskRunId: "run-1" },
      "cancel",
    );
  });

  it("dispatches configuration changes with canonical parameters", async () => {
    const { controller, transport } = createHarness();

    await controller.setConfigOption(
      { taskId: "task-1", taskRunId: "run-1" },
      "model",
      "claude-sonnet-4-5",
    );

    expect(transport.sendCommand).toHaveBeenCalledWith(
      { taskId: "task-1", taskRunId: "run-1" },
      "set_config_option",
      { configId: "model", value: "claude-sonnet-4-5" },
    );
  });

  it("preserves transport failures for service-specific handling", async () => {
    const { controller, transport } = createHarness();
    vi.mocked(transport.sendCommand).mockRejectedValueOnce(new Error("failed"));

    await expect(
      controller.cancelPrompt({ taskId: "task-1", taskRunId: "run-1" }),
    ).rejects.toThrow("failed");
  });

  it("preserves command results for callers", async () => {
    const commandResult = { success: true, result: { accepted: true } };
    const transport: CloudTaskCommandTransport<typeof commandResult> = {
      sendCommand: vi.fn(async () => commandResult),
      stopRun: vi.fn(async () => undefined),
    };
    const controller = new CloudTaskCommandController(transport);

    await expect(
      controller.sendUserMessage(
        { taskId: "task-1", taskRunId: "run-1" },
        "hello",
      ),
    ).resolves.toBe(commandResult);
  });

  it("dispatches stop requests and preserves their results", async () => {
    const stopResult = { status: "cancelling" };
    const transport: CloudTaskCommandTransport<void, typeof stopResult> = {
      sendCommand: vi.fn(async () => {}),
      stopRun: vi.fn(async () => stopResult),
    };
    const controller = new CloudTaskCommandController(transport);
    const target = { taskId: "task-1", taskRunId: "run-1" };

    await expect(controller.stopRun(target)).resolves.toBe(stopResult);
    expect(transport.stopRun).toHaveBeenCalledWith(target);
  });
});
