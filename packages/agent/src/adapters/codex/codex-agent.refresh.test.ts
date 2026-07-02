import { Readable, Writable } from "node:stream";
import type { AgentSideConnection, McpServer } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_METHODS } from "../../acp-extensions";

type MockCodexConnection = {
  initialize: ReturnType<typeof vi.fn>;
  newSession: ReturnType<typeof vi.fn>;
  loadSession: ReturnType<typeof vi.fn>;
  setSessionMode: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  setSessionConfigOption: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

type SpawnHandle = {
  process: { pid: number };
  stdin: Writable;
  stdout: Readable;
  kill: ReturnType<typeof vi.fn>;
};

const hoisted = vi.hoisted(() => {
  // Everything the mock factories depend on must live here — vi.mock()
  // invocations are hoisted above any other top-level code.
  const createdConnections: MockCodexConnection[] = [];
  const spawnedProcesses: SpawnHandle[] = [];

  const makeConnection = (): MockCodexConnection => ({
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: {},
    }),
    newSession: vi.fn(),
    loadSession: vi.fn().mockResolvedValue({
      modes: { currentModeId: "auto", availableModes: [] },
      configOptions: [],
    }),
    setSessionMode: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn(),
    prompt: vi.fn(),
    setSessionConfigOption: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  });

  const clientSideConnectionCtor = class {
    constructor() {
      Object.assign(this, makeConnection());
      createdConnections.push(this as unknown as MockCodexConnection);
    }
  };

  const spawnCodexProcessMock = vi.fn(() => {
    const handle: SpawnHandle = {
      process: { pid: 1000 + spawnedProcesses.length },
      stdin: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      stdout: new Readable({ read() {} }),
      kill: vi.fn(),
    };
    spawnedProcesses.push(handle);
    return handle;
  });

  return {
    createdConnections,
    spawnedProcesses,
    clientSideConnectionCtor,
    spawnCodexProcessMock,
  };
});

const createdConnections = hoisted.createdConnections;
const spawnedProcesses = hoisted.spawnedProcesses;

vi.mock("@agentclientprotocol/sdk", async () => {
  const actual = await vi.importActual("@agentclientprotocol/sdk");
  return {
    ...actual,
    ClientSideConnection: hoisted.clientSideConnectionCtor,
    ndJsonStream: vi.fn(() => ({}) as object),
  };
});

vi.mock("./spawn", () => ({
  spawnCodexProcess: hoisted.spawnCodexProcessMock,
}));

vi.mock("./settings", () => ({
  CodexSettingsManager: class {
    constructor(private readonly cwd: string) {}
    initialize = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    getCwd = () => this.cwd;
    setCwd = vi.fn();
    getSettings = () => ({ mcpServerNames: [] });
  },
}));

import { CodexAcpAgent } from "./codex-agent";

type PrivateAgent = {
  session: {
    abortController: AbortController;
    settingsManager: { dispose: ReturnType<typeof vi.fn> };
    notificationHistory: unknown[];
    promptRunning: boolean;
  };
  sessionId: string;
  sessionState: {
    sessionId: string;
    cwd: string;
    accumulatedUsage: {
      inputTokens: number;
      outputTokens: number;
      cachedReadTokens: number;
      cachedWriteTokens: number;
    };
    configOptions: unknown[];
    taskRunId?: string;
  };
  codexProcess: SpawnHandle;
  codexConnection: MockCodexConnection;
  lastInitRequest?: { protocolVersion: number };
};

