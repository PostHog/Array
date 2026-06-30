import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";

// A channel's inbox: where items needing attention will land. Placeholder for
// now — same shell as Recents/Artifacts, with a "coming soon" empty state.
export function WebsiteChannelInbox({ channelId }: { channelId: string }) {
  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_inbox",
      surface: "channel_inbox",
      channel_id: channelId,
    });
  }, [channelId]);

  useSetHeaderContent(
    useMemo(() => <ChannelHeader channelId={channelId} />, [channelId]),
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        <div className="flex flex-col items-center gap-1 py-24 text-center">
          <Text className="font-medium text-[14px] text-gray-12">
            Inbox coming soon
          </Text>
          <Text className="text-[13px] text-gray-10">
            This is where you'll triage what needs your attention in this
            channel.
          </Text>
        </div>
      </div>
    </div>
  );
}
