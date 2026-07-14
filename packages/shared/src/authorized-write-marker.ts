// Machine-readable marker embedded in an app-authored generation prompt to
// declare which PostHog first-party artifact the task is authorized to write —
// a channel's CONTEXT.md or a freeform canvas. Both live in PostHog (not on
// disk) and are published via the PostHog MCP `*-partial-update` sub-tools,
// which the permission gate otherwise treats as destructive.
//
// The agent's permission gate reads these markers off the *user* message (which
// the agent cannot forge — it only produces assistant messages and tool calls)
// and auto-allows the sanctioned publish sub-tool only when the call targets one
// of the declared ids. So the agent can never silently publish to an arbitrary
// artifact id; any other id still requires explicit approval. Rendered as an
// HTML comment so it stays invisible in the rendered chat.

export interface AuthorizedWrite {
  // The PostHog MCP sub-tool the task may call, e.g.
  // "desktop-file-system-instructions-partial-update".
  subTool: string;
  // The exact artifact id that sub-tool is authorized to target.
  id: string;
}

// Global so `matchAll` finds every marker in the prompt. `id` accepts anything
// except a quote or angle bracket, which keeps the match bounded to the comment.
const MARKER_RE =
  /<!--\s*posthog:authorized-write\s+subtool="([a-zA-Z0-9_-]+)"\s+id="([^"<>]+)"\s*-->/g;

export function buildAuthorizedWriteMarker(write: AuthorizedWrite): string {
  return `<!-- posthog:authorized-write subtool="${write.subTool}" id="${write.id}" -->`;
}

export function parseAuthorizedWriteMarkers(text: string): AuthorizedWrite[] {
  const writes: AuthorizedWrite[] = [];
  for (const match of text.matchAll(MARKER_RE)) {
    const subTool = match[1];
    const id = match[2];
    if (subTool && id) {
      writes.push({ subTool, id });
    }
  }
  return writes;
}
