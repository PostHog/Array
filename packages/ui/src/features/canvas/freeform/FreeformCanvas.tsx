import {
  type CanvasToHostMessage,
  canvasToHostMessageSchema,
  type HostToCanvasMessage,
} from "@posthog/core/canvas/freeformSchemas";
import { logger } from "@posthog/ui/shell/logger";
import { useEffect, useMemo, useRef, useState } from "react";
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
}: FreeformCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState<number | null>(null);

  // The document is keyed only on mode (not code): code is injected via `init`,
  // so changing it never reloads the iframe — it re-renders in place.
  const srcDoc = useMemo(() => buildSandboxDocument(mode), [mode]);

  // Reset ready whenever the iframe document is rebuilt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDoc identity tracks a reload.
  useEffect(() => setReady(false), [srcDoc]);

  // Latest callbacks without re-subscribing the message listener every render.
  const handlers = useRef({ onDataRequest, onError, onRendered });
  handlers.current = { onDataRequest, onError, onRendered };

  // Subscribed once for the component's life; reads latest callbacks via the
  // `handlers` ref so it never needs to re-bind.
  useEffect(() => {
    const post = (msg: HostToCanvasMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, "*");
    };

    const route = async (msg: CanvasToHostMessage) => {
      switch (msg.type) {
        case "ready":
          setReady(true);
          break;
        case "data-request": {
          try {
            const result = await handlers.current.onDataRequest(
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
          handlers.current.onError?.(msg.message, msg.stack);
          break;
        case "rendered":
          handlers.current.onRendered?.();
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
  }, []);

  // Push the current code once the iframe is ready, and on every code change.
  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      { channel: "posthog-canvas", type: "init", code, mode },
      "*",
    );
  }, [ready, code, mode]);

  return (
    <iframe
      ref={iframeRef}
      title="Canvas"
      // allow-scripts WITHOUT allow-same-origin = null origin = no access to host
      // cookies/storage/DOM. Do not add allow-same-origin (it collapses the
      // isolation boundary).
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="w-full border-0 bg-white"
      style={{ height: height ? `${height}px` : "100%", minHeight: "100%" }}
    />
  );
}
