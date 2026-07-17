import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { findWorkflowBuilt } from "./useCanvasGenerationToasts";

function acp(message: AcpMessage["message"]): AcpMessage {
  return { type: "acp_message", ts: 1, message };
}

describe("findWorkflowBuilt", () => {
  const builtNotification = acp({
    jsonrpc: "2.0",
    method: "_posthog/workflow_built",
    params: {
      sessionId: "s1",
      dashboardId: "dash-1",
      workflowId: "wf-1",
      workflowStatus: "draft",
      workflowName: "Welcome email after signup",
    },
  });

  it("finds the workflow link in a session's event stream", () => {
    const events: AcpMessage[] = [
      acp({ jsonrpc: "2.0", method: "session/update", params: {} }),
      builtNotification,
    ];
    expect(findWorkflowBuilt(events)).toEqual({
      dashboardId: "dash-1",
      workflowId: "wf-1",
      workflowStatus: "draft",
      workflowName: "Welcome email after signup",
      workflowType: undefined,
    });
  });

  it("matches the underscore-prefixed replay variant too", () => {
    // Stored-log replay can surface ext notifications with a leading
    // underscore on the method; isNotification matches both.
    const events: AcpMessage[] = [
      acp({
        jsonrpc: "2.0",
        method: "__posthog/workflow_built",
        params: { dashboardId: "dash-2", workflowId: "wf-2" },
      }),
    ];
    expect(findWorkflowBuilt(events)?.dashboardId).toBe("dash-2");
  });

  it("ignores requests, responses, and other notifications", () => {
    const events: AcpMessage[] = [
      // A request (has an id) with the right method must not match.
      acp({
        jsonrpc: "2.0",
        id: 1,
        method: "_posthog/workflow_built",
        params: { dashboardId: "d", workflowId: "w" },
      }),
      acp({ jsonrpc: "2.0", method: "_posthog/resources_used", params: {} }),
    ];
    expect(findWorkflowBuilt(events)).toBeNull();
  });

  it("skips a malformed payload rather than returning a partial link", () => {
    const events: AcpMessage[] = [
      acp({
        jsonrpc: "2.0",
        method: "_posthog/workflow_built",
        params: { workflowId: "wf-only" },
      }),
    ];
    expect(findWorkflowBuilt(events)).toBeNull();
  });

  it("returns null for empty or missing events", () => {
    expect(findWorkflowBuilt(undefined)).toBeNull();
    expect(findWorkflowBuilt([])).toBeNull();
  });
});
