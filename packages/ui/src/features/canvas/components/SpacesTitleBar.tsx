import { BellIcon, MagnifyingGlassIcon, TrayIcon } from "@phosphor-icons/react";
import { countUnseenActivity } from "@posthog/core/canvas/mentionActivity";
import { Button } from "@posthog/quill";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import {
  navigateToActivity,
  navigateToInbox,
} from "@posthog/ui/router/navigationBridge";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { isMac } from "@posthog/ui/utils/platform";
import { Flex } from "@radix-ui/themes";
import { useMemo } from "react";

/** Title-bar search pill (opens the command menu); replaces the tab strip in spaces. */
export function SpacesSearchField() {
  const toggleCommandMenu = useCommandMenuStore((s) => s.toggle);
  return (
    <Flex align="center" justify="start" className="min-w-0 flex-1 pr-3">
      <button
        type="button"
        onClick={toggleCommandMenu}
        className="no-drag flex h-7 w-full max-w-[420px] items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-gray-10 transition-colors hover:bg-gray-3"
      >
        <MagnifyingGlassIcon size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search</span>
        <kbd className="shrink-0 rounded border border-border px-1 font-sans text-[10px] text-gray-9">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    </Flex>
  );
}

/** Title-bar Activity (bell + unread dot) and Inbox buttons. */
export function SpacesTitleBarActions() {
  const { items } = useMentionActivity();
  const lastSeenAt = useActivitySeenStore((s) => s.lastSeenAt);
  const unseen = useMemo(
    () => countUnseenActivity(items, lastSeenAt),
    [items, lastSeenAt],
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={unseen > 0 ? `Activity (${unseen} new)` : "Activity"}
        className="relative"
        onClick={navigateToActivity}
      >
        <BellIcon size={14} />
        Activity
        {unseen > 0 && (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-blue-9" />
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Inbox"
        onClick={navigateToInbox}
      >
        <TrayIcon size={14} />
        Inbox
      </Button>
    </>
  );
}
