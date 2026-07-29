import { useEffect, useRef } from "react";

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
]);

const DROP_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
]);

const GLOBAL_ATTRIBUTES = new Set(["class", "title"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["alt", "src", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  col: new Set(["span"]),
  details: new Set(["open"]),
};

function isSafeLink(value: string): boolean {
  return /^(https?:|mailto:|#)/i.test(value.trim());
}

function isSafeImage(value: string): boolean {
  return /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/i.test(value.trim());
}

/**
 * A deliberately strict static-document sanitizer. Styles, executable/form
 * elements, event handlers and network-loaded images are removed. The result
 * is displayed in a shadow root, so artifact classes cannot affect app chrome.
 */
export function sanitizeArtifactHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  const sanitizeNode = (node: Node): void => {
    for (const child of [...node.childNodes]) sanitizeNode(child);
    if (!(node instanceof Element)) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.parentNode?.removeChild(node);
      }
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (DROP_CONTENT_TAGS.has(tag)) {
      node.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    const allowed = TAG_ATTRIBUTES[tag] ?? new Set<string>();
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!GLOBAL_ATTRIBUTES.has(name) && !allowed.has(name)) {
        node.removeAttribute(attribute.name);
      }
    }
    if (tag === "a") {
      const href = node.getAttribute("href");
      if (!href || !isSafeLink(href)) node.removeAttribute("href");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      const src = node.getAttribute("src");
      if (!src || !isSafeImage(src)) node.removeAttribute("src");
    }
  };

  for (const child of [...parsed.body.childNodes]) sanitizeNode(child);
  return parsed.body.innerHTML;
}

const DOCUMENT_STYLES = `
  :host { color: var(--gray-12); font-family: var(--default-font-family); }
  .artifact-html { box-sizing: border-box; max-width: 900px; margin: 0 auto; padding: 24px; line-height: 1.55; }
  *, *::before, *::after { box-sizing: border-box; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 .5em; }
  p, ul, ol, blockquote, pre, table { margin: .75em 0; }
  img { max-width: 100%; height: auto; }
  pre, code, kbd, samp { font-family: var(--code-font-family); }
  pre { overflow: auto; padding: 12px; border-radius: 6px; background: var(--gray-3); }
  code { padding: 1px 3px; border-radius: 3px; background: var(--gray-3); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border: 1px solid var(--gray-6); text-align: left; }
  blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid var(--gray-6); color: var(--gray-11); }
  a { color: var(--accent-11); }
`;

export function SanitizedArtifactHtml({
  html,
  onContentRoot,
}: {
  html: string;
  onContentRoot: (root: HTMLElement | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${DOCUMENT_STYLES}</style><article class="artifact-html">${sanitizeArtifactHtml(html)}</article>`;
    const root = shadow.querySelector<HTMLElement>(".artifact-html");
    onContentRoot(root);
    return () => onContentRoot(null);
  }, [html, onContentRoot]);

  return (
    <div ref={hostRef} data-testid="artifact-html" className="min-h-full" />
  );
}
