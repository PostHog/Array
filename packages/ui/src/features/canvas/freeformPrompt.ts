import {
  freeformSystemPromptFor,
  WORKFLOW_CANVAS_RULES_TEXT,
} from "@posthog/core/canvas/canvasTemplates";
import { FREEFORM_STARTER_CODE } from "@posthog/core/canvas/freeformStarter";
import {
  WORKFLOW_ENGAGEMENT_STARTER,
  WORKFLOW_HEALTH_STARTER,
} from "@posthog/core/canvas/workflowStarters";

// Builds the prompt for the task that generates a freeform (React) canvas. Like
// CONTEXT.md generation, this runs as a normal repo-less agent task (no repo
// picked up front), so the agent has the default system prompt — the freeform
// authoring contract
// (imports, the `ph` data shim, Quill/style rules) therefore has to live in the
// task's content (its first user message). The canvas is not a file on disk — it
// lives in PostHog — so the agent publishes the result via the PostHog MCP tool
// `desktop-file-system-canvas-partial-update` rather than replying with code or
// writing a file.
export function buildFreeformGenerationPrompt(input: {
  dashboardId: string;
  name: string;
  channelName: string;
  templateId?: string;
  instruction: string;
  // The current source, when editing an existing canvas. Omitted for a first build.
  currentCode?: string;
  // Default on (opt out via the generate bar): seed a known-good starter
  // scaffold as the agent's baseline on a FIRST build, so it edits a compiling
  // app instead of authoring boilerplate from scratch. Ignored when editing.
  useStarter?: boolean;
}): string {
  const {
    dashboardId,
    name,
    channelName,
    templateId,
    instruction,
    currentCode,
    useStarter,
  } = input;

  const contract = freeformSystemPromptFor(templateId);
  const isEdit = !!currentCode?.trim();

  // The header points back to the user's request, which leads the message
  // (outside this block). Without that pointer the agent can read the header as
  // a self-contained task and under-weight the actual instruction above.
  const header = isEdit
    ? `Edit the freeform React canvas "${name}" in the channel "${channelName}", per the user's request at the start of this message.`
    : `Build a freeform React canvas "${name}" for the channel "${channelName}", per the user's request at the start of this message.`;

  const currentBlock = isEdit
    ? `\n[Current code] — the canvas as it stands now. Rewrite the WHOLE file with the change applied; do not output a partial file.\n\n\`\`\`tsx\n${currentCode}\n\`\`\`\n`
    : "";

  // First-build only: hand the agent a working scaffold to build ON instead of
  // authoring from zero. It already wires the easy-to-get-wrong bits (date
  // picker, theme tokens, loading skeletons, typed-node result reading).
  const starterBlock =
    !isEdit && useStarter
      ? `\n[Starter scaffold] — begin from this WORKING baseline instead of authoring from scratch. It already wires the things that are easy to get wrong: the date picker, theme-aware tokens, per-card loading skeletons, and reading a typed-node result correctly. KEEP that wiring; replace the sample "total events" metric and the layout with what the user asked for, and output the COMPLETE rewritten file.\n\n\`\`\`tsx\n${FREEFORM_STARTER_CODE}\n\`\`\`\n`
      : "";

  // First builds can turn out to be a WORKFLOW build (the user asked to DO
  // something ongoing, not just visualize) — the mode gate + the full workflow
  // build flow ride along so free-typed requests like "Send an email after
  // signup" just work. Edits never re-run the workflow flow: an existing
  // workflow canvas resolves its board contract via its stamped templateId.
  const modeBlock = isEdit
    ? ""
    : `
MODE — before anything else, decide which of three modes the user's request is:
- PLAIN CANVAS (default): a dashboard, report, or interactive tool — even one
  ABOUT workflows or emails. Ignore the <workflow_instructions> block below
  entirely and NEVER call any \`workflows-*\` MCP tool.
- BUILD A WORKFLOW: the request asks to DO something on an ongoing basis — send
  an email after signup, alert Slack/Discord on an event, run a drip/onboarding
  sequence, sync or webhook on a trigger. Follow <workflow_instructions> below.
- TRACK AN EXISTING WORKFLOW: the request asks for a board "for", "around", or
  "of" a workflow they already have. Follow the TRACK-EXISTING part of
  <workflow_instructions>.
Only pick a workflow mode when the request clearly asks to automate or track an
automation; when in doubt, build the plain canvas.
`;

  // The standing authoring contract + publishing/data rules are the same
  // boilerplate on every canvas generation — the user never typed them. Wrap
  // them in a `<canvas_generation_instructions>` element so the conversation UI
  // collapses them into a single clickable tag instead of dumping the full body
  // inline (see extractCanvasInstructions). Kept after the user's instruction so
  // the request leads, mirroring how channel CONTEXT.md is appended.
  const instructions = `${header}
${currentBlock}${starterBlock}${modeBlock}
Follow this authoring contract for the canvas (imports, the \`ph\` data shim, and
style rules):

${contract}

PUBLISHING — this OVERRIDES any instruction above about replying with the code in
a fenced \`\`\`tsx block. In this task you do NOT reply with the code. When the
canvas is ready, PUBLISH it by calling the PostHog MCP tool
\`desktop-file-system-canvas-partial-update\` exactly once with:
- id: "${dashboardId}"
- code: the COMPLETE single-file React source for the canvas.

The canvas lives in PostHog, not on disk — calling that MCP tool is what saves it.
Do not write a local file. Verify event/property names via the PostHog MCP before
using them, and operate only on this project.

DATA — for each metric, first SAVE an insight via the PostHog MCP insight tools
(prefer an insight query type — Trends, Funnels, Retention, web-analytics kinds —
over raw SQL), record the \`short_id\` it returns, and load it in the canvas with
\`ph.loadInsight(short_id, { dateRange })\`. Fall back to inline \`ph.query(...)\`/HogQL
only when no insight can express the metric.${isEdit ? "" : buildWorkflowInstructionsBlock(dashboardId)}`;

  return `${instruction}

<canvas_generation_instructions>
${instructions}
</canvas_generation_instructions>`;
}

