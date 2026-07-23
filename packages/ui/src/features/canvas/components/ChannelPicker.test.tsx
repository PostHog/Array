import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../hooks/useChannels";
import { ChannelPicker } from "./ChannelPicker";

const CHANNELS: Channel[] = [
  { id: "chan-1", name: "marketing", path: "/marketing" },
  { id: "chan-2", name: "support", path: "/support" },
];

function renderPicker(props?: Partial<Parameters<typeof ChannelPicker>[0]>): {
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  render(
    <Theme>
      <ChannelPicker
        value={null}
        onChange={onChange}
        channels={CHANNELS}
        isLoading={false}
        {...props}
      />
    </Theme>,
  );
  return { onChange };
}

describe("ChannelPicker", () => {
  it("defaults to the personal 'me' channel", () => {
    renderPicker();
    expect(screen.getByRole("combobox", { name: "Channel" })).toHaveTextContent(
      "me",
    );
  });

  it("shows the selected channel's name", () => {
    renderPicker({ value: "chan-1" });
    expect(screen.getByRole("combobox", { name: "Channel" })).toHaveTextContent(
      "marketing",
    );
  });

  it("lists 'me' plus the channels when opened", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Channel" }));

    expect(await screen.findByRole("option", { name: "me" })).toBeVisible();
    expect(screen.getByRole("option", { name: "marketing" })).toBeVisible();
    expect(screen.getByRole("option", { name: "support" })).toBeVisible();
  });

  it("emits the channel id when a channel is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: "Channel" }));
    await user.click(await screen.findByRole("option", { name: "support" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("chan-2"));
  });

  it("emits null when the personal 'me' channel is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ value: "chan-1" });

    await user.click(screen.getByRole("combobox", { name: "Channel" }));
    await user.click(await screen.findByRole("option", { name: "me" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  // Type-to-filter is the shared Combobox's own behavior (same as the repo
  // picker) and its popup search input doesn't mount as a queryable field in
  // jsdom, so it isn't asserted here — see BranchSelector.test.tsx, which drives
  // that combobox via props for the same reason.
});
