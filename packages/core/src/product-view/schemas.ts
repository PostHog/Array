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
});

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
