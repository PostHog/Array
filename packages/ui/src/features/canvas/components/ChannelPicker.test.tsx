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
  it("shows 'No channel' when nothing is selected", () => {
    renderPicker();
    expect(screen.getByText("No channel")).toBeInTheDocument();
  });

  it("shows the '#name' of the selected channel", () => {
    renderPicker({ value: "chan-1" });
    expect(screen.getByText("#marketing")).toBeInTheDocument();
  });

  it("emits the channel id when a channel is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole("button", { name: "Channel" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "support" }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("chan-2"));
  });

  it("maps the 'No channel' sentinel back to null", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ value: "chan-1" });

    await user.click(screen.getByRole("button", { name: "Channel" }));
    await user.click(
      await screen.findByRole("menuitemradio", {
        name: "No channel · work in a repo",
      }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it("lists exactly the channels it is given (filtering is the parent's job)", async () => {
    const user = userEvent.setup();
    // A "me" channel passed through renders like any other — the component does
    // no #me filtering itself; TaskInput removes it upstream.
    renderPicker({
      channels: [...CHANNELS, { id: "me-id", name: "me", path: "/me" }],
    });

    await user.click(screen.getByRole("button", { name: "Channel" }));

    expect(
      await screen.findByRole("menuitemradio", { name: "me" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: "marketing" }),
    ).toBeInTheDocument();
  });
});
