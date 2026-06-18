import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { TypedEventEmitter } from "@posthog/shared";
import type { WorkspaceConnection } from "@posthog/workspace-client/client";
import { injectable } from "inversify";
import { logger } from "../../utils/logger.js";

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_POLL_TIMEOUT_MS = 5_000;
const SHUTDOWN_GRACE_MS = 3_000;

const log = logger.scope("workspace-server");

export const WorkspaceServerEvent = {
  ConnectionLost: "connectionLost",
} as const;

export interface WorkspaceServerEvents {
  [WorkspaceServerEvent.ConnectionLost]: {
    code: number | null;
    signal: NodeJS.Signals | null;
  };
}

@injectable()
export class WorkspaceServerService extends TypedEventEmitter<WorkspaceServerEvents> {
  private readonly scriptPath = path.join(__dirname, "workspace-server.js");
  private child: ChildProcess | null = null;
  private connection: WorkspaceConnection | null = null;
  private pendingStart: Promise<WorkspaceConnection> | null = null;

  getConnection(): WorkspaceConnection | null {
    return this.connection;
  }

  start(): Promise<WorkspaceConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.pendingStart) return this.pendingStart;

    this.pendingStart = this.spawnChild().finally(() => {
      this.pendingStart = null;
    });
    return this.pendingStart;
  }

  stop(): void {
    if (!this.child) return;
    const c = this.child;
    this.child = null;
    this.connection = null;
    try {
      c.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        c.kill("SIGKILL");
      } catch {}
    }, SHUTDOWN_GRACE_MS).unref();
  }

  private async spawnChild(): Promise<WorkspaceConnection> {
    const port = await findFreePort();
    const secret = randomBytes(32).toString("hex");
    const url = `http://127.0.0.1:${port}`;

    const c = spawn(process.execPath, [this.scriptPath], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        WORKSPACE_SERVER_SECRET: secret,
        WORKSPACE_SERVER_PORT: String(port),
        WORKSPACE_SERVER_PARENT_PID: String(process.pid),
      },
      windowsHide: true,
    });

    c.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    c.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    c.once("exit", (code, signal) => {
      const wasConnected = this.connection !== null;
      this.child = null;
      this.connection = null;
      log.info("child exited", { code, signal });
      if (wasConnected) {
        this.emit(WorkspaceServerEvent.ConnectionLost, { code, signal });
      }
    });

    this.child = c;

    if (!(await pollHealth(url))) {
      this.stop();
      throw new Error(
        `workspace-server failed to become healthy within ${HEALTH_POLL_TIMEOUT_MS}ms`,
      );
    }

    this.connection = { url, secret };
    return this.connection;
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") {
        s.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const port = a.port;
      s.close(() => resolve(port));
    });
  });
}

async function pollHealth(url: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}
