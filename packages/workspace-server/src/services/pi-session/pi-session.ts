import {
  getPiRpcClientProcess,
  type PiRpcClient,
} from "@posthog/agent/pi/rpc-client";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import { TypedEventEmitter } from "@posthog/shared";
import { inject, injectable } from "inversify";
import { TASK_METADATA_REPOSITORY } from "../../db/identifiers";
import type { ITaskMetadataRepository } from "../../db/repositories/task-metadata-repository";
import { PROCESS_TRACKING_SERVICE } from "../process-tracking/identifiers";
import type { ProcessTrackingService } from "../process-tracking/process-tracking";
import { PI_RPC_CLIENT_FACTORY, type PiRpcClientFactory } from "./identifiers";
import type { StartPiSessionInput } from "./schemas";

type PiSessionEvent = Parameters<Parameters<PiRpcClient["onEvent"]>[0]>[0];

interface PiSessionEvents {
  event: { taskId: string; event: PiSessionEvent };
}

interface ManagedPiSession {
  client: PiRpcClient;
  pid?: number;
}

@injectable()
export class PiSessionService extends TypedEventEmitter<PiSessionEvents> {
  private readonly sessions = new Map<string, ManagedPiSession>();
  private readonly lifecycleLocks = new Map<string, Promise<unknown>>();
  private readonly log: ReturnType<RootLogger["scope"]>;

  constructor(
    @inject(PI_RPC_CLIENT_FACTORY)
    private readonly clientFactory: PiRpcClientFactory,
    @inject(TASK_METADATA_REPOSITORY)
    private readonly taskMetadataRepository: ITaskMetadataRepository,
    @inject(PROCESS_TRACKING_SERVICE)
    private readonly processTracking: ProcessTrackingService,
    @inject(ROOT_LOGGER) rootLogger: RootLogger,
  ) {
    super();
    this.log = rootLogger.scope("pi-session");
  }

  async start(
    input: StartPiSessionInput,
  ): Promise<{ sessionFile: string | null; sessionId: string }> {
    return this.runExclusive(input.taskId, () => this.startLocked(input));
  }

  private async startLocked(
    input: StartPiSessionInput,
  ): Promise<{ sessionFile: string | null; sessionId: string }> {
    await this.stopLocked(input.taskId);

    const client = await this.clientFactory.create({
      cwd: input.cwd,
      model: input.model,
    });
    const session = this.registerSession(input.taskId, client);

    return this.startSession(input.taskId, client, session, async () => {
      const state = await client.getState();

      if (!state.sessionFile) {
        throw new Error(
          "Pi did not create a native session file, even though we expected it to.",
        );
      }

      this.taskMetadataRepository.upsert(input.taskId, {
        piSessionFile: state.sessionFile,
      });

      await client.prompt(input.prompt);

      return {
        sessionFile: state.sessionFile,
        sessionId: state.sessionId,
      };
    });
  }

  async resume(input: { taskId: string; cwd: string }): Promise<void> {
    await this.runExclusive(input.taskId, () => this.resumeLocked(input));
  }

  private async resumeLocked(input: {
    taskId: string;
    cwd: string;
  }): Promise<void> {
    if (this.sessions.has(input.taskId)) {
      return;
    }

    const metadata = this.taskMetadataRepository.findByTaskId(input.taskId);
    const sessionFile = metadata?.piSessionFile;

    if (!sessionFile) {
      throw new Error(
        `Pi session metadata is missing for task ${input.taskId}`,
      );
    }

    await this.stopLocked(input.taskId);

    const client = await this.clientFactory.create({
      cwd: input.cwd,
      sessionFile,
    });
    const session = this.registerSession(input.taskId, client);

    await this.startSession(input.taskId, client, session, async () => {});
  }

  async prompt(taskId: string, prompt: string): Promise<void> {
    const session = this.requireSession(taskId);

    await session.client.prompt(prompt);
  }

  async abort(taskId: string): Promise<void> {
    const session = this.requireSession(taskId);

    await session.client.abort();
  }

  async stop(taskId: string): Promise<void> {
    await this.runExclusive(taskId, () => this.stopLocked(taskId));
  }

  private async stopLocked(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);

    if (!session) {
      return;
    }

    this.sessions.delete(taskId);

    try {
      await session.client.stop();
    } finally {
      if (session.pid) {
        this.processTracking.unregister(session.pid, "pi-session-stopped");
      }
    }
  }

  status(taskId: string): ReturnType<PiRpcClient["getState"]> {
    return this.requireSession(taskId).client.getState();
  }

  entries(
    taskId: string,
    since?: string,
  ): ReturnType<PiRpcClient["getEntries"]> {
    return this.requireSession(taskId).client.getEntries(since);
  }

  async cleanup(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((taskId) => this.stop(taskId)),
    );
  }

  private runExclusive<T>(
    taskId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.lifecycleLocks.get(taskId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tracked = result.then(
      () => undefined,
      () => undefined,
    );

    this.lifecycleLocks.set(taskId, tracked);
    void tracked.finally(() => {
      if (this.lifecycleLocks.get(taskId) === tracked) {
        this.lifecycleLocks.delete(taskId);
      }
    });

    return result;
  }

  private async startSession<T>(
    taskId: string,
    client: PiRpcClient,
    session: ManagedPiSession,
    initialize: () => Promise<T>,
  ): Promise<T> {
    try {
      await client.start();
      this.trackProcess(taskId, session);

      return await initialize();
    } catch (error) {
      this.log.error("Failed to start Pi session", { taskId, error });

      await this.cleanupFailedClient(taskId, client);
      this.sessions.delete(taskId);

      throw error;
    }
  }

  private async cleanupFailedClient(
    taskId: string,
    client: PiRpcClient,
  ): Promise<void> {
    try {
      await client.stop();
    } catch (error) {
      this.log.warn("Failed to stop Pi client after startup failure", {
        taskId,
        error,
      });
    }
  }

  private registerSession(
    taskId: string,
    client: PiRpcClient,
  ): ManagedPiSession {
    const session: ManagedPiSession = { client };

    this.sessions.set(taskId, session);
    client.onEvent((event) => this.emit("event", { taskId, event }));

    return session;
  }

  private trackProcess(taskId: string, session: ManagedPiSession): void {
    const process = getPiRpcClientProcess(session.client);

    if (!process?.pid) {
      return;
    }

    session.pid = process.pid;
    this.processTracking.register(
      process.pid,
      "agent",
      "pi-rpc",
      undefined,
      taskId,
    );

    process.once("exit", (code, signal) => {
      this.processTracking.unregister(process.pid as number, "pi-rpc-exit");

      if (this.sessions.get(taskId) !== session) {
        return;
      }

      this.sessions.delete(taskId);
      this.log.warn("Pi RPC process exited", { taskId, code, signal });
    });
  }

  private requireSession(taskId: string): ManagedPiSession {
    const session = this.sessions.get(taskId);

    if (!session) {
      throw new Error(`Pi session not found for task ${taskId}`);
    }

    return session;
  }
}
