import type {
  AutomationTemplate,
  AutomationTemplateInitialValues,
} from "../types";
import {
  buildCronExpression,
  createDefaultScheduleDraft,
} from "../utils/automationSchedule";

function buildWeekdayCron(hour: string, minute: string): string {
  return buildCronExpression({
    ...createDefaultScheduleDraft(),
    mode: "weekdays",
    hour,
    minute,
  });
}

export const AUTOMATION_TEMPLATES: ReadonlyArray<AutomationTemplate> = [
  {
    id: "developer-morning-brief",
    name: "Developer morning briefing",
    description:
      "Review open PRs, review requests, CI failures, and active work before you start coding.",
    audience: "developer",
    audienceLabel: "Developer",
    categoryLabel: "Daily briefing",
    prompt:
      "Create my developer morning briefing. Summarize my open pull requests, outstanding review requests, CI failures, and work in progress in my selected repository. Call out blockers first, then list the most important items I should tackle this morning.",
    suggestedName: "Developer morning briefing",
    cron_expression: buildWeekdayCron("09", "00"),
    enabled: true,
    requiresRepository: true,
    hero: true,
  },
  {
    id: "pm-product-pulse",
    name: "PM product pulse",
    description:
      "Get a concise update on feature usage, product health, and the biggest signals worth following up on.",
    audience: "pm",
    audienceLabel: "PM",
    categoryLabel: "Daily briefing",
    prompt:
      "Create my PM product pulse. Summarize the most important usage trends, product quality signals, and feature areas I should pay attention to today. Lead with notable changes, regressions, or unusual user behavior, then suggest the follow-ups that matter most.",
    suggestedName: "PM product pulse",
    cron_expression: buildWeekdayCron("09", "30"),
    enabled: true,
    requiresRepository: false,
  },
  {
    id: "executive-day-opener",
    name: "Executive day opener",
    description:
      "Start the day with meetings, priorities, and the highest-level updates that need attention.",
    audience: "executive",
    audienceLabel: "Executive",
    categoryLabel: "Daily briefing",
    prompt:
      "Create my executive day opener. Summarize today's meetings, the highest-priority follow-ups, and the top company or product signals that need my attention. Keep it short, scannable, and focused on decisions or risks.",
    suggestedName: "Executive day opener",
    cron_expression: buildWeekdayCron("07", "30"),
    enabled: true,
    requiresRepository: false,
  },
] as const;

export function getAutomationTemplates(): ReadonlyArray<AutomationTemplate> {
  return AUTOMATION_TEMPLATES;
}

export function getAutomationTemplate(
  templateId: string | null | undefined,
): AutomationTemplate | null {
  if (!templateId) {
    return null;
  }

  return (
    AUTOMATION_TEMPLATES.find((template) => template.id === templateId) ?? null
  );
}

export function getAutomationTemplateInitialValues(
  templateId: string | null | undefined,
): AutomationTemplateInitialValues | null {
  const template = getAutomationTemplate(templateId);
  if (!template) {
    return null;
  }

  return {
    name: template.suggestedName,
    prompt: template.prompt,
    cron_expression: template.cron_expression,
    enabled: template.enabled,
    template_id: template.id,
  };
}

export function requiresAutomationTemplateRepository(
  templateId: string | null | undefined,
): boolean {
  return getAutomationTemplate(templateId)?.requiresRepository ?? false;
}
