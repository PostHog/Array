// Context compression at the LLM-proxy seam, in the spirit of Headroom
// (https://github.com/headroomlabs-ai/headroom): shrink what the agent sends
// before it reaches the model. This is the request-body chokepoint every
// desktop LLM call funnels through (AuthProxyService), so it catches *all* tool
// output — file reads, command output, MCP results, search — not just Bash.
//
// The built-in compressor here is deliberately conservative: it only collapses
// long runs of identical consecutive lines (logs, stack traces, blank gaps),
// which is safe even for source the model might quote back, since the omitted
// lines are clearly marked and the one shown line is byte-exact. A heavier,
// benchmarked compressor (e.g. the headroom-ai library) can be dropped into
// this same seam later.
//
// Cache-safety: Anthropic prompt caching keys on message *content*, and this
// transform is a pure, position-independent function of each tool_result's
// content, applied on every request. So a given tool_result compresses to the
// same bytes whether it is the latest turn or deep in history — the cached
// prefix stays stable and cache hits are preserved. Opt-in and dormant unless
// POSTHOG_COMPRESS_CONTEXT is set.

// Collapse a run of this many or more identical consecutive lines. High enough
// that it only fires on genuinely repetitive output, never on the odd repeated
// line in real source.
const IDENTICAL_RUN_THRESHOLD = 8;

export function isCompressionEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.POSTHOG_COMPRESS_CONTEXT?.trim().toLowerCase();
  return !!raw && raw !== "0" && raw !== "false";
}

/**
 * Collapses runs of >= IDENTICAL_RUN_THRESHOLD identical consecutive lines into
 * the line plus a `… [N identical lines omitted] …` marker. Pure and
 * deterministic; returns the input unchanged when there is nothing to collapse.
 */
export function compressToolOutput(text: string): string {
  if (text.indexOf("\n") === -1) return text; // single line — nothing to dedupe

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const runLength = j - i;
    if (runLength >= IDENTICAL_RUN_THRESHOLD) {
      out.push(lines[i]);
      out.push(`… [${runLength - 1} identical lines omitted] …`);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function compressBlock(block: Record<string, unknown>): boolean {
  if (block.type !== "tool_result") return false;
  const content = block.content;

  if (typeof content === "string") {
    const next = compressToolOutput(content);
    if (next === content) return false;
    block.content = next;
    return true;
  }

  if (Array.isArray(content)) {
    let changed = false;
    for (const part of content) {
      if (
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string"
      ) {
        const next = compressToolOutput(part.text);
        if (next !== part.text) {
          part.text = next;
          changed = true;
        }
      }
    }
    return changed;
  }

  return false;
}

/**
 * Compresses tool_result content in an Anthropic Messages request body. Returns
 * the original buffer untouched when the body isn't an eligible messages
 * request or nothing was compressible — fail-open, so a malformed body or an
 * unexpected shape never breaks a request.
 */
export function compressMessagesBody(
  body: Buffer<ArrayBuffer>,
): Buffer<ArrayBuffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return body;

  let changed = false;
  for (const message of parsed.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && compressBlock(block)) changed = true;
    }
  }

  if (!changed) return body;
  return Buffer.from(JSON.stringify(parsed), "utf8");
}
