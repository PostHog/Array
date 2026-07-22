// The annotation shim that runs INSIDE an HTML-artifact iframe. It owns
// everything that must happen in the artifact's own document — text selection
// capture, element picking, resolving stored anchors back to DOM positions,
// and painting highlights/pins — and talks to the host exclusively over the
// postMessage protocol in @posthog/core/canvas/htmlCanvasSchemas.
//
// Like sandboxRuntime.ts, the injected script is composed by serializing real
// functions with `fn.toString()` so the algorithms are unit-testable here in
// module scope. Two rules keep that safe under bundling/minification:
//   1. every serialized function is SELF-CONTAINED — it references only its
//      parameters and browser globals, never another module binding (a
//      minifier may rename those);
//   2. functions are handed to the runtime via an explicit `env` object, so
//      the generated script never depends on the original identifier names.

import type {
  CommentAnchor,
  ElementAnchor,
  HtmlCanvasAnnotation,
  HtmlCanvasRect,
  TextQuoteAnchor,
} from "@posthog/core/canvas/htmlCanvasSchemas";
import { HTML_CANVAS_MESSAGE_CHANNEL } from "@posthog/core/canvas/htmlCanvasSchemas";

// The overlay layer's element id — also used to exclude the shim's own DOM
// from text indexing, element picking, and mutation-triggered repaints.
export const ANNOTATION_OVERLAY_ID = "__ph-canvas-annotations";

// How much normalized context to keep around a text quote. Enough to
// disambiguate repeats, small enough to keep item_context lean.
const CONTEXT_CHARS = 32;
// Selections longer than this are rejected rather than truncated (a truncated
// quote would silently anchor to the wrong span).
const MAX_QUOTE_CHARS = 1000;

// The document's visible text, whitespace-collapsed, with a per-character map
// back to the text node + offset it came from — the search space for
// text-quote anchors and the bridge from a match back to a DOM Range.
export interface ShimTextIndex {
  text: string;
  nodes: Text[];
  charNode: number[];
  charOff: number[];
}

// Collapse whitespace runs to single spaces and trim — the one normalization
// both capture and resolution apply, so quotes match the index text.
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Build the searchable text index. Walks text nodes in document order,
// skipping non-content containers and the shim's own overlay, collapsing
// whitespace as it goes so the result matches `normalizeText` output.
export function buildTextIndex(
  doc: Document,
  overlayId: string,
): ShimTextIndex {
  const nodes: Text[] = [];
  const charNode: number[] = [];
  const charOff: number[] = [];
  let text = "";
  let lastWasSpace = true;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script,style,noscript,template"))
        return NodeFilter.FILTER_REJECT;
      const overlay = doc.getElementById(overlayId);
      if (overlay?.contains(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const nodeIndex = nodes.push(node) - 1;
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i] as string;
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        text += " ";
        lastWasSpace = true;
      } else {
        text += ch;
        lastWasSpace = false;
      }
      charNode.push(nodeIndex);
      charOff.push(i);
    }
  }
  // Drop a trailing collapsed space so the text matches normalizeText output.
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    charNode.pop();
    charOff.pop();
  }
  return { text, nodes, charNode, charOff };
}

// Capture the current selection as a text-quote anchor: the normalized quote
// plus surrounding context. Returns null for collapsed/empty/oversized
// selections. `maxQuote`/`contextChars` are parameters (not module consts) so
// the serialized copy stays self-contained.
export function textQuoteFromSelection(
  doc: Document,
  contextChars: number,
  maxQuote: number,
): TextQuoteAnchor | null {
  // Context keeps boundary whitespace (collapse WITHOUT trim): the index text
  // has a space between the quote and its neighbors, and trimming it here
  // would misalign every prefix/suffix character during resolve scoring.
  const collapse = (value: string) => value.replace(/\s+/g, " ");
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const quote = collapse(range.toString()).trim();
  if (!quote || quote.length > maxQuote) return null;
  let prefix = "";
  let suffix = "";
  try {
    const before = doc.createRange();
    before.selectNodeContents(doc.body);
    before.setEnd(range.startContainer, range.startOffset);
    prefix = collapse(before.toString()).slice(-contextChars);
    const after = doc.createRange();
    after.selectNodeContents(doc.body);
    after.setStart(range.endContainer, range.endOffset);
    suffix = collapse(after.toString()).slice(0, contextChars);
  } catch {
    // A selection straddling odd boundaries still anchors by quote alone.
  }
  return { type: "text", quote, prefix, suffix };
}

