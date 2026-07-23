import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelPicker } from "./ChannelPicker";

// Parent-ordered: me first, then the rest.
const CHANNEL_NAMES = ["me", "marketing", "support"];

function renderPicker(props?: Partial<Parameters<typeof ChannelPicker>[0]>): {
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  render(
    <Theme>
      <ChannelPicker
        value={null}
        onChange={onChange}
        channelNames={CHANNEL_NAMES}
        isLoading={false}
        {...props}
      />
    </Theme>,
  );
  return { onChange };
}

describe("ChannelPicker", () => {
  it("defaults to 'No channel'", () => {
    renderPicker();
    expect(screen.getByRole("combobox", { name: "Channel" })).toHaveTextContent(
      "No channel",
    );
  });

  it("shows the selected channel's name (incl. the personal 'me')", () => {
    renderPicker({ value: "me" });
    expect(screen.getByRole("combobox", { name: "Channel" })).toHaveTextContent(
      "me",
    );
  });

  it("lists 'No channel' first, then the channels in the given order", async () => {
    const user = userEvent.setup();
    // Deliberately not alphabetical: the parent orders the list and the picker
    // must preserve that order (No channel → me → starred → rest).
    renderPicker({ channelNames: ["me", "zulu", "alpha"] });

    await user.click(screen.getByRole("combobox", { name: "Channel" }));
    await screen.findByRole("option", { name: "No channel" });

    expect(screen.getAllByRole("option").map((el) => el.textContent)).toEqual([
      "No channel",
      "me",
      "zulu",
      "alpha",
    ]);
  });

  it("emits the channel name when a channel is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Channel" }));
    await user.click(await screen.findByRole("option", { name: "support" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("support"));
  });

  it("emits null when 'No channel' is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ value: "me" });

    await user.click(screen.getByRole("combobox", { name: "Channel" }));
    await user.click(await screen.findByRole("option", { name: "No channel" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  // Type-to-filter is the shared Combobox's own behavior (same as the repo
  // picker) and its popup search input doesn't mount as a queryable field in
  // jsdom, so it isn't asserted here — see BranchSelector.test.tsx, which drives
  // that combobox via props for the same reason.
});
