import {
  type ElementAnchor,
  HTML_CANVAS_MESSAGE_CHANNEL,
  type HostToHtmlCanvasMessage,
  type HtmlCanvasAnnotation,
  type HtmlCanvasRect,
  type HtmlCanvasToHostMessage,
  htmlCanvasToHostMessageSchema,
  type TextQuoteAnchor,
} from "@posthog/core/canvas/htmlCanvasSchemas";
import { logger } from "@posthog/ui/shell/logger";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { buildHtmlArtifactDocument } from "./htmlSandbox";

const log = logger.scope("html-artifact-frame");

export interface HtmlArtifactFrameProps {
  /** The complete HTML document to render (the canvas's `code`). */
  html: string;
  /** Root comments to paint as highlights + numbered pins. */
  annotations: HtmlCanvasAnnotation[];
  /** Element-pick mode: hover outline + click-to-anchor inside the iframe. */
  pickMode: boolean;
  /** The emphasized annotation; changing to a non-null id scrolls to it. */
  activeId: string | null;
  /**
   * Whether a draft (pending composer) exists host-side. While true the shim
   * keeps the draft highlight painted; on true -> false it is cleared.
   */
  hasDraft: boolean;
  /** A text selection settled inside the document. */
  onSelection: (anchor: TextQuoteAnchor, rect: HtmlCanvasRect) => void;
  /** The selection collapsed without becoming a draft. */
  onSelectionCleared: () => void;
  /** Pick mode: the user clicked an element. */
  onElementPicked: (anchor: ElementAnchor, rect: HtmlCanvasRect) => void;
  /** The user clicked a pin/highlight — open that thread. */
  onMarkerClicked: (id: string, rect?: HtmlCanvasRect) => void;
  /** Which anchors resolved after a repaint (unresolved = orphaned). */
  onAnnotationsResolved: (
    results: { id: string; resolved: boolean; rect?: HtmlCanvasRect }[],
  ) => void;
  onError?: (message: string) => void;
}

// Renders an HTML artifact inside a null-origin sandboxed iframe and brokers
// the annotation postMessage protocol with the injected shim. Unlike the
// freeform canvas there is no `init` frame — the artifact IS the srcDoc — so
// a code change reloads the iframe (cheap: static HTML, no compile step).
export function HtmlArtifactFrame({
  html,
  annotations,
  pickMode,
  activeId,
  hasDraft,
  onSelection,
  onSelectionCleared,
  onElementPicked,
  onMarkerClicked,
  onAnnotationsResolved,
  onError,
}: HtmlArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Whether the current document's shim has announced `ready`. Ref, not
  // state: it only gates imperative postMessages.
  const readyRef = useRef(false);

  const srcDoc = useMemo(() => buildHtmlArtifactDocument(html), [html]);

  // Latest props for the once-bound listener and the stable state push.
  const latest = useRef({
    annotations,
    pickMode,
    activeId,
    hasDraft,
    onSelection,
    onSelectionCleared,
    onElementPicked,
    onMarkerClicked,
    onAnnotationsResolved,
    onError,
  });
  latest.current = {
    annotations,
    pickMode,
    activeId,
    hasDraft,
    onSelection,
    onSelectionCleared,
    onElementPicked,
    onMarkerClicked,
    onAnnotationsResolved,
    onError,
  };

  const post = useCallback((msg: HostToHtmlCanvasMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // Push the full paintable state — idempotent, sent on ready/load and reused
  // by the prop-change effects below.
  const pushState = useCallback(() => {
    const p = latest.current;
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-annotations",
      annotations: p.annotations,
    });
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-pick-mode",
      active: p.pickMode,
    });
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-active",
      id: p.activeId,
      scroll: false,
    });
  }, [post]);

  // A new document reloads the iframe; its shim re-announces `ready`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDoc identity tracks a reload.
  useLayoutEffect(() => {
    readyRef.current = false;
  }, [srcDoc]);

  // Bound once; reads latest props via the ref. Layout effect so the listener
  // exists before the iframe's load task can post its one-shot `ready`.
  useLayoutEffect(() => {
    const route = (msg: HtmlCanvasToHostMessage) => {
      const p = latest.current;
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          pushState();
          break;
        case "selection":
          p.onSelection(msg.anchor, msg.rect);
          break;
        case "selection-cleared":
          p.onSelectionCleared();
          break;
        case "element-picked":
          p.onElementPicked(msg.anchor, msg.rect);
          break;
        case "marker-clicked":
          p.onMarkerClicked(msg.id, msg.rect);
          break;
        case "annotations-resolved":
          p.onAnnotationsResolved(msg.results);
          break;
        case "error":
          log.warn("HTML artifact shim error", { message: msg.message });
          p.onError?.(msg.message);
          break;
      }
    };

    const onMessage = (event: MessageEvent) => {
      // A null-origin sandbox can't be trusted by origin; identify the frame
      // by its window reference + the channel tag instead.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const parsed = htmlCanvasToHostMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      route(parsed.data);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pushState]);

  // Prop-driven pushes, skipped until the shim is ready (ready/load push the
  // full state anyway).
  useLayoutEffect(() => {
    if (!readyRef.current) return;
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-annotations",
      annotations,
    });
  }, [annotations, post]);

  useLayoutEffect(() => {
    if (!readyRef.current) return;
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-pick-mode",
      active: pickMode,
    });
  }, [pickMode, post]);

  // Panel-driven focus: emphasize + scroll to the active annotation.
  useLayoutEffect(() => {
    if (!readyRef.current) return;
    post({
      channel: HTML_CANVAS_MESSAGE_CHANNEL,
      type: "set-active",
      id: activeId,
      scroll: activeId !== null,
    });
  }, [activeId, post]);

  // Draft lifecycle: the shim keeps the draft highlight while the composer is
  // open; clearing happens on the true -> false transition.
  useLayoutEffect(() => {
    if (!readyRef.current) return;
    if (!hasDraft) {
      post({ channel: HTML_CANVAS_MESSAGE_CHANNEL, type: "clear-draft" });
    }
  }, [hasDraft, post]);

  return (
    <iframe
      ref={iframeRef}
      title="Document"
      // allow-scripts WITHOUT allow-same-origin = null origin = no access to
      // host cookies/storage/DOM. Do not add allow-same-origin.
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      // Race-free init: by `load` the shim has executed (it sits at the end of
      // body), so pushing state here delivers even if the one-shot `ready`
      // was missed. Pushes are idempotent.
      onLoad={() => {
        readyRef.current = true;
        pushState();
      }}
      className="h-full w-full border-0 bg-white"
    />
  );
}
