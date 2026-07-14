import { ListChecksIcon } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useRecentTasksInfinite } from "@posthog/ui/features/tasks/useTasks";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useEffect } from "react";

function TaskRow({ task }: { task: Task }) {
  const openTask = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_task",
      surface: "activity",
      channel_id: task.channel ?? undefined,
      task_id: task.id,
    });
    // Channel-filed tasks keep the channels chrome under /website; everything
    // else opens the plain task view.
    if (task.channel) {
      navigateToChannelTask(task.channel, task.id);
    } else {
      navigateToTaskDetail(task.id);
    }
  };

  return (
    <button
      type="button"
      onClick={openTask}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-fill-secondary"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <TaskIcon
          taskRunStatus={task.latest_run?.status}
          originProduct={task.origin_product}
        />
      </span>
      <Text size="1" weight="medium" className="min-w-0 flex-1 truncate">
        {task.title || "Untitled task"}
      </Text>
      <Text size="1" className="shrink-0 text-muted-foreground">
        {formatRelativeTimeShort(task.updated_at)}
      </Text>
    </button>
  );
}

export function ActivityTasksTab() {
  const { tasks, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useRecentTasksInfinite();

  // Sentinel below the list: as it scrolls into view (with a margin so it fires
  // before the user reaches the very bottom), pull the next page.
  const [sentinelRef, sentinelInView] = useInView<HTMLDivElement>({
    rootMargin: "400px 0px",
  });

  useEffect(() => {
    if (sentinelInView && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [sentinelInView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecksIcon size={20} />
          </EmptyMedia>
          <EmptyTitle>No tasks yet</EmptyTitle>
          <EmptyDescription>
            Tasks you start show up here, newest first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <div className="flex justify-center py-3">
          <Spinner />
        </div>
      )}
      {!hasNextPage && (
        <Text size="1" className="block py-3 text-center text-muted-foreground">
          That's everything.
        </Text>
      )}
    </div>
  );
}
