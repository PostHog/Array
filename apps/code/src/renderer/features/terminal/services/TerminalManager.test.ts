import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const checkQuery = vi.fn();
  const createMutate = vi.fn();
  const createCommandMutate = vi.fn();
  const writeMutate = vi.fn();
  const resizeMutate = vi.fn();
  const openExternalMutate = vi.fn();
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
    checkQuery,
    createMutate,
    createCommandMutate,
    writeMutate,
    resizeMutate,
    openExternalMutate,
    logInfo,
    logError,
    MockTerminal,
    terminalInstances,
  };
});

vi.mock("@renderer/trpc", () => ({
  trpcClient: {
    shell: {
      check: { query: mocks.checkQuery },
      create: { mutate: mocks.createMutate },
      createCommand: { mutate: mocks.createCommandMutate },
      write: { mutate: mocks.writeMutate },
      resize: { mutate: mocks.resizeMutate },
    },
    os: {
      openExternal: { mutate: mocks.openExternalMutate },
    },
  },
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      info: mocks.logInfo,
      error: mocks.logError,
    }),
  },
}));

vi.mock("@utils/platform", () => ({
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
    mocks.checkQuery.mockReset();
    mocks.createMutate.mockReset();
    mocks.createCommandMutate.mockReset();
    mocks.writeMutate.mockReset();
    mocks.resizeMutate.mockReset();
    mocks.openExternalMutate.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.terminalInstances.length = 0;

    mocks.checkQuery.mockResolvedValue(true);
    mocks.createMutate.mockResolvedValue(undefined);
    mocks.createCommandMutate.mockResolvedValue(undefined);
    mocks.writeMutate.mockResolvedValue(undefined);
    mocks.resizeMutate.mockResolvedValue(undefined);
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
      expect(mocks.checkQuery).toHaveBeenCalledWith({ sessionId });
    });

    mocks.checkQuery.mockResolvedValueOnce(false);
    mocks.writeMutate
      .mockRejectedValueOnce(new Error(`Shell session ${sessionId} not found`))
      .mockResolvedValue(undefined);

    mocks.terminalInstances[0].emitData("a");

    await vi.waitFor(() => {
      expect(mocks.createMutate).toHaveBeenCalledWith({
        sessionId,
        cwd: "/repo",
        taskId: "task-1",
      });
    });

    await vi.waitFor(() => {
      expect(mocks.writeMutate).toHaveBeenCalledTimes(2);
    });

    expect(mocks.writeMutate.mock.calls[1][0]).toEqual({
      sessionId,
      data: "a",
    });
  });
});
