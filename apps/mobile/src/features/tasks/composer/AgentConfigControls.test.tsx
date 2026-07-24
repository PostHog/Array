import type { CloudTaskConfigOption } from "@posthog/shared";
import { createElement, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { AgentConfigControls } from "./AgentConfigControls";

vi.mock("phosphor-react-native", () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement(name, props);
  return {
    BrainIcon: icon("BrainIcon"),
    CaretDown: icon("CaretDown"),
    Check: icon("Check"),
    Cpu: icon("Cpu"),
    PauseIcon: icon("PauseIcon"),
    PencilIcon: icon("PencilIcon"),
    Robot: icon("Robot"),
    ShieldCheck: icon("ShieldCheck"),
    Sparkle: icon("Sparkle"),
  };
});

vi.mock("@/components/SheetContainer", () => ({
  SheetContainer: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? createElement("SheetContainer", null, children) : null),
}));

vi.mock("@/lib/theme", () => ({
  useThemeColors: () => ({
    gray: { 10: "#777", 11: "#555" },
    accent: { 9: "#f60", 11: "#f60" },
  }),
}));

const configOptions: CloudTaskConfigOption[] = [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "claude-sonnet-4-6",
    options: [{ value: "claude-sonnet-4-6", name: "Sonnet 4.6" }],
    category: "model",
    description: "Choose a model",
  },
];

function findPressableWithText(
  renderer: ReturnType<typeof create>,
  label: string,
) {
  return renderer.root.find(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.findAll((child) => child.props.children === label).length > 0,
  );
}

describe("AgentConfigControls", () => {
  it("resets incompatible values when switching adapters", () => {
    const onAdapterChange = vi.fn();
    const onModeChange = vi.fn();
    const onModelChange = vi.fn();
    const onReasoningChange = vi.fn();
    let renderer!: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        createElement(AgentConfigControls, {
          adapter: "claude",
          mode: "plan",
          model: "claude-sonnet-4-6",
          reasoning: "high",
          configOptions,
          onAdapterChange,
          onModeChange,
          onModelChange,
          onReasoningChange,
        }),
      );
    });

    act(() => findPressableWithText(renderer, "Sonnet 4.6").props.onPress());
    act(() =>
      findPressableWithText(renderer, "Switch to Codex").props.onPress(),
    );

    expect(onAdapterChange).toHaveBeenCalledWith("codex");
    expect(onModeChange).toHaveBeenCalledWith("auto");
    expect(onModelChange).toHaveBeenCalledWith("gpt-5.5");
    expect(onReasoningChange).toHaveBeenCalledWith("high");
  });
});
