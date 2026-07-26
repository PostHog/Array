export function buildFreeformGenerationPrompt(input: {
  dashboardId: string;
  name: string;
  channelName: string;
  templateId?: string;
  instruction: string;
  currentCode?: string;
  useStarter?: boolean;
}): string {
  const legacySource = input.currentCode?.trim()
    ? `
This canvas predates application source history. Use the following legacy React
source only as migration input if \`canvas-source-get\` reports no current source:

\`\`\`tsx
${input.currentCode}
\`\`\`
`
    : "";

  return `${input.instruction}

<canvas_generation_instructions>
Use $building-canvases. Build or edit the browser application named
"${input.name}" in the "${input.channelName}" channel. The target canvas ID is "${input.dashboardId}".

Do not ask the user to choose React, Quill, HTML, Canvas, WebGL, or Three.js.
Choose the simplest suitable mixture based on the requested experience. Read the
current project with \`canvas-source-get\` before editing. Validate the complete
project with \`canvas-source-validate\`, then publish it exactly once with
\`canvas-source-publish\`, using the source version you read as
\`expectedCurrentVersionId\`. The cloud build is authoritative; inspect it with
\`canvas-build-get\` and repair failures in a fresh task run.

Use the injected \`ph\` browser SDK for PostHog data and capabilities. Discover
real event and property names before using them, never embed credentials, and do
not publish executable build artifacts directly.${legacySource}
</canvas_generation_instructions>`;
}
