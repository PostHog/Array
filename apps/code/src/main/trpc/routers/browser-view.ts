import { z } from "zod";
import { browserViewService } from "../../services/browser-view/service";
import { publicProcedure, router } from "../trpc";

export const browserViewRouter = router({
  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => browserViewService.setEnabled(input.enabled)),
});
