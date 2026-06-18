import type { AcpMessage } from "@posthog/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../../sessions/sessionStore";
import { useDraftStore } from "../draftStore";
import { getCommandSuggestions } from "./getSuggestions";

const SESSION_ID = "task-123";
const TASK_ID = "task-123";
const TASK_RUN_ID = "run-1";

function seedDraftCommands(commands: { name: string; description: string }[]) {
  useDraftStore.getState().actions.setCommands(SESSION_ID, commands);
}

function seedSessionContext(taskId: string | undefined) {
  useDraftStore.getState().actions.setContext(SESSION_ID, { taskId });
}

function seedSessionAvailableCommands(
  commands: { name: string; description: string }[],
) {
  const events: AcpMessage[] = [
    {
      direction: "agent_to_client",
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: TASK_RUN_ID,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: commands,
          },
        },
      },
    } as unknown as AcpMessage,
  ];

  useSessionStore.setState((state) => {
    state.sessions[TASK_RUN_ID] = {
      taskId: TASK_ID,
      taskRunId: TASK_RUN_ID,
      events,
      processedLineCount: 0,
      configOptions: [],
      pendingPermissions: new Map(),
      messageQueue: [],
      optimisticItems: [],
    } as unknown as (typeof state.sessions)[string];
    state.taskIdIndex[TASK_ID] = TASK_RUN_ID;
  });
}

function resetStores() {
  useDraftStore.setState((state) => {
    state.commands = {};
    state.contexts = {};
  });
  useSessionStore.setState((state) => {
    state.sessions = {};
    state.taskIdIndex = {};
  });
}

interface Scenario {
  name: string;
  contextTaskId?: string;
  sessionCommands?: { name: string; description: string }[];
  draftCommands?: { name: string; description: string }[];
  expectContains: string[];
  expectNotContains?: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "built-ins are always present",
    expectContains: ["good", "bad", "feedback"],
  },
  {
    name: "agent-supplied skills surface from session events",
    contextTaskId: TASK_ID,
    sessionCommands: [
      { name: "review", description: "Review code" },
      { name: "ship-it", description: "Ship the change" },
    ],
    expectContains: ["review", "ship-it"],
  },
  {
    name: "falls back to draft-store skills when session has no commands_update yet",
    contextTaskId: TASK_ID,
    draftCommands: [{ name: "review", description: "Review code" }],
    expectContains: ["review"],
  },
  {
    name: "agent-supplied commands win over draft-store fallback once reported",
    contextTaskId: TASK_ID,
    draftCommands: [
      { name: "fallback-only", description: "Should not appear" },
    ],
    sessionCommands: [{ name: "agent-cmd", description: "From agent" }],
    expectContains: ["agent-cmd"],
    expectNotContains: ["fallback-only"],
  },
  {
    name: "uses draft-store skills when there is no running task",
    draftCommands: [{ name: "my-skill", description: "User skill" }],
    expectContains: ["my-skill"],
  },
  {
    name: "agent reporting an empty list suppresses the draft-store fallback",
    contextTaskId: TASK_ID,
    draftCommands: [
      { name: "fallback-only", description: "Should not appear" },
    ],
    sessionCommands: [],
    expectContains: ["good", "bad", "feedback"],
    expectNotContains: ["fallback-only"],
  },
];

describe("getCommandSuggestions", () => {
  beforeEach(resetStores);

  it.each(SCENARIOS)(
    "$name",
    ({
      contextTaskId,
      sessionCommands,
      draftCommands,
      expectContains,
      expectNotContains,
    }) => {
      if (contextTaskId) seedSessionContext(contextTaskId);
      if (draftCommands) seedDraftCommands(draftCommands);
      if (sessionCommands) seedSessionAvailableCommands(sessionCommands);

      const names = getCommandSuggestions(SESSION_ID, "").map(
        (s) => s.command.name,
      );

      for (const expected of expectContains) {
        expect(names).toContain(expected);
      }
      for (const unexpected of expectNotContains ?? []) {
        expect(names).not.toContain(unexpected);
      }
    },
  );
});
