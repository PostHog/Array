import { freeformSystemPromptFor } from "./canvasTemplates";
import { FREEFORM_STARTER_CODE } from "./freeformStarter";

export function buildFreeformGenerationPrompt(input: {
  dashboardId: string;
  name: string;
  channelName: string;
  templateId?: string;
  instruction: string;
  currentCode?: string;
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
  const header = isEdit
    ? `Edit the freeform React canvas "${name}" in the channel "${channelName}", per the user's request at the start of this message.`
    : `Build a freeform React canvas "${name}" for the channel "${channelName}", per the user's request at the start of this message.`;
  const currentBlock = isEdit
    ? `\n[Current code] — the canvas as it stands now. Rewrite the WHOLE file with the change applied; do not output a partial file.\n\n\`\`\`tsx\n${currentCode}\n\`\`\`\n`
    : "";
  const starterBlock =
    !isEdit && useStarter
      ? `\n[Starter scaffold] — begin from this WORKING baseline instead of authoring from scratch. It already wires the things that are easy to get wrong: the date picker, theme-aware tokens, per-card loading skeletons, and reading a typed-node result correctly. KEEP that wiring; replace the sample "total events" metric and the layout with what the user asked for, and output the COMPLETE rewritten file.\n\n\`\`\`tsx\n${FREEFORM_STARTER_CODE}\n\`\`\`\n`
      : "";

  const instructions = `${header}
${currentBlock}${starterBlock}
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
only when no insight can express the metric.`;

  return `${instruction}

<canvas_generation_instructions>
${instructions}
</canvas_generation_instructions>`;
}
