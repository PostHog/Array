import type { Task } from "@posthog/shared/domain-types";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeRetainedTasks,
  releaseRetainedTask,
  retainTask,
} from "./retainedTasks";

const task = { id: "forked-task", title: "Forked task" } as Task;

describe("retainedTasks", () => {
  afterEach(() => releaseRetainedTask(task.id));

  it("keeps a fork visible while the server list is stale", () => {
    retainTask(task);

    expect(mergeRetainedTasks([])).toEqual([task]);
  });

  it("reconciles to the server task once it appears", () => {
    const serverTask = { ...task, title: "Server title" };
    retainTask(task);

    expect(mergeRetainedTasks([serverTask])).toEqual([serverTask]);
    expect(mergeRetainedTasks([])).toEqual([]);
  });

  it("drops a retained task after rollback", () => {
    retainTask(task);
    releaseRetainedTask(task.id);

    expect(mergeRetainedTasks([])).toEqual([]);
  });
});
