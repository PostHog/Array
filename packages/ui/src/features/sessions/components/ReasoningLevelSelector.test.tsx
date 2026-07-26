import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  DEFAULT_OPTION_META_KEY,
  OPTION_DOCS_URL_META_KEY,
} from "@posthog/shared";
import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReasoningLevelSelector } from "./ReasoningLevelSelector";

const openUrlInBrowser = vi.hoisted(() => vi.fn());
vi.mock("@posthog/ui/utils/browser", () => ({ openUrlInBrowser }));

const ultrathinkDocsUrl =
  "https://code.claude.com/docs/en/model-config#use-ultrathink-for-one-off-deep-reasoning";

function thoughtOption(
  overrides?: Partial<SessionConfigOption>,
): SessionConfigOption {
  return {
    type: "select",
    id: "effort",
    name: "Effort",
    category: "thought_level",
    currentValue: "high",
    options: [
      { name: "Low", value: "low" },
      {
        name: "High",
        value: "high",
        _meta: { [DEFAULT_OPTION_META_KEY]: true },
      },
      { name: "Max", value: "max" },
      {
        name: "Ultrathink",
        value: "ultrathink",
        _meta: { [OPTION_DOCS_URL_META_KEY]: ultrathinkDocsUrl },
      },
    ],
    ...overrides,
  } as unknown as SessionConfigOption;
}

describe("ReasoningLevelSelector", () => {
  it("renders the active level as the trigger label", () => {
    render(
      <Theme>
        <ReasoningLevelSelector thoughtOption={thoughtOption()} />
      </Theme>,
    );
    expect(
      screen.getByRole("button", { name: "Reasoning: High" }),
    ).toBeInTheDocument();
  });

  it("emits the raw value via onChange once the menu closes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Theme>
        <ReasoningLevelSelector
          thoughtOption={thoughtOption()}
          onChange={onChange}
        />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: "Reasoning: High" }));
    const lowItem = await screen.findByRole("menuitemradio", { name: "Low" });
    await user.click(lowItem);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("low"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("marks the adapter default level with a Default badge", async () => {
    const user = userEvent.setup();
    render(
      <Theme>
        <ReasoningLevelSelector thoughtOption={thoughtOption()} />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: "Reasoning: High" }));
    const highItem = await screen.findByRole("menuitemradio", {
      name: /High/,
    });
    expect(highItem).toHaveTextContent("Default");
  });

  it("opens the docs link without selecting the level", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Theme>
        <ReasoningLevelSelector
          thoughtOption={thoughtOption()}
          onChange={onChange}
        />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: "Reasoning: High" }));
    const docsButton = await screen.findByRole("button", {
      name: "Learn more about Ultrathink",
    });
    await user.click(docsButton);

    expect(openUrlInBrowser).toHaveBeenCalledWith(ultrathinkDocsUrl);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders context window and fast mode sections that emit config changes", async () => {
    const onConfigOptionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Theme>
        <ReasoningLevelSelector
          thoughtOption={thoughtOption()}
          contextWindowOption={
            {
              type: "select",
              id: "context_window",
              name: "Context Window",
              currentValue: "1m",
              options: [
                { name: "200k", value: "200k" },
                {
                  name: "1M",
                  value: "1m",
                  _meta: { [DEFAULT_OPTION_META_KEY]: true },
                },
              ],
            } as unknown as SessionConfigOption
          }
          fastModeOption={
            {
              type: "select",
              id: "fast",
              name: "Fast Mode",
              currentValue: "off",
              options: [
                { name: "On", value: "on" },
                { name: "Off", value: "off" },
              ],
            } as unknown as SessionConfigOption
          }
          onConfigOptionChange={onConfigOptionChange}
        />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: "Reasoning: High" }));
    expect(
      await screen.findByRole("menuitemradio", { name: "On" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("menuitemradio", { name: "200k" }),
    );

    await waitFor(() =>
      expect(onConfigOptionChange).toHaveBeenCalledWith(
        "context_window",
        "200k",
      ),
    );
    expect(onConfigOptionChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["undefined option", undefined],
    ["non-select type", thoughtOption({ type: "boolean" })],
    ["empty options", thoughtOption({ options: [] })],
  ])("renders no trigger for %s", (_label, option) => {
    render(
      <ReasoningLevelSelector
        thoughtOption={option as SessionConfigOption | undefined}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
