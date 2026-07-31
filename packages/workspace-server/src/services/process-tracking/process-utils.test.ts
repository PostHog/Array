import { describe, expect, it } from "vitest";
import { findProcessTree } from "./process-utils";

describe("findProcessTree", () => {
  it("returns descendants deepest-first across nested process groups", () => {
    const result = findProcessTree(10, [
      { pid: 1, ppid: 0, pgid: 1 },
      { pid: 10, ppid: 1, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
      { pid: 12, ppid: 11, pgid: 12 },
      { pid: 13, ppid: 12, pgid: 12 },
      { pid: 20, ppid: 1, pgid: 20 },
    ]);

    expect(result).toEqual([
      { pid: 13, ppid: 12, pgid: 12 },
      { pid: 12, ppid: 11, pgid: 12 },
      { pid: 11, ppid: 10, pgid: 10 },
      { pid: 10, ppid: 1, pgid: 10 },
    ]);
  });

  it("returns no unrelated processes when the root has exited", () => {
    expect(findProcessTree(10, [{ pid: 20, ppid: 1, pgid: 20 }])).toEqual([]);
  });
});
