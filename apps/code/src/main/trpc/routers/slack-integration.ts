import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  startSlackFlowInput,
  startSlackFlowOutput,
} from "../../services/slack-integration/schemas";
import {
  type SlackFlowTimedOut,
  type SlackIntegrationCallback,
  SlackIntegrationEvent,
  type SlackIntegrationService,
} from "../../services/slack-integration/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<SlackIntegrationService>(MAIN_TOKENS.SlackIntegrationService);

export const slackIntegrationRouter = router({
  startFlow: publicProcedure
    .input(startSlackFlowInput)
    .output(startSlackFlowOutput)
    .mutation(({ input }) =>
      getService().startFlow(input.region, input.projectId),
    ),

  /**
   * Subscribe to Slack integration deep link callbacks emitted after the user
   * completes (or errors out of) the Slack OAuth flow on PostHog Cloud.
   */
  onCallback: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(SlackIntegrationEvent.Callback, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  /**
   * Subscribe to flow timeout events (5 minutes with no deep link callback).
   */
  onFlowTimedOut: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(SlackIntegrationEvent.FlowTimedOut, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),

  /**
   * Get any integration callback that arrived before the renderer subscribed.
   */
  consumePendingCallback: publicProcedure.query(
    (): SlackIntegrationCallback | null =>
      getService().consumePendingCallback(),
  ),
});

export type { SlackIntegrationCallback, SlackFlowTimedOut };
