import {
  BookOpenTextIcon,
  ChatsCircleIcon,
  FunnelSimple as FunnelSimpleIcon,
  MagnifyingGlass,
  PackageIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import type { CreatedByFilter } from "@posthog/core/canvas/channelItems";
import { filterChannelItems } from "@posthog/core/canvas/channelItems";
import { RUN_STATUS_FILTER_OPTIONS } from "@posthog/core/canvas/runStatus";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  MenuLabel,
  Skeleton,
} from "@posthog/quill";
import { LOOPS_FLAG } from "@posthog/shared";
import type { TaskRunStatus } from "@posthog/shared/domain-types";
import { ChannelBackRow } from "@posthog/ui/features/canvas/components/ChannelBackRow";
import { ChannelItemRow } from "@posthog/ui/features/canvas/components/ChannelItemRow";
import { NewTaskFab } from "@posthog/ui/features/canvas/components/NewTaskFab";
import { useChannelItems } from "@posthog/ui/features/canvas/hooks/useChannelItems";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";

const CREATED_BY_OPTIONS: readonly { value: CreatedByFilter; label: string }[] =
  [
    { value: "anyone", label: "Anyone" },
    { value: "me", label: "Me" },
    { value: "others", label: "Other people" },
  ] as const;

const HEADER_ICON_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground";

const cnHeaderButton = (active: boolean) =>
  cn(HEADER_ICON_BUTTON_CLASS, active && "bg-fill-selected text-foreground");

const RECENTS_CAP = 30;

function RecentSectionHeader({
  searchOpen,
  onToggleSearch,
  query,
  onQueryChange,
  createdByFilter,
  onCreatedByChange,
  statusFilter,
  onStatusChange,
  filtersActive,
}: {
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  createdByFilter: CreatedByFilter;
  onCreatedByChange: (value: CreatedByFilter) => void;
  statusFilter: TaskRunStatus | null;
  onStatusChange: (value: TaskRunStatus | null) => void;
  filtersActive: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-0.5 pr-1">
        <div className="min-w-0 flex-1">
          <MenuLabel>Recent</MenuLabel>
        </div>
        <button
          type="button"
          aria-label="Search"
          aria-pressed={searchOpen}
          onClick={onToggleSearch}
          className={cnHeaderButton(searchOpen)}
        >
          <MagnifyingGlass size={12} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Filter"
                className={cnHeaderButton(filtersActive)}
              >
                <FunnelSimpleIcon size={12} />
              </button>
            }
          />
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="min-w-fit"
          >
            <MenuLabel>Created by</MenuLabel>
            <DropdownMenuRadioGroup
              value={createdByFilter}
              onValueChange={(value) =>
                onCreatedByChange(value as CreatedByFilter)
              }
            >
              {CREATED_BY_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <MenuLabel>Status</MenuLabel>
            <DropdownMenuRadioGroup
              value={statusFilter ?? "any"}
              onValueChange={(value) =>
                onStatusChange(
                  value === "any" ? null : (value as TaskRunStatus),
                )
              }
            >
              {RUN_STATUS_FILTER_OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value ?? "any"}
                  value={option.value ?? "any"}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {searchOpen && (
        <div className="px-1 pb-1">
          <Input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search…"
            aria-label="Search recent items"
            className="h-6 text-[12px]"
          />
        </div>
      )}
    </>
  );
}

// Varied widths so the loading state reads as the list it becomes.
const SKELETON_ROW_WIDTHS = [
  "w-3/5",
  "w-4/5",
  "w-2/5",
  "w-3/4",
  "w-1/2",
  "w-2/3",
] as const;

function ChannelItemsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-px">
      <Skeleton className="mx-2 mt-1.5 mb-1 h-3 w-12" />
      {SKELETON_ROW_WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className={cn("h-3.5", width)} />
        </div>
      ))}
    </div>
  );
}

/**
 * The channel pane of the sidebar slider: the way back to the channel list,
 * the channel's sections, then its pinned and recent tasks & canvases.
 */
