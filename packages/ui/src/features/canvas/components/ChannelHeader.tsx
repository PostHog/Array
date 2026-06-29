import { HashIcon } from "@phosphor-icons/react";
import { ChannelTabs } from "@posthog/ui/features/canvas/components/ChannelTabs";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { Text } from "@radix-ui/themes";
import { useNavigate } from "@tanstack/react-router";

// The shared channel header: a clickable "# channel" (→ channel home, like the
// sidebar channel row) followed by the channel tab strip. Rendered into the
// header bar by every channel view so the tabs stay in view across Home /
// Recents / Artifacts / CONTEXT.md.
export function ChannelHeader({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={() =>
          void navigate({ to: "/website/$channelId", params: { channelId } })
        }
        className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-gray-3"
      >
        <HashIcon
          size={12}
          className="mt-px shrink-0 text-muted-foreground/80"
        />
        <Text
          className="min-w-0 truncate font-medium text-[13px]"
          title={channelName}
        >
          {channelName ?? "Channel"}
        </Text>
      </button>
      <ChannelTabs channelId={channelId} />
    </div>
  );
}
