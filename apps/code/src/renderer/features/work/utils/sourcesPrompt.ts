/**
 * Encode/decode the user's selected MCP data sources as a prefix in the
 * scheduled task's prompt. This is a stopgap until the backend grows a
 * first-class `mcp_sources` field on TaskAutomation.
 *
 * Format:
 *   [Sources: github, slack, linear]
 *   <blank line>
 *   <prompt body>
 *
 * If the prompt doesn't start with this header, the sources list is empty
 * and the body is the entire prompt.
 */

const PREFIX_RE = /^\[Sources:\s*([^\]]*)\]\s*\n+([\s\S]*)$/;

export interface PromptWithSources {
  sources: string[];
  body: string;
}

export function decodePrompt(prompt: string): PromptWithSources {
  const m = prompt.match(PREFIX_RE);
  if (!m) return { sources: [], body: prompt };
  const sources = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { sources, body: m[2] };
}

export function encodePrompt(body: string, sources: string[]): string {
  const cleaned = sources.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) return body;
  return `[Sources: ${cleaned.join(", ")}]\n\n${body}`;
}
