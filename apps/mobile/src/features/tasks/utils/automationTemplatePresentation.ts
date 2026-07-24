import type { TaskAutomation } from "@posthog/api-client/posthog-client";
import { parseSkillTemplateId } from "../skills/skillTemplateIds";

export interface AutomationTemplatePresentation {
  templateName: string | null;
  contextLabel: string | null;
  repositoryLabel: string | null;
  secondaryLabel: string;
}

export function getAutomationTemplatePresentation(
  automation: Pick<TaskAutomation, "repository" | "template_id">,
): AutomationTemplatePresentation {
  const repositoryLabel = automation.repository.trim() || null;
  const skillName = parseSkillTemplateId(automation.template_id);
  const contextLabel = skillName ? "Skill store" : null;
  return {
    templateName:
      skillName ?? (automation.template_id ? "Template automation" : null),
    contextLabel,
    repositoryLabel,
    secondaryLabel: repositoryLabel ?? contextLabel ?? "No repository context",
  };
}
