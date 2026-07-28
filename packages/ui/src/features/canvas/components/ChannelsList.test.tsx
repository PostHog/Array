import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channels: [] as { id: string; name: string; path: string }[],
  starredPaths: [] as string[],
  channelsLayout: true,
  navigate: vi.fn(),
}));

vi.mock("@posthog/ui/shell/analytics", () => ({ track: vi.fn() }));
vi.mock("@posthog/ui/features/canvas/hooks/useChannelsLayout", () => ({
  useChannelsLayout: () => mocks.channelsLayout,
}));
vi.mock("@posthog/ui/features/canvas/hooks/useChannels", () => ({
  useChannels: () => ({ channels: mocks.channels, isLoading: false }),
  useChannelMutations: () => ({ createChannel: vi.fn(), isDeleting: false }),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useChannelStars", () => ({
  useChannelStars: () => ({
    starredRefToShortcutId: new Map(mocks.starredPaths.map((p) => [p, p])),
  }),
  useChannelStarToggle: () => ({
    isStarred: false,
    toggleStar: vi.fn(),
    removeStar: vi.fn(),
  }),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useDashboards", () => ({
  useCreateAndOpenDashboard: () => vi.fn(),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useUnreadChannels", () => ({
  useIsChannelUnread: () => () => false,
}));
vi.mock("@posthog/ui/features/canvas/hooks/useTaskChannels", async () => {
  const actual = await vi.importActual<
    typeof import("@posthog/ui/features/canvas/hooks/useTaskChannels")
  >("@posthog/ui/features/canvas/hooks/useTaskChannels");
  return { ...actual, useTaskChannels: () => ({ channels: [] }) };
});
vi.mock("@posthog/ui/features/canvas/components/RenameChannelModal", () => ({
  RenameChannelModal: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: () => "/website",
}));

import { ChannelsList } from "./ChannelsList";

const ME = { id: "me-id", name: "me", path: "/me" };
const ENG = { id: "eng-id", name: "engineering", path: "/engineering" };
const DESIGN = { id: "design-id", name: "design", path: "/design" };

function renderList() {
  return render(
    <Theme>
      <ChannelsList />
    </Theme>,
  );
}

describe("ChannelsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channels = [ME, ENG, DESIGN];
    mocks.starredPaths = [];
    mocks.channelsLayout = true;
  });

  it("pins #me above the channels, with its ⌘1 shortcut", () => {
    renderList();
    const me = screen.getByText("me");
    const eng = screen.getByText("engineering");
    expect(
      me.compareDocumentPosition(eng) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ChannelHotkeys binds ⌘1-9 to the same slots; the list is where they're
    // advertised now that the switcher popover is gone.
    expect(me.parentElement?.textContent).toMatch(/me(⌘|Ctrl)/);
  });

  // "Starred" and "Channels" are headings over the rows, not parents of them —
  // under the layout the rows sit at the heading's level and keep the "#" for
  // themselves. The alpha's tree is unchanged.
  describe("group headings", () => {
    beforeEach(() => {
      mocks.starredPaths = [ENG.path];
    });

    it("does not indent rows under the layout", () => {
      renderList();
      expect(screen.getByText("engineering").closest(".pl-5")).toBeNull();
    });

    it("keeps the indented tree off the layout", () => {
      mocks.channelsLayout = false;
      renderList();
      expect(screen.getByText("engineering").closest(".pl-5")).toBeTruthy();
    });
  });

  describe("search", () => {
    // The list is the only way to switch channels now, so with a few dozen
    // channels it has to be filterable rather than only scrollable.
    it("narrows the list to matching channels", async () => {
      const user = userEvent.setup();
      renderList();

      await user.type(screen.getByLabelText("Search channels"), "eng");

      expect(screen.getByText("engineering")).toBeTruthy();
      expect(screen.queryByText("design")).toBeNull();
      expect(screen.queryByText("me")).toBeNull();
    });

    // Grouping is for browsing; once you've named what you want, "Starred" and
    // "Channels" headings only stand between you and the one row that matches.
    it("drops the group headings while filtering", async () => {
      const user = userEvent.setup();
      mocks.starredPaths = [ENG.path];
      renderList();
      expect(screen.getByText("Starred")).toBeTruthy();

      await user.type(screen.getByLabelText("Search channels"), "eng");

      expect(screen.queryByText("Starred")).toBeNull();
      expect(screen.getByText("engineering")).toBeTruthy();
    });

    // The alpha renders this list as a plain tree with no slider around it, and
    // ChannelHotkeys doesn't bind ⌘1-9 there either — so neither shows.
    it("is absent off the channels layout, along with the shortcut hints", () => {
      mocks.channelsLayout = false;
      renderList();
      expect(screen.queryByLabelText("Search channels")).toBeNull();
      expect(screen.getByText("me").parentElement?.textContent).toBe("me");
    });

    it("says so when nothing matches", async () => {
      const user = userEvent.setup();
      renderList();

      await user.type(screen.getByLabelText("Search channels"), "zzz");

      expect(screen.getByText(/No channels match/)).toBeTruthy();
    });
  });
});
