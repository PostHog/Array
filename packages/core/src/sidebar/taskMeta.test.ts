import { describe, expect, it } from "vitest";
import { parseTimestamps } from "./taskMeta";

describe("parseTimestamps", () => {
  it("parses ISO strings to epoch ms and passes the label through", () => {
    const result = parseTimestamps({
      t1: {
        pinnedAt: null,
        lastViewedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-02T00:00:00.000Z",
        label: "high-priority",
      },
    });

    expect(result.t1).toEqual({
      lastViewedAt: new Date("2026-01-01T00:00:00.000Z").getTime(),
      lastActivityAt: new Date("2026-01-02T00:00:00.000Z").getTime(),
      label: "high-priority",
    });
  });

  it("keeps a null label for an unlabeled task", () => {
    const result = parseTimestamps({
      t1: {
        pinnedAt: null,
        lastViewedAt: null,
        lastActivityAt: null,
        label: null,
      },
    });

    expect(result.t1).toEqual({
      lastViewedAt: null,
      lastActivityAt: null,
      label: null,
    });
  });
});
