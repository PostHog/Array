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
  signalCount?: number;
}

export function InboxItem({
  isActive,
  onClick,
  signalCount = 0,
}: InboxItemProps) {
  return (
    <Tooltip
      content={
        signalCount > 0
          ? `${signalCount} actionable report${signalCount === 1 ? "" : "s"} assigned to you`
          : "No actionable reports assigned to you yet"
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
                count={signalCount}
                title={`${signalCount} actionable reports for you`}
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
