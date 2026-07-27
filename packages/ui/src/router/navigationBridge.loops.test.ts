import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigateToEditLoop,
  navigateToLoopDetail,
  navigateToLoops,
  navigateToNewLoop,
} from "./navigationBridge";

const navigate = vi.fn();

vi.mock("./routerRef", () => ({
  getRouterOrNull: () => ({ navigate }),
}));

vi.mock("@posthog/ui/shell/analytics", () => ({
  track: vi.fn(),
}));

describe("loop navigation", () => {
  beforeEach(() => navigate.mockClear());

  it("returns channel-scoped loops to that channel", () => {
    navigateToLoops("channel-123");

    expect(navigate).toHaveBeenCalledWith({
      to: "/website/$channelId/loops",
      params: { channelId: "channel-123" },
    });
  });

  it("keeps the channel return target through create, detail, and edit", () => {
    navigateToNewLoop("channel-123");
    navigateToLoopDetail("loop-456", "channel-123");
    navigateToEditLoop("loop-456", "channel-123");

    expect(navigate).toHaveBeenNthCalledWith(1, {
      to: "/code/loops/new",
      search: { channelId: "channel-123" },
    });
    expect(navigate).toHaveBeenNthCalledWith(2, {
      to: "/code/loops/$loopId",
      params: { loopId: "loop-456" },
      search: { channelId: "channel-123" },
    });
    expect(navigate).toHaveBeenNthCalledWith(3, {
      to: "/code/loops/$loopId/edit",
      params: { loopId: "loop-456" },
      search: { channelId: "channel-123" },
    });
  });

  it("preserves the global loops destination without a channel", () => {
    navigateToLoops();
    navigateToLoopDetail("loop-456");

    expect(navigate).toHaveBeenNthCalledWith(1, { to: "/code/loops" });
    expect(navigate).toHaveBeenNthCalledWith(2, {
      to: "/code/loops/$loopId",
      params: { loopId: "loop-456" },
      search: {},
    });
  });
});
