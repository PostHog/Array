import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateToChannelNewTask = vi.fn();
const navigateToWebsiteNew = vi.fn();
const navigateToCode = vi.fn();

vi.mock("./navigationBridge", () => ({
  navigateToChannelNewTask: (...args: unknown[]) =>
    navigateToChannelNewTask(...args),
  navigateToWebsiteNew: () => navigateToWebsiteNew(),
  navigateToCode: () => navigateToCode(),
  navigateToChannelTask: vi.fn(),
  navigateToTaskDetail: vi.fn(),
  navigateToFolderSettings: vi.fn(),
}));
vi.mock("@posthog/di/container", () => ({
  resolveService: vi.fn(),
  resolveServiceOptional: vi.fn(),
}));
vi.mock("@posthog/ui/shell/analytics", () => ({
  track: vi.fn(),
  setActiveTaskContext: vi.fn(),
}));

import { useCurrentChannelStore } from "@posthog/ui/features/canvas/stores/currentChannelStore";
import { openTaskInput } from "./useOpenTask";

describe("openTaskInput channel scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentChannelStore.setState({ currentChannelId: null });
  });

  // Without the channels layout nothing sets a current channel, so creates must
  // land where they always did rather than being pulled into a channel.
  it("routes to Code when no channel is current", () => {
    openTaskInput();
    expect(navigateToCode).toHaveBeenCalledTimes(1);
    expect(navigateToChannelNewTask).not.toHaveBeenCalled();
  });

  it("still honours an explicit website space when no channel is current", () => {
    openTaskInput({ space: "website" });
    expect(navigateToWebsiteNew).toHaveBeenCalledTimes(1);
    expect(navigateToChannelNewTask).not.toHaveBeenCalled();
  });

  it("routes into the current channel once one is scoped", () => {
    useCurrentChannelStore.setState({ currentChannelId: "chan-1" });
    openTaskInput();
    expect(navigateToChannelNewTask).toHaveBeenCalledWith("chan-1");
    expect(navigateToCode).not.toHaveBeenCalled();
  });

  it("carries prefill into the channel route", () => {
    useCurrentChannelStore.setState({ currentChannelId: "chan-1" });
    openTaskInput({ initialPrompt: "ship it" });
    expect(navigateToChannelNewTask).toHaveBeenCalledWith("chan-1");
  });
});
