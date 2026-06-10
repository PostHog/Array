import type { HomeWorkstream } from "@posthog/core/home/schemas";
import type { SituationId } from "@posthog/core/workflow/schemas";
import { describe, expect, it } from "vitest";
import { buildBoardColumns, columnForWorkstream } from "./boardColumns";

function makeWs(overrides: Partial<HomeWorkstream> = {}): HomeWorkstream {
  return {
    id: "ws_1",
    repoName: null,
    repoFullPath: null,
    branch: null,
    prUrl: null,
    pr: null,
    tasks: [],
    situations: [],
    primarySituation: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

const ACTIVE_COLUMNS: SituationId[] = [
  "working",
  "in_review",
  "ci_failing",
  "changes_requested",
  "comments_waiting",
  "ready_to_merge",
];

describe("columnForWorkstream", () => {
  it("returns null when there is no primary situation", () => {
    expect(columnForWorkstream(makeWs({ primarySituation: null }))).toBeNull();
  });

  it("pushes done off the active board", () => {
    expect(
      columnForWorkstream(makeWs({ primarySituation: "done" })),
    ).toBeNull();
  });

  it("buckets a stale workstream into working", () => {
    expect(columnForWorkstream(makeWs({ primarySituation: "stale" }))).toBe(
      "working",
    );
  });

  it("maps each active situation to its own column", () => {
    for (const id of ACTIVE_COLUMNS) {
      expect(columnForWorkstream(makeWs({ primarySituation: id }))).toBe(id);
    }
  });
});

describe("buildBoardColumns", () => {
  it("returns the six active columns in order with empty inputs", () => {
    const columns = buildBoardColumns([], []);
    expect(columns.map((c) => c.id)).toEqual(ACTIVE_COLUMNS);
    expect(columns.every((c) => c.workstreams.length === 0)).toBe(true);
  });

  it("omits stale and done from the columns", () => {
    const ids = buildBoardColumns([], []).map((c) => c.id);
    expect(ids).not.toContain("stale");
    expect(ids).not.toContain("done");
  });

  it("uses titles and descriptions from situation metadata", () => {
    const columns = buildBoardColumns([], []);
    const working = columns.find((c) => c.id === "working");
    expect(working?.title).toBe("Working");
    expect(working?.description).toBe("Branch with changes, no PR yet");
  });

  it("drops workstreams with a done or null primary situation", () => {
    const columns = buildBoardColumns(
      [makeWs({ id: "done-ws", primarySituation: "done" })],
      [makeWs({ id: "null-ws", primarySituation: null })],
    );
    expect(columns.every((c) => c.workstreams.length === 0)).toBe(true);
  });

  it("places a stale workstream in the working column", () => {
    const columns = buildBoardColumns(
      [],
      [makeWs({ id: "stale-ws", primarySituation: "stale" })],
    );
    const working = columns.find((c) => c.id === "working");
    expect(working?.workstreams.map((w) => w.id)).toEqual(["stale-ws"]);
  });

  it("sorts each column by lastActivityAt descending", () => {
    const columns = buildBoardColumns(
      [],
      [
        makeWs({ id: "old", primarySituation: "working", lastActivityAt: 100 }),
        makeWs({ id: "new", primarySituation: "working", lastActivityAt: 300 }),
        makeWs({ id: "mid", primarySituation: "working", lastActivityAt: 200 }),
      ],
    );
    const working = columns.find((c) => c.id === "working");
    expect(working?.workstreams.map((w) => w.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("keeps needsAttention ahead of inProgress when activity ties (stable sort)", () => {
    const columns = buildBoardColumns(
      [
        makeWs({
          id: "attn",
          primarySituation: "ci_failing",
          lastActivityAt: 5,
        }),
      ],
      [
        makeWs({
          id: "prog",
          primarySituation: "ci_failing",
          lastActivityAt: 5,
        }),
      ],
    );
    const ciFailing = columns.find((c) => c.id === "ci_failing");
    expect(ciFailing?.workstreams.map((w) => w.id)).toEqual(["attn", "prog"]);
  });

  it("routes workstreams from both lists into their columns", () => {
    const columns = buildBoardColumns(
      [makeWs({ id: "a", primarySituation: "changes_requested" })],
      [makeWs({ id: "b", primarySituation: "ready_to_merge" })],
    );
    const byId = Object.fromEntries(columns.map((c) => [c.id, c.workstreams]));
    expect(byId.changes_requested.map((w) => w.id)).toEqual(["a"]);
    expect(byId.ready_to_merge.map((w) => w.id)).toEqual(["b"]);
  });
});
