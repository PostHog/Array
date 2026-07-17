import type { LoopSchemas } from "@posthog/api-client/loops";

export function loopStatusColor(
  loop: LoopSchemas.Loop,
): "gray" | "green" | "red" {
  if (!loop.enabled) return "gray";
  if (loop.last_run_status === "failed") return "red";
  return "green";
}

export function loopStatusLabel(loop: LoopSchemas.Loop): string {
  if (!loop.enabled) return "Paused";
  if (loop.last_run_status === "failed") return "Failing";
  return "Active";
}

interface TriggerLike {
  type: LoopSchemas.LoopTriggerTypeEnum;
  config: LoopSchemas.LoopTriggerConfig;
}

/** Compact one-word-ish label for the form's review list. */
export function summarizeTrigger(trigger: TriggerLike): string {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
    if (config.run_at) return "Once";
    return `Schedule (${config.cron_expression ?? "cron"})`;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    return `GitHub (${config.repository || "a repo"})`;
  }
  return "API";
}

/** Full description for the detail view's configuration summary. */
export function describeTrigger(trigger: TriggerLike): string {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
    if (config.run_at)
      return `One-time · ${new Date(config.run_at).toLocaleString()}`;
    return `Schedule · ${config.cron_expression ?? "?"} (${config.timezone ?? "UTC"})`;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    return `GitHub · ${config.repository || "?"} · ${config.events.join(", ") || "no events"}`;
  }
  return "API · authenticated POST";
}
