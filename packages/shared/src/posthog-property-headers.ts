export type PosthogPropertyValue = string | number | boolean | null | undefined;

export type PosthogProperties = Record<string, PosthogPropertyValue>;

/**
 * Make a value safe to embed in an HTTP header value. Collapses newlines to
 * spaces (the header block is newline-delimited), transliterates accented
 * letters to their ASCII base (`più` → `piu`), and drops everything else
 * outside printable ASCII (emoji, smart quotes, CJK). Latin1 bytes are valid
 * per RFC 9110 and undici accepts them, but Bun's fetch — which the Claude
 * Code CLI uses to send headers wired through `ANTHROPIC_CUSTOM_HEADERS` —
 * rejects any non-ASCII header value, so printable ASCII is the only range
 * every consumer accepts.
 */
function sanitizeHeaderValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "");
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
