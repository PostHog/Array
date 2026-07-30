import {
  type IRecentsService,
  RECENTS_SERVICE,
} from "@posthog/core/recents/identifiers";
import {
  recentEngagementInputSchema,
  recentItemSchema,
} from "@posthog/core/recents/schemas";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

export const recentsRouter = router({
  list: publicProcedure
    .output(z.array(recentItemSchema))
    .query(({ ctx }) =>
      ctx.container.get<IRecentsService>(RECENTS_SERVICE).list(),
    ),
  record: publicProcedure
    .input(recentEngagementInputSchema)
    .output(z.void())
    .mutation(({ ctx, input }) =>
      ctx.container.get<IRecentsService>(RECENTS_SERVICE).record(input),
    ),
});
