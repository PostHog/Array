import { PreviewCard } from "@base-ui/react/preview-card";
import { ChatCircleIcon } from "@phosphor-icons/react";
import type { ChannelItemModel } from "@posthog/core/canvas/channelItems";
import {
  runStatusLabel,
  runStatusVariant,
} from "@posthog/core/canvas/runStatus";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Badge,
  Card,
  CardContent,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import {
  TaskRowContextMenu,
  TaskRowMenuList,
  type TaskRowMenuProps,
} from "@posthog/ui/features/canvas/components/TaskRowMenu";
import { useChannelTaskStatus } from "@posthog/ui/features/canvas/hooks/useChannelTaskStatus";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { InlineEditInput } from "@posthog/ui/features/sidebar/components/items/TaskItem";
import {
  PinnedBadge,
  TaskBadgeStack,
  TaskStatusDot,
  TaskStatusTooltips,
} from "@posthog/ui/features/sidebar/components/items/TaskStatusDot";
import { taskDot } from "@posthog/ui/features/sidebar/components/items/taskStatusVocabulary";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { type ReactNode, useState } from "react";

/**
 * What a row can do. One object per channel rather than closures per item, so
 * the item list stays plain data and doesn't rebuild on every navigation.
 */
export interface ChannelItemActions {
  open: (item: ChannelItemModel) => void;
  togglePin: (item: ChannelItemModel) => void;
  archive: (item: ChannelItemModel) => void;
  /** Canvases only — a task is archived, not deleted. */
  remove: (item: ChannelItemModel) => void;
}

// The channel sidebar's own chrome. Deliberately not shared with the Code
// sidebar's TaskItem: that one is still on the absolute gray scale, while these
// rows use the theme's fill/foreground tokens.
const TIMESTAMP_CLASS = "shrink-0 text-[11px] text-muted-foreground";
// The badges own the trailing slot outright now that the actions have moved to
// the hover card — a row's identity is what you scan a task list for. The gap is
// between stacks (a pin, then the status badges), not within one.
const TRAILING_CLASS = "flex shrink-0 items-center gap-1";

/**
 * What the card leads with. A canvas gets its template glyph in canvas violet; a
 * task gets the chat glyph the sidebar uses for a task with nothing going on —
 * before this, a task was shown wearing a canvas's icon.
 */
