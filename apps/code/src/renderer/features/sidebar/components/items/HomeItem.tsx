import { Badge } from "@components/ui/Badge";
import { Tooltip } from "@components/ui/Tooltip";
import { EnvelopeSimple, Plus } from "@phosphor-icons/react";
import type { ButtonProps } from "@posthog/quill";
import {
  formatHotkey,
  SHORTCUTS,
} from "@renderer/constants/keyboard-shortcuts";
import { SidebarItem } from "../SidebarItem";

interface NewTaskItemProps {
  isActive: boolean;
  onClick: () => void;
  variant?: ButtonProps["variant"];
}

export function NewTaskItem({ isActive, onClick }: NewTaskItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Plus size={16} weight={isActive ? "bold" : "regular"} />}
      label="New task"
      isActive={isActive}
      onClick={onClick}
    />
  );
}

interface InboxItemProps {
  isActive: boolean;
  onClick: () => void;
  signalCount?: number;
}

function formatSignalCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function InboxItem({ isActive, onClick, signalCount }: InboxItemProps) {
  return (
    <Tooltip
      content={
        signalCount && signalCount > 0
          ? `${signalCount} actionable report${signalCount === 1 ? "" : "s"} assigned to you`
          : "No actionable reports assigned to you yet"
      }
      shortcut={formatHotkey(SHORTCUTS.INBOX)}
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
              {signalCount && signalCount > 0 ? (
                <span
                  className="ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-(--red-9) p-1 font-medium text-[10px] leading-none"
                  style={{
                    color: "white",
                  }}
                  title={`${signalCount} actionable reports for you`}
                >
                  {formatSignalCount(signalCount)}
                </span>
              ) : null}
            </>
          }
          isActive={isActive}
          onClick={onClick}
          endContent={<Badge color="amber">Alpha</Badge>}
        />
      </div>
    </Tooltip>
  );
}
