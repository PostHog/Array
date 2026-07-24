import { describe, expect, it } from "vitest";
import type { Task } from "@posthog/shared/domain-types";
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

  it("prefers the Home snapshot URL", () => {
    expect(
      taskPrUrl(
        task,
        new Map([
          ["task-1", { url: "https://github.com/o/r/pull/2" }],
        ]),
      ),
    ).toBe("https://github.com/o/r/pull/2");
  });

  it("falls back to the latest run URL", () => {
    expect(taskPrUrl(task, new Map())).toBe(
      "https://github.com/o/r/pull/1",
    );
  });
});
