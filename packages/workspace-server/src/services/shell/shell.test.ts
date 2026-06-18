import { describe, expect, it, vi } from "vitest";
import { ShellEvent } from "./schemas";

const mockPty = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => mockPty);

import { ShellService } from "./shell";

function createMockPtyProcess() {
  return {
    pid: 1234,
    process: "bash",
    write: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createService() {
  const processTracking = {
    register: vi.fn(),
    unregister: vi.fn(),
    kill: vi.fn(),
  };
  const logger = {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
  const service = new ShellService(
    processTracking as never,
    {} as never,
    {} as never,
    {} as never,
    { getWorktreeLocation: vi.fn(() => "/tmp/worktrees") } as never,
    logger as never,
  );
  return { service, processTracking };
}

describe("ShellService.destroy", () => {
  it("emits an exit event for explicit teardown", async () => {
    mockPty.spawn.mockReturnValue(createMockPtyProcess());
    const { service } = createService();
    const exitHandler = vi.fn();
    service.on(ShellEvent.Exit, exitHandler);

    await service.create("session-1");

    service.destroy("session-1");

    expect(exitHandler).toHaveBeenCalledWith({
      sessionId: "session-1",
      exitCode: 130,
    });
  });

  it("does nothing for non-existent session", () => {
    const { service } = createService();
    expect(() => service.destroy("nonexistent")).not.toThrow();
  });
});
