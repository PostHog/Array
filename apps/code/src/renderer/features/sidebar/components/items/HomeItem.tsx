import { Tooltip } from "@components/ui/Tooltip";
import { EnvelopeSimple, Plus } from "@phosphor-icons/react";
import { Badge, type ButtonProps } from "@posthog/quill";
import { SHORTCUTS } from "@renderer/constants/keyboard-shortcuts";
import { useDraftStore } from "@renderer/features/message-editor/stores/draftStore";
import { isContentEmpty } from "@renderer/features/message-editor/utils/content";
import { SidebarItem } from "../SidebarItem";
import { SidebarKbdHint } from "./SidebarKbdHint";

interface NewTaskItemProps {
  isActive: boolean;
  onClick: () => void;
  variant?: ButtonProps["variant"];
}

export function NewTaskItem({ isActive, onClick }: NewTaskItemProps) {
  const hasDraft = useDraftStore(
    (s) => !isContentEmpty(s.drafts["task-input"]),
  );
  return (
    <SidebarItem
      depth={0}
      icon={<Plus size={16} weight={isActive ? "bold" : "regular"} />}
      label="New task"
      isActive={isActive}
      onClick={onClick}
      endContent={
        <>
          {hasDraft ? (
            <Badge variant="default" title="You have unsubmitted changes">
              Draft
            </Badge>
          ) : null}
          <SidebarKbdHint keys={SHORTCUTS.NEW_TASK} />
        </>
      }
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
