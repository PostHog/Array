import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import {
  LOCAL_MCP_SERVICE,
  type LocalMcpService,
} from "@posthog/workspace-server/services/local-mcp/identifiers";
import {
  listLocalMcpServersInput,
  listLocalMcpServersOutput,
  localMcpConfigFileOutput,
  updateLocalMcpConfigFileInput,
} from "@posthog/workspace-server/services/local-mcp/schemas";

export const localMcpRouter = router({
  list: publicProcedure
    .input(listLocalMcpServersInput)
    .output(listLocalMcpServersOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<LocalMcpService>(LOCAL_MCP_SERVICE)
        .listServers(input.cwd),
    ),
  config: publicProcedure
    .output(localMcpConfigFileOutput)
    .query(({ ctx }) =>
      ctx.container.get<LocalMcpService>(LOCAL_MCP_SERVICE).getConfigFile(),
    ),
  updateConfig: publicProcedure
    .input(updateLocalMcpConfigFileInput)
    .output(localMcpConfigFileOutput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<LocalMcpService>(LOCAL_MCP_SERVICE)
        .updateConfigFile(input.content),
    ),
});
