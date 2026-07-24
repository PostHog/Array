import { HashIcon } from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
import { ChannelTabs } from "@posthog/ui/features/canvas/components/ChannelTabs";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useMarkChannelSeen } from "@posthog/ui/features/canvas/hooks/useMarkChannelSeen";
import { useSpacesLayout } from "@posthog/ui/features/canvas/hooks/useSpacesLayout";
import { Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";

// The shared channel header: a clickable "# channel" routing to the channel
// home. The spaces layout drops the section tab strip (the space sidebar
// carries those entries); flag off keeps the strip as before.
export function ChannelHeader({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const spacesOn = useSpacesLayout();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === `/website/${channelId}`;
  // Every channel surface renders this header, so mark the channel read here.
  useMarkChannelSeen(channelName);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        data-selected={isHome || undefined}
        onClick={() =>
          void navigate({ to: "/website/$channelId", params: { channelId } })
        }
        size="sm"
        className={cn("min-w-0", isHome ? "bg-fill-selected" : "")}
      >
        <HashIcon size={20} className="shrink-0 text-muted-foreground/80" />
        <Text className="min-w-0 truncate font-medium" title={channelName}>
          {channelName ?? "Channel"}
        </Text>
      </Button>
      {!spacesOn && <ChannelTabs channelId={channelId} />}
    </div>
  );
}
