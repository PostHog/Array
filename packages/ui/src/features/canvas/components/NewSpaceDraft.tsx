import { HashIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Button, Input } from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { useChannelStarMutations } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useSpaces } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { toast } from "@posthog/ui/primitives/toast";
import { motion } from "framer-motion";
import { useState } from "react";

/**
 * The draft "new space" chooser, Arc/Zen-style: pressing "+" opens a temporary
 * space in the sidebar where you either attach an existing channel (starring
 * it, so its dot persists) or create a new channel. Cancelling returns to the
 * previous space.
 */
export function NewSpaceDraft() {
  const { spaces, switchTo } = useSpaces();
  const { channels } = useChannels();
  const { star } = useChannelStarMutations();
  const setDraftSpace = useSpaceStore((s) => s.setDraftSpace);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Channels that aren't a space yet — candidates to attach to this draft.
  const addable = channels
    .filter(
      (c) =>
        c.name !== PERSONAL_CHANNEL_NAME && !spaces.some((s) => s.id === c.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? addable.filter((c) => c.name.toLowerCase().includes(normalizedQuery))
    : addable;

  const attach = (channel: Channel) => {
    star(channel).catch((error: unknown) => {
      toast.error("Couldn't add space", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
    // Clears the draft too (setCurrentChannel dismisses the overrides).
    switchTo(channel);
  };

  return (
    <motion.div
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: [0, 0, 0.2, 1] }}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <span className="min-w-0 flex-1 truncate font-semibold text-[13px] text-gray-12">
          New space
        </span>
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Cancel new space"
          onClick={() => setDraftSpace(false)}
        >
          <XIcon size={14} />
        </Button>
      </div>
      <p className="px-3 pb-2 text-[12px] text-gray-10">
        Pick a channel for this space, or create a new one.
      </p>

      <div className="px-3 pb-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels…"
          aria-label="Search channels"
          className="h-7 text-[13px]"
        />
      </div>

      <div className="scroll-mask-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length > 0 && (
          <div className="flex flex-col gap-px">
            {filtered.map((channel) => (
              <SidebarItem
                key={channel.id}
                depth={0}
                icon={<HashIcon size={16} />}
                label={channel.name}
                onClick={() => attach(channel)}
              />
            ))}
          </div>
        )}
        {filtered.length === 0 && addable.length > 0 && (
          <p className="px-2 py-2 text-[12px] text-gray-10">
            No channels match "{query.trim()}".
          </p>
        )}
        {addable.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-gray-10">
            Every channel is already a space — create a new one.
          </p>
        )}
        <div className="mt-2 flex flex-col gap-px">
          <SidebarItem
            depth={0}
            icon={<PlusIcon size={16} />}
            label="New channel…"
            onClick={() => setCreateOpen(true)}
          />
        </div>
      </div>

      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
}
