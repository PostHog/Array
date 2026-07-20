import {
  activeNotificationTarget,
  type ThreadPanelSnapshot,
} from "@posthog/ui/features/notifications/activeTarget";
import { describe, expect, it } from "vitest";

const noThread: ThreadPanelSnapshot = { openByChannel: {}, collapsed: false };

describe("activeNotificationTarget", () => {
  it("targets the task on a task route", () => {
    expect(
      activeNotificationTarget({
        routeId: "/code/tasks/$taskId",
        params: { taskId: "t1" },
        threadPanel: noThread,
      }),
    ).toEqual({ kind: "task", taskId: "t1" });
  });

  it("targets the canvas on a dashboard route", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/$channelId/dashboards/$dashboardId",
        params: { channelId: "c1", dashboardId: "d1" },
        threadPanel: noThread,
      }),
    ).toEqual({ kind: "canvas", channelId: "c1", dashboardId: "d1" });
  });

  it("targets the task whose thread is open beside the channel feed", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/$channelId",
        params: { channelId: "c1" },
        threadPanel: { openByChannel: { c1: "t9" }, collapsed: false },
      }),
    ).toEqual({ kind: "task", taskId: "t9" });
  });

  it("targets the task whose thread is open beside the Activity list", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/activity",
        params: {},
        threadPanel: { openByChannel: { activity: "t9" }, collapsed: false },
      }),
    ).toEqual({ kind: "task", taskId: "t9" });
  });

  it("ignores a thread open on another channel's surface", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/$channelId",
        params: { channelId: "c1" },
        threadPanel: { openByChannel: { c2: "t9" }, collapsed: false },
      }),
    ).toBeUndefined();
  });

  it("is nothing when the panel is collapsed — a rail shows no conversation", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/activity",
        params: {},
        threadPanel: { openByChannel: { activity: "t9" }, collapsed: true },
      }),
    ).toBeUndefined();
  });

  it("is nothing on a feed with no thread open", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/$channelId",
        params: { channelId: "c1" },
        threadPanel: noThread,
      }),
    ).toBeUndefined();
  });

  it("is nothing on an unrelated route, thread or not", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/skills",
        params: {},
        threadPanel: { openByChannel: { activity: "t9" }, collapsed: false },
      }),
    ).toBeUndefined();
    expect(
      activeNotificationTarget({
        routeId: undefined,
        params: {},
        threadPanel: noThread,
      }),
    ).toBeUndefined();
  });

  it("treats a closed thread (null) as nothing open", () => {
    expect(
      activeNotificationTarget({
        routeId: "/website/activity",
        params: {},
        threadPanel: { openByChannel: { activity: null }, collapsed: false },
      }),
    ).toBeUndefined();
  });
});
