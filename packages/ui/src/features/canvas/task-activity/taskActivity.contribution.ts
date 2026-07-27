import type { Contribution } from "@posthog/di/contribution";
import type { TaskActivityPage } from "@posthog/shared/domain-types";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import type { InfiniteData } from "@tanstack/react-query";
import { inject, injectable } from "inversify";
import { TASK_ACTIVITY_QUERY_KEY } from "./taskActivityQuery";

const POLL_INTERVAL_MS = 4_000;
const RECONCILE_DELAY_MS = 2_000;
const MAX_TRACKING_AGE_MS = 15 * 60_000;

@injectable()
export class TaskActivityContribution implements Contribution {
  private readonly tracked = new Map<
    string,
    { title: string; trackedAt: number }
  >();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @inject(NotificationBus)
    private readonly notificationBus: NotificationBus,
    @inject(IMPERATIVE_QUERY_CLIENT)
    private readonly queryClient: ImperativeQueryClient,
  ) {}

  start(): void {
    this.notificationBus.subscribeToTaskCompletion((taskId) => {
      if (taskId) this.untrack(taskId);
      this.refresh();
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = setTimeout(
        () => this.refresh(),
        RECONCILE_DELAY_MS,
      );
    });
    this.queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.query.queryKey[0] !== TASK_ACTIVITY_QUERY_KEY[0]
      ) {
        return;
      }
      this.handleActivity(
        event.query.state.data as InfiniteData<TaskActivityPage> | undefined,
      );
    });
  }

  track(task: { id: string; title: string }): void {
    this.tracked.set(task.id, { title: task.title, trackedAt: Date.now() });
    this.startPolling();
    this.refresh();
  }

  private handleActivity(
    data: InfiniteData<TaskActivityPage> | undefined,
  ): void {
    for (const item of data?.pages.flatMap((page) => page.results) ?? []) {
      const tracked = this.tracked.get(item.task_id);
      if (!tracked || item.activity_kind !== "completed") continue;
      this.untrack(item.task_id);
      this.notificationBus.notify({
        body: `"${tracked.title}" finished`,
        target: { kind: "task", taskId: item.task_id },
        toast: { level: "success" },
      });
    }
  }

  private refresh(): void {
    void this.queryClient.invalidateQueries({
      queryKey: TASK_ACTIVITY_QUERY_KEY,
    });
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      const cutoff = Date.now() - MAX_TRACKING_AGE_MS;
      for (const [taskId, task] of this.tracked) {
        if (task.trackedAt < cutoff) this.tracked.delete(taskId);
      }
      if (this.tracked.size === 0) {
        this.stopPolling();
        return;
      }
      this.refresh();
    }, POLL_INTERVAL_MS);
  }

  private untrack(taskId: string): void {
    this.tracked.delete(taskId);
    if (this.tracked.size === 0) this.stopPolling();
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
