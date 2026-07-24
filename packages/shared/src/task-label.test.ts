import { describe, expect, it } from "vitest";
import {
  TASK_LABEL_META,
  TASK_LABELS,
  type TaskLabel,
  taskLabelRank,
  taskLabelSchema,
} from "./task-label";

describe("taskLabelSchema", () => {
  it.each(TASK_LABELS)("accepts %s", (label) => {
    expect(taskLabelSchema.parse(label)).toBe(label);
  });

  it("rejects values outside the fixed set", () => {
    expect(taskLabelSchema.safeParse("urgent").success).toBe(false);
    expect(taskLabelSchema.safeParse("").success).toBe(false);
  });
});

describe("TASK_LABEL_META", () => {
  it("covers every label with a display name and accent", () => {
    for (const label of TASK_LABELS) {
      expect(TASK_LABEL_META[label].displayName).toBeTruthy();
      expect(TASK_LABEL_META[label].accent).toMatch(/^var\(--/);
    }
  });
});

describe("taskLabelRank", () => {
  it("orders high-priority and active above unlabeled, deprioritized and done below", () => {
    const order: (TaskLabel | null)[] = [
      "high-priority",
      "active",
      null,
      "deprioritized",
      "done",
    ];
    const ranks = order.map(taskLabelRank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
