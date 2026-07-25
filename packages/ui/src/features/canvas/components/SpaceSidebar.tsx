import { PreviewCard } from "@base-ui/react/preview-card";
import {
  Archive,
  BookOpenTextIcon,
  FileTextIcon,
  FunnelSimple as FunnelSimpleIcon,
  HashIcon,
  MagnifyingGlass,
  PackageIcon,
  PlusIcon,
  PushPin,
  RepeatIcon,
} from "@phosphor-icons/react";
import type { ChannelTaskRecord } from "@posthog/core/canvas/channelTaskSchemas";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  Avatar,
  AvatarFallback,
  Badge,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  MenuLabel,
} from "@posthog/quill";
import { formatRelativeTimeShort, LOOPS_FLAG } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTasks } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { usePinnedTasks } from "@posthog/ui/features/sidebar/usePinnedTasks";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToChannelNewTask } from "@posthog/ui/router/navigationBridge";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { type ReactNode, useMemo, useState } from "react";

type StatusVariant = "default" | "destructive" | "info" | "success" | "warning";

interface SpaceItem {
  key: string;
  kind: "task" | "canvas";
  title: string;
  ts: number;
  pinned: boolean;
  icon: ReactNode;
  isActive: boolean;
  /** Run status ("In progress", …) for the hover card; tasks only. */
  status: string | null;
  /** Raw run status value, for the status filter. */
  rawStatus: string | null;
  statusVariant: StatusVariant;
  /** Who created it — the full user when known (tasks), else a name. */
  authorUser: UserBasic | null;
  authorName: string | null;
  onClick: () => void;
  onTogglePin: () => void;
  /** Tasks only — canvases can't be archived. */
  onArchive?: () => void;
}

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

const CREATED_BY_OPTIONS: readonly {
  value: CreatedByFilter;
  label: string;
}[] = [
  { value: "anyone", label: "Anyone" },
  { value: "me", label: "Me" },
  { value: "others", label: "Other people" },
] as const;

const HEADER_ICON_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12";
const HOVER_ACTION_CLASS =
  "flex h-5 w-5 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12";

const cnHeaderButton = (active: boolean) =>
  cn(HEADER_ICON_BUTTON_CLASS, active && "bg-gray-3 text-gray-12");

function humanizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusVariantFor(status: string | null | undefined): StatusVariant {
  if (!status) return "default";
  const value = status.toLowerCase();
  if (value.includes("complete")) return "success";
  if (value.includes("fail") || value.includes("error")) return "destructive";
  if (
    value.includes("progress") ||
    value.includes("running") ||
    value.includes("pending") ||
    value.includes("start")
  ) {
    return "info";
  }
  return "default";
}

