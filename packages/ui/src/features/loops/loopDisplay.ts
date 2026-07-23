import type { LoopSchemas } from "@posthog/api-client/loops";
import { formatClockTime } from "@posthog/shared";
import { nextRecurringRun } from "@posthog/ui/primitives/nextRecurringRun";
import {
  formatTimezoneAbbreviation,
  systemTimezone,
} from "@posthog/ui/primitives/timezone";
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
  const timezoneLabel = formatTimezoneAbbreviation(timezone);
  if (!parsed) return `${cron ?? "?"} (${timezoneLabel})`;
  if (parsed.frequency === "hourly") return `Every hour (${timezoneLabel})`;

  const time = formatClockTime(parsed.time);
  if (parsed.frequency === "daily")
    return `Daily at ${time} (${timezoneLabel})`;
  if (parsed.frequency === "weekdays")
    return `Weekdays at ${time} (${timezoneLabel})`;
  return `${WEEKDAY_NAMES[parsed.weekday]}s at ${time} (${timezoneLabel})`;
}

export function nextScheduleRun(
  config: LoopSchemas.LoopScheduleTriggerConfig,
  now = new Date(),
): Date | null {
  if (config.run_at) {
    const runAt = new Date(config.run_at);
    return runAt > now ? runAt : null;
  }

  const schedule = parseCronSchedule(config.cron_expression);
  if (!schedule) return null;
  return nextRecurringRun(schedule, config.timezone ?? "UTC", now);
}

function describeNextRun(
  config: LoopSchemas.LoopScheduleTriggerConfig,
): string {
  const nextRun = nextScheduleRun(config);
  if (!nextRun) return "";
  const timezone =
    config.timezone ?? (config.run_at ? systemTimezone() : "UTC");
  const formatted = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(nextRun);
  return ` · Next run ${formatted}`;
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

/** Readable label for the form's review list. */
export function summarizeTrigger(trigger: TriggerLike): string {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
    if (config.run_at)
      return `Once · ${new Date(config.run_at).toLocaleString()}`;
    return `${describeSchedule(config)}${describeNextRun(config)}`;
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
      return `One-time · ${new Date(config.run_at).toLocaleString()}${describeNextRun(config)}`;
    return `Schedule · ${describeSchedule(config)}${describeNextRun(config)}`;
  }
  if (trigger.type === "github") {
    const config = trigger.config as LoopSchemas.LoopGithubTriggerConfig;
    return `GitHub · ${config.repository || "?"} · ${config.events.join(", ") || "no events"}`;
  }
  return "API · authenticated POST";
}
