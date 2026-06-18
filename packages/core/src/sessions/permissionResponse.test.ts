import type { PermissionRequest } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  isOtherPermissionOption,
  planPermissionResponse,
} from "./permissionResponse";

function makePermission(
  options: Array<{
    optionId: string;
    kind?: string;
    _meta?: Record<string, unknown>;
  }>,
  toolCallKind?: string,
): PermissionRequest & { toolCallId: string } {
  return {
    taskRunId: "run-1",
    receivedAt: 0,
    toolCallId: "tool-1",
    toolCall: toolCallKind ? { kind: toolCallKind } : undefined,
    options,
  } as unknown as PermissionRequest & { toolCallId: string };
}

describe("isOtherPermissionOption", () => {
  it("recognizes both canonical other ids", () => {
    expect(isOtherPermissionOption("_other")).toBe(true);
    expect(isOtherPermissionOption("other")).toBe(true);
    expect(isOtherPermissionOption("allow")).toBe(false);
  });
});

describe("planPermissionResponse", () => {
  it("flags allow_always upgrade when option is allow_always and not a mode switch", () => {
    const permission = makePermission([
      { optionId: "allow", kind: "allow_always" },
    ]);
    const plan = planPermissionResponse(permission, "allow");
    expect(plan.applyAllowAlwaysUpgrade).toBe(true);
  });

  it("does not upgrade for allow_always when tool call is a mode switch", () => {
    const permission = makePermission(
      [{ optionId: "allow", kind: "allow_always" }],
      "switch_mode",
    );
    const plan = planPermissionResponse(permission, "allow");
    expect(plan.applyAllowAlwaysUpgrade).toBe(false);
  });

  it("responds with custom input for the other option", () => {
    const permission = makePermission([{ optionId: "_other" }]);
    const plan = planPermissionResponse(permission, "_other", "do this");
    expect(plan.respondWithCustomInput).toBe(true);
    expect(plan.resendPromptText).toBeNull();
  });

  it("responds with custom input when option meta opts in", () => {
    const permission = makePermission([
      { optionId: "feedback", _meta: { customInput: true } },
    ]);
    const plan = planPermissionResponse(permission, "feedback", "more detail");
    expect(plan.respondWithCustomInput).toBe(true);
    expect(plan.resendPromptText).toBeNull();
  });

  it("re-sends custom input as a prompt for a plain option", () => {
    const permission = makePermission([{ optionId: "allow" }]);
    const plan = planPermissionResponse(permission, "allow", "follow up");
    expect(plan.respondWithCustomInput).toBe(false);
    expect(plan.resendPromptText).toBe("follow up");
  });

  it("responds plainly with no custom input", () => {
    const permission = makePermission([{ optionId: "allow" }]);
    const plan = planPermissionResponse(permission, "allow");
    expect(plan.respondWithCustomInput).toBe(false);
    expect(plan.resendPromptText).toBeNull();
  });
});
