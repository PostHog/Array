import { CaretRightIcon, FileTextIcon, HashIcon } from "@phosphor-icons/react";
import type { ChannelTaskRecord } from "@posthog/core/canvas/channelTaskSchemas";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import { Button } from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { ChannelHomeComposer } from "@posthog/ui/features/canvas/components/ChannelHomeComposer";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useChannelTaskMutations,
  useChannelTasks,
} from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Distance (px) over which the heading fades out as the history scrolls up,
// so it reads like a channel intro that scrolls away behind the messages.
const HEADING_FADE_DISTANCE = 140;

type RecentItem = {
  key: string;
  kind: "task" | "canvas";
  title: string;
  ts: number;
  icon: ReactNode;
  accent: string;
  onClick: () => void;
};

// A channel's static homepage. Replaces the old auto-created "Home" canvas: a
// heading, a chat-like stack of the channel's recent tasks + canvases (most
// recent at the bottom, against the prompt box), and a composer that files new
// tasks into the channel.
export function WebsiteChannelHome({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { fileTask } = useChannelTaskMutations();

  const { data: instructions } = useFolderInstructions(channelId);
  const channelContext = instructions?.content;

  const openContext = useCallback(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "edit_context_open",
      surface: "channel_home",
      channel_id: channelId,
    });
    void navigate({
      to: "/website/$channelId/context",
      params: { channelId },
    });
  }, [channelId, navigate]);

  // "# channel" on the left, an open-CONTEXT.md button pinned to the far right.
  useSetHeaderContent(
    useMemo(
      () => (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <HashIcon
              size={12}
              className="mt-px shrink-0 text-muted-foreground/80"
            />
            <Text
              className="min-w-0 truncate font-medium text-[13px]"
              title={channelName}
            >
              {channelName ?? "Channel"}
            </Text>
          </div>
          <Button variant="outline" size="sm" onClick={openContext}>
            <FileTextIcon size={14} />
            CONTEXT.md
          </Button>
        </div>
      ),
      [channelName, openContext],
    ),
  );

  const { dashboards } = useDashboards(channelId);
  const { tasks: filedTasks } = useChannelTasks(channelId);
  const { data: tasks } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();

  const items = useMemo<RecentItem[]>(() => {
    const canvasItems: RecentItem[] = dashboards.map((d: DashboardSummary) => ({
      key: `canvas:${d.id}`,
      kind: "canvas",
      title: d.name,
      ts: d.updatedAt,
      icon: iconForTemplate(d.templateId, {
        size: 15,
        className: "text-violet-9",
      }),
      accent: "violet",
      onClick: () =>
        navigate({
          to: "/website/$channelId/dashboards/$dashboardId",
          params: { channelId, dashboardId: d.id },
        }),
    }));

    const taskById = new Map(tasks?.map((t) => [t.id, t]) ?? []);
    const taskItems: RecentItem[] = filedTasks
      .filter(
        (f: ChannelTaskRecord) =>
          !archivedTaskIds.has(f.taskId) && taskById.has(f.taskId),
      )
      .map((f: ChannelTaskRecord) => {
        const task = taskById.get(f.taskId) as Task;
        return {
          key: `task:${f.id}`,
          kind: "task" as const,
          title: task.title || "Untitled task",
          ts: Date.parse(task.updated_at) || 0,
          icon: <TaskGlyph />,
          accent: "blue",
          onClick: () =>
            navigate({
              to: "/website/$channelId/tasks/$taskId",
              params: { channelId, taskId: f.taskId },
            }),
        };
      });

    // Oldest first so the most recent settles at the bottom, against the box.
    return [...canvasItems, ...taskItems].sort((a, b) => a.ts - b.ts);
  }, [dashboards, filedTasks, tasks, archivedTaskIds, channelId, navigate]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [headingOpacity, setHeadingOpacity] = useState(1);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHeadingOpacity(Math.max(0, 1 - el.scrollTop / HEADING_FADE_DISTANCE));
  }, []);

  // Pin to the bottom (newest) on load and whenever the item count changes (the
  // recent lists fetch async after mount), the way a chat view opens on its
  // latest message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length is the intended re-pin trigger, even though the body reads it via the ref
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    handleScroll();
  }, [handleScroll, items.length]);

  const onTaskCreated = useCallback(
    (task: Task) => {
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      void fileTask(channelId, task.id, task.title)
        .then(() =>
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: true,
          }),
        )
        .catch((error: unknown) => {
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: false,
          });
          toast.error("Couldn't file task to channel", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId: task.id },
      });
    },
    [channelId, fileTask, navigate, queryClient],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col px-4">
          <div
            style={{ opacity: headingOpacity }}
            className="pointer-events-none pt-16 pb-10 text-center"
          >
            <h1 className="font-semibold text-2xl text-gray-12 tracking-tight">
              What can I do for you today?
            </h1>
            <Text className="mt-2 block text-[13px] text-gray-10">
              Ask anything, kick off a task, or pick up where you left off.
            </Text>
          </div>

          <div className="flex-1" />

          {items.length > 0 && (
            <div className="flex flex-col gap-0.5 pb-6">
              {items.map((item) => (
                <RecentItemRow key={item.key} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <ChannelHomeComposer
          channelId={channelId}
          channelName={channelName}
          channelContext={channelContext}
          onTaskCreated={onTaskCreated}
        />
      </div>
    </div>
  );
}

function RecentItemRow({ item }: { item: RecentItem }) {
  return (
    <button
      type="button"
      onClick={item.onClick}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-3"
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `var(--${item.accent}-3)` }}
      >
        {item.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {item.title}
        </span>
        <span className="truncate text-[11px] text-gray-10 leading-tight">
          {item.kind === "canvas" ? "Canvas" : "Task"} ·{" "}
          {formatRelativeTimeShort(item.ts)}
        </span>
      </span>
      <CaretRightIcon
        size={14}
        className="shrink-0 text-gray-8 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

// A small task glyph for the recent list, tinted to match the row's accent.
function TaskGlyph() {
  return (
    <span className="block size-2 rounded-full bg-blue-9" aria-hidden="true" />
  );
}
