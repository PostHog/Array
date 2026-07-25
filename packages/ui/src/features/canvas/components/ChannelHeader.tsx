import { StarIcon } from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { ChannelTabs } from "@posthog/ui/features/canvas/components/ChannelTabs";
import { channelGlyph } from "@posthog/ui/features/canvas/components/channelGlyph";
import { useChannelStarToggle } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelsLayout } from "@posthog/ui/features/canvas/hooks/useChannelsLayout";
import { useMarkChannelSeen } from "@posthog/ui/features/canvas/hooks/useMarkChannelSeen";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";

// The feed-side counterpart to the switcher's hover star.
function ChannelStarButton({ channel }: { channel: Channel }) {
  const { isStarred, toggleStar } = useChannelStarToggle(channel);
  return (
    <Button
      type="button"
      size="icon-sm"
      aria-label={isStarred ? "Unstar channel" : "Star channel"}
      onClick={() => {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: isStarred ? "unstar" : "star",
          surface: "channel_home",
          channel_id: channel.id,
        });
        toggleStar();
      }}
    >
      <StarIcon
        size={14}
        weight={isStarred ? "fill" : "regular"}
        className={isStarred ? undefined : "text-muted-foreground/80"}
      />
    </Button>
  );
}

// The shared channel header. The new layout drops the section tab strip — the
// channel sidebar carries those entries — while flag off keeps it.
export function ChannelHeader({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const channelsLayout = useChannelsLayout();
  const { channels } = useChannels();
  const channel = channels.find((c) => c.id === channelId);
  const channelName = channel?.name;
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
        {channelGlyph(channelName, {
          size: 20,
          className: "shrink-0 text-muted-foreground/80",
        })}
        <Text className="min-w-0 truncate font-medium" title={channelName}>
          {channelName ?? "Channel"}
        </Text>
      </Button>
      {channelsLayout && channel && channel.name !== PERSONAL_CHANNEL_NAME && (
        <ChannelStarButton channel={channel} />
      )}
      {!channelsLayout && <ChannelTabs channelId={channelId} />}
    </div>
  );
}