export function ChannelSidebar({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);

  const { items, actions, me, isLoading, channelMissing } =
    useChannelItems(channelId);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createdByFilter, setCreatedByFilter] =
    useState<CreatedByFilter>("anyone");
  const [statusFilter, setStatusFilter] = useState<TaskRunStatus | null>(null);
  const filtersActive = createdByFilter !== "anyone" || statusFilter !== null;

  const base = `/website/${channelId}`;
  // Activeness is a key comparison rather than a flag baked into each item, so
  // navigating doesn't rebuild the list.
  const activeKey = useMemo(() => {
    const dashboard = pathname.match(/\/dashboards\/([^/]+)$/);
    if (dashboard) return `canvas:${dashboard[1]}`;
    const task = pathname.match(/\/tasks\/([^/]+)$/);
    return task ? `task:${task[1]}` : null;
  }, [pathname]);

  const pinnedItems = useMemo(() => items.filter((i) => i.pinned), [items]);
  const recentItems = useMemo(
    () =>
      filterChannelItems(
        items.filter((i) => !i.pinned),
        { query, createdBy: createdByFilter, status: statusFilter, me },
      ).slice(0, RECENTS_CAP),
    [items, query, createdByFilter, statusFilter, me],
  );

  const sectionRow = (
    label: string,
    icon: ReactNode,
    to: string,
    onClick: () => void,
  ) => (
    <SidebarItem
      depth={0}
      icon={icon}
      label={label}
      isActive={pathname === to}
      onClick={onClick}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelBackRow channelId={channelId} />

      <div className="flex flex-col gap-px px-2 pt-2">
        {sectionRow(
          "Feed",
          <ChatsCircleIcon size={16} />,
          base,
          () =>
            void navigate({ to: "/website/$channelId", params: { channelId } }),
        )}
        {sectionRow(
          "Context",
          <BookOpenTextIcon size={16} />,
          `${base}/context`,
          () =>
            void navigate({
              to: "/website/$channelId/context",
              params: { channelId },
            }),
        )}
        {loopsEnabled &&
          sectionRow(
            "Loops",
            <RepeatIcon size={16} />,
            `${base}/loops`,
            () =>
              void navigate({
                to: "/website/$channelId/loops",
                params: { channelId },
              }),
          )}
        {sectionRow(
          "Artifacts",
          <PackageIcon size={16} />,
          `${base}/artifacts`,
          () =>
            void navigate({
              to: "/website/$channelId/artifacts",
              params: { channelId },
            }),
        )}
      </div>

      {/* Relative so the FAB can float over the list. */}
      <div className="relative mt-2 min-h-0 flex-1">
        <div
          aria-busy={isLoading}
          className="scroll-mask-4 h-full overflow-y-auto px-2 pb-2"
        >
          {isLoading && items.length === 0 && <ChannelItemsSkeleton />}

          {channelMissing && (
            <Empty className="border-0 py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageIcon size={18} />
                </EmptyMedia>
                <EmptyTitle>Channel unavailable</EmptyTitle>
                <EmptyDescription>
                  It may have been deleted, or belong to another project.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {pinnedItems.length > 0 && (
            <>
              <MenuLabel>Pinned</MenuLabel>
              <div className="flex flex-col gap-px">
                {pinnedItems.map((item) => (
                  <ChannelItemRow
                    key={item.key}
                    item={item}
                    isActive={item.key === activeKey}
                    actions={actions}
                  />
                ))}
              </div>
            </>
          )}

          {(items.some((i) => !i.pinned) || filtersActive || searchOpen) && (
            <>
              <RecentSectionHeader
                searchOpen={searchOpen}
                onToggleSearch={() => {
                  if (searchOpen) setQuery("");
                  setSearchOpen(!searchOpen);
                }}
                query={query}
                onQueryChange={setQuery}
                createdByFilter={createdByFilter}
                onCreatedByChange={setCreatedByFilter}
                statusFilter={statusFilter}
                onStatusChange={setStatusFilter}
                filtersActive={filtersActive}
              />
              {recentItems.length > 0 ? (
                <div className="flex flex-col gap-px">
                  {recentItems.map((item) => (
                    <ChannelItemRow
                      key={item.key}
                      item={item}
                      isActive={item.key === activeKey}
                      actions={actions}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="border-0 py-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MagnifyingGlass size={18} />
                    </EmptyMedia>
                    <EmptyTitle>No matches</EmptyTitle>
                    <EmptyDescription>
                      Try a different search or clear the filters.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          )}

          {!isLoading && !channelMissing && items.length === 0 && (
            <Empty className="border-0 py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChatsCircleIcon size={18} />
                </EmptyMedia>
                <EmptyTitle>Nothing here yet</EmptyTitle>
                <EmptyDescription>
                  Tasks and canvases you create in this channel show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <NewTaskFab channelId={channelId} />
      </div>
    </div>
  );
}
