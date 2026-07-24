import {
  BookOpenTextIcon,
  FileTextIcon,
  HashIcon,
  PackageIcon,
  PlusIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import type { ChannelTaskRecord } from "@posthog/core/canvas/channelTaskSchemas";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  MenuLabel,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { formatRelativeTimeShort, LOOPS_FLAG } from "@posthog/shared";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTasks } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useSpaces } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { usePinnedTasks } from "@posthog/ui/features/sidebar/usePinnedTasks";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { navigateToChannelNewTask } from "@posthog/ui/router/navigationBridge";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { type ReactNode, useMemo, useRef } from "react";

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
  /** Who created it, for the hover card. */
  person: string | null;
  onClick: () => void;
}

function humanizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A pinned/recent row with its hover card: kind, status, author, last update.
function SpaceItemRow({ item }: { item: SpaceItem }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="min-w-0">
            <SidebarItem
              depth={0}
              icon={item.icon}
              label={item.title}
              isActive={item.isActive}
              onClick={item.onClick}
            />
          </div>
        }
      />
      <TooltipContent side="right" sideOffset={10}>
        <div className="flex max-w-64 flex-col gap-0.5 py-0.5 text-left">
          <span className="font-medium text-[12px]">{item.title}</span>
          <span className="text-[11px] opacity-75">
            {item.kind === "canvas" ? "Canvas" : "Task"}
            {item.status ? ` · ${item.status}` : ""} ·{" "}
            {formatRelativeTimeShort(item.ts)}
          </span>
          {item.person && (
            <span className="text-[11px] opacity-75">By {item.person}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const RECENTS_CAP = 30;

// How much horizontal trackpad travel counts as a space swipe, and how long
// the switcher stays locked afterwards so one gesture moves one space.
const SWIPE_THRESHOLD = 90;
const SWIPE_LOCK_MS = 500;
const SWIPE_RESET_MS = 300;

/**
 * The sidebar body while a space (channel) is active — the Arc-style layout:
 * New task, the channel header, the channel's sections (Context / Loops /
 * Artifacts) as nav rows, then pinned and recent tasks & canvases. Slides in
 * on space switches; horizontal trackpad swipes cycle spaces.
 */
export function SpaceSidebar({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const direction = useSpaceStore((s) => s.direction);
  const { cycle } = useSpaces();
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);

  const { channels } = useChannels();
  const channelName =
    channels.find((c) => c.id === channelId)?.name ?? "channel";

  const { dashboards } = useDashboards(channelId);
  const { tasks: filedTasks } = useChannelTasks(channelId);
  const { data: tasks } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const { pinnedTaskIds } = usePinnedTasks();

  const base = `/website/${channelId}`;

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
      person: d.createdBy ?? null,
      isActive: pathname === `${base}/dashboards/${d.id}`,
      onClick: () =>
        void navigate({
          to: "/website/$channelId/dashboards/$dashboardId",
          params: { channelId, dashboardId: d.id },
        }),
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
            person: task.created_by ? userDisplayName(task.created_by) : null,
            isActive: pathname === `${base}/tasks/${f.taskId}`,
            onClick: () =>
              void navigate({
                to: "/website/$channelId/tasks/$taskId",
                params: { channelId, taskId: f.taskId },
              }),
          },
        ];
      },
    );

    return [...canvasItems, ...taskItems].sort((a, b) => b.ts - a.ts);
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
  ]);

  const pinnedItems = items.filter((i) => i.pinned);
  const recentItems = items.filter((i) => !i.pinned).slice(0, RECENTS_CAP);

  // Horizontal trackpad swipe cycles spaces, Arc-style. Accumulate deltaX and
  // fire once past the threshold; ignore mostly-vertical wheel events so list
  // scrolling never switches spaces.
  const swipeAccum = useRef(0);
  const swipeLockUntil = useRef(0);
  const swipeLastEvent = useRef(0);
  const onWheel = (event: React.WheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const now = Date.now();
    if (now < swipeLockUntil.current) return;
    if (now - swipeLastEvent.current > SWIPE_RESET_MS) swipeAccum.current = 0;
    swipeLastEvent.current = now;
    swipeAccum.current += event.deltaX;
    if (Math.abs(swipeAccum.current) >= SWIPE_THRESHOLD) {
      const delta = swipeAccum.current > 0 ? 1 : -1;
      swipeAccum.current = 0;
      swipeLockUntil.current = now + SWIPE_LOCK_MS;
      cycle(delta);
    }
  };

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
      onWheel={onWheel}
    >
      <div className="flex flex-col gap-px px-2 pt-2">
        <SidebarItem
          depth={0}
          icon={<PlusIcon size={16} />}
          label="New task"
          isActive={pathname === `${base}/new`}
          onClick={() => navigateToChannelNewTask(channelId)}
        />
      </div>

      {/* Channel header: the space's identity, click = channel home. */}
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/website/$channelId",
            params: { channelId },
          })
        }
        className="mx-2 mt-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-gray-3"
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

      <TooltipProvider delay={500}>
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

          {recentItems.length > 0 && (
            <>
              <MenuLabel>Recent</MenuLabel>
              <div className="flex flex-col gap-px">
                {recentItems.map((item) => (
                  <SpaceItemRow key={item.key} item={item} />
                ))}
              </div>
            </>
          )}

          {pinnedItems.length === 0 && recentItems.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-gray-10">
              Tasks and canvases you create in this space show up here.
            </p>
          )}
        </div>
      </TooltipProvider>
    </motion.div>
  );
}