function previewGlyph(item: ChannelItemModel): ReactNode {
  if (item.kind !== "canvas") {
    return <ChatCircleIcon size={15} className="text-gray-10" />;
  }
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

/**
 * One badge in a row's trailing stack, named on hover like the ones
 * `TaskBadgeStack` draws — the row's tooltip provider is already up, so this
 * shares its open delay.
 */
function RowBadge({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Avatar size="xs" aria-label={label} role="img">
            <AvatarFallback className="bg-transparent">
              {children}
            </AvatarFallback>
          </Avatar>
        }
      />
      <TooltipContent side="top" className="pointer-events-none select-none">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A canvas's trailing stack: the pin, then its template glyph. Same stack as a
 * task's badges — a pinned canvas reads the way a pinned task does.
 */
function CanvasBadgeStack({
  item,
  pinned,
}: {
  item: ChannelItemModel;
  pinned?: boolean;
}) {
  return (
    <AvatarGroup stacked reverse size="xs" className="shrink-0">
      {pinned ? <PinnedBadge /> : null}
      <RowBadge label="Canvas">
        {/* Violet is the canvas colour everywhere else it appears — the
            artifacts list, the thread panel, the pinned menu — so the badge says
            "canvas" the same way they do. */}
        {iconForTemplate(item.templateId ?? "freeform", {
          size: 9,
          className: "text-violet-9",
        })}
      </RowBadge>
    </AvatarGroup>
  );
}

export function ChannelItemRow({
  item,
  isActive,
  actions,
  isEditing = false,
  onRename,
  onAddToCommandCenter,
  onEditSubmit,
  onEditCancel,
}: {
  item: ChannelItemModel;
  isActive: boolean;
  actions: ChannelItemActions;
  isEditing?: boolean;
  /** Puts the row into inline-rename mode. Absent for canvases. */
  onRename?: () => void;
  /** Absent when the command centre has no free cell, which disables the item. */
  onAddToCommandCenter?: () => void;
  onEditSubmit?: (newTitle: string) => void;
  onEditCancel?: () => void;
}) {
  const status = useChannelTaskStatus(item);
  const [cardOpen, setCardOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const statusLabel = runStatusLabel(item.rawStatus);
  const author = authorLabel(item);
  // The row's leading mark is always the task-list state vocabulary. Canvases
  // have no live run, so they use the quiet dot and move their glyph to the
  // right-side identity stack.
  const rowIcon = <TaskStatusDot dot={taskDot(status ?? {})} />;
  const previewIcon = previewGlyph(item);
  // A canvas gets the same menu with the items it actually has: pin, and delete
  // instead of archive. Filing and command-centre cells are task-shaped, and the
  // menu drops them rather than showing them dead.
  const menu: TaskRowMenuProps =
    item.kind === "canvas"
      ? {
          kind: "canvas",
          id: item.id,
          title: item.title,
          isPinned: item.pinned,
          onTogglePin: () => actions.togglePin(item),
          onDelete: () => actions.remove(item),
        }
      : {
          kind: "task",
          id: item.id,
          title: item.title,
          isPinned: item.pinned,
          onAddToCommandCenter,
          onRename,
          onTogglePin: () => actions.togglePin(item),
          onArchive: () => actions.archive(item),
        };

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
    // Controlled so the card survives its own submenu: "File to…" opens in a
    // portal outside the card, and the pointer moving there reads as leaving the
    // card, which would take the menu down with it.
    <PreviewCard.Root open={cardOpen || submenuOpen} onOpenChange={setCardOpen}>
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
              endContent={
                <span className={TRAILING_CLASS}>
                  {/* Badges take the timestamp's slot on a task row: the row's
                      identity (pin, source, cloud, PR) is what you scan a task
                      list for, and the relative age is still in the preview
                      card. The pin joins whichever stack the row has, rather
                      than standing beside it as a badge of its own. */}
                  {status ? (
                    <TaskBadgeStack status={status} pinned={item.pinned} />
                  ) : item.kind === "canvas" ? (
                    <CanvasBadgeStack item={item} pinned={item.pinned} />
                  ) : (
                    <>
                      {item.pinned && (
                        <AvatarGroup
                          stacked
                          reverse
                          size="xs"
                          className="shrink-0"
                        >
                          <PinnedBadge />
                        </AvatarGroup>
                      )}
                      <span className={TIMESTAMP_CLASS}>
                        {formatRelativeTimeShort(item.ts)}
                      </span>
                    </>
                  )}
                </span>
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
          {/* The card is quill's `Card` and `Item` parts throughout — the popup
              itself carries no surface styling, so this window's hover card
              matches every other card in the app rather than a hand-tuned
              shadow of its own. */}
          <PreviewCard.Popup render={<Card size="sm" className="w-64" />}>
            <CardContent>
              {/* ItemGroup's own gap is sized for cards of stacked panels, and
                  Item only reports its size through the class it takes — not a
                  data attribute the group can match — so the tight gap is set
                  here. */}
              <ItemGroup className="gap-1.5">
                <Item size="xs">
                  <ItemMedia variant="icon">{previewIcon}</ItemMedia>
                  <ItemContent>
                    <ItemTitle>{item.title}</ItemTitle>
                    <ItemDescription>
                      {item.kind === "canvas" ? "Canvas" : "Task"} · updated{" "}
                      {formatRelativeTimeShort(item.ts)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                {statusLabel && (
                  // `self-start` because ItemGroup is a stretching column and a
                  // full-width badge reads as a banner.
                  <Badge
                    variant={runStatusVariant(item.rawStatus)}
                    className="self-start"
                  >
                    {statusLabel}
                  </Badge>
                )}
                {author && (
                  <>
                    {/* Every section of the card gets the rule above it,
                        canvases included — the author is a different fact from
                        the thing's identity whether or not there are actions
                        under it. */}
                    <ItemSeparator className="my-0" />
                    <Item size="xs">
                      <ItemMedia variant="icon">
                        {item.authorUser ? (
                          <UserAvatar size="xs" user={item.authorUser} />
                        ) : (
                          <Avatar size="xs">
                            <AvatarFallback>
                              {author.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{author}</ItemTitle>
                        <ItemDescription>Created by</ItemDescription>
                      </ItemContent>
                    </Item>
                  </>
                )}
                {/* The row's actions live here now: a row at rest shows its
                    status, and the card is already the surface you're pointing
                    at when you want to do something to it. */}
                <ItemSeparator className="my-0" />
                <TaskRowMenuList
                  menu={menu}
                  onAction={() => setCardOpen(false)}
                  onSubmenuOpenChange={setSubmenuOpen}
                />
              </ItemGroup>
            </CardContent>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );

  const tipped = <TaskStatusTooltips>{row}</TaskStatusTooltips>;
  // Right-click opens the same actions the hover card lists, from the same
  // definition, so the two can't drift.
  return <TaskRowContextMenu menu={menu}>{tipped}</TaskRowContextMenu>;
}
