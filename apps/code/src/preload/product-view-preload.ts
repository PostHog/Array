/**
 * Product View in-page inspector + overlay. Injected as the preload of the
 * embedded WebContentsView showing the USER'S OWN product, running in the
 * isolated world: the page cannot see, call, or spoof anything here (nothing
 * is exposed via contextBridge), and nothing secret ever enters this file —
 * the host pushes only display-ready overlay items over IPC.
 *
 * Responsibilities:
 * - enumerate interactive elements and report compact descriptors to the host
 *   (which matches them against PostHog autocapture data)
 * - paint element-anchored halos/badges inside a closed shadow root, so the
 *   overlay tracks scroll/zoom for free and never collides with page CSS
 * - inspect mode: hover highlight + click-to-select (reported to the host)
 */
import { ipcRenderer } from "electron";

const MAX_ELEMENTS = 300;
const TEXT_CAP = 64;
const ATTR_CAP = 200;
const REPORT_DEBOUNCE_MS = 600;

const CANDIDATE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[data-attr]",
].join(", ");

interface ElementDescriptor {
  selectorHash: string;
  tag: string;
  dataAttr: string | null;
  id: string | null;
  classes: string[];
  href: string | null;
  text: string | null;
  nthChildPath: string;
}

interface OverlayItem {
  selectorHash: string;
  halo: "green" | "amber" | "red";
  label: string | null;
}

const cap = (value: string | null | undefined, max: number): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function nthChildPath(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  for (let depth = 0; node && node !== document.body && depth < 6; depth++) {
    const parent: Element | null = node.parentElement;
    const index = parent
      ? Array.prototype.indexOf.call(parent.children, node) + 1
      : 1;
    parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
    node = parent;
  }
  return parts.join(">");
}

function describe(element: Element): ElementDescriptor {
  const tag = element.tagName.toLowerCase();
  const dataAttr = cap(element.getAttribute("data-attr"), ATTR_CAP);
  const id = cap(element.getAttribute("id"), ATTR_CAP);
  const classes = Array.from(element.classList).slice(0, 5);
  const href = cap(element.getAttribute("href"), ATTR_CAP);
  const text = cap(element.textContent, TEXT_CAP);
  const path = nthChildPath(element);
  const selectorHash = djb2(
    [tag, dataAttr ?? "", id ?? "", href ?? "", text ?? "", path].join("|"),
  );
  return {
    selectorHash,
    tag,
    dataAttr,
    id,
    classes,
    href,
    text,
    nthChildPath: path,
  };
}

// hash → live element; rebuilt on every enumeration so navigations and
// re-renders can't leave the overlay pointing at detached nodes.
let elementsByHash = new Map<string, Element>();
let overlayItems = new Map<string, OverlayItem>();
let inspectMode = false;

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

function enumerate(): ElementDescriptor[] {
  const found = document.querySelectorAll(CANDIDATE_SELECTOR);
  const next = new Map<string, Element>();
  const descriptors: ElementDescriptor[] = [];
  for (const element of Array.from(found)) {
    if (descriptors.length >= MAX_ELEMENTS) break;
    if (overlayHost?.contains(element)) continue;
    if (!isVisible(element)) continue;
    const descriptor = describe(element);
    if (next.has(descriptor.selectorHash)) continue;
    next.set(descriptor.selectorHash, element);
    descriptors.push(descriptor);
  }
  elementsByHash = next;
  return descriptors;
}

let reportTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReport(): void {
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportTimer = null;
    const elements = enumerate();
    ipcRenderer.send("product-view:elements-reported", { elements });
    renderOverlay();
  }, REPORT_DEBOUNCE_MS);
}

// ── Overlay rendering (closed shadow root; page CSS cannot reach in) ──

let overlayHost: HTMLDivElement | null = null;
let overlayRoot: ShadowRoot | null = null;
let ringsLayer: HTMLDivElement | null = null;
let hoverRing: HTMLDivElement | null = null;

const OVERLAY_CSS = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
  .ring {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border-radius: 6px; border: 2px solid transparent;
  }
  .ring.green { border-color: rgba(54, 196, 111, 0.75); }
  .ring.amber { border-color: rgba(247, 165, 1, 0.9); box-shadow: 0 0 8px rgba(247, 165, 1, 0.35); }
  .ring.red { border-color: rgba(245, 78, 0, 0.9); box-shadow: 0 0 10px rgba(245, 78, 0, 0.4); }
  .badge {
    position: absolute; top: -20px; left: 0; white-space: nowrap;
    font: 600 10px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #fff; background: rgba(13, 15, 18, 0.85); border-radius: 4px;
    padding: 0 6px; letter-spacing: 0.2px;
  }
  .hover {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 2px dashed rgba(45, 135, 255, 0.9); border-radius: 6px;
    background: rgba(45, 135, 255, 0.08); z-index: 2147483647; display: none;
  }
