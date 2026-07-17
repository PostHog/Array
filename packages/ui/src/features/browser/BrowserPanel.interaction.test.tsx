import { ServiceProvider } from "@posthog/di/react";
import { Theme } from "@radix-ui/themes";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Container } from "inversify";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

let reportDeferredReady: (() => void) | undefined;

function DeferredBrowserView({ onReady }: BrowserViewProps) {
  reportDeferredReady = () => onReady(browserViewHandle);
  return <div data-testid="browser-view" />;
}

describe("BrowserPanel", () => {
  beforeEach(() => {
    loadURL.mockReset();
    reportDeferredReady = undefined;
  });

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

  it("surfaces synchronous navigation failures", async () => {
    loadURL.mockImplementation(() => {
      throw new Error("webview unavailable");
    });
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

    expect(screen.getByText("Failed to load page")).toBeInTheDocument();
  });

  it("queues Enter navigation until the browser view is ready", async () => {
    loadURL.mockResolvedValue();
    const container = new Container();
    container.bind(BROWSER_VIEW_COMPONENT).toConstantValue(DeferredBrowserView);

    render(
      <ServiceProvider container={container}>
        <Theme>
          <BrowserPanel url="about:blank" />
        </Theme>
      </ServiceProvider>,
    );

    const address = screen.getByRole("textbox", { name: "Address" });
    fireEvent.change(address, { target: { value: "posthog.com" } });
    fireEvent.submit(address.closest("form") as HTMLFormElement);

    expect(loadURL).not.toHaveBeenCalled();
    act(() => reportDeferredReady?.());
    expect(loadURL).toHaveBeenCalledWith("https://posthog.com");
  });
});
