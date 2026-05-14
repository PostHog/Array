import { describe, expect, it } from "vitest";
import { getAutomationStatusPresentation } from "./automationStatus";

describe("automationStatus", () => {
  it("shows queued when the linked task run has not started work yet", () => {
    expect(
      getAutomationStatusPresentation({
        lastRunStatus: "running",
        lastTaskRunStatus: "queued",
      }),
    ).toMatchObject({
      label: "Queued",
    });
  });

  it("shows running only when the linked task run is actively in progress", () => {
    expect(
      getAutomationStatusPresentation({
        lastRunStatus: "running",
        lastTaskRunStatus: "in_progress",
      }),
    ).toMatchObject({
      label: "Running",
    });
  });

  it("falls back to automation status when task-run detail is unavailable", () => {
    expect(
      getAutomationStatusPresentation({
        lastRunStatus: "success",
      }),
    ).toMatchObject({
      label: "Success",
    });
  });
});
