import { describe, expect, it } from "vitest";
import { parseRunPlans } from "./runArtifactSchemas";

describe("parseRunPlans", () => {
  it.each([
    { name: "undefined", raw: undefined },
    { name: "null", raw: null },
    { name: "an object", raw: { artifacts: [] } },
    { name: "a string", raw: "plan" },
  ])("reads $name as no artifacts", ({ raw }) => {
    expect(parseRunPlans(raw)).toEqual([]);
  });

  it("keeps only plan artifacts", () => {
    const plans = parseRunPlans([
      { id: "a", type: "plan", name: "Plan A" },
      { id: "b", type: "upload", name: "internal blob" },
    ]);
    expect(plans).toEqual([{ id: "a", type: "plan", name: "Plan A" }]);
  });

  // One bad entry shouldn't take the Artifacts tab down with it.
  it("drops entries that don't match the shape", () => {
    const plans = parseRunPlans([
      { id: 42, type: "plan" },
      null,
      "not an object",
      { type: "plan", storage_path: "runs/1/plan.md" },
    ]);
    expect(plans).toEqual([{ type: "plan", storage_path: "runs/1/plan.md" }]);
  });

  it("ignores an artifact with no type", () => {
    expect(parseRunPlans([{ id: "a", name: "mystery" }])).toEqual([]);
  });
});
