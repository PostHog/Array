import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TitleBarSearch } from "./TitleBarSearch";

describe("TitleBarSearch", () => {
  it("opens global search when activated", async () => {
    const onClick = vi.fn();
    render(<TitleBarSearch onClick={onClick} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Search PostHog Code" }),
    );

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
