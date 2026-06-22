import {
  type CanvasAnalyticsConfig,
  type CanvasToHostMessage,
  canvasToHostMessageSchema,
  type HostToCanvasMessage,
} from "@posthog/core/canvas/freeformSchemas";
import { logger } from "@posthog/ui/shell/logger";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildSandboxDocument, type SandboxMode } from "./sandboxRuntime";

const log = logger.scope("freeform-canvas");

export interface FreeformCanvasProps {
  /** The single-file React source to render. */
  code: string;
  /** edit = in-app authoring (full data shim); view = published/shared. */
  mode: SandboxMode;
  /**
   * Resolves a data-request from the canvas. The host owns the real token; this
   * runs the authenticated call and returns only the result. In view mode the
   * implementation must reject anything outside the frozen query allowlist.
   */
  onDataRequest: (method: string, payload: unknown) => Promise<unknown>;
  /** Called when the canvas reports a compile/runtime error (self-repair loop). */
  onError?: (message: string, stack?: string) => void;
  /** Called once the canvas has rendered successfully (clears error state). */
  onRendered?: () => void;
  /**
   * Bootstrap config for in-iframe posthog-js (analytics + session replay).
   * Absent = no capture/replay. Only the PUBLIC key is here; the private token
   * never crosses into the iframe.
   */
  analytics?: CanvasAnalyticsConfig;
  /**
   * Bump to force a full iframe reload (a fresh boot re-runs the app's data
   * `useEffect`s = a real refresh). Folded into the srcDoc so changing it
   * reloads the frame via the existing reload path.
   */
  refreshKey?: number;
}

// Renders a freeform-React canvas inside a null-origin sandboxed iframe and
// brokers the postMessage protocol with it. The component never hands the iframe
// a JS object — only structured-clone messages cross the boundary.
export function FreeformCanvas({
  code,
  mode,
  onDataRequest,
  onError,
  onRendered,
  analytics,
  refreshKey = 0,
}: FreeformCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // Whether the iframe has announced it's ready for `init`. A ref, not state: it
  // only gates an imperative postMessage and is never shown on screen, so it
  // shouldn't trigger re-renders.
  const readyRef = useRef(false);

  // The document is keyed on mode + the analytics host (which the CSP must open
  // for posthog-js), not on code: code is injected via `init`, so changing it
  // never reloads the iframe — it re-renders in place.
  const analyticsHost = analytics?.apiHost;
  const srcDoc = useMemo(() => {
    const doc = buildSandboxDocument(mode, analyticsHost);
    // Append the refresh nonce as a comment so a bump changes the srcDoc string,
    // which reloads the iframe (re-announces "ready" → re-init → fresh run).
    return refreshKey > 0 ? `${doc}\n<!-- refresh:${refreshKey} -->` : doc;
  }, [mode, analyticsHost, refreshKey]);

  // Latest props, read by the once-bound listener + the (stable) postInit.
  const latest = useRef({
    onDataRequest,
    onError,
    onRendered,
    code,
    mode,
    analytics,
  });
  latest.current = {
    onDataRequest,
    onError,
    onRendered,
    code,
    mode,
    analytics,
  };

  const postInit = useCallback(() => {
    const p = latest.current;
    iframeRef.current?.contentWindow?.postMessage(
      {
        channel: "posthog-canvas",
        type: "init",
        code: p.code,
        mode: p.mode,
        analytics: p.analytics,
      },
      "*",
    );
  }, []);

  // The iframe reloads only when srcDoc changes (mode / analytics host); on
  // reload it re-announces "ready", so mark it not-ready until then. Ref write
  // only — no state update, no extra render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDoc identity tracks a reload.
  useLayoutEffect(() => {
    readyRef.current = false;
  }, [srcDoc]);

  // Subscribed once for the component's life; reads latest props via the ref.
  // Layout effect (not passive): the listener must be attached during commit,
  // before the browser yields to the iframe's load task — otherwise the iframe's
  // one-shot "ready" (and early data-request/error/resize) can fire before the
  // listener exists and be lost, leaving the canvas blank on a cold first open.
  useLayoutEffect(() => {
    const post = (msg: HostToCanvasMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, "*");
    };

    const route = async (msg: CanvasToHostMessage) => {
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          postInit();
          break;
        case "data-request": {
          try {
            const result = await latest.current.onDataRequest(
              msg.method,
              msg.payload,
            );
            post({
              channel: "posthog-canvas",
              type: "data-response",
              id: msg.id,
              ok: true,
              result,
            });
          } catch (err) {
            post({
              channel: "posthog-canvas",
              type: "data-response",
              id: msg.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "error":
          log.warn("Freeform canvas error", { message: msg.message });
          latest.current.onError?.(msg.message, msg.stack);
          break;
        case "rendered":
          latest.current.onRendered?.();
          break;
        case "resize":
          setHeight(msg.height);
          break;
      }
    };

    const onMessage = (event: MessageEvent) => {
      // A null-origin sandbox can't be trusted by origin, so identify the frame
      // by its window reference + our channel tag instead.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const parsed = canvasToHostMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      void route(parsed.data);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postInit]);

  // Re-send init when the code / mode / analytics change, if the iframe is ready.
  // NB: reference code/mode/analytics DIRECTLY here (not via postInit, which
  // reads them off a ref) — otherwise the exhaustive-deps lint strips them from
  // the array as "unused" and the effect goes stale, never re-posting on change.
  useEffect(() => {
    if (!readyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { channel: "posthog-canvas", type: "init", code, mode, analytics },
      "*",
    );
  }, [code, mode, analytics]);

  return (
    <iframe
      ref={iframeRef}
      title="Canvas"
      // allow-scripts WITHOUT allow-same-origin = null origin = no access to host
      // cookies/storage/DOM. Do not add allow-same-origin (it collapses the
      // isolation boundary).
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      // Race-free init: by `load`, the iframe's module bootstrap has executed
      // (so its message listener is registered and "ready" already posted), so
      // posting init here reliably delivers the code — even if the one-shot
      // "ready" message was missed. Re-posting is idempotent (mountSeq dedupes).
      onLoad={() => {
        readyRef.current = true;
        postInit();
      }}
      className="w-full border-0 bg-white"
      style={{ height: height ? `${height}px` : "100%", minHeight: "100%" }}
    />
  );
}
