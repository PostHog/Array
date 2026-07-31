import { z } from "zod";

/** Renderer slot rect, window-content-relative CSS pixels. */
export const embeddedBrowserBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
});
export type EmbeddedBrowserBoundsInput = z.infer<
  typeof embeddedBrowserBoundsSchema
>;

export const productViewPageStateSchema = z.object({
  viewId: z.string(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
});

export const openProductViewInput = z.object({
  viewId: z.string(),
  url: z.string(),
  bounds: embeddedBrowserBoundsSchema,
  /** PostHog project whose analytics overlay onto this view's pages.
   * Defaults to the signed-in user's current project. */
  dataProjectId: z.number().optional(),
});

/** A reported in-page element descriptor. Everything here comes from the
 * user's product page and is untrusted: capped and validated before use. */
export const reportedElementSchema = z.object({
  selectorHash: z.string().min(1).max(64),
  tag: z.string().min(1).max(64),
  dataAttr: z.string().max(300).nullable(),
  id: z.string().max(300).nullable(),
  classes: z.array(z.string().max(200)).max(10),
  href: z.string().max(2000).nullable(),
  text: z.string().max(200).nullable(),
  nthChildPath: z.string().max(500),
});

export const reportedElementsSchema = z.array(reportedElementSchema).max(400);

export const navigateProductViewInput = z.object({
  viewId: z.string(),
  url: z.string(),
});

export const productViewIdInput = z.object({ viewId: z.string() });

export const setProductViewBoundsInput = z.object({
  viewId: z.string(),
  bounds: embeddedBrowserBoundsSchema,
});

export const setProductViewVisibleInput = z.object({
  viewId: z.string(),
  visible: z.boolean(),
});

export const productUrlSuggestionSchema = z.object({
  url: z.string(),
  source: z.enum(["app_urls", "pageview_hosts"]),
  eventCount: z.number().optional(),
});
