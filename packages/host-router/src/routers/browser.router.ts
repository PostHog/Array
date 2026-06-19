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

function subscribeBrowser<
  TEvent extends BrowserNavigateEvent | BrowserTitleEvent | BrowserFaviconEvent,
>(event: "navigate" | "title" | "favicon") {
  return publicProcedure
    .input(browserIdInput)
    .subscription(async function* (opts) {
      const service = opts.ctx.container.get<IBrowserService>(BROWSER_SERVICE);
      const targetBrowserId = opts.input.browserId;

      let resolve: ((value: IteratorResult<TEvent>) => void) | null = null;
      const queue: TEvent[] = [];
      let done = false;

      const listener = (data: TEvent) => {
        if (data.browserId !== targetBrowserId) return;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: data, done: false });
        } else {
          queue.push(data);
        }
      };

      (service.on as (event: string, listener: (data: TEvent) => void) => void)(
        event,
        listener,
      );

      opts.signal?.addEventListener("abort", () => {
        done = true;
        service.off(event, listener as (...args: unknown[]) => void);
        if (resolve) {
          resolve({ value: undefined as never, done: true });
        }
      });

      while (!done) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const next = await new Promise<IteratorResult<TEvent>>((r) => {
            resolve = r;
          });
          if (next.done) break;
          yield next.value;
        }
      }
    });
}

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

  getState: publicProcedure
    .input(browserIdInput)
    .output(stateOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<IBrowserService>(BROWSER_SERVICE)
        .getState(input.browserId),
    ),

  onNavigate: subscribeBrowser<BrowserNavigateEvent>("navigate"),
  onTitle: subscribeBrowser<BrowserTitleEvent>("title"),
  onFavicon: subscribeBrowser<BrowserFaviconEvent>("favicon"),

  // Fired when web content calls window.open() with a safe http/https URL.
  onOpenUrl: publicProcedure.subscription(async function* (opts) {
    const service = opts.ctx.container.get<IBrowserService>(BROWSER_SERVICE);
    let resolve: ((value: IteratorResult<BrowserOpenUrlEvent>) => void) | null =
      null;
    const queue: BrowserOpenUrlEvent[] = [];
    let done = false;

    const listener = (data: BrowserOpenUrlEvent) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: data, done: false });
      } else {
        queue.push(data);
      }
    };

    (
      service.on as (
        event: "openUrl",
        listener: (data: BrowserOpenUrlEvent) => void,
      ) => void
    )("openUrl", listener);

    opts.signal?.addEventListener("abort", () => {
      done = true;
      service.off("openUrl", listener as (...args: unknown[]) => void);
      if (resolve) resolve({ value: undefined as never, done: true });
    });

    while (!done) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        const next = await new Promise<IteratorResult<BrowserOpenUrlEvent>>(
          (r) => {
            resolve = r;
          },
        );
        if (next.done) break;
        yield next.value;
      }
    }
  }),
});