// Resolve a text-quote anchor to a DOM Range using the index. Every occurrence
// of the quote is scored by how much of the stored prefix/suffix matches
// around it; the best occurrence wins. Null = orphaned (quote no longer in
// the document).
export function resolveTextQuote(
  doc: Document,
  anchor: TextQuoteAnchor,
  index: ShimTextIndex,
): Range | null {
  const { text } = index;
  const quote = anchor.quote;
  if (!quote) return null;
  const positions: number[] = [];
  for (
    let at = text.indexOf(quote);
    at !== -1;
    at = text.indexOf(quote, at + 1)
  ) {
    positions.push(at);
    if (positions.length > 100) break;
  }
  if (positions.length === 0) return null;
  let best = positions[0] as number;
  if (positions.length > 1) {
    let bestScore = -1;
    for (const pos of positions) {
      let score = 0;
      const pre = text.slice(Math.max(0, pos - anchor.prefix.length), pos);
      for (
        let i = 0;
        i < pre.length &&
        pre[pre.length - 1 - i] === anchor.prefix[anchor.prefix.length - 1 - i];
        i++
      )
        score++;
      const post = text.slice(
        pos + quote.length,
        pos + quote.length + anchor.suffix.length,
      );
      for (let i = 0; i < post.length && post[i] === anchor.suffix[i]; i++)
        score++;
      if (score > bestScore) {
        bestScore = score;
        best = pos;
      }
    }
  }
  const endChar = best + quote.length - 1;
  const startNode = index.nodes[index.charNode[best] as number];
  const endNode = index.nodes[index.charNode[endChar] as number];
  if (!startNode || !endNode) return null;
  const range = doc.createRange();
  range.setStart(startNode, index.charOff[best] as number);
  range.setEnd(endNode, (index.charOff[endChar] as number) + 1);
  return range;
}

// A stable-ish CSS selector for an element: its own unique id when it has
// one, else a tag:nth-of-type path from the nearest uniquely-id'd ancestor
// (or body), capped in depth.
export function cssPathFor(el: Element, doc: Document): string {
  const esc = (value: string) => {
    const cssGlobal = (
      globalThis as { CSS?: { escape?: (v: string) => string } }
    ).CSS;
    return cssGlobal?.escape
      ? cssGlobal.escape(value)
      : value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  };
  const uniqueId = (candidate: Element) =>
    candidate.id && doc.querySelectorAll(`#${esc(candidate.id)}`).length === 1;
  if (uniqueId(el)) return `#${esc(el.id)}`;
  const segments: string[] = [];
  let current: Element | null = el;
  for (let depth = 0; current && current !== doc.body && depth < 12; depth++) {
    if (uniqueId(current)) {
      segments.unshift(`#${esc(current.id)}`);
      return segments.join(" > ");
    }
    const tag = current.tagName.toLowerCase();
    let nth = 1;
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === current.tagName) nth++;
    }
    segments.unshift(`${tag}:nth-of-type(${nth})`);
    current = current.parentElement;
  }
  if (current === doc.body) segments.unshift("body");
  return segments.join(" > ");
}

// A human label for an element anchor, shown in the panel even when the
// selector no longer resolves: the tag plus a trimmed text snippet.
export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return text ? `${tag} — ${text}` : tag;
}

// The environment handed to the serialized runtime: the channel stamp, tuning
// constants, and the algorithms above (as generated-scope bindings).
interface ShimEnv {
  channel: string;
  overlayId: string;
  contextChars: number;
  maxQuote: number;
  buildTextIndex: typeof buildTextIndex;
  textQuoteFromSelection: typeof textQuoteFromSelection;
  resolveTextQuote: typeof resolveTextQuote;
  cssPathFor: typeof cssPathFor;
  labelFor: typeof labelFor;
}