function makeAgent(): CodexAcpAgent {
  const client = {
    extNotification: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSideConnection;
  return new CodexAcpAgent(client, {
    codexProcessOptions: { cwd: "/tmp/repo" },
  });
}

function primeSession(
  agent: CodexAcpAgent,
  sessionId: string,
): {
  oldProcess: SpawnHandle;
  oldConnection: MockCodexConnection;
  priv: PrivateAgent;
} {
  const priv = agent as unknown as PrivateAgent;
  priv.sessionId = sessionId;
  priv.sessionState = {
    sessionId,
    cwd: "/tmp/repo",
    accumulatedUsage: {
      inputTokens: 42,
      outputTokens: 17,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    configOptions: [{ id: "opt", value: "x" }],
    taskRunId: "run-1",
  };
  priv.session.notificationHistory = [{ foo: "bar" }];
  priv.lastInitRequest = { protocolVersion: 1 };
  return {
    oldProcess: priv.codexProcess,
    oldConnection: priv.codexConnection,
    priv,
  };
}

describe("CodexAcpAgent.extMethod refresh_session", () => {
  beforeEach(() => {
    spawnedProcesses.length = 0;
    createdConnections.length = 0;
  });

  it("returns methodNotFound for unknown extension methods", async () => {
    const agent = makeAgent();
    await expect(agent.extMethod("_posthog/nope", {})).rejects.toThrow(
      /Method not found/i,
    );
  });

  it("rejects when mcpServers is missing", async () => {
    const agent = makeAgent();
    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {}),
    ).rejects.toThrow(/at least one refreshable field/);
  });

  it("rejects when mcpServers is not an array", async () => {
    const agent = makeAgent();
    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: "nope" as unknown,
      }),
    ).rejects.toThrow(/mcpServers must be an array/);
  });

  it("rejects refresh while a prompt is in flight", async () => {
    const agent = makeAgent();
    const { priv } = primeSession(agent, "s-1");
    priv.session.promptRunning = true;

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: [
          { name: "posthog", type: "http", url: "https://new", headers: [] },
        ],
      }),
    ).rejects.toThrow(/prompt turn is in flight/);
  });

  it("respawns the subprocess, re-initializes, and rehydrates with new MCP servers", async () => {
    const agent = makeAgent();
    const { oldProcess, oldConnection, priv } = primeSession(agent, "s-2");
    const oldAbortController = priv.session.abortController;
    const oldSettingsManager = priv.session.settingsManager;

    const mcpServers: McpServer[] = [
      {
        name: "posthog",
        type: "http",
        url: "https://fresh",
        headers: [{ name: "x-foo", value: "bar" }],
      },
    ];

    const result = await agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
      mcpServers,
    });

    expect(result).toEqual({ refreshed: true });

    // Old subprocess torn down, old connection cancelled.
    expect(oldConnection.cancel).toHaveBeenCalledWith({ sessionId: "s-2" });
    expect(oldProcess.kill).toHaveBeenCalledTimes(1);
    expect(oldAbortController.signal.aborted).toBe(true);
    expect(oldSettingsManager.dispose).toHaveBeenCalledTimes(1);

    // A fresh subprocess was spawned and a new ClientSideConnection wired up.
    expect(spawnedProcesses).toHaveLength(2);
    expect(createdConnections).toHaveLength(2);
    const newConnection = createdConnections[1];
    if (!newConnection) throw new Error("expected a second connection");

    // ACP handshake replayed against the new subprocess.
    expect(newConnection.initialize).toHaveBeenCalledWith({
      protocolVersion: 1,
    });
    expect(newConnection.loadSession).toHaveBeenCalledWith({
      sessionId: "s-2",
      cwd: "/tmp/repo",
      mcpServers,
    });

    // References swapped to the new instances.
    expect(priv.codexProcess).toBe(spawnedProcesses[1]);
    expect(priv.codexConnection).toBe(newConnection);
    expect(priv.session.abortController).not.toBe(oldAbortController);
    expect(priv.session.settingsManager).not.toBe(oldSettingsManager);

    // Session-level state preserved across refresh.
    expect(priv.sessionState.accumulatedUsage.inputTokens).toBe(42);
    expect(priv.sessionState.accumulatedUsage.outputTokens).toBe(17);
    expect(priv.sessionState.configOptions).toEqual([
      { id: "opt", value: "x" },
    ]);
    expect(priv.sessionState.taskRunId).toBe("run-1");
    expect(priv.session.notificationHistory).toEqual([{ foo: "bar" }]);
  });

  it("does not fail refresh when cancel() throws on the stale connection", async () => {
    const agent = makeAgent();
    const { oldConnection } = primeSession(agent, "s-3");
    oldConnection.cancel.mockRejectedValueOnce(new Error("already dead"));

    await expect(
      agent.extMethod(POSTHOG_METHODS.REFRESH_SESSION, {
        mcpServers: [
          { name: "posthog", type: "http", url: "https://x", headers: [] },
        ],
      }),
    ).resolves.toEqual({ refreshed: true });

    expect(spawnedProcesses).toHaveLength(2);
    expect(createdConnections[1]?.loadSession).toHaveBeenCalled();
  });
});
