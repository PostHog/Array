import type { LoopSchemas } from "@posthog/api-client/loops";
import { describe, expect, it } from "vitest";
import { updatedScheduleTriggers } from "./InlineLoopScheduleEditor";

function loopWithTriggers(
  triggers: LoopSchemas.LoopTrigger[],
): LoopSchemas.Loop {
  return { id: "loop-1", triggers } as LoopSchemas.Loop;
}

function trigger(
  id: string,
  type: LoopSchemas.LoopTriggerTypeEnum,
  config: LoopSchemas.LoopTriggerConfig,
): LoopSchemas.LoopTrigger {
  return { id, type, config, enabled: true } as LoopSchemas.LoopTrigger;
}

describe("updatedScheduleTriggers", () => {
  it("updates the existing schedule without dropping other triggers", () => {
    const github = trigger("github-1", "github", {
      github_integration_id: 1,
      repository: "posthog/posthog",
      events: ["push"],
    });
    const schedule = trigger("schedule-1", "schedule", {
      cron_expression: "0 9 * * *",
      timezone: "UTC",
    });

    expect(
      updatedScheduleTriggers(
        loopWithTriggers([github, schedule]),
        { cron_expression: "0 14 * * *", timezone: "America/Toronto" },
        false,
      ),
    ).toEqual([
      { id: "github-1", type: "github", enabled: true, config: github.config },
      {
        id: "schedule-1",
        type: "schedule",
        enabled: false,
        config: {
          cron_expression: "0 14 * * *",
          timezone: "America/Toronto",
        },
      },
    ]);
  });

  it("adds a schedule while preserving existing triggers", () => {
    const api = trigger("api-1", "api", {});

    expect(
      updatedScheduleTriggers(
        loopWithTriggers([api]),
        { cron_expression: "0 * * * *", timezone: "UTC" },
        true,
      ),
    ).toEqual([
      { id: "api-1", type: "api", enabled: true, config: {} },
      {
        type: "schedule",
        enabled: true,
        config: { cron_expression: "0 * * * *", timezone: "UTC" },
      },
    ]);
  });
});
