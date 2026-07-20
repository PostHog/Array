import { freeformSystemPromptFor } from "@posthog/core/canvas/canvasTemplates";
import type { CanvasAnnotationTarget } from "@posthog/core/canvas/freeformSchemas";
import { FREEFORM_STARTER_CODE } from "@posthog/core/canvas/freeformStarter";

// A queued comment-mode annotation, ready for the prompt: the pin number the
// user saw, their comment, and the captured target.
export interface CanvasAnnotationPromptInput {
  n: number;
  comment: string;
  target: CanvasAnnotationTarget;
}

// One prompt line per annotation. The selector describes the RENDERED DOM, so
// the quoted text + stable attributes are the primary locators against source.
function annotationLine(a: CanvasAnnotationPromptInput): string {
  const t = a.target;
  const comment = a.comment || "see the user's request above";
  if (t.type === "text-range") {
    return `${a.n}. On the text "${t.text}" (inside <${t.ancestorTag}>, selector: ${t.ancestorSelector}): ${comment}`;
  }
  const attrs = Object.entries(t.attributes)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const label = t.text ? ` "${t.text}"` : "";
  const hints = [`selector: ${t.selector}`, attrs].filter(Boolean).join("; ");
  return `${a.n}. On <${t.tag}>${label} (${hints}): ${comment}`;
}

// Builds the prompt for the task that generates a freeform (React) canvas. Like
// CONTEXT.md generation, this runs as a normal repo-less agent task (no repo
// picked up front), so the agent has the default system prompt — the freeform
// authoring contract
// (imports, the `ph` data shim, Quill/style rules) therefore has to live in the
// task's content (its first user message). The canvas is not a file on disk — it
// lives in PostHog — but the agent WORKS on it as a local scratch file through
// the `canvas_checkout` / `canvas_publish` local tools (posthog-code-tools):
// checkout writes the live source to a scratch path tool-side and records the
// base version; the agent applies the change with its native file-editing tools
// (targeted edits, not a full regeneration — and no transcribing the source
// through chat); publish reads the file from disk and saves it as the new
// version, rejecting a publish whose base is stale (a concurrent edit or undo)
// instead of silently clobbering it.
export function buildFreeformGenerationPrompt(input: {
  dashboardId: string;
  name: string;
  channelName: string;
  templateId?: string;
  instruction: string;
  // Present when editing an existing canvas; omitted for a first build. Only
  // its presence matters — `canvas_checkout` fetches the authoritative source
  // itself (fresher than anything embedded at task-creation time), so the
  // content is no longer folded into the prompt.
  currentCode?: string;
  // Default on (opt out via the generate bar): seed a known-good starter
  // scaffold as the agent's baseline on a FIRST build, so it edits a compiling
  // app instead of authoring boilerplate from scratch. Ignored when editing.
  useStarter?: boolean;
  // Queued comment-mode annotations: parts of the rendered canvas the user
  // marked, each with a comment. Rendered as a numbered block matching the
  // pins the user saw.
  annotations?: CanvasAnnotationPromptInput[];
}): string {
  const {
    dashboardId,
    name,
    channelName,
    templateId,
    instruction,
    currentCode,
    useStarter,
    annotations,
  } = input;

  const contract = freeformSystemPromptFor(templateId);
  const isEdit = !!currentCode?.trim();

  // The header points back to the user's request, which leads the message
  // (outside this block). Without that pointer the agent can read the header as
  // a self-contained task and under-weight the actual instruction above.
  const header = isEdit
    ? `Edit the freeform React canvas "${name}" in the channel "${channelName}", per the user's request at the start of this message.`
    : `Build a freeform React canvas "${name}" for the channel "${channelName}", per the user's request at the start of this message.`;

  const checkoutStep = `
[Working copy] — FIRST, check out the canvas: call the \`canvas_checkout\` tool
(posthog-code-tools) with id "${dashboardId}". It writes the canvas's live
source to a local scratch file and returns the path.`;

  const editStep = isEdit
    ? `
Then apply the user's request by editing that file with your file-editing
tools. Do not paste the source into chat.
`
    : "";

  // Structured feedback from the comment-mode overlay: numbered to match the
  // pins the user saw on the rendered canvas.
  const annotationsBlock =
    annotations && annotations.length > 0
      ? `
[Annotations] — the user marked specific parts of the RENDERED canvas. Locate
each in the checked-out source (match primarily by the quoted text and the
stable attributes — the CSS selector describes the rendered DOM, not the code)
and apply the comment as a targeted edit:
${annotations.map(annotationLine).join("\n")}
`
      : "";

  // First-build only: hand the agent a working scaffold to build ON instead of
  // authoring from zero. It already wires the easy-to-get-wrong bits (date
  // picker, theme tokens, loading skeletons, typed-node result reading).
  const starterBlock =
    !isEdit && useStarter
      ? `
[Starter scaffold] — the canvas is empty, so write this WORKING baseline to the
checked-out path, then build by EDITING that file. It already wires the things
that are easy to get wrong: the date picker, theme-aware tokens, per-card
loading skeletons, and reading a typed-node result correctly. KEEP that wiring;
replace the sample "total events" metric and the layout with what the user
asked for.

\`\`\`tsx
${FREEFORM_STARTER_CODE}
\`\`\`
`
      : "";

  const freshBuildStep =
    !isEdit && !useStarter
      ? `
The canvas is empty: author the complete app at the checked-out path and
iterate on it there with your file-editing tools.
`
      : "";

  // The standing authoring contract + publishing/data rules are the same
  // boilerplate on every canvas generation — the user never typed them. Wrap
  // them in a `<canvas_generation_instructions>` element so the conversation UI
  // collapses them into a single clickable tag instead of dumping the full body
  // inline (see extractCanvasInstructions). Kept after the user's instruction so
  // the request leads, mirroring how channel CONTEXT.md is appended.
  const instructions = `${header}
${checkoutStep}${editStep}${annotationsBlock}${starterBlock}${freshBuildStep}
Follow this authoring contract for the canvas (imports, the \`ph\` data shim, and
style rules):

${contract}

PUBLISHING — the scratch file is only your working copy; the canvas lives in
PostHog. When it is ready, call the \`canvas_publish\` tool (posthog-code-tools)
exactly once with:
- id: "${dashboardId}"
- prompt: one short sentence describing the change.

It reads the scratch file from disk and saves it as the canvas's new version —
do not paste the code into the tool call or into chat, and do not call
\`desktop-file-system-canvas-partial-update\` directly. If it fails with a
version-conflict error, the canvas changed while you worked (another edit, or
the user's undo): call \`canvas_checkout\` again, re-apply your edits to the
re-seeded file, then publish again.

Verify event/property names via the PostHog MCP before using them, and operate
only on this project.

DATA — for each metric, first SAVE an insight via the PostHog MCP insight tools
(prefer an insight query type — Trends, Funnels, Retention, web-analytics kinds —
over raw SQL), record the \`short_id\` it returns, and load it in the canvas with
\`ph.loadInsight(short_id, { dateRange })\`. Fall back to inline \`ph.query(...)\`/HogQL
only when no insight can express the metric.`;

  return `${instruction}

<canvas_generation_instructions>
${instructions}
</canvas_generation_instructions>`;
}
