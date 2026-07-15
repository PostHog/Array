/**
 * The canned first-message the loop-builder cloud task starts with — the agent's
 * "custom instructions" for a session whose whole job is to create a Loop with the
 * user and then create it via the PostHog MCP `loops-create` tool. Mirrors the scout
 * authoring prompt (`packages/core/src/scouts/scoutPrompts.ts`).
 */
export function buildLoopBuilderPrompt({
  instructions,
}: {
  instructions?: string;
}): string {
  const seed = instructions?.trim();

  return `Your job in this session is to help me create a Loop for this PostHog project, then create it for me.

A Loop is a named, cloud-executed agent automation: instructions the agent runs whenever a trigger fires (a schedule, a GitHub event, or an API call). Loops run unattended in a sandbox and can post results, open pull requests, and keep a context up to date.

${
  seed
    ? `Here's what I want automated:\n\n${seed}\n`
    : `Start by asking me what I want automated, and offer a couple of concrete ideas.\n`
}
Walk me through building it:

1. Turn what I want into a clear set of loop instructions — the prompt the loop runs on every fire. Draft it and refine it with me.
2. Ask me the essentials one focused question at a time (use your question tool so I can pick from options), keeping sensible defaults and inferring what you reasonably can rather than over-asking:
   - When it runs: a schedule (e.g. weekday mornings), on a GitHub event, or only when I trigger it manually.
   - Whether it works on a repository (for code changes and PRs) or is report-only.
   - Whether it may open pull requests, and how I want to hear about runs (in-app, email, or Slack).
   - A short name.
3. When you have enough, show me a clear summary of the loop — name, what it does, when it runs, where it works, notifications — and ask me to confirm before creating anything.
4. Only after I confirm, create it by calling the PostHog MCP \`loops-create\` tool with the assembled configuration. Make it a personal loop unless I ask otherwise. Then tell me it's created and where to find it.

Use the PostHog MCP loop tools: \`loops-list\` first to see what already exists so you don't duplicate one, and \`loops-create\` to create it. Do not create the loop until I've confirmed the summary.`;
}