// A pinned/recent row with its hover card (Base UI PreviewCard): icon, full
// title, kind + freshness, status badge, and the author with their avatar.
function SpaceItemRow({ item }: { item: SpaceItem }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={400}
        closeDelay={100}
        render={
          <div className="min-w-0">
            <SidebarItem
              depth={0}
              icon={item.icon}
              // A non-string label opts out of SidebarItem's built-in
              // truncation tooltip — the hover card carries the full title.
              label={<>{item.title}</>}
              isActive={item.isActive}
              onClick={item.onClick}
              // At rest: the relative time. On hover: pin + archive, like the
              // old task rows.
              endContent={
                <>
                  <span className="shrink-0 text-[11px] text-gray-11 group-hover:hidden">
                    {formatRelativeTimeShort(item.ts)}
                  </span>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <Tooltip content={item.pinned ? "Unpin" : "Pin"} side="top">
                      <NestedButton
                        aria-label={item.pinned ? "Unpin" : "Pin"}
                        className={HOVER_ACTION_CLASS}
                        onActivate={item.onTogglePin}
                      >
                        <PushPin
                          size={12}
                          weight={item.pinned ? "fill" : "regular"}
                        />
                      </NestedButton>
                    </Tooltip>
                    {item.onArchive && (
                      <Tooltip content="Archive task" side="top">
                        <NestedButton
                          aria-label="Archive task"
                          className={HOVER_ACTION_CLASS}
                          onActivate={item.onArchive}
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
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-3">
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-[13px] text-gray-12 leading-snug">
                  {item.title}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-10">
                  {item.kind === "canvas" ? "Canvas" : "Task"} · updated{" "}
                  {formatRelativeTimeShort(item.ts)}
                </p>
              </div>
            </div>
            {item.status && (
              <div className="mt-2">
                <Badge variant={item.statusVariant}>{item.status}</Badge>
              </div>
            )}
            {(item.authorUser || item.authorName) && (
              <div className="mt-2.5 flex items-center gap-2 border-border border-t pt-2.5">
                {item.authorUser ? (
                  <UserAvatar user={item.authorUser} />
                ) : (
                  <Avatar>
                    <AvatarFallback>
                      {(item.authorName ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-gray-12">
                    {item.authorName ?? "Unknown"}
                  </p>
                  <p className="text-[10px] text-gray-10">Created by</p>
                </div>
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

const RECENTS_CAP = 30;

/**
 * The sidebar body while a space (channel) is active — the Arc-style layout:
 * New task, the channel header, the channel's sections (Context / Loops /
 * Artifacts) as nav rows, then pinned and recent tasks & canvases. Slides in
 * on space switches; the sidebar-wide swipe handler lives in ChannelsSidebar.
 */
export function SpaceSidebar({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const direction = useSpaceStore((s) => s.direction);
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);

  const { channels } = useChannels();
  const channelName =
    channels.find((c) => c.id === channelId)?.name ?? "channel";

  const { dashboards } = useDashboards(channelId);
  const { tasks: filedTasks } = useChannelTasks(channelId);
  // All users' tasks, not just mine: a channel's filed tasks belong to the
  // whole team, and rows are dropped when the task can't be resolved — the
  // default mine-only list silently hid everyone else's work.
  const { data: tasks } = useTasks({ showAllUsers: true });
  const archivedTaskIds = useArchivedTaskIds();
  const { pinnedTaskIds, togglePin } = usePinnedTasks();
  const { archiveTask } = useArchiveTask({ navigateSpace: "website" });
  const { setPinned: setCanvasPinned } = useDashboardMutations();
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });

  // Recent-section controls: title search plus created-by / status filters,
  // mirroring the old task list's header (minus "Add folder").
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createdByFilter, setCreatedByFilter] =
    useState<CreatedByFilter>("anyone");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const filtersActive = createdByFilter !== "anyone" || statusFilter !== null;

  const base = `/website/${channelId}`;
  const isPersonal = channelName === PERSONAL_CHANNEL_NAME;
  const meUuid = currentUser?.uuid ?? null;
  const meName = currentUser ? userDisplayName(currentUser) : null;

  const items = useMemo<SpaceItem[]>(() => {
    const canvasItems: SpaceItem[] = dashboards.map((d: DashboardSummary) => ({
      key: `canvas:${d.id}`,
      kind: "canvas",
      title: d.name,
      ts: d.updatedAt,
      pinned: d.pinnedAt != null,
      icon: iconForTemplate(d.templateId, {
        size: 15,
        className: "text-violet-9",
      }),
      status: null,
      rawStatus: null,
      statusVariant: "default" as const,
      authorUser: null,
      authorName: d.createdBy ?? null,
      isActive: pathname === `${base}/dashboards/${d.id}`,
      onClick: () =>
        void navigate({
          to: "/website/$channelId/dashboards/$dashboardId",
          params: { channelId, dashboardId: d.id },
        }),
      onTogglePin: () => {
        setCanvasPinned(d.id, d.pinnedAt == null).catch(() => {
          toast.error("Couldn't update pin");
        });
      },
    }));

    const taskById = new Map(tasks?.map((t) => [t.id, t]) ?? []);
    const taskItems: SpaceItem[] = filedTasks.flatMap(
      (f: ChannelTaskRecord) => {
        const task = taskById.get(f.taskId);
        if (archivedTaskIds.has(f.taskId) || !task) return [];
        return [
          {
            key: `task:${f.id}`,
            kind: "task" as const,
            title: task.title || "Untitled task",
            ts: Date.parse(task.updated_at) || 0,
            pinned: pinnedTaskIds.has(f.taskId),
            icon: <FileTextIcon size={15} className="text-blue-9" />,
            status: humanizeStatus(task.latest_run?.status),
            rawStatus: task.latest_run?.status ?? null,
            statusVariant: statusVariantFor(task.latest_run?.status),
            authorUser: task.created_by ?? null,
            authorName: task.created_by
              ? userDisplayName(task.created_by)
              : null,
            isActive: pathname === `${base}/tasks/${f.taskId}`,
            onClick: () =>
              void navigate({
                to: "/website/$channelId/tasks/$taskId",
                params: { channelId, taskId: f.taskId },
              }),
            onTogglePin: () => {
              togglePin(f.taskId).catch(() => {
                toast.error("Couldn't update pin");
              });
            },
            onArchive: () => {
              void archiveTask({ taskId: f.taskId });
            },
          },
        ];
      },
    );

    const all = [...canvasItems, ...taskItems].sort((a, b) => b.ts - a.ts);

    // The personal space is *yours*: the shared "me" folder can hold other
    // people's items, so drop anything whose author is known and isn't you.
    // Unknown authors stay (better to over-show than hide your own work), and
    // nothing is dropped until the current user has actually loaded.
    if (!isPersonal || (!meUuid && !meName)) return all;
    return all.filter((item) => {
      if (item.authorUser) return item.authorUser.uuid === meUuid;
      if (item.authorName && meName) return item.authorName === meName;
      return true;
    });
  }, [
    dashboards,
    filedTasks,
    tasks,
    archivedTaskIds,
    pinnedTaskIds,
    pathname,
    base,
    channelId,
    navigate,
    togglePin,
    archiveTask,
    setCanvasPinned,
    isPersonal,
    meUuid,
    meName,
  ]);

  const pinnedItems = items.filter((i) => i.pinned);

  // The Recent list honors the header's search + filters; Pinned stays as-is.
  const normalizedQuery = query.trim().toLowerCase();
  const recentItems = items
    .filter((i) => !i.pinned)
    .filter((i) => {
      if (normalizedQuery && !i.title.toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      if (createdByFilter !== "anyone") {
        // Tasks carry the author's uuid; canvases only a display name.
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
    <motion.div
      key={channelId}
      initial={{ x: direction * 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: [0, 0, 0.2, 1] }}
      className="flex h-full min-h-0 flex-col"
    >
      {/* Channel header: the space's identity, click = channel home. */}
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/website/$channelId",
            params: { channelId },
          })
        }
        className="mx-2 mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-gray-3"
      >
        <HashIcon size={14} className="shrink-0 text-gray-10" />
        <span className="min-w-0 truncate font-semibold text-[13px] text-gray-12">
          {channelName}
        </span>
      </button>

      <div className="flex flex-col gap-px px-2 pt-1">
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

      {/* New task sits below the space's nav, right above the item lists. */}
      <div className="flex flex-col gap-px px-2 pt-2">
        <SidebarItem
          depth={0}
          icon={<PlusIcon size={16} />}
          label="New task"
          isActive={pathname === `${base}/new`}
          onClick={() => navigateToChannelNewTask(channelId)}
        />
      </div>

      <div className="scroll-mask-4 mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pinnedItems.length > 0 && (
          <>
            <MenuLabel>Pinned</MenuLabel>
            <div className="flex flex-col gap-px">
              {pinnedItems.map((item) => (
                <SpaceItemRow key={item.key} item={item} />
              ))}
            </div>
          </>
        )}

        {(items.some((i) => !i.pinned) || filtersActive || searchOpen) && (
          <>
            <div className="flex items-center gap-0.5 pr-1">
              <div className="min-w-0 flex-1">
                <MenuLabel>Recent</MenuLabel>
              </div>
              <button
                type="button"
                aria-label="Search"
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setQuery("");
                  setSearchOpen(!searchOpen);
                }}
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
                {/* Same construction as the task list's filter menu so the
                    two read identically. */}
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
                      setCreatedByFilter(value as CreatedByFilter)
                    }
                  >
                    {CREATED_BY_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <MenuLabel>Status</MenuLabel>
                  <DropdownMenuRadioGroup
                    value={statusFilter ?? "any"}
                    onValueChange={(value) =>
                      setStatusFilter(value === "any" ? null : value)
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
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search…"
                  aria-label="Search recent items"
                  className="h-6 text-[12px]"
                />
              </div>
            )}
            {recentItems.length > 0 ? (
              <div className="flex flex-col gap-px">
                {recentItems.map((item) => (
                  <SpaceItemRow key={item.key} item={item} />
                ))}
              </div>
            ) : (
              <p className="px-2 py-2 text-[12px] text-gray-10">
                Nothing matches the current search or filters.
              </p>
            )}
          </>
        )}

        {items.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-gray-10">
            Tasks and canvases you create in this space show up here.
          </p>
        )}
      </div>
    </motion.div>
  );
}
