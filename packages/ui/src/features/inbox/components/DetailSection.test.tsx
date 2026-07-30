import { FileTextIcon } from "@phosphor-icons/react";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DetailSection } from "./DetailSection";
import { RightColumnSection } from "./RightColumnSection";

// Both column styles share the same collapsible contract, so exercise them
// through one table – a regression in either primitive collapses (or fails to
// collapse) sections on the report detail.
const SECTIONS = [
  { name: "DetailSection", Section: DetailSection },
  { name: "RightColumnSection", Section: RightColumnSection },
];

describe.each(SECTIONS)("$name", ({ Section }) => {
  const renderSection = (
    props: Partial<Parameters<typeof Section>[0]> = {},
  ) => {
    render(
      <Theme>
        <Section Icon={FileTextIcon} title="Summary" {...props}>
          <p>body</p>
        </Section>
      </Theme>,
    );
  };

  it("renders the body with no toggle when not collapsible", () => {
    renderSection();

    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides and restores the body from the header, reporting expanded state", async () => {
    const user = userEvent.setup();
    renderSection({ collapsible: true });

    const toggle = screen.getByRole("button", { name: /summary/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("starts collapsed with defaultCollapsed", () => {
    renderSection({ collapsible: true, defaultCollapsed: true });

    expect(screen.getByRole("button", { name: /summary/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("leaves rightSlot controls outside the toggle so they stay clickable", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    renderSection({
      collapsible: true,
      rightSlot: (
        <button type="button" onClick={onAdd}>
          Add
        </button>
      ),
    });

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
