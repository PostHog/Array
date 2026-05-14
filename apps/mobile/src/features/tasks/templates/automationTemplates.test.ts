import { describe, expect, it } from "vitest";
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplate,
  getAutomationTemplateInitialValues,
  requiresAutomationTemplateRepository,
} from "./automationTemplates";

describe("automationTemplates", () => {
  it("returns the developer template first and includes all launch templates", () => {
    expect(AUTOMATION_TEMPLATES.map((template) => template.id)).toEqual([
      "developer-morning-brief",
      "pm-product-pulse",
      "executive-day-opener",
    ]);
    expect(AUTOMATION_TEMPLATES[0]?.hero).toBe(true);
  });

  it("derives initial editor values from a selected template", () => {
    expect(
      getAutomationTemplateInitialValues("developer-morning-brief"),
    ).toEqual({
      name: "Developer morning briefing",
      prompt: expect.stringContaining("Create my developer morning briefing."),
      cron_expression: "0 9 * * 1-5",
      enabled: true,
      template_id: "developer-morning-brief",
    });
  });

  it("handles unknown template ids without throwing", () => {
    expect(getAutomationTemplate("unknown-template")).toBeNull();
    expect(getAutomationTemplateInitialValues("unknown-template")).toBeNull();
  });

  it("exposes repository requirements per template", () => {
    expect(
      requiresAutomationTemplateRepository("developer-morning-brief"),
    ).toBe(true);
    expect(requiresAutomationTemplateRepository("pm-product-pulse")).toBe(
      false,
    );
    expect(requiresAutomationTemplateRepository("executive-day-opener")).toBe(
      false,
    );
  });
});
