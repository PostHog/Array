import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AutomationTemplateCard", () => ({
  AutomationTemplateCard: ({
    template,
    onPress,
  }: {
    template: { id: string; name: string };
    onPress: (templateId: string) => void;
  }) =>
    createElement(
      "AutomationTemplateCard",
      {
        onPress: () => onPress(template.id),
        title: template.name,
      },
      template.name,
    ),
}));

import { AutomationTemplateGallery } from "./AutomationTemplateGallery";

describe("AutomationTemplateGallery", () => {
  it("renders the developer template first and includes the launch set", () => {
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        createElement(AutomationTemplateGallery, {
          onSelectTemplate: vi.fn(),
          onCreateCustom: vi.fn(),
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    const labels = renderer.root
      .findAll(
        (node) =>
          typeof node.props.children === "string" &&
          /brief|pulse|opener/i.test(node.props.children),
      )
      .map((node) => node.props.children);

    expect(labels).toContain("Developer morning briefing");
    expect(labels).toContain("PM product pulse");
    expect(labels).toContain("Executive day opener");
    expect(
      renderer.root.findAll(
        (node) => node.props.children === "Start from scratch",
      ).length,
    ).toBeGreaterThan(0);
    expect(labels.indexOf("Developer morning briefing")).toBeLessThan(
      labels.indexOf("PM product pulse"),
    );
  });

  it("routes template and custom selections through the expected callbacks", () => {
    const onSelectTemplate = vi.fn();
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        createElement(AutomationTemplateGallery, {
          onSelectTemplate,
          onCreateCustom: vi.fn(),
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    const buttons = renderer.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        (node.type === "AutomationTemplateCard" ||
          node.props.children === "Start from scratch"),
    );

    const developerButton = buttons.find(
      (node) => node.props.title === "Developer morning briefing",
    );

    developerButton?.props.onPress();

    expect(onSelectTemplate).toHaveBeenCalledWith("developer-morning-brief");
  });
});
