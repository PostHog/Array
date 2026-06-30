export type PosthogPropertyValue = string | number | boolean | null | undefined;

export type PosthogProperties = Record<string, PosthogPropertyValue>;

/**
 * Make a value safe to embed in an HTTP header value. Collapses newlines to
 * spaces (the header block is newline-delimited) and drops characters outside
 * the valid header-byte range — control chars and code points above latin1
 * (emoji, smart quotes) — which an HTTP client (e.g. undici) would otherwise
 * reject before sending. ASCII is preserved.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7e\x80-\xff]/g, "");
}

function buildEntries(properties: PosthogProperties): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue;
    entries.push([
      `x-posthog-property-${key}`,
      sanitizeHeaderValue(String(value)),
    ]);
  }
  return entries;
}

/**
 * Build a `Record<string, string>` of `x-posthog-property-<name>` headers
 * suitable for `fetch()` init.headers. The LLM gateway lifts each header
 * onto the `$ai_generation` event it captures
 * (see `services/llm-gateway/src/llm_gateway/request_context.py` in
 * posthog/posthog). `null`/`undefined` values are dropped; values are
 * sanitized via {@link sanitizeHeaderValue}.
 */
export function buildPosthogPropertyHeaderRecord(
  properties: PosthogProperties,
): Record<string, string> {
  return Object.fromEntries(buildEntries(properties));
}

/**
 * Same property semantics as {@link buildPosthogPropertyHeaderRecord}, but
 * returns a newline-joined string of `key: value` lines — the format
 * `ANTHROPIC_CUSTOM_HEADERS` expects when wiring headers into the Claude
 * Agent SDK.
 */
export function buildPosthogPropertyHeaderLines(
  properties: PosthogProperties,
): string {
  return buildEntries(properties)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}
