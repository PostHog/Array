import {
  handleShareLinkClick,
  parseShareLink,
} from "@posthog/ui/utils/shareLinks";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateToChannel = vi.fn();
const navigateToChannelDashboard = vi.fn();
const navigateToChannelTask = vi.fn();

vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToChannel: (...args: unknown[]) => navigateToChannel(...args),
  navigateToChannelDashboard: (...args: unknown[]) =>
    navigateToChannelDashboard(...args),
  navigateToChannelTask: (...args: unknown[]) => navigateToChannelTask(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseShareLink", () => {
  it.each([
    [
      "canvas link",
      "https://us.posthog.com/code/canvas/chan1/dash1",
      { kind: "canvas", channelId: "chan1", dashboardId: "dash1" },
    ],
    [
      "canvas link with encoded ids",
      "https://us.posthog.com/code/canvas/chan%2F1/dash%202",
      { kind: "canvas", channelId: "chan/1", dashboardId: "dash 2" },
    ],
    [
      "channel link on the eu host",
      "https://eu.posthog.com/code/channel/chan1",
      { kind: "channel", channelId: "chan1" },
    ],
    [
      "channel thread link",
      "https://us.posthog.com/code/channel/chan1/tasks/task1",
      { kind: "channel", channelId: "chan1", taskId: "task1" },
    ],
  ])("parses a %s", (_label, href, expected) => {
    expect(parseShareLink(href)).toEqual(expected);
  });

  it.each([
    ["a non-PostHog host", "https://evil.com/code/canvas/chan1/dash1"],
    [
      "an unrelated PostHog path",
      "https://us.posthog.com/project/2/dashboard/1",
    ],
    [
      "a canvas link missing the dashboard id",
      "https://us.posthog.com/code/canvas/chan1",
    ],
    [
      "a channel thread link with a malformed tail",
      "https://us.posthog.com/code/channel/chan1/foo/task1",
    ],
    ["a malformed url", "not a url"],
  ])("returns null for %s", (_label, href) => {
    expect(parseShareLink(href)).toBeNull();
  });
});

describe("handleShareLinkClick", () => {
  it("navigates in-app and cancels the default open for a share link", () => {
    const event = { preventDefault: vi.fn() };

    const handled = handleShareLinkClick(
      "https://us.posthog.com/code/canvas/chan1/dash1",
      event,
    );

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(navigateToChannelDashboard).toHaveBeenCalledWith("chan1", "dash1");
  });

  it("routes a channel thread link to the task navigator", () => {
    const event = { preventDefault: vi.fn() };

    handleShareLinkClick(
      "https://us.posthog.com/code/channel/chan1/tasks/task1",
      event,
    );

    expect(navigateToChannelTask).toHaveBeenCalledWith("chan1", "task1");
  });

  it("leaves an external link alone", () => {
    const event = { preventDefault: vi.fn() };

    const handled = handleShareLinkClick("https://example.com/docs", event);

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigateToChannel).not.toHaveBeenCalled();
    expect(navigateToChannelDashboard).not.toHaveBeenCalled();
    expect(navigateToChannelTask).not.toHaveBeenCalled();
  });

  it("returns false for a missing href", () => {
    const event = { preventDefault: vi.fn() };

    expect(handleShareLinkClick(undefined, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
