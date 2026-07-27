import type { Contribution } from "@posthog/di/contribution";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { inject, injectable } from "inversify";
import { TASK_ACTIVITY_QUERY_KEY } from "./taskActivityQuery";

const RECONCILE_DELAY_MS = 2_000;

@injectable()
export class TaskActivityContribution implements Contribution {
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @inject(NotificationBus)
    private readonly notificationBus: NotificationBus,
    @inject(IMPERATIVE_QUERY_CLIENT)
    private readonly queryClient: ImperativeQueryClient,
  ) {}

  start(): void {
    this.notificationBus.subscribeToTaskCompletion(() => {
      this.refresh();
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = setTimeout(
        () => this.refresh(),
        RECONCILE_DELAY_MS,
      );
    });
  }

  private refresh(): void {
    void this.queryClient.invalidateQueries({
      queryKey: TASK_ACTIVITY_QUERY_KEY,
    });
  }
}
