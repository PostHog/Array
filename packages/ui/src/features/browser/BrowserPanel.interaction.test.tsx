import { ServiceProvider } from "@posthog/di/react";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Container } from "inversify";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";
import {
  BROWSER_VIEW_COMPONENT,
  type BrowserViewHandle,
  type BrowserViewProps,
} from "./identifiers";

const loadURL = vi.fn<(url: string) => Promise<void>>();

const browserViewHandle: BrowserViewHandle = {
  loadURL,
  reload: vi.fn(),
  stop: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
};

function FakeBrowserView({ onReady }: BrowserViewProps) {
  useEffect(() => {
    onReady(browserViewHandle);
    return () => onReady(null);
  }, [onReady]);
  return <div data-testid="browser-view" />;
}

describe("BrowserPanel", () => {
  it("navigates when Enter is pressed in the address input", async () => {
    loadURL.mockResolvedValue();
    const container = new Container();
    container.bind(BROWSER_VIEW_COMPONENT).toConstantValue(FakeBrowserView);
    const user = userEvent.setup();

    render(
      <ServiceProvider container={container}>
        <Theme>
          <BrowserPanel url="about:blank" />
        </Theme>
      </ServiceProvider>,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Address" }),
      "posthog.com{Enter}",
    );

    expect(loadURL).toHaveBeenCalledWith("https://posthog.com");
  });
});
