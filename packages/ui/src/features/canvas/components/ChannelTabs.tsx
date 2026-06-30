import { cn } from "@posthog/quill";
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
    <nav className="flex items-center gap-0.5">
      {TABS.map((tab) => {
        const href = tab.to.replace("$channelId", channelId);
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            to={tab.to}
            params={{ channelId }}
            className={cn(
              "rounded-md px-2 py-1 font-medium text-[13px] no-underline transition-colors",
              active
                ? "bg-gray-3 text-gray-12"
                : "text-gray-10 hover:bg-gray-2 hover:text-gray-12",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      <ChannelPinnedMenu channelId={channelId} />
    </nav>
  );
}
