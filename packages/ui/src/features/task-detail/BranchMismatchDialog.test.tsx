import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BranchMismatchDialog } from "./BranchMismatchDialog";

function renderDialog(
  overrides?: Partial<Parameters<typeof BranchMismatchDialog>[0]>,
) {
  const handlers = {
    onSwitch: vi.fn(),
    onContinue: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <Theme>
      <BranchMismatchDialog
        open
        linkedBranch="feat/foo"
        currentBranch="main"
        hasUncommittedChanges={false}
        switchError={null}
        {...handlers}
        {...overrides}
      />
    </Theme>,
  );
  return handlers;
}

describe("BranchMismatchDialog", () => {
  it("clicking Switch branch does not fire onCancel", async () => {
    // Regression: the Switch button was wrapped in AlertDialog.Action, whose
    // auto-close fired onOpenChange -> onCancel, discarding the pending
    // message so it was never sent after the checkout succeeded.
    const user = userEvent.setup();
    const { onSwitch, onCancel } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Switch branch" }));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clicking Cancel fires onCancel only", async () => {
    const user = userEvent.setup();
    const { onSwitch, onContinue, onCancel } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("clicking Continue anyway fires onContinue only", async () => {
    const user = userEvent.setup();
    const { onSwitch, onContinue, onCancel } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Continue anyway" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape closes and fires onCancel when idle", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape does not fire onCancel while switching", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog({ isSwitching: true });

    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows the switch error", () => {
    renderDialog({ switchError: "dirty worktree" });

    expect(screen.getByText("dirty worktree")).toBeInTheDocument();
  });
});
