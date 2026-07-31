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

export const getElementDetailInput = z.object({
  viewId: z.string(),
  pageUrl: z.string().max(4000),
  element: reportedElementSchema,
});

const latencySnapshotSchema = z.object({
  count: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});

const networkRequestSampleSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().nullable(),
  durationMs: z.number().nullable(),
  traceId: z.string().nullable(),
  interactionSelectorHash: z.string().nullable(),
  timestamp: z.number(),
});

/** Everything the details panel renders for one selected element. */
export const elementDetailSchema = z.object({
  selectorHash: z.string(),
  dataProjectId: z.number(),
  pathname: z.string(),
  totals: z
    .object({
      clicks: z.number(),
      rageclicks: z.number(),
      deadclicks: z.number(),
    })
    .nullable(),
  trend: z.array(
    z.object({ day: z.string(), clicks: z.number(), users: z.number() }),
  ),
  errors: z.array(
    z.object({
      issueId: z.string(),
      types: z.array(z.string()),
      occurrences: z.number(),
      affectedUsers: z.number(),
    }),
  ),
  sessions: z.array(z.object({ sessionId: z.string(), lastSeen: z.string() })),
  vitals: z.object({ inpP75: z.number(), lcpP75: z.number() }).nullable(),
  liveLatency: latencySnapshotSchema.nullable(),
  recentRequests: z.array(networkRequestSampleSchema),
});
export type ElementDetail = z.infer<typeof elementDetailSchema>;