// The shim runtime. Serialized wholesale into the artifact document, so it
// references only `env`, its own locals, and browser globals. Runs from the
// end of <body>, so the artifact DOM above is parsed when it starts.
function annotationShimMain(env: ShimEnv): void {
  const doc = document;
  const post = (msg: Record<string, unknown>) => {
    window.parent.postMessage({ channel: env.channel, ...msg }, "*");
  };
  const toRect = (rect: DOMRect): HtmlCanvasRect => ({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  });

  let annotations: HtmlCanvasAnnotation[] = [];
  let activeId: string | null = null;
  let pickMode = false;
  let draftRange: Range | null = null;
  let draftElement: Element | null = null;
  let hadSelection = false;

  const overlay = doc.createElement("div");
  overlay.id = env.overlayId;
  overlay.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483000;";
  const hoverBox = doc.createElement("div");
  hoverBox.style.cssText =
    "position:absolute;display:none;pointer-events:none;border:2px solid rgba(79,70,229,.9);background:rgba(79,70,229,.08);border-radius:3px;";
  const pickCursorStyle = doc.createElement("style");
  pickCursorStyle.textContent = "* { cursor: crosshair !important; }";

  const ensureOverlay = () => {
    // Re-append if artifact JS replaced/clobbered the body contents.
    if (!overlay.isConnected) doc.body.appendChild(overlay);
    return overlay;
  };

  const boxIn = (host: Element, rect: DOMRect, css: string) => {
    const el = doc.createElement("div");
    el.style.cssText = `position:absolute;pointer-events:none;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;${css}`;
    host.appendChild(el);
    return el;
  };

  const pinAt = (host: Element, rect: DOMRect, id: string, index: number) => {
    const pin = doc.createElement("button");
    pin.type = "button";
    pin.textContent = String(index);
    const left = Math.max(2, rect.left + window.scrollX - 22);
    const top = Math.max(2, rect.top + window.scrollY - 8);
    pin.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;left:${left}px;top:${top}px;width:18px;height:18px;border-radius:9999px;border:2px solid #fff;background:${id === activeId ? "#312e81" : "#4f46e5"};color:#fff;font:700 10px/14px ui-sans-serif,system-ui,sans-serif;text-align:center;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.35);`;
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeId = id;
      schedulePaint();
      post({
        type: "marker-clicked",
        id,
        rect: toRect(pin.getBoundingClientRect()),
      });
    });
    host.appendChild(pin);
  };

  const drawRange = (
    host: Element,
    range: Range,
    active: boolean,
    isDraft: boolean,
  ) => {
    const fill = isDraft
      ? "background:rgba(79,70,229,.18);"
      : active
        ? "background:rgba(245,158,11,.45);"
        : "background:rgba(245,158,11,.28);";
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i] as DOMRect;
      if (rect.width === 0 && rect.height === 0) continue;
      boxIn(host, rect, `${fill}border-radius:2px;`);
    }
  };

  const drawElementBox = (
    host: Element,
    el: Element,
    active: boolean,
    isDraft: boolean,
  ) => {
    const style = isDraft
      ? "border:2px dashed rgba(79,70,229,.9);background:rgba(79,70,229,.08);"
      : active
        ? "border:2px solid rgba(245,158,11,1);background:rgba(245,158,11,.14);"
        : "border:2px solid rgba(245,158,11,.75);";
    boxIn(host, el.getBoundingClientRect(), `${style}border-radius:3px;`);
  };

  const resolveElement = (selector: string): Element | null => {
    try {
      const el = doc.querySelector(selector);
      return el && !overlay.contains(el) && el !== overlay ? el : null;
    } catch {
      return null;
    }
  };

  const paint = () => {
    const host = ensureOverlay();
    while (host.firstChild) host.removeChild(host.firstChild);
    let index: ReturnType<typeof env.buildTextIndex> | null = null;
    const getIndex = () => {
      if (!index) index = env.buildTextIndex(doc, env.overlayId);
      return index;
    };
    const results: Array<{
      id: string;
      resolved: boolean;
      rect?: HtmlCanvasRect;
    }> = [];
    for (const annotation of annotations) {
      const anchor = annotation.anchor;
      if (anchor.type === "page") {
        results.push({ id: annotation.id, resolved: true });
        continue;
      }
      if (anchor.type === "text") {
        const range = env.resolveTextQuote(doc, anchor, getIndex());
        if (!range) {
          results.push({ id: annotation.id, resolved: false });
          continue;
        }
        drawRange(host, range, annotation.id === activeId, false);
        pinAt(
          host,
          range.getBoundingClientRect(),
          annotation.id,
          annotation.index,
        );
        results.push({
          id: annotation.id,
          resolved: true,
          rect: toRect(range.getBoundingClientRect()),
        });
        continue;
      }
      const el = resolveElement(anchor.selector);
      if (!el) {
        results.push({ id: annotation.id, resolved: false });
        continue;
      }
      drawElementBox(host, el, annotation.id === activeId, false);
      pinAt(host, el.getBoundingClientRect(), annotation.id, annotation.index);
      results.push({
        id: annotation.id,
        resolved: true,
        rect: toRect(el.getBoundingClientRect()),
      });
    }
    if (draftRange) drawRange(host, draftRange, false, true);
    if (draftElement?.isConnected)
      drawElementBox(host, draftElement, false, true);
    host.appendChild(hoverBox);
    post({ type: "annotations-resolved", results });
  };

  let paintTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePaint = () => {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      try {
        paint();
      } catch (err) {
        post({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, 120);
  };

  // Selection capture — always live (no mode). Debounced so we report settled
  // selections, not every drag tick. The captured range is kept as the draft
  // so the highlight survives the selection collapsing when the host composer
  // takes focus; the host clears it with `clear-draft`.
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  doc.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (pickMode) return;
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (hadSelection) {
          hadSelection = false;
          post({ type: "selection-cleared" });
        }
        return;
      }
      const anchor = env.textQuoteFromSelection(
        doc,
        env.contextChars,
        env.maxQuote,
      );
      if (!anchor) return;
      hadSelection = true;
      draftRange = sel.getRangeAt(0).cloneRange();
      schedulePaint();
      post({
        type: "selection",
        anchor,
        rect: toRect(sel.getRangeAt(0).getBoundingClientRect()),
      });
    }, 200);
  });

  // Element pick mode: hover outline + capture-phase click.
  doc.addEventListener(
    "mouseover",
    (event) => {
      if (!pickMode) return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        overlay.contains(target) ||
        target === doc.body ||
        target === doc.documentElement
      ) {
        hoverBox.style.display = "none";
        return;
      }
      const rect = target.getBoundingClientRect();
      hoverBox.style.display = "block";
      hoverBox.style.left = `${rect.left + window.scrollX}px`;
      hoverBox.style.top = `${rect.top + window.scrollY}px`;
      hoverBox.style.width = `${rect.width}px`;
      hoverBox.style.height = `${rect.height}px`;
    },
    true,
  );
  doc.addEventListener(
    "click",
    (event) => {
      if (!pickMode) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target;
      if (
        !(target instanceof Element) ||
        overlay.contains(target) ||
        target === doc.body ||
        target === doc.documentElement
      )
        return;
      draftElement = target;
      draftRange = null;
      hoverBox.style.display = "none";
      const anchor: ElementAnchor = {
        type: "element",
        selector: env.cssPathFor(target, doc),
        label: env.labelFor(target),
      };
      schedulePaint();
      post({
        type: "element-picked",
        anchor,
        rect: toRect(target.getBoundingClientRect()),
      });
    },
    true,
  );

  // Repaint when the document reflows or mutates (ignoring our own overlay).
  window.addEventListener("resize", schedulePaint);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      if (
        target === overlay ||
        (target instanceof Node && overlay.contains(target)) ||
        target === pickCursorStyle
      )
        continue;
      schedulePaint();
      return;
    }
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  const scrollToAnnotation = (id: string) => {
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;
    const anchor: CommentAnchor = annotation.anchor;
    if (anchor.type === "text") {
      const range = env.resolveTextQuote(
        doc,
        anchor,
        env.buildTextIndex(doc, env.overlayId),
      );
      const el = range?.startContainer.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (anchor.type === "element") {
      resolveElement(anchor.selector)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.channel !== env.channel) return;
    try {
      switch (data.type) {
        case "set-annotations":
          annotations = Array.isArray(data.annotations)
            ? (data.annotations as HtmlCanvasAnnotation[])
            : [];
          schedulePaint();
          break;
        case "set-pick-mode": {
          const active = data.active === true;
          if (active === pickMode) break;
          pickMode = active;
          if (active) {
            doc.head.appendChild(pickCursorStyle);
          } else {
            pickCursorStyle.remove();
            hoverBox.style.display = "none";
          }
          break;
        }
        case "set-active":
          activeId = typeof data.id === "string" ? data.id : null;
          schedulePaint();
          if (data.scroll === true && activeId) scrollToAnnotation(activeId);
          break;
        case "clear-draft":
          draftRange = null;
          draftElement = null;
          schedulePaint();
          break;
      }
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ensureOverlay();
  post({ type: "ready" });
}

// Compose the injectable script. Every helper is bound to a fresh, literal
// name in the generated scope and handed to the runtime through `env`, so the
// output is immune to bundler identifier renaming.
export function buildAnnotationShimScript(): string {
  return `;(() => {
  "use strict";
  const __phBuildTextIndex = ${buildTextIndex.toString()};
  const __phTextQuoteFromSelection = ${textQuoteFromSelection.toString()};
  const __phResolveTextQuote = ${resolveTextQuote.toString()};
  const __phCssPathFor = ${cssPathFor.toString()};
  const __phLabelFor = ${labelFor.toString()};
  const __phMain = ${annotationShimMain.toString()};
  try {
    __phMain({
      channel: ${JSON.stringify(HTML_CANVAS_MESSAGE_CHANNEL)},
      overlayId: ${JSON.stringify(ANNOTATION_OVERLAY_ID)},
      contextChars: ${CONTEXT_CHARS},
      maxQuote: ${MAX_QUOTE_CHARS},
      buildTextIndex: __phBuildTextIndex,
      textQuoteFromSelection: __phTextQuoteFromSelection,
      resolveTextQuote: __phResolveTextQuote,
      cssPathFor: __phCssPathFor,
      labelFor: __phLabelFor,
    });
  } catch (err) {
    window.parent.postMessage(
      {
        channel: ${JSON.stringify(HTML_CANVAS_MESSAGE_CHANNEL)},
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      },
      "*",
    );
  }
})();`;
}
