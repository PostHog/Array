import type { AcpMessage } from "@shared/types/session-events";
import { makeAttachmentUri } from "@utils/promptContent";
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

describe("buildConversationItems", () => {
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
