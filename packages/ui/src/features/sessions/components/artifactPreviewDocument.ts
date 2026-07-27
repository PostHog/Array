import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { applyCspToHtml } from "../../mcp-apps/utils/mcp-app-csp";

export function artifactHtmlDocument(html: string): string {
  return applyCspToHtml(html);
}

export function markdownDocument(markdown: string): string {
  const content = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
  return artifactHtmlDocument(`<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
    :root{font:15px/1.6 system-ui,sans-serif;color-scheme:light dark}body{box-sizing:border-box;margin:0 auto;max-width:900px;padding:32px;color:CanvasText;background:Canvas}h1,h2{border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}a{color:LinkText}blockquote{margin-left:0;padding-left:1em;border-left:4px solid color-mix(in srgb,CanvasText 25%,transparent);color:GrayText}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}code{border-radius:4px;background:color-mix(in srgb,CanvasText 8%,transparent);padding:.15em .3em}pre{overflow:auto;border-radius:6px;background:color-mix(in srgb,CanvasText 8%,transparent);padding:16px}pre code{background:none;padding:0}table{border-spacing:0;border-collapse:collapse}th,td{border:1px solid color-mix(in srgb,CanvasText 20%,transparent);padding:6px 12px}img{max-width:100%}hr{border:0;border-top:1px solid color-mix(in srgb,CanvasText 20%,transparent)}
  </style></head><body>${content}</body></html>`);
}
