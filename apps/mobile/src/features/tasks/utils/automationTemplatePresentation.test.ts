import { describe, expect, it } from "vitest";
import { getAutomationTemplatePresentation } from "./automationTemplatePresentation";

describe("automationTemplatePresentation", () => {
  it("prefers repository context when one exists", () => {
    expect(
      getAutomationTemplatePresentation({
        repository: "posthog/posthog",
        template_id: "developer-morning-brief",
      }),
    ).toMatchObject({
      templateName: "Developer morning briefing",
      repositoryLabel: "posthog/posthog",
      contextLabel: "Developer · Daily briefing",
      secondaryLabel: "posthog/posthog",
    });
  });

  it("falls back to template context for repo-optional automations", () => {
    expect(
      getAutomationTemplatePresentation({
        repository: "",
        template_id: "pm-product-pulse",
      }),
    ).toMatchObject({
      templateName: "PM product pulse",
      repositoryLabel: null,
      contextLabel: "PM · Daily briefing",
      secondaryLabel: "PM · Daily briefing",
    });
  });

  it("handles unknown template ids and blank repositories safely", () => {
    expect(
      getAutomationTemplatePresentation({
        repository: "",
        template_id: "unknown-template",
      }),
    ).toMatchObject({
      templateName: "Template automation",
      repositoryLabel: null,
      contextLabel: null,
      secondaryLabel: "No repository context",
    });
  });
});
