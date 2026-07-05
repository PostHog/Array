import { describe, expect, it } from "vitest";
import { saveResult, workflowConfig } from "../workflow/schemas";
import { EMPTY_HOME_SNAPSHOT, homeSnapshot } from "./schemas";

// Wire-contract validation: zod schemas reject malformed payloads and accept
// valid ones. Fixture shapes mirror the upstream service tests so the validated
// wire contract stays identical.

const BINDINGS = {
  working: [],
  in_review: [],
  ci_failing: [],
  changes_requested: [],
  comments_waiting: [],
  ready_to_merge: [],
  stale: [],
  done: [],
};

const VALID_SNAPSHOT = {
  activeAgents: [
    {
      taskId: "t1",
      title: "Fix bug",
      repoName: null,
      branch: null,
      status: "in_progress",
      lastActivityAt: 1,
      needsPermission: false,
      cloudPrUrl: null,
    },
  ],
  needsAttention: [],
  inProgress: [],
};

const VALID_CONFIG = {
  id: "wf_1",
  version: 2,
  updatedAt: "2026-01-01T00:00:00Z",
  bindings: BINDINGS,
};

describe("homeSnapshot schema", () => {
  it("parses a valid snapshot", () => {
    expect(homeSnapshot.safeParse(VALID_SNAPSHOT).success).toBe(true);
  });

  it("rejects a snapshot with an unknown extra key (strict)", () => {
    const withExtra = { ...VALID_SNAPSHOT, unknownKey: true };
    expect(homeSnapshot.safeParse(withExtra).success).toBe(false);
  });

  it("rejects a snapshot with a bad status enum on an active agent", () => {
    const withBadEnum = {
      ...VALID_SNAPSHOT,
      activeAgents: [
        { ...VALID_SNAPSHOT.activeAgents[0], status: "unknown_status" },
      ],
    };
    expect(homeSnapshot.safeParse(withBadEnum).success).toBe(false);
  });

  it("parses EMPTY_HOME_SNAPSHOT", () => {
    expect(homeSnapshot.safeParse(EMPTY_HOME_SNAPSHOT).success).toBe(true);
  });
});

describe("workflowConfig schema", () => {
  it("parses a valid config", () => {
    expect(workflowConfig.safeParse(VALID_CONFIG).success).toBe(true);
  });

  it("rejects a config missing required fields", () => {
    const { id: _id, ...withoutId } = VALID_CONFIG;
    expect(workflowConfig.safeParse(withoutId).success).toBe(false);
  });
});

describe("saveResult schema", () => {
  it("parses a saved result", () => {
    const result = { status: "saved", config: VALID_CONFIG };
    expect(saveResult.safeParse(result).success).toBe(true);
  });

  it("parses a conflict result without config", () => {
    const result = { status: "conflict" };
    expect(saveResult.safeParse(result).success).toBe(true);
  });

  it("parses a conflict result with config", () => {
    const result = { status: "conflict", config: VALID_CONFIG };
    expect(saveResult.safeParse(result).success).toBe(true);
  });

  it("parses an invalid result with diagnostics", () => {
    const diagnostics = [
      { severity: "error", code: "action_empty_prompt", message: "empty" },
    ];
    const result = { status: "invalid", diagnostics };
    expect(saveResult.safeParse(result).success).toBe(true);
  });

  it("rejects a result with an unknown status discriminant", () => {
    const result = { status: "unknown" };
    expect(saveResult.safeParse(result).success).toBe(false);
  });

  it("rejects a malformed saved result missing config", () => {
    const result = { status: "saved" };
    expect(saveResult.safeParse(result).success).toBe(false);
  });
});
