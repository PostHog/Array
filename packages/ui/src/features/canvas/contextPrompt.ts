// Builds the prompt for the task that generates a channel's CONTEXT.md. The
// task runs as a normal agent task in the channel's repo, so the agent has full
// tools; this is the task's content (its first user message). CONTEXT.md is not
// a file on disk — it lives in PostHog — so the agent must publish the result
// via the PostHog MCP rather than writing a file.
export function buildContextGenerationPrompt(input: {
  channelName: string;
  channelId: string;
}): string {
  const { channelName, channelId } = input;
  return `Generate a CONTEXT.md for the channel/folder "${channelName}".

CONTEXT.md tells future agents the specific, non-obvious details they need to
work in "${channelName}": what it is, key files, conventions, gotchas, and the
PostHog resources that relate to it.

Investigate two sources:
1. This repository — use Read, Grep, and Glob to find code, directories, and
   config related to "${channelName}" (conventions, key files, gotchas).
2. PostHog — use the PostHog MCP to find data related to "${channelName}" in
   this project: feature flags, experiments, surveys, notebooks, insights, web
   analytics, and persons. Operate only on this project.

When you have gathered enough, PUBLISH the document by calling the PostHog MCP
tool \`desktop-file-system-instructions-partial-update\` exactly once with:
- id: "${channelId}"
- content: the full CONTEXT.md markdown
- base_version: the current instructions version, or 0 if none exists yet

Structure the markdown with these sections:
1. Overview — what "${channelName}" is and why it exists.
2. Key files — the most important paths, each with a one-line purpose.
3. Conventions & gotchas — non-obvious rules, patterns, and pitfalls.
4. Related PostHog resources — relevant flags/experiments/surveys/notebooks/
   insights with links.

Write the document in terse, high-signal language: drop articles and filler,
prefer fragments and short phrases over full sentences, cut anything that does
not carry technical substance. Keep it concise. CONTEXT.md lives in PostHog, not
on disk, so publishing via the MCP tool is what saves it — do not just write a
local file.`;
}
