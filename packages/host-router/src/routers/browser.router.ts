import { eventToAsyncIterator } from "@posthog/host-trpc/eventSubscription";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";
import {
  BROWSER_SERVICE,
  type BrowserFaviconEvent,
  type BrowserNavigateEvent,
  type BrowserOpenUrlEvent,
  type BrowserTitleEvent,
  type IBrowserService,
} from "../ports/browser";

const browserIdInput = z.object({ browserId: z.string() });

const createInput = z.object({
  browserId: z.string(),
  url: z.string(),
});

const navigateInput = z.object({
  browserId: z.string(),
  url: z.string(),
});

const setBoundsInput = z.object({
  browserId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const setVisibleInput = z.object({
  browserId: z.string(),
  visible: z.boolean(),
});

const stateOutput = z
  .object({
    url: z.string(),
    title: z.string(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    isLoading: z.boolean(),
  })
  .nullable();

export const browserRouter = router({
  create: publicProcedure
    .input(createInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .create(input.browserId, input.url),
    ),

  destroy: publicProcedure
    .input(browserIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .destroy(input.browserId),
    ),

  navigate: publicProcedure
    .input(navigateInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .navigate(input.browserId, input.url),
    ),

  setBounds: publicProcedure.input(setBoundsInput).mutation(({ ctx, input }) =>
    ctx.container
      .get<IBrowserService>(BROWSER_SERVICE)
      .setBounds(input.browserId, {
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
      }),
  ),

  setVisible: publicProcedure
    .input(setVisibleInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .setVisible(input.browserId, input.visible),
    ),

  goBack: publicProcedure
    .input(browserIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .goBack(input.browserId),
    ),

  goForward: publicProcedure
    .input(browserIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .goForward(input.browserId),
    ),

  reload: publicProcedure
    .input(browserIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .reload(input.browserId),
    ),

  stop: publicProcedure
    .input(browserIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IBrowserService>(BROWSER_SERVICE).stop(input.browserId),
    ),

  getState: publicProcedure
    .input(browserIdInput)
    .output(stateOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .getState(input.browserId),
    ),

  onNavigate: publicProcedure
    .input(browserIdInput)
    .subscription(({ ctx, input, signal }) => {
      const service = ctx.container.get<IBrowserService>(BROWSER_SERVICE);
      return eventToAsyncIterator<BrowserNavigateEvent>(
        (l) => service.on("navigate", l),
        (l) => service.off("navigate", l),
        signal,
        (data) => data.browserId === input.browserId,
      );
    }),

  onTitle: publicProcedure
    .input(browserIdInput)
    .subscription(({ ctx, input, signal }) => {
      const service = ctx.container.get<IBrowserService>(BROWSER_SERVICE);
      return eventToAsyncIterator<BrowserTitleEvent>(
        (l) => service.on("title", l),
        (l) => service.off("title", l),
        signal,
        (data) => data.browserId === input.browserId,
      );
    }),

  onFavicon: publicProcedure
    .input(browserIdInput)
    .subscription(({ ctx, input, signal }) => {
      const service = ctx.container.get<IBrowserService>(BROWSER_SERVICE);
      return eventToAsyncIterator<BrowserFaviconEvent>(
        (l) => service.on("favicon", l),
        (l) => service.off("favicon", l),
        signal,
        (data) => data.browserId === input.browserId,
      );
    }),

  onOpenUrl: publicProcedure.subscription(({ ctx, signal }) => {
    const service = ctx.container.get<IBrowserService>(BROWSER_SERVICE);
    return eventToAsyncIterator<BrowserOpenUrlEvent>(
      (l) => service.on("openUrl", l),
      (l) => service.off("openUrl", l),
      signal,
    );
  }),
});
