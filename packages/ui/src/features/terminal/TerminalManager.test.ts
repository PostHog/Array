import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const check = vi.fn();
  const create = vi.fn();
  const createCommand = vi.fn();
  const write = vi.fn();
  const resize = vi.fn();
  const openExternal = vi.fn();
  const logInfo = vi.fn();
  const logError = vi.fn();

  class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    dataHandler: ((data: string) => void) | null = null;
    loadAddon = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    clear = vi.fn();
    refresh = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      terminalInstances.push(this);
    }

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }

    open(element: HTMLElement) {
      const terminalElement = document.createElement("div");
      terminalElement.className = "xterm";
      element.appendChild(terminalElement);
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }
  }

  const terminalInstances: MockTerminal[] = [];

  return {
    check,
    create,
    createCommand,
    write,
    resize,
    openExternal,
    logInfo,
    logError,
    MockTerminal,
    terminalInstances,
  };
});

vi.mock("@posthog/di/container", () => ({
  resolveService: () => ({
    check: mocks.check,
    create: mocks.create,
    createCommand: mocks.createCommand,
    write: mocks.write,
    resize: mocks.resize,
    openExternal: mocks.openExternal,
  }),
}));

vi.mock("@posthog/ui/shell/logger", () => ({
  logger: {
    scope: () => ({
      info: mocks.logInfo,
      error: mocks.logError,
    }),
  },
}));

vi.mock("@posthog/ui/utils/platform", () => ({
  isMac: false,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    serialize = vi.fn(() => "serialized-terminal-state");
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: mocks.MockTerminal,
}));

import { terminalManager } from "./TerminalManager";

describe("TerminalManager shell recovery", () => {
  const sessionId = "shell-recovery-test";

  beforeEach(() => {
    mocks.check.mockReset();
    mocks.create.mockReset();
    mocks.createCommand.mockReset();
    mocks.write.mockReset();
    mocks.resize.mockReset();
    mocks.openExternal.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.terminalInstances.length = 0;

    mocks.check.mockResolvedValue(true);
    mocks.create.mockResolvedValue(undefined);
    mocks.createCommand.mockResolvedValue(undefined);
    mocks.write.mockResolvedValue(undefined);
    mocks.resize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    terminalManager.destroy(sessionId);
  });

  it("recreates a missing interactive shell and retries the triggering input", async () => {
    terminalManager.create({
      sessionId,
      persistenceKey: "task-1-shell",
      cwd: "/repo",
      taskId: "task-1",
    });

    await vi.waitFor(() => {
      expect(mocks.check).toHaveBeenCalledWith({ sessionId });
    });

    mocks.check.mockResolvedValueOnce(false);
    mocks.write
      .mockRejectedValueOnce(new Error(`Shell session ${sessionId} not found`))
      .mockResolvedValue(undefined);

    mocks.terminalInstances[0].emitData("a");

    await vi.waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        sessionId,
        cwd: "/repo",
        taskId: "task-1",
      });
    });

    await vi.waitFor(() => {
      expect(mocks.write).toHaveBeenCalledTimes(2);
    });

    expect(mocks.write.mock.calls[1][0]).toEqual({
      sessionId,
      data: "a",
    });
  });
});
