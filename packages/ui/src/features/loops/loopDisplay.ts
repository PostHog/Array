import type { LoopSchemas } from "@posthog/api-client/loops";
import { formatClockTime } from "@posthog/shared";
import { parseCronSchedule } from "./loopCron";

const WEEKDAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
};

function describeSchedule(
  config: LoopSchemas.LoopScheduleTriggerConfig,
): string {
  const cron = config.cron_expression;
  const parsed = parseCronSchedule(cron);
  const timezone = config.timezone ?? "UTC";
  if (!parsed) return `${cron ?? "?"} (${timezone})`;
  if (parsed.frequency === "hourly") return `Every hour (${timezone})`;

  const time = formatClockTime(parsed.time);
  if (parsed.frequency === "daily") return `Daily at ${time} (${timezone})`;
  if (parsed.frequency === "weekdays")
    return `Weekdays at ${time} (${timezone})`;
  return `${WEEKDAY_NAMES[parsed.weekday]}s at ${time} (${timezone})`;
}

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

export function summarizeNotificationDestinations(
  notifications: LoopSchemas.LoopNotifications,
): string[] {
  const destinations: string[] = [];

  if (notifications.push.enabled) destinations.push("Push");
  if (notifications.email.enabled) destinations.push("Email");
  if (notifications.slack.enabled) {
    const channelName = notifications.slack.params.channel_name;
    destinations.push(
      typeof channelName === "string" && channelName.length > 0
        ? `Slack · #${channelName.replace(/^#/, "")}`
        : "Slack",
    );
  }

  return destinations;
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
    return `Schedule · ${describeSchedule(config)}`;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    return `GitHub · ${config.repository || "?"} · ${config.events.join(", ") || "no events"}`;
  }
  return "API · authenticated POST";
}
