/**
 * A host-provided browser surface embedded inside the app window, used by the
 * Product View to show the user's own product (live site or localhost dev
 * server) beneath an analytics overlay. The desktop host implements it with an
 * Electron `WebContentsView` owned by the main process; the renderer only
 * drives bounds/visibility/navigation and consumes the event stream.
 *
 * Everything that crosses this interface is display-ready data. PostHog
 * credentials never pass through it in either direction: analytics queries run
 * host-side and only shaped overlay payloads go down; element descriptors
 * reported by the page come up untrusted and are validated by the consumer.
 */

export interface EmbeddedBrowserBounds {
  /** Window-content-relative CSS pixels (the renderer slot's client rect). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedBrowserPageState {
  viewId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

/**
 * An interactive element the in-page inspector reported. All string fields are
 * length-capped by the preload; consumers still treat them as untrusted input.
 */
export interface EmbeddedBrowserElement {
  /** Stable hash of the element's descriptor, the overlay's join key. */
  selectorHash: string;
  tag: string;
  /** `data-attr` value, PostHog's preferred stable selector. */
  dataAttr: string | null;
  id: string | null;
  classes: string[];
  href: string | null;
  /** Trimmed visible text (capped). */
  text: string | null;
  /** nth-child path fallback used when nothing stronger identifies it. */
  nthChildPath: string;
}

/** Per-element visual instruction pushed down to the in-page overlay. */
export interface EmbeddedBrowserOverlayItem {
  selectorHash: string;
  halo: "green" | "amber" | "red";
  /** Compact badge text shown in inspect mode (e.g. "12.4k · 0.8%"). */
  label: string | null;
}

export interface EmbeddedBrowserOverlayPayload {
  viewId: string;
  items: EmbeddedBrowserOverlayItem[];
}

/** A network request observed on the embedded page (CDP capture). */
export interface EmbeddedBrowserNetworkSample {
  viewId: string;
  url: string;
  method: string;
  status: number | null;
  /** Milliseconds from request start to response end, when known. */
  durationMs: number | null;
  /** W3C trace id extracted from the `traceparent` request header, if any. */
  traceId: string | null;
  /** selectorHash of the interaction this request was attributed to, if any. */
  interactionSelectorHash: string | null;
  timestamp: number;
}

export type EmbeddedBrowserEvent =
  | { type: "page-state"; state: EmbeddedBrowserPageState }
  | {
      type: "elements-reported";
      viewId: string;
      pageUrl: string;
      elements: EmbeddedBrowserElement[];
    }
  | {
      type: "element-selected";
      viewId: string;
      pageUrl: string;
      element: EmbeddedBrowserElement;
    }
  | { type: "network-sample"; sample: EmbeddedBrowserNetworkSample }
  | { type: "view-destroyed"; viewId: string };

export interface EmbeddedBrowserCreateOptions {
  viewId: string;
  url: string;
  bounds: EmbeddedBrowserBounds;
}

export interface IEmbeddedBrowser {
  /** Create (or navigate an existing) view and attach it to the app window. */
  create(options: EmbeddedBrowserCreateOptions): Promise<void>;
  navigate(viewId: string, url: string): Promise<void>;
  goBack(viewId: string): void;
  goForward(viewId: string): void;
  reload(viewId: string): void;
  setBounds(viewId: string, bounds: EmbeddedBrowserBounds): void;
  setVisible(viewId: string, visible: boolean): void;
  destroy(viewId: string): Promise<void>;
  /** Current page state, or null when the view doesn't exist. */
  getPageState(viewId: string): EmbeddedBrowserPageState | null;
  /** Toggle the in-page inspector's hover/select mode. */
  setInspectMode(viewId: string, enabled: boolean): void;
  /** Push display-ready overlay data into the in-page renderer. */
  pushOverlayData(payload: EmbeddedBrowserOverlayPayload): void;
  /** One shared event stream; consumers filter by viewId. */
  events(signal?: AbortSignal): AsyncIterable<EmbeddedBrowserEvent>;
}

export const EMBEDDED_BROWSER = Symbol.for("posthog.platform.embeddedBrowser");
