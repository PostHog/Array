import { POSTHOG_NOTIFICATIONS } from "@posthog/core/sessions/acpNotifications";
import { makeAttachmentUri } from "@posthog/core/sessions/promptContent";
import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  buildConversationItems,
  type ConversationItem,
} from "./buildConversationItems";

function consoleMsg(ts: number, message: string, level = "info"): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/console",
      params: { level, message },
    },
  };
}

function progressMsg(
  ts: number,
  step: string,
  status: string,
  label: string,
  detail?: string,
  group = "setup",
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/progress",
      params: { step, status, label, detail, group },
    },
  };
}

function userPromptMsg(ts: number, id: number, text: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: { prompt: [{ type: "text", text }] },
    },
  };
}

function promptResponseMsg(ts: number, id: number): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      result: { stopReason: "end_turn" },
    },
  };
}

function turnCompleteMsg(ts: number, stopReason = "end_turn"): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/turn_complete",
      params: { sessionId: "session-1", stopReason },
    },
  };
}

function gitCheckpointMsg(
  ts: number,
  checkpointId: string,
  promptId?: number,
  turnCompletedAt?: string,
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
      params: { checkpointId, promptId, turnCompletedAt },
    },
  };
}

function agentMessageMsg(ts: number, text: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    },
  };
}

function resourcesUsedMsg(
  ts: number,
  products: { id: string; label: string }[],
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/resources_used",
      params: { sessionId: "session-1", products },
    },
  };
}

function statusMsg(
  ts: number,
  status: string,
  isComplete?: boolean,
  error?: string,
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/status",
      params: { sessionId: "session-1", status, isComplete, error },
    },
  };
}

function refusalStatusMsg(
  ts: number,
  status: "refusal" | "refusal_fallback",
  fields: { explanation?: string; fromModel?: string; toModel?: string } = {},
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/status",
      params: { sessionId: "session-1", status, ...fields },
    },
  };
}