`;

function ensureOverlay(): void {
  if (overlayHost?.isConnected) return;
  overlayHost = document.createElement("div");
  overlayHost.setAttribute("data-posthog-product-view", "");
  overlayRoot = overlayHost.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(OVERLAY_CSS);
  overlayRoot.adoptedStyleSheets = [sheet];
  ringsLayer = document.createElement("div");
  ringsLayer.className = "layer";
  hoverRing = document.createElement("div");
  hoverRing.className = "hover";
  overlayRoot.append(ringsLayer, hoverRing);
  document.documentElement.appendChild(overlayHost);
}

let layoutFrame: number | null = null;
function scheduleLayout(): void {
  if (layoutFrame != null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    layoutRings();
  });
}

const ringNodes = new Map<string, HTMLDivElement>();

function renderOverlay(): void {
  ensureOverlay();
  if (!ringsLayer) return;
  const wanted = new Set<string>();
  for (const [hash, item] of overlayItems) {
    const element = elementsByHash.get(hash);
    if (!element || !element.isConnected) continue;
    wanted.add(hash);
    let ring = ringNodes.get(hash);
    if (!ring) {
      ring = document.createElement("div");
      ringNodes.set(hash, ring);
      ringsLayer.appendChild(ring);
    }
    ring.className = `ring ${item.halo}`;
    const label = inspectMode && item.label ? item.label : null;
    let badge = ring.firstElementChild as HTMLDivElement | null;
    if (label) {
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "badge";
        ring.appendChild(badge);
      }
      badge.textContent = label;
    } else if (badge) {
      badge.remove();
    }
  }
  for (const [hash, ring] of ringNodes) {
    if (!wanted.has(hash)) {
      ring.remove();
      ringNodes.delete(hash);
    }
  }
  layoutRings();
}

function layoutRings(): void {
  for (const [hash, ring] of ringNodes) {
    const element = elementsByHash.get(hash);
    if (!element || !element.isConnected) {
      ring.style.display = "none";
      continue;
    }
    const rect = element.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight;
    ring.style.display = visible ? "block" : "none";
    if (!visible) continue;
    ring.style.left = `${rect.left - 2}px`;
    ring.style.top = `${rect.top - 2}px`;
    ring.style.width = `${rect.width + 4}px`;
    ring.style.height = `${rect.height + 4}px`;
  }
}

// ── Inspect mode: hover highlight + click-to-select ──

function candidateFor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  if (overlayHost?.contains(target)) return null;
  return target.closest(CANDIDATE_SELECTOR);
}

function onMouseMove(event: MouseEvent): void {
  if (!hoverRing) return;
  const candidate = candidateFor(event.target);
  if (!candidate) {
    hoverRing.style.display = "none";
    return;
  }
  const rect = candidate.getBoundingClientRect();
  hoverRing.style.display = "block";
  hoverRing.style.left = `${rect.left - 2}px`;
  hoverRing.style.top = `${rect.top - 2}px`;
  hoverRing.style.width = `${rect.width + 4}px`;
  hoverRing.style.height = `${rect.height + 4}px`;
}

function onClick(event: MouseEvent): void {
  const candidate = candidateFor(event.target);
  if (!candidate) return;
  // Inspect-mode clicks select, never activate — ambient mode never touches
  // page behaviour (these listeners are only attached while inspecting).
  event.preventDefault();
  event.stopImmediatePropagation();
  const descriptor = describe(candidate);
  elementsByHash.set(descriptor.selectorHash, candidate);
  ipcRenderer.send("product-view:element-selected", { element: descriptor });
}

function setInspectMode(enabled: boolean): void {
  if (inspectMode === enabled) return;
  inspectMode = enabled;
  ensureOverlay();
  if (enabled) {
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
  } else {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    if (hoverRing) hoverRing.style.display = "none";
  }
  renderOverlay();
}

// ── Wiring ──

ipcRenderer.on("product-view:overlay-data", (_event, payload) => {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  overlayItems = new Map(
    items
      .filter(
        (item: OverlayItem) =>
          item &&
          typeof item.selectorHash === "string" &&
          (item.halo === "green" ||
            item.halo === "amber" ||
            item.halo === "red"),
      )
      .map((item: OverlayItem) => [item.selectorHash, item]),
  );
  renderOverlay();
});

ipcRenderer.on("product-view:set-inspect-mode", (_event, payload) => {
  setInspectMode(Boolean(payload?.enabled));
});

// Ambient interaction reporting: never blocks or alters the page; the host
// uses it to attribute the network requests that follow to the element that
// triggered them (live latency + trace correlation).
document.addEventListener(
  "pointerdown",
  (event) => {
    const candidate = candidateFor(event.target);
    if (!candidate) return;
    ipcRenderer.send("product-view:interaction", {
      selectorHash: describe(candidate).selectorHash,
    });
  },
  { capture: true, passive: true },
);

window.addEventListener("scroll", scheduleLayout, {
  passive: true,
  capture: true,
});
window.addEventListener("resize", scheduleLayout, { passive: true });
// Animations/layout changes without scroll events (accordions, carousels).
setInterval(scheduleLayout, 500);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (
      mutation.target instanceof Element &&
      overlayHost?.contains(mutation.target)
    ) {
      continue;
    }
    scheduleReport();
    return;
  }
});

function start(): void {
  ensureOverlay();
  scheduleReport();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  // SPA navigations don't fire load events; history changes re-enumerate.
  const wrap = (name: "pushState" | "replaceState") => {
    const original = history[name].bind(history);
    history[name] = ((...args: Parameters<History["pushState"]>) => {
      original(...args);
      scheduleReport();
    }) as History["pushState"];
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", scheduleReport);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
