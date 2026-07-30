import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/di/container", () => ({
  resolveService: vi.fn(),
}));

import { resolveService } from "@posthog/di/container";
import type { Task } from "@posthog/shared/domain-types";
import { channelFeedQueryRoot } from "../canvas/hooks/useChannelFeed";
import { taskKeys } from "../tasks/taskKeys";
import { taskCreationEffects } from "./taskCreationEffectsImpl";

const deadTask = { id: "task-dead", title: "Rolled back" } as Task;
const otherTask = { id: "task-live", title: "Unrelated" } as Task;

describe("taskCreationEffects.onCreateRolledBack", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.mocked(resolveService).mockReturnValue(client);
  });

  it("removes the rolled-back task from list, feed, and detail caches", () => {
    client.setQueryData(taskKeys.list(), [deadTask, otherTask]);
    client.setQueryData(
      [...channelFeedQueryRoot, "channel-1"],
      [deadTask, otherTask],
    );
    client.setQueryData(taskKeys.detail(deadTask.id), deadTask);

    taskCreationEffects.onCreateRolledBack(deadTask);

    expect(client.getQueryData(taskKeys.list())).toEqual([otherTask]);
    expect(client.getQueryData([...channelFeedQueryRoot, "channel-1"])).toEqual(
      [otherTask],
    );
    expect(client.getQueryData(taskKeys.detail(deadTask.id))).toBeUndefined();
  });

  it("marks list and feed queries stale so the server copy settles", () => {
    client.setQueryData(taskKeys.list(), [deadTask]);
    client.setQueryData([...channelFeedQueryRoot, "channel-1"], [deadTask]);

    taskCreationEffects.onCreateRolledBack(deadTask);

    expect(client.getQueryState(taskKeys.list())?.isInvalidated).toBe(true);
    expect(
      client.getQueryState([...channelFeedQueryRoot, "channel-1"])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("leaves other tasks' detail caches alone", () => {
    client.setQueryData(taskKeys.detail(otherTask.id), otherTask);

    taskCreationEffects.onCreateRolledBack(deadTask);

    expect(client.getQueryData(taskKeys.detail(otherTask.id))).toBe(otherTask);
  });
});
