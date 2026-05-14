import { getAutomationTemplate } from "../templates/automationTemplates";
import type { TaskAutomation } from "../types";

export interface AutomationTemplatePresentation {
  templateName: string | null;
  repositoryLabel: string | null;
  contextLabel: string | null;
  secondaryLabel: string;
}

export function getAutomationTemplatePresentation(
  automation: Pick<TaskAutomation, "repository" | "template_id">,
): AutomationTemplatePresentation {
  const repositoryLabel = automation.repository.trim() || null;
  const template = getAutomationTemplate(automation.template_id);
  const contextLabel = template
    ? `${template.audienceLabel} · ${template.categoryLabel}`
    : null;

  return {
    templateName:
      template?.name ?? (automation.template_id ? "Template automation" : null),
    repositoryLabel,
    contextLabel,
    secondaryLabel: repositoryLabel ?? contextLabel ?? "No repository context",
  };
}
