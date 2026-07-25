import {
  BookOpenTextIcon,
  ChatsCircleIcon,
  FunnelSimple as FunnelSimpleIcon,
  MagnifyingGlass,
  PackageIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  MenuLabel,
  Skeleton,
} from "@posthog/quill";
import { LOOPS_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { ChannelItemRow } from "@posthog/ui/features/canvas/components/ChannelItemRow";
import { ChannelSwitcher } from "@posthog/ui/features/canvas/components/ChannelSwitcher";
import { useChannelItems } from "@posthog/ui/features/canvas/hooks/useChannelItems";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { NewTaskItem } from "@posthog/ui/features/sidebar/components/items/NewTaskItem";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { navigateToChannelNewTask } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

type CreatedByFilter = "anyone" | "me" | "others";

const STATUS_FILTER_OPTIONS: readonly {
  value: string | null;
  label: string;
}[] = [
  { value: null, label: "Any status" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const CREATED_BY_OPTIONS: readonly { value: CreatedByFilter; label: string }[] =
  [
    { value: "anyone", label: "Anyone" },
    { value: "me", label: "Me" },
    { value: "others", label: "Other people" },
  ] as const;

const HEADER_ICON_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12";

const cnHeaderButton = (active: boolean) =>
  cn(HEADER_ICON_BUTTON_CLASS, active && "bg-gray-3 text-gray-12");

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
  statusFilter: string | null;
  onStatusChange: (value: string | null) => void;
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
                onStatusChange(value === "any" ? null : value)
              }
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
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

// Varied-width ghost rows so the loading state reads as the list it becomes.
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
 * The sidebar body while a channel is active: the switcher, its sections
 * (Context / Loops / Artifacts), then pinned and recent tasks & canvases.
 */
export function ChannelSidebar({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);

  const { channels } = useChannels();
  const channelName =
    channels.find((c) => c.id === channelId)?.name ?? "channel";

  const { items, meUuid, meName, isLoading } = useChannelItems(
    channelId,
    channelName,
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createdByFilter, setCreatedByFilter] =
    useState<CreatedByFilter>("anyone");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const filtersActive = createdByFilter !== "anyone" || statusFilter !== null;

  const base = `/website/${channelId}`;
  const pinnedItems = items.filter((i) => i.pinned);

  const normalizedQuery = query.trim().toLowerCase();
  const recentItems = items
    .filter((i) => {
      if (i.pinned) return false;
      if (normalizedQuery && !i.title.toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      if (createdByFilter !== "anyone") {
        const isMine = i.authorUser
          ? i.authorUser.uuid === meUuid
          : i.authorName != null && meName != null && i.authorName === meName;
        if (createdByFilter === "me" && !isMine) return false;
        if (createdByFilter === "others" && isMine) return false;
      }
      if (statusFilter && i.rawStatus !== statusFilter) return false;
      return true;
    })
    .slice(0, RECENTS_CAP);

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
      <ChannelSwitcher channelId={channelId} />

      <div className="px-2 pt-2">
        <NewTaskItem
          isActive={pathname === `${base}/new`}
          onClick={() => {
            track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
              item: "new_task",
              in_more: false,
            });
            navigateToChannelNewTask(channelId);
          }}
        />
      </div>

      <div className="flex flex-col gap-px px-2 pt-1">
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

      <div className="scroll-mask-4 mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading && items.length === 0 && <ChannelItemsSkeleton />}

        {pinnedItems.length > 0 && (
          <>
            <MenuLabel>Pinned</MenuLabel>
            <div className="flex flex-col gap-px">
              {pinnedItems.map((item) => (
                <ChannelItemRow key={item.key} item={item} />
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
                  <ChannelItemRow key={item.key} item={item} />
                ))}
              </div>
            ) : (
              <p className="px-2 py-2 text-[12px] text-gray-10">
                Nothing matches the current search or filters.
              </p>
            )}
          </>
        )}

        {!isLoading && items.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-gray-10">
            Tasks and canvases you create in this channel show up here.
          </p>
        )}
      </div>
    </div>
  );
}
