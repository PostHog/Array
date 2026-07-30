import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/features/canvas/hooks/useChannels", () => ({
  useChannels: () => ({
    channels: [{ id: "personal-space", name: "me", path: "/me" }],
    isLoading: false,
  }),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useChannelsLayout", () => ({
  useChannelsLayout: () => true,
}));
vi.mock("@posthog/ui/features/canvas/components/ChannelHeader", () => ({
  ChannelHeader: () => null,
}));
vi.mock("@posthog/ui/hooks/useSetHeaderContent", () => ({
  useSetHeaderContent: () => {},
}));
vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToNewLoop: vi.fn(),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({
    members: [],
    isLoading: false,
    isError: false,
    isComplete: true,
  }),
}));
vi.mock("@posthog/ui/features/loops/hooks/useLoops", () => ({
  useLoops: () => ({ data: [], isLoading: false, isError: false }),
  useLoopLimits: () => null,
}));
vi.mock("@posthog/ui/features/loops/components/LoopBuilderComposer", () => ({
  LoopBuilderComposer: () => null,
}));
vi.mock("@posthog/ui/features/loops/components/LoopFallbacks", () => ({
  LoopsEmptyNotice: () => null,
  LoopsSkeleton: () => null,
}));
vi.mock("@posthog/ui/features/loops/components/LoopRow", () => ({
  LoopRow: () => null,
}));
vi.mock("@posthog/ui/features/loops/components/LoopsEmptyState", () => ({
  LoopsEmptyState: () => null,
}));
vi.mock("@posthog/ui/features/loops/components/LoopTemplatesSection", () => ({
  LoopTemplatesSection: () => null,
}));
vi.mock("@posthog/ui/features/canvas/hooks/useTaskChannels", () => ({
  PERSONAL_CHANNEL_NAME: "me",
}));
vi.mock("@posthog/ui/features/loops/components/LoopsListView", () => ({
  LoopsListView: () => <div>Project loops registry</div>,
}));

import { WebsiteChannelLoops } from "./WebsiteChannelLoops";

describe("WebsiteChannelLoops", () => {
  it("shows the project loops registry in the Personal space", () => {
    render(<WebsiteChannelLoops channelId="personal-space" />);

    expect(screen.getByText("Project loops registry")).toBeInTheDocument();
  });
});
