import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpMessage, AgentSession } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const TASK_ID = "task-1";
const RUN_ID = "run-1";

const PROMPT: ContentBlock[] = [{ type: "text", text: "do the thing" }];

function promptEcho(): AcpMessage {
  return {
    type: "acp_message",
    ts: 0,
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "session/prompt",
      params: {},
    },
  } as unknown as AcpMessage;
}

function createHarness(
  overrides: {
    session?: AgentSession | null;
    getPendingInitialPrompt?: string | null;
  } = {},
) {
  const sessions: Record<string, AgentSession> = {};
  if (overrides.session)
    sessions[overrides.session.taskRunId] = overrides.session;

  const setPendingInitialPrompt = vi.fn().mockResolvedValue(undefined);
  const getPendingInitialPrompt = vi
    .fn()
    .mockResolvedValue(overrides.getPendingInitialPrompt ?? null);
  const clearPendingInitialPrompt = vi.fn().mockResolvedValue(undefined);

  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    setSession: (session: AgentSession) => {
      sessions[session.taskRunId] = session;
    },
    updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
      const session = sessions[taskRunId];
      if (session) Object.assign(session, updates);
    },
    replaceOptimisticWithEvent: vi.fn(),
    appendEvents: vi.fn(),
  };

  const deps = {
    store,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    trpc: {
      agent: {
        onSessionIdleKilled: { subscribe: () => ({ unsubscribe: vi.fn() }) },
      },
      workspace: {
        setPendingInitialPrompt: { mutate: setPendingInitialPrompt },
        getPendingInitialPrompt: { query: getPendingInitialPrompt },
        clearPendingInitialPrompt: { mutate: clearPendingInitialPrompt },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);

  return {
    service,
    setPendingInitialPrompt,
    getPendingInitialPrompt,
    clearPendingInitialPrompt,
  };
}

describe("initial prompt persistence", () => {
  describe("resendPendingPromptIfNeeded", () => {
    it("clears the durable prompt without resending when the log already has the echo", async () => {
      const h = createHarness({
        getPendingInitialPrompt: JSON.stringify(PROMPT),
      });
      const sendPrompt = vi
        .spyOn(h.service, "sendPrompt")
        .mockResolvedValue({ stopReason: "end_turn" });

      await (
        h.service as unknown as {
          resendPendingPromptIfNeeded: (
            taskId: string,
            events: AcpMessage[],
          ) => Promise<void>;
        }
      ).resendPendingPromptIfNeeded(TASK_ID, [promptEcho()]);

      expect(h.clearPendingInitialPrompt).toHaveBeenCalledWith({
        taskId: TASK_ID,
      });
      expect(h.getPendingInitialPrompt).not.toHaveBeenCalled();
      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("resends the stored prompt exactly once when the log lacks the echo", async () => {
      const h = createHarness({
        getPendingInitialPrompt: JSON.stringify(PROMPT),
      });
      const sendPrompt = vi
        .spyOn(h.service, "sendPrompt")
        .mockResolvedValue({ stopReason: "end_turn" });

      await (
        h.service as unknown as {
          resendPendingPromptIfNeeded: (
            taskId: string,
            events: AcpMessage[],
          ) => Promise<void>;
        }
      ).resendPendingPromptIfNeeded(TASK_ID, []);

      expect(sendPrompt).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledWith(TASK_ID, PROMPT);
    });

    it("does nothing when there is no stored prompt", async () => {
      const h = createHarness({ getPendingInitialPrompt: null });
      const sendPrompt = vi
        .spyOn(h.service, "sendPrompt")
        .mockResolvedValue({ stopReason: "end_turn" });

      await (
        h.service as unknown as {
          resendPendingPromptIfNeeded: (
            taskId: string,
            events: AcpMessage[],
          ) => Promise<void>;
        }
      ).resendPendingPromptIfNeeded(TASK_ID, []);

      expect(sendPrompt).not.toHaveBeenCalled();
    });
  });

  describe("handleSessionEvent", () => {
    it("clears the durable prompt on the prompt echo", () => {
      const session = {
        taskRunId: RUN_ID,
        taskId: TASK_ID,
        events: [],
        messageQueue: [],
        optimisticItems: [],
      } as unknown as AgentSession;
      const h = createHarness({ session });

      (
        h.service as unknown as {
          handleSessionEvent: (runId: string, msg: AcpMessage) => void;
        }
      ).handleSessionEvent(RUN_ID, promptEcho());

      expect(h.clearPendingInitialPrompt).toHaveBeenCalledWith({
        taskId: TASK_ID,
      });
    });
  });

  describe("clearSessionError", () => {
    it("recovers the durable prompt when the in-memory session is gone", async () => {
      const h = createHarness({
        session: null,
        getPendingInitialPrompt: JSON.stringify(PROMPT),
      });
      const createNewLocalSession = vi
        .spyOn(
          h.service as unknown as {
            createNewLocalSession: (...args: unknown[]) => Promise<void>;
          },
          "createNewLocalSession",
        )
        .mockResolvedValue(undefined);
      vi.spyOn(
        h.service as unknown as {
          getAuthCredentialsStatus: () => Promise<unknown>;
        },
        "getAuthCredentialsStatus",
      ).mockResolvedValue({ kind: "ready", auth: { client: {} } });

      await h.service.clearSessionError(TASK_ID, "/repo");

      expect(h.getPendingInitialPrompt).toHaveBeenCalledWith({
        taskId: TASK_ID,
      });
      expect(createNewLocalSession).toHaveBeenCalledWith(
        TASK_ID,
        "Task",
        "/repo",
        { client: {} },
        PROMPT,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });
});
