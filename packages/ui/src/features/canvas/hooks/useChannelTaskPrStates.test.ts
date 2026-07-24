import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { prDetailsToState, taskPrUrl } from "./useChannelTaskPrStates";

describe("prDetailsToState", () => {
  it.each([
    [undefined, null],
    [{ state: "open", merged: false, draft: false }, "open"],
    [{ state: "open", merged: false, draft: true }, "draft"],
    [{ state: "closed", merged: false, draft: false }, "closed"],
    [{ state: "closed", merged: false, draft: true }, "closed"],
    [{ state: "closed", merged: true, draft: false }, "merged"],
  ] as const)("maps %o to %s", (details, expected) => {
    expect(prDetailsToState(details)).toBe(expected);
  });
});

describe("taskPrUrl", () => {
  const task = {
    id: "task-1",
    latest_run: { output: { pr_url: "https://github.com/o/r/pull/1" } },
  } as unknown as Task;

  it("reads the latest run URL", () => {
    expect(taskPrUrl(task)).toBe("https://github.com/o/r/pull/1");
  });
});
