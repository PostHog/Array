import { describe, expect, it } from "vitest";
import { isTaskDetailNotFoundError } from "./queries";

describe("task queries", () => {
  it("detects task detail 404 errors from the shared API fetcher", () => {
    expect(
      isTaskDetailNotFoundError(
        new Error('Failed request: [404] {"detail":"Not found."}'),
      ),
    ).toBe(true);
    expect(
      isTaskDetailNotFoundError(
        new Error('Failed request: [500] {"detail":"Server error."}'),
      ),
    ).toBe(false);
    expect(isTaskDetailNotFoundError("Failed request: [404]")).toBe(false);
  });
});
