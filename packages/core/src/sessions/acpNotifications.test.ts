import { describe, expect, it } from "vitest";
import { parseWorkflowBuiltParams } from "./acpNotifications";

describe("parseWorkflowBuiltParams", () => {
  it("parses a full payload", () => {
    expect(
      parseWorkflowBuiltParams({
        sessionId: "s1",
        dashboardId: "d1",
        workflowId: "wf1",
        workflowStatus: "draft",
        workflowName: "Welcome sequence",
        workflowType: "alert",
      }),
    ).toEqual({
      dashboardId: "d1",
      workflowId: "wf1",
      workflowStatus: "draft",
      workflowName: "Welcome sequence",
      workflowType: "alert",
    });
  });

  it("keeps optional fields undefined when absent or wrong-typed", () => {
    expect(
      parseWorkflowBuiltParams({
        dashboardId: "d1",
        workflowId: "wf1",
        workflowStatus: 42,
      }),
    ).toEqual({
      dashboardId: "d1",
      workflowId: "wf1",
      workflowStatus: undefined,
      workflowName: undefined,
      workflowType: undefined,
    });
  });

  it("returns null without the required ids", () => {
    expect(parseWorkflowBuiltParams({ workflowId: "wf1" })).toBeNull();
    expect(parseWorkflowBuiltParams({ dashboardId: "d1" })).toBeNull();
    expect(parseWorkflowBuiltParams(undefined)).toBeNull();
    expect(parseWorkflowBuiltParams(null)).toBeNull();
    expect(parseWorkflowBuiltParams("nope")).toBeNull();
  });
});