// The workflow build flow, appended to FIRST-build prompts only (see the MODE
// gate above). A workflow canvas is a PostHog WORKFLOW plus the metrics canvas
// that tracks it: the agent builds + tests the workflow over the PostHog MCP
// \`workflows-*\` tools, then publishes the metrics canvas via the same publish
// path as a plain canvas, starting from a proven starter board. The workflow
// LINK is recorded automatically host-side by observing the build (see the
// workflow link primitive) - the agent does NOT persist it and MUST NOT try.
// The agent NEVER takes the workflow live; going live is the human's explicit
// call (the go-live tools raise an approval card even in auto mode).
function buildWorkflowInstructionsBlock(dashboardId: string): string {
  return `

<workflow_instructions>
Applies ONLY in the BUILD A WORKFLOW / TRACK AN EXISTING WORKFLOW modes. Operate
ONLY on this project via the PostHog MCP tools, and verify every
event/property/template name via MCP before using it - never hardcode ids.

TRACK AN EXISTING WORKFLOW - find it with \`workflows-list\`, then read it with
\`workflows-get\` (always \`workflows-get\` the target before publishing - this is
what links the canvas to it). Do NOT create, edit, or test a workflow. If more
than one workflow could match, list the candidates and ask the user which one
before continuing. Then SKIP straight to step 6 (publish the metrics canvas) and
step 7.

BUILD FLOW - follow in order:

1. PARSE INTENT + DISCOVER DESTINATIONS. Work out the trigger, audience, steps,
and outputs. List the live destination catalog with \`cdp-function-templates-list\`
and read required inputs with \`cdp-function-templates-retrieve\`. Never hardcode
template ids.

2. CREATE THE WORKFLOW AS A DRAFT with \`workflows-create\` (drafts never
execute). ALWAYS pass a clear, specific \`name\` that describes what the workflow
does (e.g. "Slack alert on failed checkout", "Welcome email sequence") - NEVER
leave it unnamed or generic. Shape the graph with \`workflows-patch-graph\` -
surgical edits, not full rewrites.

3. EMAIL TEMPLATES - BUILD THEM IN PARALLEL. Authoring an email template is
slow, so do NOT block the graph on it: first lay down the graph with PLACEHOLDER
email actions, then delegate EACH email template to its OWN sub-agent so they
build concurrently. Use the Task tool with subagent_type "general-purpose" (NOT
the read-only explorer) so the sub-agent can call the PostHog MCP; instruct each
sub-agent to author one template via \`workflows-create-email-template\` and
return ONLY the new template id. As each id comes back, wire it into its email
action with \`workflows-patch-graph\`. BRANDING: use clean, neutral defaults
(simple layout, no invented logos or brand colors) unless the user's request
specifies branding - do NOT ask the user about branding mid-build; note in your
summary that the template's branding can be edited later. Because a sub-agent's
own work is not streamed to the chat, post a short visible line first (e.g.
"Building N email templates in parallel…") so the build doesn't look stalled.

4. TEST EVERY BRANCH with \`workflows-test-run\` (it runs one step at a time -
walk the graph via \`nextActionId\`, and set \`current_action_id\` to exercise each
branch). Read \`workflows-logs\`. Re-test after ANY edit.

5. BATCH / SCHEDULED ONLY - before any dispatch, call \`workflows-blast-radius\`
and surface the matched count to the user for explicit confirmation.

6. PUBLISH THE METRICS CANVAS. When the workflow is built + tested, PUBLISH the
canvas by calling \`desktop-file-system-canvas-partial-update\` exactly once with:
- id: "${dashboardId}"
- code: the COMPLETE single-file React source for the metrics canvas.
START FROM the STARTER DASHBOARD below that matches this workflow's category, and
EDIT it - do NOT author a dashboard from scratch, and IGNORE the generic
[Starter scaffold] above (these starters replace it):
  - alert / notification / sync / data-hygiene (Slack/Discord/webhook/CRM/enrichment) → the HEALTH starter.
  - marketing / lifecycle email (welcome/onboarding/re-engagement/drip) → the ENGAGEMENT starter.
Replace each placeholder metric (the "all events" query + the TODO(agent) spots)
with a SAVED insight you created for THIS workflow's real deliveries / email
outcomes, loaded via \`ph.loadInsight(shortId, { dateRange })\`. KEEP the wiring
(date picker, skeletons, the not-yet-fired empty state). For a BATCH / SCHEDULED
workflow, also add an "audience reach per run" card/row. Only depart from the
starter if the workflow genuinely needs something it doesn't cover.

Extra rules for the metrics canvas, on top of the authoring contract above:
${WORKFLOW_CANVAS_RULES_TEXT}

[Starter dashboard — HEALTH (deliverability)]

\`\`\`tsx
${WORKFLOW_HEALTH_STARTER}
\`\`\`

[Starter dashboard — ENGAGEMENT (email)]

\`\`\`tsx
${WORKFLOW_ENGAGEMENT_STARTER}
\`\`\`

7. SUMMARISE for the human - the trigger, inputs/audience, steps/outputs, and
the branch-test results - then STOP.

HARD RULES:
- NEVER take the workflow live yourself. Do NOT call \`workflows-enable\`,
\`workflows-run-batch\`, \`workflows-schedule-create\`, or
\`workflows-update-schedule\`. Going live is the human's explicit "approve &
publish" step (those tools raise an approval card). Your job ends at a tested
draft + published canvas.
- The workflow LINK (which workflow this canvas tracks) is recorded
AUTOMATICALLY once you create (or \`workflows-get\`) the workflow and publish the
canvas. Do NOT try to write it onto the canvas/dashboard yourself - there is no
MCP tool for that and attempting it will loop.
</workflow_instructions>`;
}
