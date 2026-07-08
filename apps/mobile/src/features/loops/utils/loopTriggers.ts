import {
  type AutomationScheduleDraft,
  buildCronExpression,
  createDefaultScheduleDraft,
  formatScheduleSummary,
  parseCronExpression,
} from "@/features/tasks/utils/automationSchedule";
import type {
  LoopGithubTriggerConfig,
  LoopGithubTriggerEvent,
  LoopScheduleTriggerConfig,
  LoopTrigger,
  LoopTriggerType,
  LoopTriggerWrite,
} from "../types";

export type LoopScheduleMode = "recurring" | "once";

export interface LoopTriggerDraft {
  /** Stable React key: the trigger's server id when editing, a generated
   *  client-side id for a not-yet-saved draft. Never sent to the API. */
  draftId: string;
  id?: string;
  type: LoopTriggerType;
  enabled: boolean;
  scheduleMode: LoopScheduleMode;
  scheduleDraft: AutomationScheduleDraft;
  timezone: string;
  runAt: string;
  githubIntegrationId: number | null;
  githubRepository: string | null;
  githubEvents: LoopGithubTriggerEvent[];
  githubFilterActions: string;
  githubFilterBranches: string;
  githubFilterLabels: string;
}

let draftCounter = 0;
function nextDraftId(): string {
  draftCounter += 1;
  return `new-trigger-${Date.now()}-${draftCounter}`;
}

export function createDefaultTriggerDraft(
  type: LoopTriggerType,
  defaultTimezone: string,
): LoopTriggerDraft {
  return {
    draftId: nextDraftId(),
    type,
    enabled: true,
    scheduleMode: "recurring",
    scheduleDraft: createDefaultScheduleDraft(),
    timezone: defaultTimezone,
    runAt: "",
    githubIntegrationId: null,
    githubRepository: null,
    githubEvents: [],
    githubFilterActions: "",
    githubFilterBranches: "",
    githubFilterLabels: "",
  };
}

function splitCommaList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function joinCommaList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "";
}

export function triggerToDraft(
  trigger: LoopTrigger,
  defaultTimezone: string,
): LoopTriggerDraft {
  const draft = createDefaultTriggerDraft(trigger.type, defaultTimezone);
  draft.draftId = trigger.id;
  draft.id = trigger.id;
  draft.enabled = trigger.enabled;

  if (trigger.type === "schedule") {
    const config = trigger.config as LoopScheduleTriggerConfig;
    if (config.run_at) {
      draft.scheduleMode = "once";
      draft.runAt = config.run_at;
    } else if (config.cron_expression) {
      draft.scheduleMode = "recurring";
      draft.scheduleDraft = parseCronExpression(config.cron_expression);
    }
    draft.timezone = config.timezone ?? defaultTimezone;
  } else if (trigger.type === "github") {
    const config = trigger.config as LoopGithubTriggerConfig;
    draft.githubIntegrationId = config.github_integration_id;
    draft.githubRepository = config.repository;
    draft.githubEvents = config.events ?? [];
    draft.githubFilterActions = joinCommaList(config.filters?.actions);
    draft.githubFilterBranches = joinCommaList(config.filters?.branches);
    draft.githubFilterLabels = joinCommaList(config.filters?.labels);
  }

  return draft;
}

export function draftToTriggerWrite(draft: LoopTriggerDraft): LoopTriggerWrite {
  const write: LoopTriggerWrite = {
    type: draft.type,
    enabled: draft.enabled,
  };
  if (draft.id) {
    write.id = draft.id;
  }

  if (draft.type === "schedule") {
    write.config =
      draft.scheduleMode === "once"
        ? {
            run_at: draft.runAt.trim(),
            timezone: draft.timezone.trim() || undefined,
          }
        : {
            cron_expression: buildCronExpression(draft.scheduleDraft),
            timezone: draft.timezone.trim() || undefined,
          };
  } else if (draft.type === "github") {
    write.config = {
      github_integration_id: draft.githubIntegrationId ?? 0,
      repository: draft.githubRepository ?? "",
      events: draft.githubEvents,
      filters: {
        actions: splitCommaList(draft.githubFilterActions),
        branches: splitCommaList(draft.githubFilterBranches),
        labels: splitCommaList(draft.githubFilterLabels),
      },
    };
  } else {
    write.config = {};
  }

  return write;
}

export function describeTriggerDraft(draft: LoopTriggerDraft): string {
  switch (draft.type) {
    case "schedule":
      if (draft.scheduleMode === "once") {
        return draft.runAt ? `Once at ${draft.runAt}` : "One-time run";
      }
      return formatScheduleSummary(
        buildCronExpression(draft.scheduleDraft),
        draft.timezone,
      );
    case "github":
      return draft.githubRepository
        ? `GitHub · ${draft.githubRepository}${
            draft.githubEvents.length > 0
              ? ` · ${draft.githubEvents.join(", ")}`
              : ""
          }`
        : "GitHub event";
    case "api":
      return "Authenticated POST";
    default:
      return draft.type;
  }
}

/** Read-only summary for an already-saved `LoopTrigger`, used in detail
 *  views that don't need the full editable draft. */
export function describeTrigger(trigger: LoopTrigger): string {
  if (trigger.type === "schedule") {
    const config = trigger.config as LoopScheduleTriggerConfig;
    if (config.run_at) {
      return `Once at ${config.run_at}${
        config.timezone ? ` (${config.timezone})` : ""
      }`;
    }
    if (config.cron_expression) {
      return formatScheduleSummary(config.cron_expression, config.timezone);
    }
    return "Schedule";
  }

  if (trigger.type === "github") {
    const config = trigger.config as LoopGithubTriggerConfig;
    return `${config.repository} · ${config.events.join(", ")}`;
  }

  return "Authenticated POST";
}

export function isTriggerDraftValid(draft: LoopTriggerDraft): boolean {
  if (draft.type === "schedule") {
    return draft.scheduleMode === "once"
      ? !!draft.runAt.trim()
      : !!buildCronExpression(draft.scheduleDraft).trim() &&
          !!draft.timezone.trim();
  }
  if (draft.type === "github") {
    return (
      !!draft.githubIntegrationId &&
      !!draft.githubRepository &&
      draft.githubEvents.length > 0
    );
  }
  return true;
}

export const TRIGGER_TYPE_LABELS: Record<LoopTriggerType, string> = {
  schedule: "Schedule",
  github: "GitHub event",
  api: "API",
};

export const GITHUB_TRIGGER_EVENT_OPTIONS: Array<{
  value: LoopGithubTriggerEvent;
  label: string;
}> = [
  { value: "issues", label: "Issues" },
  { value: "issue_comment", label: "Issue comments" },
  { value: "pull_request", label: "Pull requests" },
  { value: "push", label: "Push" },
];
