import { NOTIFICATION_SERVICE } from "@posthog/core/notification/identifiers";
import type { NotificationService } from "@posthog/core/notification/notification";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

export const notificationRouter = router({
  send: publicProcedure
    .input(
      z.object({
        title: z.string(),
        body: z.string(),
        silent: z.boolean(),
        taskId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<NotificationService>(NOTIFICATION_SERVICE)
        .send(input.title, input.body, input.silent, input.taskId),
    ),
  showDockBadge: publicProcedure.mutation(({ ctx }) =>
    ctx.container
      .get<NotificationService>(NOTIFICATION_SERVICE)
      .showDockBadge(),
  ),
  bounceDock: publicProcedure.mutation(({ ctx }) =>
    ctx.container.get<NotificationService>(NOTIFICATION_SERVICE).bounceDock(),
  ),
});
