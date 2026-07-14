import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@posthog/quill";
import type { TaskChannel } from "@posthog/shared/domain-types";
import { mentionChipClass } from "@posthog/ui/features/canvas/components/MentionText";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { Heading, Text } from "@radix-ui/themes";
import { FileCheckCorner, FilePlusCorner, Info } from "lucide-react";

// "today" / "yesterday" / "on July 10th" for the intro's creation line.
function creationDatePhrase(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `on ${date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
}

// The Slack-style intro pinned at the very start of a channel's feed: the
// channel name, who created it and when, and (until the context has a
// CONTEXT.md) a full-width card that starts the "Create your context.md" flow.
// Derived entirely from the channel row, so it renders for every public
// channel, not just freshly created ones.
export function ChannelIntro({
  channel,
  channelName,
  hasContextMd,
  onCreateContextMd,
}: {
  /** The backend channel row (creator + creation time). */
  channel: TaskChannel | undefined;
  channelName: string;
  /** Flips the card from the "Create a context.md" call to action to the
   * inert "Created context.md" success state. */
  hasContextMd: boolean;
  onCreateContextMd: () => void;
}) {
  const creator = channel?.created_by;

  return (
    <div className="flex w-full max-w-[70ch] flex-col gap-3 px-4 pt-8 pb-10">
      <div className="flex flex-col gap-0">
        <Heading className="font-bold text-2xl">{channelName}</Heading>
        {channel && (
          <Text size="2" className="text-muted-foreground">
            {/* Mention-styled but inert for now; later it opens the person. */}
            <span className={mentionChipClass}>
              @{userDisplayName(creator ?? null)}
            </span>{" "}
            created this context {creationDatePhrase(channel.created_at)}. This
            is the very beginning of the{" "}
            <Text weight="bold">{channelName}</Text> context.
          </Text>
        )}
      </div>
      <div className="flex gap-2">
        {hasContextMd ? (
          <Item tone="success" className="w-full">
            <ItemMedia variant="icon">
              <FileCheckCorner size={18} />
            </ItemMedia>
            <ItemContent className="self-start">
              <ItemTitle>Created context.md</ItemTitle>
              <ItemDescription>
                Used in all sessions within this context
              </ItemDescription>
            </ItemContent>
          </Item>
        ) : (
          <Item
            variant="pressable"
            className="w-full border-primary/50 bg-primary/10 hover:bg-primary/15"
            render={<button type="button" onClick={onCreateContextMd} />}
          >
            <ItemMedia variant="icon">
              <FilePlusCorner size={18} />
            </ItemMedia>
            <ItemContent className="self-start">
              <ItemTitle>Create a context.md</ItemTitle>
              <ItemDescription className="text-xs">
                Gives your agentic sessions everything they need to start new,
                or continue existing, tasks.
              </ItemDescription>
            </ItemContent>
          </Item>
        )}
        <Item
          className="w-full border-primary/50 hover:bg-fill-hover"
          variant="pressable"
          render={<button type="button" onClick={() => {}} />}
        >
          <ItemMedia variant="icon">
            <Info size={18} />
          </ItemMedia>
          <ItemContent className="self-start">
            <ItemTitle>Learn more about contexts</ItemTitle>
            <ItemDescription className="text-xs">
              Context is a group of tasks that are related to a specific topic.
            </ItemDescription>
          </ItemContent>
        </Item>
      </div>
    </div>
  );
}