describe("buildConversationItems", () => {
  // Restore-icon gating: a turn is restorable iff its user_message carries a
  // lastCheckpointId, set from the GIT_CHECKPOINT notification. This must work
  // when the checkpoint is loaded from logs.ndjson on a cold start (the only
  // place it lives after the in-memory map is gone on app restart).
  it("associates a git_checkpoint notification with its turn via promptId", () => {
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "first"),
        promptResponseMsg(2, 1),
        turnCompleteMsg(3),
        gitCheckpointMsg(4, "cp-abc", 1),
      ],
      null,
    );

    const userMsg = result.items.find((i) => i.type === "user_message");
    expect(userMsg?.type).toBe("user_message");
    expect(
      userMsg?.type === "user_message"
        ? userMsg.turnContext?.lastCheckpointId
        : undefined,
    ).toBe("cp-abc");
  });

  it("leaves lastCheckpointId unset for a turn with no checkpoint", () => {
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "first"),
        promptResponseMsg(2, 1),
        turnCompleteMsg(3),
      ],
      null,
    );

    const userMsg = result.items.find((i) => i.type === "user_message");
    expect(
      userMsg?.type === "user_message"
        ? (userMsg.turnContext?.lastCheckpointId ?? null)
        : "missing",
    ).toBeNull();
  });

  // Regression: across a local→cloud→local handoff the cloud session restarts
  // prompt numbering, so promptIds collide (harness/alpha = 2/3, cloud-resume/beta
  // reuse 2/3). A promptId-keyed Map would let the cloud turns steal the local
  // turns' checkpoints, leaving harness+alpha with disabled restore icons. Each
  // turn must keep its OWN checkpoint, and the internal (no-promptId) pre-flight
  // snapshot must not bind to any turn's button.
  it("associates checkpoints by timestamp when promptIds collide across a handoff", () => {
    const preflightCheckpoint: AcpMessage = {
      type: "acp_message",
      ts: 9,
      message: {
        jsonrpc: "2.0",
        method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
        params: { checkpointId: "cp-preflight" }, // internal: no promptId
      },
    };

    const result = buildConversationItems(
      [
        userPromptMsg(1, 2, "harness"),
        promptResponseMsg(2, 2),
        turnCompleteMsg(3),
        gitCheckpointMsg(4, "cp-harness", 2),
        userPromptMsg(5, 3, "alpha"),
        promptResponseMsg(6, 3),
        turnCompleteMsg(7),
        gitCheckpointMsg(8, "cp-alpha", 3),
        preflightCheckpoint,
        userPromptMsg(10, 2, "resuming"), // cloud reuses promptId 2
        promptResponseMsg(11, 2),
        turnCompleteMsg(12),
        gitCheckpointMsg(13, "cp-cloudinit", 1), // cloud promptId has no local twin
        userPromptMsg(14, 3, "beta"), // cloud reuses promptId 3
        promptResponseMsg(15, 3),
        turnCompleteMsg(16),
        gitCheckpointMsg(17, "cp-beta", 2),
      ],
      null,
    );

    const checkpointIds = result.items
      .filter((i) => i.type === "user_message")
      .map((i) =>
        i.type === "user_message"
          ? (i.turnContext?.lastCheckpointId ?? null)
          : null,
      );

    // harness, alpha, cloud-resume, beta — each its own checkpoint, none disabled.
    expect(checkpointIds).toEqual([
      "cp-harness",
      "cp-alpha",
      "cp-cloudinit",
      "cp-beta",
    ]);
    expect(checkpointIds).not.toContain("cp-preflight");
  });

  // Regression (run A): after a handoff, promptId collides even within one local
  // session — Turn2's checkpoint and a post-restore turn's checkpoint both reuse
  // promptId 5. Captures are async and land LATE, so the marker's EVENT ts falls
  // inside the LATER turn's window; a ts-only fallback then binds Turn2's
  // checkpoint to the post-restore turn, leaving Turn2 with a disabled "no
  // checkpoint" icon (even though the checkpoint is restorable). Binding by the
  // marker's turnCompletedAt (the true turn boundary) keeps each on its own turn.
  it("binds colliding promptIds to the right turn via turnCompletedAt despite late capture ts", () => {
    const base = Date.parse("2026-07-08T06:12:00.000Z");
    const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    const result = buildConversationItems(
      [
        userPromptMsg(base + 1_000, 5, "beta"),
        promptResponseMsg(base + 1_500, 5),
        turnCompleteMsg(base + 2_000),
        userPromptMsg(base + 200_000, 5, "gamma"), // post-restore reuses promptId 5
        promptResponseMsg(base + 200_500, 5),
        turnCompleteMsg(base + 201_000),
        // Both markers arrive late (after gamma's prompt) and share promptId 5,
        // but each carries its own true turn boundary.
        gitCheckpointMsg(base + 250_000, "cp-beta", 5, iso(2_000)),
        gitCheckpointMsg(base + 260_000, "cp-gamma", 5, iso(201_000)),
      ],
      null,
    );

    const checkpointIds = result.items
      .filter((i) => i.type === "user_message")
      .map((i) =>
        i.type === "user_message"
          ? (i.turnContext?.lastCheckpointId ?? null)
          : null,
      );

    // beta keeps cp-beta (not stolen by the later gamma turn); gamma keeps cp-gamma.
    expect(checkpointIds).toEqual(["cp-beta", "cp-gamma"]);
  });

  it("extracts cloud prompt attachments into user messages", () => {
    const uri = makeAttachmentUri("/tmp/hello world.txt");

    const events: AcpMessage[] = [
      {
        type: "acp_message",
        ts: 1,
        message: {
          jsonrpc: "2.0",
          id: 1,
          method: "session/prompt",
          params: {
            prompt: [
              { type: "text", text: "read this file" },
              {
                type: "resource",
                resource: {
                  uri,
                  text: "watup",
                  mimeType: "text/plain",
                },
              },
            ],
          },
        },
      },
    ];

    const result = buildConversationItems(events, null);

    expect(result.items).toEqual([
      {
        type: "user_message",
        id: "turn-1-1-user",
        content: "read this file",
        timestamp: 1,
        attachments: [
          {
            id: uri,
            label: "hello world.txt",
          },
        ],
        turnContext: {
          toolCalls: new Map(),
          childItems: new Map(),
          turnCancelled: false,
          turnComplete: false,
          lastCheckpointId: null,
        },
      },
    ]);
  });

  it("clears the compacting spinner on a successful completion status, without duplicating the row", () => {
    // A successful compaction sends a terminal `status: compacting, isComplete:
    // true`. It must flip the existing status row, not append a second one.
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "hi"),
        statusMsg(2, "compacting"),
        statusMsg(3, "compacting", true),
      ],
      null,
    );

    const statusItems = result.items.filter(
      (i): i is Extract<ConversationItem, { type: "session_update" }> =>
        i.type === "session_update" && i.update.sessionUpdate === "status",
    );
    expect(statusItems).toHaveLength(1);
    expect((statusItems[0].update as { isComplete?: boolean }).isComplete).toBe(
      true,
    );
    expect(result.isCompacting).toBe(false);
  });

  it("renders a failed compaction as a compacting_failed status row and clears the spinner", () => {
    // A failed compaction emits no compact_boundary, so the agent sends a
    // structured `compacting_failed` status: it clears the spinner (the original
    // compacting row goes complete) and adds the outcome row with the error.
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "hi"),
        statusMsg(2, "compacting"),
        statusMsg(3, "compacting_failed", undefined, "Not enough messages."),
      ],
      null,
    );

    const statusItems = result.items.filter(
      (i): i is Extract<ConversationItem, { type: "session_update" }> =>
        i.type === "session_update" && i.update.sessionUpdate === "status",
    );
    // Spinner row (now complete) + the failure row.
    expect(statusItems.map((i) => i.update)).toEqual([
      { sessionUpdate: "status", status: "compacting", isComplete: true },
      {
        sessionUpdate: "status",
        status: "compacting_failed",
        error: "Not enough messages.",
      },
    ]);
    expect(result.isCompacting).toBe(false);
  });

  it("renders a terminal refusal as a status row carrying the explanation", () => {
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "hi"),
        refusalStatusMsg(2, "refusal", {
          explanation: "This request was declined.",
        }),
      ],
      null,
    );

    const statusItems = result.items.filter(
      (i): i is Extract<ConversationItem, { type: "session_update" }> =>
        i.type === "session_update" && i.update.sessionUpdate === "status",
    );
    expect(statusItems.map((i) => i.update)).toEqual([
      {
        sessionUpdate: "status",
        status: "refusal",
        explanation: "This request was declined.",
      },
    ]);
  });

  it("renders a refusal fallback status row carrying the model swap", () => {
    const result = buildConversationItems(
      [
        userPromptMsg(1, 1, "hi"),
        refusalStatusMsg(2, "refusal_fallback", {
          fromModel: "claude-fable-5",
          toModel: "claude-opus-4-8",
        }),
      ],
      null,
    );

    const statusItems = result.items.filter(
      (i): i is Extract<ConversationItem, { type: "session_update" }> =>
        i.type === "session_update" && i.update.sessionUpdate === "status",
    );
    expect(statusItems.map((i) => i.update)).toEqual([
      {
        sessionUpdate: "status",
        status: "refusal_fallback",
        fromModel: "claude-fable-5",
        toModel: "claude-opus-4-8",
      },
    ]);
  });

  it("marks cloud turns complete from structured turn completion notifications", () => {
    const result = buildConversationItems(
      [userPromptMsg(10, 42, "hello"), turnCompleteMsg(25)],
      null,
    );

    expect(result.lastTurnInfo).toEqual({
      isComplete: true,
      durationMs: 15,
      stopReason: "end_turn",
    });
  });

  it("keeps attachment-only prompts visible", () => {
    const uri = makeAttachmentUri("/tmp/test.txt");

    const events: AcpMessage[] = [
      {
        type: "acp_message",
        ts: 1,
        message: {
          jsonrpc: "2.0",
          id: 1,
          method: "session/prompt",
          params: {
            prompt: [
              {
                type: "resource",
                resource: {
                  uri,
                  text: "watup",
                  mimeType: "text/plain",
                },
              },
            ],
          },
        },
      },
    ];

    const result = buildConversationItems(events, null);

    expect(result.items).toEqual([
      {
        type: "user_message",
        id: "turn-1-1-user",
        content: "",
        timestamp: 1,
        attachments: [
          {
            id: uri,
            label: "test.txt",
          },
        ],
        turnContext: {
          toolCalls: new Map(),
          childItems: new Map(),
          turnCancelled: false,
          turnComplete: false,
          lastCheckpointId: null,
        },
      },
    ]);
  });

  it("extracts cloud resource_link attachments into user messages", () => {
    const fileUri = "file:///tmp/workspace/attachments/Receipt-2264-0277.pdf";

    const events: AcpMessage[] = [
      {
        type: "acp_message",
        ts: 1,
        message: {
          jsonrpc: "2.0",
          id: 1,
          method: "session/prompt",
          params: {
            prompt: [
              { type: "text", text: "what is this about?" },
              {
                type: "resource_link",
                uri: fileUri,
                name: "Receipt-2264-0277.pdf",
              },
            ],
          },
        },
      },
    ];

    const result = buildConversationItems(events, null);

    expect(result.items).toEqual([
      {
        type: "user_message",
        id: "turn-1-1-user",
        content: "what is this about?",
        timestamp: 1,
        attachments: [
          {
            id: fileUri,
            label: "Receipt-2264-0277.pdf",
          },
        ],
        turnContext: {
          toolCalls: new Map(),
          childItems: new Map(),
          turnCancelled: false,
          turnComplete: false,
          lastCheckpointId: null,
        },
      },
    ]);
  });

  describe("progress notifications", () => {
    it("aggregates progress events arriving before the first prompt into one progress_group item in arrival order", () => {
      const events: AcpMessage[] = [
        progressMsg(1, "sandbox", "in_progress", "Setting up sandbox"),
        progressMsg(2, "sandbox", "completed", "Set up sandbox"),
        progressMsg(3, "clone", "in_progress", "Cloning repository"),
        progressMsg(4, "clone", "completed", "Cloned repository"),
        progressMsg(5, "checkout", "in_progress", "Checking out branch main"),
      ];

      const result = buildConversationItems(events, null);

      const groups = findProgressGroups(result.items);
      expect(groups).toHaveLength(1);
      const update = groups[0];
      expect(update.steps.map((s) => [s.key, s.status, s.label])).toEqual([
        ["sandbox", "completed", "Set up sandbox"],
        ["clone", "completed", "Cloned repository"],
        ["checkout", "in_progress", "Checking out branch main"],
      ]);
      expect(update.isActive).toBe(true);
    });

    it("marks the progress group inactive once no step is in_progress", () => {
      const events: AcpMessage[] = [
        progressMsg(1, "sandbox", "completed", "Set up sandbox"),
        progressMsg(2, "clone", "completed", "Cloned repository"),
        progressMsg(3, "agent", "completed", "Started agent"),
      ];

      const result = buildConversationItems(events, null);
      const [group] = findProgressGroups(result.items);
      expect(group.isActive).toBe(false);
    });

    it("keeps the agent step in_progress until its run emits run_started", () => {
      const runStarted = (ts: number, runId: string): AcpMessage => ({
        type: "acp_message",
        ts,
        message: {
          jsonrpc: "2.0",
          method: "_posthog/run_started",
          params: { runId },
        },
      });
      const base: AcpMessage[] = [
        progressMsg(
          1,
          "sandbox",
          "completed",
          "Restored sandbox",
          undefined,
          "setup:run-9",
        ),
        progressMsg(
          2,
          "agent",
          "completed",
          "Started agent",
          undefined,
          "setup:run-9",
        ),
      ];

      const gated = findProgressGroups(
        buildConversationItems(base, null).items,
      )[0];
      expect(gated.steps.find((s) => s.key === "agent")?.status).toBe(
        "in_progress",
      );
      expect(gated.isActive).toBe(true);

      const ready = findProgressGroups(
        buildConversationItems([...base, runStarted(3, "run-9")], null).items,
      )[0];
      expect(ready.steps.find((s) => s.key === "agent")?.status).toBe(
        "completed",
      );
      expect(ready.isActive).toBe(false);
    });

    it("opens a separate progress_group per group id — distinct groups coexist inline", () => {
      const events: AcpMessage[] = [
        // Pre-prompt setup group.
        progressMsg(
          1,
          "sandbox",
          "in_progress",
          "Setting up sandbox",
          undefined,
          "setup",
        ),
        progressMsg(
          2,
          "sandbox",
          "completed",
          "Set up sandbox",
          undefined,
          "setup",
        ),
        // First user prompt + response.
        userPromptMsg(10, 1, "hi"),
        promptResponseMsg(20, 1),
        // A distinct group id — must open its own card, not join "setup".
        progressMsg(
          30,
          "push",
          "in_progress",
          "Creating pull request",
          undefined,
          "pr_create",
        ),
        progressMsg(
          40,
          "push",
          "completed",
          "Created pull request",
          undefined,
          "pr_create",
        ),
      ];

      const result = buildConversationItems(events, null);
      const groups = findProgressGroups(result.items);
      expect(groups).toHaveLength(2);

      expect(groups[0].steps.map((s) => s.key)).toEqual(["sandbox"]);
      expect(groups[0].isActive).toBe(false);

      expect(groups[1].steps.map((s) => [s.key, s.status, s.label])).toEqual([
        ["push", "completed", "Created pull request"],
      ]);
      expect(groups[1].isActive).toBe(false);
    });

    it("late completion events update the original group regardless of turn boundaries", () => {
      const events: AcpMessage[] = [
        // `sandbox` starts in the pre-prompt implicit turn.
        progressMsg(
          1,
          "sandbox",
          "in_progress",
          "Setting up sandbox",
          undefined,
          "setup",
        ),
        // User prompt + response come in before the completion lands.
        userPromptMsg(10, 1, "hi"),
        promptResponseMsg(20, 1),
        // The completion arrives late, after the turn boundary — it should
        // still update the existing "setup" card, not open a new one.
        progressMsg(
          30,
          "sandbox",
          "completed",
          "Set up sandbox",
          undefined,
          "setup",
        ),
      ];

      const result = buildConversationItems(events, null);
      const groups = findProgressGroups(result.items);
      expect(groups).toHaveLength(1);
      expect(groups[0].steps).toEqual([
        {
          key: "sandbox",
          status: "completed",
          label: "Set up sandbox",
          detail: undefined,
        },
      ]);
      expect(groups[0].isActive).toBe(false);
    });

    it("drops progress events missing a group id", () => {
      const events: AcpMessage[] = [
        {
          type: "acp_message",
          ts: 1,
          message: {
            jsonrpc: "2.0",
            method: "_posthog/progress",
            params: {
              step: "sandbox",
              status: "in_progress",
              label: "Setting up sandbox",
            },
          },
        },
      ];

      const result = buildConversationItems(events, null);
      expect(findProgressGroups(result.items)).toHaveLength(0);
    });

    it("replaces the step entry when a later event revisits the same key with a new label/status", () => {
      const events: AcpMessage[] = [
        progressMsg(1, "sandbox", "in_progress", "Setting up sandbox"),
        progressMsg(2, "sandbox", "failed", "Set up failed", "timeout"),
      ];

      const result = buildConversationItems(events, null);
      const [group] = findProgressGroups(result.items);
      expect(group.steps).toHaveLength(1);
      expect(group.steps[0]).toEqual({
        key: "sandbox",
        status: "failed",
        label: "Set up failed",
        detail: "timeout",
      });
    });

    it("hides debug-level console logs by default and renders them inline when showDebugLogs is true", () => {
      const events: AcpMessage[] = [
        progressMsg(1, "sandbox", "in_progress", "Setting up sandbox"),
        consoleMsg(2, "sandbox provisioned", "debug"),
      ];

      const hidden = buildConversationItems(events, null);
      expect(
        hidden.items.some(
          (i) =>
            i.type === "session_update" && i.update.sessionUpdate === "console",
        ),
      ).toBe(false);

      const shown = buildConversationItems(events, null, {
        showDebugLogs: true,
      });
      expect(
        shown.items.some(
          (i) =>
            i.type === "session_update" && i.update.sessionUpdate === "console",
        ),
      ).toBe(true);
    });

    it("emits no progress group for a conversation without progress notifications", () => {
      const events: AcpMessage[] = [userPromptMsg(1, 1, "hi")];

      const result = buildConversationItems(events, null);
      expect(findProgressGroups(result.items)).toHaveLength(0);
    });
  });

  describe("resources_used", () => {
    it("does not render an inline item (surfaced in the persistent bar)", () => {
      const events: AcpMessage[] = [
        userPromptMsg(1, 1, "list my experiments"),
        agentMessageMsg(2, "Here are your experiments."),
        resourcesUsedMsg(3, [{ id: "experiments", label: "Experiments" }]),
        promptResponseMsg(4, 1),
      ];

      const result = buildConversationItems(events, false);

      // The notification must not produce any conversation item — it's now
      // handled out-of-band by SessionResourcesBar / accumulateSessionResources.
      expect(
        result.items.some(
          (i) =>
            i.type === "session_update" &&
            // biome-ignore lint/suspicious/noExplicitAny: removed union member
            (i.update.sessionUpdate as any) === "resources_used",
        ),
      ).toBe(false);
    });
  });

  describe("completedToolCallCount", () => {
    const toolCallMsg = (
      ts: number,
      toolCallId: string,
      extra: Record<string, unknown> = {},
    ): AcpMessage => ({
      type: "acp_message",
      ts,
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            kind: "execute",
            status: "pending",
            title: toolCallId,
            ...extra,
          },
        },
      },
    });

    const toolUpdateMsg = (
      ts: number,
      toolCallId: string,
      extra: Record<string, unknown>,
    ): AcpMessage => ({
      type: "acp_message",
      ts,
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { sessionUpdate: "tool_call_update", toolCallId, ...extra },
        },
      },
    });

    it("starts at zero with no tool calls", () => {
      const result = buildConversationItems([userPromptMsg(1, 1, "hi")], null);
      expect(result.completedToolCallCount).toBe(0);
    });

    it("stays at zero while a tool call is still pending", () => {
      const events = [userPromptMsg(1, 1, "go"), toolCallMsg(2, "t1")];
      expect(buildConversationItems(events, true).completedToolCallCount).toBe(
        0,
      );
    });

    it.each(["completed", "failed", "cancelled"])(
      "counts a tool call once it settles to %s",
      (status) => {
        const events = [
          userPromptMsg(1, 1, "go"),
          toolCallMsg(2, "t1"),
          toolUpdateMsg(3, "t1", { status }),
        ];
        expect(
          buildConversationItems(events, true).completedToolCallCount,
        ).toBe(1);
      },
    );

    it("does not double-count repeated updates after settling", () => {
      const events = [
        userPromptMsg(1, 1, "go"),
        toolCallMsg(2, "t1"),
        toolUpdateMsg(3, "t1", { status: "completed" }),
        toolUpdateMsg(4, "t1", {
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "x" } }],
        }),
      ];
      expect(buildConversationItems(events, true).completedToolCallCount).toBe(
        1,
      );
    });

    it("accumulates across multiple completed tool calls and turns", () => {
      const events = [
        userPromptMsg(1, 1, "go"),
        toolCallMsg(2, "t1"),
        toolUpdateMsg(3, "t1", { status: "completed" }),
        toolCallMsg(4, "t2"),
        toolUpdateMsg(5, "t2", { status: "completed" }),
        promptResponseMsg(6, 1),
        userPromptMsg(7, 2, "again"),
        toolCallMsg(8, "t3"),
        toolUpdateMsg(9, "t3", { status: "completed" }),
      ];
      expect(buildConversationItems(events, true).completedToolCallCount).toBe(
        3,
      );
    });
  });

  describe("session_update timestamps", () => {
    const toolCallMsg = (ts: number, toolCallId: string): AcpMessage => ({
      type: "acp_message",
      ts,
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            kind: "execute",
            status: "pending",
            title: toolCallId,
          },
        },
      },
    });

    const firstSessionUpdate = (items: ConversationItem[]) =>
      items.find((i) => i.type === "session_update") as
        | Extract<ConversationItem, { type: "session_update" }>
        | undefined;

    it("stamps an agent message with the first chunk's ts and keeps it across merges", () => {
      const events = [
        userPromptMsg(1, 1, "hi"),
        agentMessageMsg(5, "Hello"),
        agentMessageMsg(9, " there"),
      ];
      const item = firstSessionUpdate(
        buildConversationItems(events, true).items,
      );
      expect(item?.update.sessionUpdate).toBe("agent_message_chunk");
      expect(item?.timestamp).toBe(5);
    });

    it("stamps a tool call with its ts", () => {
      const events = [userPromptMsg(1, 1, "go"), toolCallMsg(4, "t1")];
      const item = firstSessionUpdate(
        buildConversationItems(events, true).items,
      );
      expect(item?.update.sessionUpdate).toBe("tool_call");
      expect(item?.timestamp).toBe(4);
    });
  });
});

// Local alias kept intentionally narrow to the shape we care about in tests.
type RenderItemUnion = Extract<
  ConversationItem,
  { type: "session_update" }
>["update"];

type ProgressGroupUpdate = Extract<
  RenderItemUnion,
  { sessionUpdate: "progress_group" }
>;

function findProgressGroups(items: ConversationItem[]): ProgressGroupUpdate[] {
  const groups: ProgressGroupUpdate[] = [];
  for (const item of items) {
    if (
      item.type === "session_update" &&
      item.update.sessionUpdate === "progress_group"
    ) {
      groups.push(item.update);
    }
  }
  return groups;
}
