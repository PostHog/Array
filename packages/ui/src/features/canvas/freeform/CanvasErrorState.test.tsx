import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasErrorState } from "./CanvasErrorState";

describe("CanvasErrorState", () => {
  it("explains the failure and offers a retry", async () => {
    const onRetry = vi.fn();
    render(
      <CanvasErrorState
        message="Couldn't load the canvas runtime."
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Couldn't load the canvas runtime."),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("only offers the agent in edit mode", () => {
    const { rerender } = render(
      <CanvasErrorState message="boom" onRetry={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Ask agent to fix" }),
    ).not.toBeInTheDocument();

    rerender(
      <CanvasErrorState
        message="boom"
        onRetry={vi.fn()}
        onAskAgent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Ask agent to fix" }),
    ).toBeInTheDocument();
  });
});
