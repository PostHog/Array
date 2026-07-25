import type { Task, UserBasic } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  buildChannelItems,
  type ChannelItemModel,
  filterChannelItems,
  isOwnedBy,
} from "./channelItems";
import type { DashboardSummary } from "./dashboardSchemas";

const ME: UserBasic = {
  id: 1,
  uuid: "me-uuid",
  distinct_id: "me",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@posthog.com",
};

const OTHER: UserBasic = {
  id: 2,
  uuid: "other-uuid",
  distinct_id: "other",
  first_name: "Grace",
  last_name: "Hopper",
  email: "grace@posthog.com",
};

function canvas(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    id: "d1",
    channelId: "c1",
    name: "Canvas",
    templateId: "freeform",
    createdAt: 0,
    updatedAt: 1_000,
    ...over,
  } as DashboardSummary;
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    updated_at: new Date(2_000).toISOString(),
    created_by: ME,
    ...over,
  } as Task;
}

const NONE: ReadonlySet<string> = new Set();

describe("buildChannelItems", () => {
  it("merges canvases and tasks newest-first", () => {
    const items = buildChannelItems({
      dashboards: [canvas({ id: "old", updatedAt: 1_000 })],
      feedTasks: [
        task({ id: "new", updated_at: new Date(5_000).toISOString() }),
      ],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: null,
    });
    expect(items.map((i) => i.key)).toEqual(["task:new", "canvas:old"]);
  });

  it("drops archived tasks but keeps canvases", () => {
    const items = buildChannelItems({
      dashboards: [canvas()],
      feedTasks: [task({ id: "gone" })],
      archivedTaskIds: new Set(["gone"]),
      pinnedTaskIds: NONE,
      ownedBy: null,
    });
    expect(items.map((i) => i.kind)).toEqual(["canvas"]);
  });

  it("marks pinned state from each source's own signal", () => {
    const items = buildChannelItems({
      dashboards: [canvas({ id: "pinned-canvas", pinnedAt: 42 })],
      feedTasks: [task({ id: "pinned-task" })],
      archivedTaskIds: NONE,
      pinnedTaskIds: new Set(["pinned-task"]),
      ownedBy: null,
    });
    expect(items.every((i) => i.pinned)).toBe(true);
  });

  it("falls back to a placeholder title for untitled tasks", () => {
    const [item] = buildChannelItems({
      dashboards: [],
      feedTasks: [task({ title: "" })],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: null,
    });
    expect(item.title).toBe("Untitled task");
  });

  it("treats an unparseable updated_at as epoch rather than NaN", () => {
    const [item] = buildChannelItems({
      dashboards: [],
      feedTasks: [task({ updated_at: "not a date" })],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: null,
    });
    expect(item.ts).toBe(0);
  });

  it("returns everything when the owner is unknown", () => {
    const items = buildChannelItems({
      dashboards: [canvas({ createdBy: "Grace Hopper" })],
      feedTasks: [task({ created_by: OTHER })],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: null,
    });
    expect(items).toHaveLength(2);
  });

  it("filters to the owner for the personal channel", () => {
    const items = buildChannelItems({
      dashboards: [
        canvas({ id: "mine", createdBy: "Ada Lovelace" }),
        canvas({ id: "theirs", createdBy: "Grace Hopper" }),
      ],
      feedTasks: [
        task({ id: "mine-task", created_by: ME }),
        task({ id: "their-task", created_by: OTHER }),
      ],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: { uuid: ME.uuid, name: "Ada Lovelace" },
    });
    expect(items.map((i) => i.id).sort()).toEqual(["mine", "mine-task"]);
  });

  it("keeps items whose author is unknown", () => {
    const items = buildChannelItems({
      dashboards: [canvas({ id: "orphan", createdBy: undefined })],
      feedTasks: [task({ id: "orphan-task", created_by: null })],
      archivedTaskIds: NONE,
      pinnedTaskIds: NONE,
      ownedBy: { uuid: ME.uuid, name: "Ada Lovelace" },
    });
    expect(items).toHaveLength(2);
  });
});

describe("isOwnedBy", () => {
  it("prefers uuid over display name when a full user is present", () => {
    const item = { authorUser: OTHER, authorName: "Ada Lovelace" };
    expect(isOwnedBy(item, { uuid: ME.uuid, name: "Ada Lovelace" })).toBe(
      false,
    );
  });

  it("cannot match a name-only author when our own name is unknown", () => {
    const item = { authorUser: null, authorName: "Grace Hopper" };
    expect(isOwnedBy(item, { uuid: ME.uuid, name: null })).toBe(true);
  });
});

function model(over: Partial<ChannelItemModel> = {}): ChannelItemModel {
  return {
    key: "task:t1",
    kind: "task",
    id: "t1",
    title: "Ship the thing",
    ts: 0,
    pinned: false,
    rawStatus: null,
    authorUser: ME,
    authorName: null,
    templateId: null,
    ...over,
  };
}

describe("filterChannelItems", () => {
  const me = { uuid: ME.uuid, name: "Ada Lovelace" };

  it("matches titles case-insensitively", () => {
    const items = [model({ title: "Ship IT" }), model({ title: "Other" })];
    const result = filterChannelItems(items, {
      query: "  ship ",
      createdBy: "anyone",
      status: null,
      me,
    });
    expect(result.map((i) => i.title)).toEqual(["Ship IT"]);
  });

  it.each([
    ["me", ["mine"]],
    ["others", ["theirs"]],
    ["anyone", ["mine", "theirs"]],
  ] as const)("filters createdBy=%s", (createdBy, expected) => {
    const items = [
      model({ id: "mine", authorUser: ME }),
      model({ id: "theirs", authorUser: OTHER }),
    ];
    const result = filterChannelItems(items, {
      query: "",
      createdBy,
      status: null,
      me,
    });
    expect(result.map((i) => i.id)).toEqual(expected);
  });

  it("filters by run status, including not_started", () => {
    const items = [
      model({ id: "fresh", rawStatus: "not_started" }),
      model({ id: "done", rawStatus: "completed" }),
    ];
    const result = filterChannelItems(items, {
      query: "",
      createdBy: "anyone",
      status: "not_started",
      me,
    });
    expect(result.map((i) => i.id)).toEqual(["fresh"]);
  });

  it("excludes canvases when a run status is selected", () => {
    const items = [model({ kind: "canvas", rawStatus: null })];
    const result = filterChannelItems(items, {
      query: "",
      createdBy: "anyone",
      status: "completed",
      me,
    });
    expect(result).toEqual([]);
  });
});
