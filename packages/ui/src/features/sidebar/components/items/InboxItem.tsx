import { EnvelopeSimple } from "@phosphor-icons/react";
import { Badge } from "@posthog/quill";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { SidebarItem } from "../SidebarItem";
import { SidebarCountBadge } from "./SidebarCountBadge";
import { SidebarKbdHint } from "./SidebarKbdHint";

interface InboxItemProps {
  isActive: boolean;
  onClick: () => void;
  pullRequestCount?: number;
}

export function InboxItem({
  isActive,
  onClick,
  pullRequestCount = 0,
}: InboxItemProps) {
  return (
    <Tooltip
      content={
        pullRequestCount > 0
          ? `${pullRequestCount} pull request${pullRequestCount === 1 ? "" : "s"} to review`
          : "No pull requests to review"
      }
      side="right"
    >
      <div>
        <SidebarItem
          depth={0}
          icon={
            <EnvelopeSimple size={16} weight={isActive ? "fill" : "regular"} />
          }
          label={
            <>
              Inbox
              <SidebarCountBadge
                count={pullRequestCount}
                title={`${pullRequestCount} pull requests to review`}
              />
            </>
          }
          isActive={isActive}
          onClick={onClick}
          endContent={
            <>
              <Badge variant="warning">Alpha</Badge>
              <SidebarKbdHint keys={SHORTCUTS.INBOX} />
            </>
          }
        />
      </div>
    </Tooltip>
  );
}
