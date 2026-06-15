import {
  INBOX_LINK_SERVICE,
  NEW_TASK_LINK_SERVICE,
  SCOUT_LINK_SERVICE,
  TASK_LINK_SERVICE,
} from "@posthog/core/links/identifiers";
import {
  InboxLinkEvent,
  type InboxLinkService,
  type PendingInboxDeepLink,
} from "@posthog/core/links/inbox-link";
import {
  NewTaskLinkEvent,
  type NewTaskLinkPayload,
  type NewTaskLinkService,
} from "@posthog/core/links/new-task-link";
import {
  ScoutLinkEvent,
  type ScoutLinkPayload,
  type ScoutLinkService,
} from "@posthog/core/links/scout-link";
import {
  type PendingDeepLink,
  TaskLinkEvent,
  type TaskLinkService,
} from "@posthog/core/links/task-link";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

export const deepLinkRouter = router({
  onOpenTask: publicProcedure.subscription(async function* (opts) {
    const service = opts.ctx.container.get<TaskLinkService>(TASK_LINK_SERVICE);
    const iterable = service.toIterable(TaskLinkEvent.OpenTask, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  getPendingDeepLink: publicProcedure.query(
    ({ ctx }): PendingDeepLink | null => {
      return ctx.container
        .get<TaskLinkService>(TASK_LINK_SERVICE)
        .consumePendingDeepLink();
    },
  ),

  onOpenReport: publicProcedure.subscription(async function* (opts) {
    const service =
      opts.ctx.container.get<InboxLinkService>(INBOX_LINK_SERVICE);
    const iterable = service.toIterable(InboxLinkEvent.OpenReport, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  getPendingReportLink: publicProcedure.query(
    ({ ctx }): PendingInboxDeepLink | null => {
      return ctx.container
        .get<InboxLinkService>(INBOX_LINK_SERVICE)
        .consumePendingDeepLink();
    },
  ),

  onOpenScout: publicProcedure.subscription(async function* (opts) {
    const service =
      opts.ctx.container.get<ScoutLinkService>(SCOUT_LINK_SERVICE);
    const iterable = service.toIterable(ScoutLinkEvent.OpenScout, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  getPendingScoutLink: publicProcedure.query(
    ({ ctx }): ScoutLinkPayload | null => {
      return ctx.container
        .get<ScoutLinkService>(SCOUT_LINK_SERVICE)
        .consumePendingDeepLink();
    },
  ),

  onNewTaskAction: publicProcedure.subscription(async function* (opts) {
    const service = opts.ctx.container.get<NewTaskLinkService>(
      NEW_TASK_LINK_SERVICE,
    );
    const iterable = service.toIterable(NewTaskLinkEvent.Action, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  getPendingNewTaskLink: publicProcedure.query(
    ({ ctx }): NewTaskLinkPayload | null => {
      return ctx.container
        .get<NewTaskLinkService>(NEW_TASK_LINK_SERVICE)
        .consumePendingLink();
    },
  ),
});
