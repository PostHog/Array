import { defineTool } from "@earendil-works/pi-coding-agent";
import { LRUCache } from "lru-cache";
import TurndownService from "turndown";
import { Type } from "typebox";
import {
  type GatewayAuth,
  tryResolveGatewayAuth,
} from "../posthog-provider/gateway-auth";
import type { PosthogProviderOptions } from "../posthog-provider/provider";
import { renderWebFetchCall } from "./render";

const MAX_URL_LENGTH = 2000;
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;
const MAX_MARKDOWN_LENGTH = 100_000;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 10;
const SUMMARIZATION_MODEL = "claude-haiku-4-5";

const turndown = new TurndownService();
// Strip non-content elements before conversion. Without this, <head> boilerplate
// (inline fonts as base64, <style>/<script> blocks) gets converted to markdown
// text and can push real page content past MAX_MARKDOWN_LENGTH truncation,
// leaving the summarizer with nothing but CSS/font junk.
turndown.remove(["script", "style", "noscript", "head", "link", "meta", "svg"]);

export function validateUrl(
  url: string,
): { valid: true; url: URL } | { valid: false; reason: string } {
  if (url.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      reason: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: `Invalid URL: ${url}` };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: "URLs with embedded credentials are not supported",
    };
  }

  const parts = parsed.hostname.split(".");
  if (parts.length < 2) {
    return { valid: false, reason: "URL must have a public hostname" };
  }

  return { valid: true, url: parsed };
}

interface CacheEntry {
  bytes: number;
  code: number;
  content: string;
  contentType: string;
}

const urlCache = new LRUCache<string, CacheEntry>({
  maxSize: 50 * 1024 * 1024,
  sizeCalculation: (entry) => Math.max(1, entry.content.length),
  ttl: 15 * 60 * 1000,
});

export function isPermittedRedirect(
  original: string,
  redirect: string,
): boolean {
  try {
    const a = new URL(original);
    const b = new URL(redirect);
    if (b.protocol !== a.protocol || b.port !== a.port) return false;
    if (b.username || b.password) return false;
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(a.hostname) === strip(b.hostname);
  } catch {
    return false;
  }
}

async function fetchWithRedirects(
  url: string,
  signal: AbortSignal,
  depth = 0,
): Promise<
  | { type: "response"; response: Response; finalUrl: string }
  | { type: "cross_host_redirect"; from: string; to: string; status: number }
> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
  }

  const response = await fetch(url, {
    signal,
    redirect: "manual",
    headers: {
      Accept: "text/markdown, text/html, */*",
      "User-Agent": "PostHog-Harness/1.0 (web-fetch)",
    },
  });

  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing Location header");
    const redirectUrl = new URL(location, url).toString();

    if (isPermittedRedirect(url, redirectUrl)) {
      return fetchWithRedirects(redirectUrl, signal, depth + 1);
    }
    return {
      type: "cross_host_redirect",
      from: url,
      to: redirectUrl,
      status: response.status,
    };
  }

  return { type: "response", response, finalUrl: url };
}

export function makeSummarizationPrompt(
  markdownContent: string,
  prompt: string,
): string {
  const truncated =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? `${markdownContent.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
      : markdownContent;

  return `Web page content:\n---\n${truncated}\n---\n\n${prompt}\n\nProvide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.`;
}

async function summarize(
  markdown: string,
  prompt: string,
  gateway: GatewayAuth,
  signal: AbortSignal | undefined,
): Promise<string> {
  const baseUrl = gateway.baseUrl.replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gateway.apiKey}`,
    },
    body: JSON.stringify({
      model: SUMMARIZATION_MODEL,
      messages: [
        { role: "user", content: makeSummarizationPrompt(markdown, prompt) },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(
      `Summarization failed (${response.status}): ${err || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "No response from summarizer.";
}

function returnMarkdown(
  markdown: string,
  details: Record<string, unknown>,
): {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
} {
  const truncated =
    markdown.length > MAX_MARKDOWN_LENGTH
      ? `${markdown.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
      : markdown;
  return {
    content: [{ type: "text" as const, text: truncated }],
    details,
  };
}

export function createWebFetchTool(options: PosthogProviderOptions = {}) {
  return defineTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract content from a web page URL. Converts HTML to markdown and summarizes it based on your prompt. Use for reading documentation, READMEs, API references, or any public web page.",
    promptSnippet: "Fetch and read content from a URL",
    promptGuidelines: [
      "Use web_fetch to read documentation, READMEs, changelogs, or any public web page.",
      "web_fetch will fail for authenticated or private URLs — only use it for public content.",
      "The prompt parameter tells the summarizer what to extract — be specific about what you need.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "The URL to fetch content from",
      }),
      prompt: Type.String({
        description: "What information to extract from the page content",
      }),
    }),
    renderCall(args, theme) {
      return renderWebFetchCall(args, theme);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const validation = validateUrl(params.url);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      const gateway = await tryResolveGatewayAuth(options, ctx);

      const parsed = validation.url;
      if (parsed.protocol === "http:") {
        parsed.protocol = "https:";
      }
      const url = parsed.toString();

      const cached = urlCache.get(url);
      if (cached) {
        const details = {
          code: cached.code,
          bytes: cached.bytes,
          url,
          cached: true,
        };

        if (
          cached.contentType.includes("text/markdown") &&
          cached.content.length < MAX_MARKDOWN_LENGTH
        ) {
          return returnMarkdown(cached.content, details);
        }

        if (gateway) {
          const summary = await summarize(
            cached.content,
            params.prompt,
            gateway,
            signal,
          );
          return {
            content: [{ type: "text" as const, text: summary }],
            details,
          };
        }

        return returnMarkdown(cached.content, details);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      try {
        const result = await fetchWithRedirects(url, combinedSignal);

        if (result.type === "cross_host_redirect") {
          return {
            content: [
              {
                type: "text" as const,
                text: `REDIRECT DETECTED: The URL redirects to a different host.\n\nOriginal URL: ${result.from}\nRedirect URL: ${result.to}\nStatus: ${result.status}\n\nTo fetch the redirected content, call web_fetch again with the redirect URL.`,
              },
            ],
            details: {
              code: result.status,
              url: result.from,
              redirectUrl: result.to,
            },
          };
        }

        const { response, finalUrl } = result;

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(
            `HTTP ${response.status}: ${body || response.statusText}`,
          );
        }

        const contentLengthHeader = response.headers.get("content-length");
        const contentLength = contentLengthHeader
          ? Number(contentLengthHeader)
          : 0;
        if (contentLength > MAX_CONTENT_LENGTH) {
          throw new Error(
            `Content too large (${contentLength} bytes, max ${MAX_CONTENT_LENGTH})`,
          );
        }

        const rawText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";

        let markdown: string;
        if (contentType.includes("text/html")) {
          markdown = turndown.turndown(rawText);
        } else {
          markdown = rawText;
        }

        urlCache.set(url, {
          bytes: rawText.length,
          code: response.status,
          content: markdown,
          contentType,
        });

        const details = {
          code: response.status,
          bytes: rawText.length,
          url: finalUrl,
        };

        if (
          contentType.includes("text/markdown") &&
          markdown.length < MAX_MARKDOWN_LENGTH
        ) {
          return returnMarkdown(markdown, details);
        }

        if (gateway) {
          const summary = await summarize(
            markdown,
            params.prompt,
            gateway,
            signal,
          );
          return {
            content: [{ type: "text" as const, text: summary }],
            details,
          };
        }

        return returnMarkdown(markdown, details);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
