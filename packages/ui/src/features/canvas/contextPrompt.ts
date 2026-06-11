// Builds the system prompt for the CONTEXT.md generation agent. The agent runs
// rooted at the channel's local repo (its cwd) with the PostHog MCP enabled,
// and publishes the finished document itself via the MCP. AgentService also
// appends a "use project N on <host>" guard, so the prompt refers to "this
// PostHog project" rather than restating ids.
export function buildContextSystemPrompt(input: {
  channelName: string;
  channelId: string;
  baseVersion: number;
}): string {
  const { channelName, channelId, baseVersion } = input;
  return `You are generating a CONTEXT.md for the channel/folder "${channelName}".

CONTEXT.md tells future agents the specific, non-obvious details they need to
work in "${channelName}": what it is, key files, conventions, gotchas, and the
PostHog resources that relate to it.

Your working directory is the channel's local repository. Investigate it:
- Use Read, Grep, and Glob to find code, directories, and config related to
  "${channelName}". Do NOT modify any files — exploration is read-only.

Then use the PostHog MCP to find data related to "${channelName}" in this
PostHog project — feature flags, experiments, surveys, notebooks, insights,
web analytics, and persons. Operate only on this project.

When you have gathered enough, PUBLISH the document by calling the PostHog MCP
tool \`desktop-file-system-instructions-partial-update\` exactly once with:
- id: "${channelId}"
- content: the full CONTEXT.md markdown
- base_version: ${baseVersion}

Structure the markdown with these sections:
1. Overview — what "${channelName}" is and why it exists.
2. Key files — the most important paths, each with a one-line purpose.
3. Conventions & gotchas — non-obvious rules, patterns, and pitfalls.
4. Related PostHog resources — relevant flags/experiments/surveys/notebooks/
   insights with links.

Keep it concise and high-signal. Stream the document as you write it so the
user sees a live preview. Emit nothing else after publishing.`;
}
