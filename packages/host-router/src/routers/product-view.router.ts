import { PRODUCT_VIEW_SERVICE } from "@posthog/core/product-view/identifiers";
import type { IProductViewService } from "@posthog/core/product-view/productView";
import {
  elementDetailSchema,
  getElementDetailInput,
  navigateProductViewInput,
  openProductViewInput,
  productUrlSuggestionSchema,
  productViewIdInput,
  productViewPageStateSchema,
  setProductViewBoundsInput,
  setProductViewVisibleInput,
} from "@posthog/core/product-view/schemas";
import type { ServiceResolver } from "@posthog/host-trpc/context";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import {
  PRODUCT_CODE_CONTEXT_SERVICE,
  PRODUCT_ENVIRONMENTS_SERVICE,
} from "@posthog/workspace-server/di/tokens";
import type { IProductCodeContextService } from "@posthog/workspace-server/services/product-view/code-context";
import {
  elementCodeContextInput,
  elementCodeContextSchema,
  listProductEnvironmentsInput,
  productEnvironmentSchema,
  removeProductEnvironmentInput,
  saveProductEnvironmentInput,
  touchProductEnvironmentInput,
} from "@posthog/workspace-server/services/product-view/schemas";
import type { IProductEnvironmentsService } from "@posthog/workspace-server/services/product-view/service";
import { z } from "zod";

const view = (container: ServiceResolver) =>
  container.get<IProductViewService>(PRODUCT_VIEW_SERVICE);
const envs = (container: ServiceResolver) =>
  container.get<IProductEnvironmentsService>(PRODUCT_ENVIRONMENTS_SERVICE);
const codeContext = (container: ServiceResolver) =>
  container.get<IProductCodeContextService>(PRODUCT_CODE_CONTEXT_SERVICE);

export const productViewRouter = router({
  // ── Environments: which sites this project's Product tab can browse ──
  listEnvironments: publicProcedure
    .input(listProductEnvironmentsInput)
    .output(z.array(productEnvironmentSchema))
    .query(({ ctx, input }) => envs(ctx.container).list(input.projectId)),

  saveEnvironment: publicProcedure
    .input(saveProductEnvironmentInput)
    .output(productEnvironmentSchema)
    .mutation(({ ctx, input }) => envs(ctx.container).save(input)),

  removeEnvironment: publicProcedure
    .input(removeProductEnvironmentInput)
    .mutation(({ ctx, input }) => envs(ctx.container).remove(input.id)),

  touchEnvironment: publicProcedure
    .input(touchProductEnvironmentInput)
    .output(productEnvironmentSchema.nullable())
    .mutation(({ ctx, input }) =>
      envs(ctx.container).touch(input.id, input.currentUrl),
    ),

  // ── The embedded browser view ──
  open: publicProcedure
    .input(openProductViewInput)
    .mutation(({ ctx, input }) => view(ctx.container).open(input)),

  navigate: publicProcedure
    .input(navigateProductViewInput)
    .mutation(({ ctx, input }) =>
      view(ctx.container).navigate(input.viewId, input.url),
    ),

  goBack: publicProcedure
    .input(productViewIdInput)
    .mutation(({ ctx, input }) => view(ctx.container).goBack(input.viewId)),

  goForward: publicProcedure
    .input(productViewIdInput)
    .mutation(({ ctx, input }) => view(ctx.container).goForward(input.viewId)),

  reload: publicProcedure
    .input(productViewIdInput)
    .mutation(({ ctx, input }) => view(ctx.container).reload(input.viewId)),

  setBounds: publicProcedure
    .input(setProductViewBoundsInput)
    .mutation(({ ctx, input }) =>
      view(ctx.container).setBounds(input.viewId, input.bounds),
    ),

  setVisible: publicProcedure
    .input(setProductViewVisibleInput)
    .mutation(({ ctx, input }) =>
      view(ctx.container).setVisible(input.viewId, input.visible),
    ),

  setInspectMode: publicProcedure
    .input(z.object({ viewId: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      view(ctx.container).setInspectMode(input.viewId, input.enabled),
    ),

  destroy: publicProcedure
    .input(productViewIdInput)
    .mutation(({ ctx, input }) => view(ctx.container).destroy(input.viewId)),

  getPageState: publicProcedure
    .input(productViewIdInput)
    .output(productViewPageStateSchema.nullable())
    .query(({ ctx, input }) => view(ctx.container).getPageState(input.viewId)),

  suggestUrls: publicProcedure
    .output(z.array(productUrlSuggestionSchema))
    .query(({ ctx }) => view(ctx.container).suggestProductUrls()),

  getElementDetail: publicProcedure
    .input(getElementDetailInput)
    .output(elementDetailSchema)
    .query(({ ctx, input }) => view(ctx.container).getElementDetail(input)),

  getElementCodeContext: publicProcedure
    .input(elementCodeContextInput)
    .output(elementCodeContextSchema)
    .query(({ ctx, input }) =>
      codeContext(ctx.container).getElementCodeContext(input),
    ),

  onEvents: publicProcedure.subscription(async function* (opts) {
    for await (const event of view(opts.ctx.container).events(opts.signal)) {
      yield event;
    }
  }),
});
