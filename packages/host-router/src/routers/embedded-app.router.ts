import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { EmbeddedAppProxyService } from "@posthog/workspace-server/services/embedded-app-proxy/embedded-app-proxy";
import { EMBEDDED_APP_PROXY_SERVICE } from "@posthog/workspace-server/services/embedded-app-proxy/identifiers";
import { z } from "zod";

/** EXPERIMENT (embedded webapp): expose the local proxy URL to the renderer. */
export const embeddedAppRouter = router({
  getUrl: publicProcedure
    .output(z.object({ url: z.string() }))
    .query(async ({ ctx }) => ({
      url: await ctx.container
        .get<EmbeddedAppProxyService>(EMBEDDED_APP_PROXY_SERVICE)
        .ensureStarted(),
    })),
});
