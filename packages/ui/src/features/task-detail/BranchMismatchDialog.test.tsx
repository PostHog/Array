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
  // The Switch case is the regression: the button was wrapped in
  // AlertDialog.Action, whose auto-close fired onOpenChange -> onCancel,
  // discarding the pending message so it was never sent after the checkout
  // succeeded.
  it.each([
    { button: "Switch branch", fires: "onSwitch" },
    { button: "Continue anyway", fires: "onContinue" },
    { button: "Cancel", fires: "onCancel" },
  ] as const)(
    "clicking $button fires $fires only",
    async ({ button, fires }) => {
      const user = userEvent.setup();
      const handlers = renderDialog();

      await user.click(screen.getByRole("button", { name: button }));

      for (const [name, handler] of Object.entries(handlers)) {
        expect(handler, name).toHaveBeenCalledTimes(name === fires ? 1 : 0);
      }
    },
  );

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
