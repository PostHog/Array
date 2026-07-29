import { PreviewCard } from "@base-ui/react/preview-card";
import { Archive, PushPin } from "@phosphor-icons/react";
import type { ChannelItemModel } from "@posthog/core/canvas/channelItems";
import {
  runStatusLabel,
  runStatusVariant,
} from "@posthog/core/canvas/runStatus";
import { Avatar, AvatarFallback, Badge } from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannelTaskStatus } from "@posthog/ui/features/canvas/hooks/useChannelTaskStatus";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { InlineEditInput } from "@posthog/ui/features/sidebar/components/items/TaskItem";
import {
  TaskBadgeStack,
  TaskStatusDot,
  TaskStatusTooltips,
} from "@posthog/ui/features/sidebar/components/items/TaskStatusDot";
import { taskDot } from "@posthog/ui/features/sidebar/components/items/taskStatusVocabulary";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import type { ReactNode } from "react";

/**
 * What a row can do. One object per channel rather than closures per item, so
 * the item list stays plain data and doesn't rebuild on every navigation.
 */
export interface ChannelItemActions {
  open: (item: ChannelItemModel) => void;
  togglePin: (item: ChannelItemModel) => void;
  archive: (item: ChannelItemModel) => void;
}

// The channel sidebar's own chrome. Deliberately not shared with the Code
// sidebar's TaskItem: that one is still on the absolute gray scale, while these
// rows use the theme's fill/foreground tokens.
const HOVER_ACTION_CLASS =
  "flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground";
const HOVER_TOOLBAR_CLASS =
  "hidden shrink-0 items-center gap-0.5 group-hover:flex";
const TIMESTAMP_CLASS =
  "shrink-0 text-[11px] text-muted-foreground group-hover:hidden";
// Same hide-on-hover rule as the timestamp it replaces, so the pin/archive
// toolbar has the slot to itself while the pointer is on the row.
const TRAILING_CLASS = "flex shrink-0 items-center group-hover:hidden";

// A canvas has no run to report, so it keeps its template glyph. Tasks moved to
// the status dot, which is why only canvases still have an icon function.
function canvasIcon(item: ChannelItemModel): ReactNode {
  // Matches the schema's own default for boards saved before templating.
  return iconForTemplate(item.templateId ?? "freeform", {
    size: 15,
    className: "text-violet-9",
  });
}

function authorLabel(item: ChannelItemModel): string | null {
  if (item.authorUser) return userDisplayName(item.authorUser);
  return item.authorName;
}

export function ChannelItemRow({
  item,
  isActive,
  actions,
  isEditing = false,
  onContextMenu,
  onEditSubmit,
  onEditCancel,
}: {
  item: ChannelItemModel;
  isActive: boolean;
  actions: ChannelItemActions;
  isEditing?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
  onEditSubmit?: (newTitle: string) => void;
  onEditCancel?: () => void;
}) {
  const status = useChannelTaskStatus(item);
  const statusLabel = runStatusLabel(item.rawStatus);
  const author = authorLabel(item);
  // A task's leading mark is its state (dot / working spinner); a canvas has no
  // state, so it keeps the template glyph. The preview card always shows the
  // glyph — it has room to say what the row is as well as how it's doing.
  const icon = canvasIcon(item);
  const rowIcon = status ? <TaskStatusDot dot={taskDot(status)} /> : icon;

  if (isEditing) {
    return (
      <InlineEditInput
        depth={0}
        icon={rowIcon}
        label={item.title}
        isActive={isActive}
        onSubmit={(newTitle) => onEditSubmit?.(newTitle)}
        onCancel={() => onEditCancel?.()}
      />
    );
  }

  // One tooltip provider per task row, shared by its dot and badges so moving
  // between them doesn't re-wait the open delay. Canvas rows have neither.
  const row = (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={400}
        closeDelay={100}
        render={
          <div className="min-w-0">
            <SidebarItem
              depth={0}
              icon={rowIcon}
              // A non-string label opts out of SidebarItem's truncation tooltip.
              label={<span>{item.title}</span>}
              isActive={isActive}
              onClick={() => actions.open(item)}
              onContextMenu={onContextMenu}
              endContent={
                <>
                  {/* Badges take the timestamp's slot on a task row: the row's
                      identity (source, cloud, PR) is what you scan a task list
                      for, and the relative age is still in the preview card. */}
                  {status ? (
                    <span className={TRAILING_CLASS}>
                      <TaskBadgeStack status={status} />
                    </span>
                  ) : (
                    <span className={TIMESTAMP_CLASS}>
                      {formatRelativeTimeShort(item.ts)}
                    </span>
                  )}
                  <span className={HOVER_TOOLBAR_CLASS}>
                    <Tooltip content={item.pinned ? "Unpin" : "Pin"} side="top">
                      <NestedButton
                        aria-label={item.pinned ? "Unpin" : "Pin"}
                        className={HOVER_ACTION_CLASS}
                        onActivate={() => actions.togglePin(item)}
                      >
                        <PushPin
                          size={12}
                          weight={item.pinned ? "fill" : "regular"}
                        />
                      </NestedButton>
                    </Tooltip>
                    {/* Canvases can't be archived. */}
                    {item.kind === "task" && (
                      <Tooltip content="Archive task" side="top">
                        <NestedButton
                          aria-label="Archive task"
                          className={HOVER_ACTION_CLASS}
                          onActivate={() => actions.archive(item)}
                        >
                          <Archive size={12} />
                        </NestedButton>
                      </Tooltip>
                    )}
                  </span>
                </>
              }
            />
          </div>
        }
      />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={10}
          className="z-50"
        >
          <PreviewCard.Popup className="w-64 rounded-lg border border-border bg-background p-3 shadow-lg outline-none">
            <div className="flex items-start gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                {icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-[13px] text-foreground leading-snug">
                  {item.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.kind === "canvas" ? "Canvas" : "Task"} · updated{" "}
                  {formatRelativeTimeShort(item.ts)}
                </p>
              </div>
            </div>
            {statusLabel && (
              <div className="mt-2">
                <Badge variant={runStatusVariant(item.rawStatus)}>
                  {statusLabel}
                </Badge>
              </div>
            )}
            {author && (
              <div className="mt-2.5 flex items-center gap-2 border-border border-t pt-2.5">
                {item.authorUser ? (
                  <UserAvatar user={item.authorUser} />
                ) : (
                  <Avatar>
                    <AvatarFallback>
                      {author.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-foreground">
                    {author}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Created by
                  </p>
                </div>
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );

  return status ? <TaskStatusTooltips>{row}</TaskStatusTooltips> : row;
}
