import {
  getToolDefinitionInput,
  getUiResourceByUriInput,
  getUiResourceInput,
  hasUiForToolInput,
  McpAppsServiceEvent,
  mcpAppsSubscriptionInput,
  mcpUiResourceSchema,
  openLinkInput,
  proxyResourceReadInput,
  proxyToolCallInput,
} from "@shared/types/mcp-apps";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { McpAppsService } from "../../services/mcp-apps/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<McpAppsService>(MAIN_TOKENS.McpAppsService);

export const mcpAppsRouter = router({
  getUiResource: publicProcedure
    .input(getUiResourceInput)
    .output(mcpUiResourceSchema.nullable())
    .query(({ input }) => getService().getUiResourceForTool(input.toolKey)),

  hasUiForTool: publicProcedure
    .input(hasUiForToolInput)
    .query(({ input }) => getService().hasUiForTool(input.toolKey)),

  // Fetch a UI resource by URI. The built-in PostHog `exec` tool resolves its
  // UI app per call from the result's `_meta` (in the renderer) rather than
  // registration metadata, so the host fetches the resource by URI directly.
  getUiResourceByUri: publicProcedure
    .input(getUiResourceByUriInput)
    .output(mcpUiResourceSchema.nullable())
    .query(({ input }) =>
      getService().getUiResourceByUri(input.serverName, input.resourceUri),
    ),

  getToolDefinition: publicProcedure
    .input(getToolDefinitionInput)
    .query(({ input }) => getService().getToolDefinition(input.toolKey)),

  proxyToolCall: publicProcedure
    .input(proxyToolCallInput)
    .mutation(({ input }) =>
      getService().proxyToolCall(input.serverName, input.toolName, input.args),
    ),

  proxyResourceRead: publicProcedure
    .input(proxyResourceReadInput)
    .mutation(({ input }) =>
      getService().proxyResourceRead(input.serverName, input.uri),
    ),

  openLink: publicProcedure
    .input(openLinkInput)
    .mutation(({ input }) => getService().openLink(input.url)),

  onToolInput: publicProcedure
    .input(mcpAppsSubscriptionInput)
    .subscription(async function* (opts) {
      const service = getService();
      const targetToolKey = opts.input.toolKey;
      for await (const event of service.toIterable(
        McpAppsServiceEvent.ToolInput,
        { signal: opts.signal },
      )) {
        if (event.toolKey === targetToolKey) {
          yield event;
        }
      }
    }),

  onToolResult: publicProcedure
    .input(mcpAppsSubscriptionInput)
    .subscription(async function* (opts) {
      const service = getService();
      const targetToolKey = opts.input.toolKey;
      for await (const event of service.toIterable(
        McpAppsServiceEvent.ToolResult,
        { signal: opts.signal },
      )) {
        if (event.toolKey === targetToolKey) {
          yield event;
        }
      }
    }),

  onToolCancelled: publicProcedure
    .input(mcpAppsSubscriptionInput)
    .subscription(async function* (opts) {
      const service = getService();
      const targetToolKey = opts.input.toolKey;
      for await (const event of service.toIterable(
        McpAppsServiceEvent.ToolCancelled,
        { signal: opts.signal },
      )) {
        if (event.toolKey === targetToolKey) {
          yield event;
        }
      }
    }),

  onDiscoveryComplete: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    for await (const event of service.toIterable(
      McpAppsServiceEvent.DiscoveryComplete,
      { signal: opts.signal },
    )) {
      yield event;
    }
  }),
});
