import { Button, cn } from "@posthog/quill";
import { ChannelPinnedMenu } from "@posthog/ui/features/canvas/components/ChannelPinnedMenu";
import { Link, useRouterState } from "@tanstack/react-router";

const TABS = [
  { label: "Inbox", to: "/website/$channelId/inbox" },
  { label: "Artifacts", to: "/website/$channelId/artifacts" },
  { label: "Recents", to: "/website/$channelId/history" },
  { label: "CONTEXT.md", to: "/website/$channelId/context" },
] as const;

// Home / History / Artifacts tab switcher shown in the channel header bar, with
// a Pinned quick-access menu alongside. Pathname-driven active state (the
// codebase's convention) rather than Link's activeProps.
export function ChannelTabs({ channelId }: { channelId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex items-center gap-px">
      {TABS.map((tab) => {
        const href = tab.to.replace("$channelId", channelId);
        const active = pathname === href;
        return (
          <Button
            key={tab.label}
            variant="default"
            size="sm"
            data-selected={active || undefined}
            className={cn(active && "bg-fill-selected")}
            render={<Link to={tab.to} params={{ channelId }} />}
          >
            {tab.label}
          </Button>
        );
      })}
      <ChannelPinnedMenu channelId={channelId} />
    </nav>
  );
}
