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
3. When you have enough, call the PostHog MCP \`loops-review\` tool with the full assembled configuration (the same fields \`loops-create\` takes: name, instructions, runtime_adapter, triggers, behaviors, notifications, and so on). This renders an interactive review card that shows me the loop and gives me a Create button. Make it a personal loop unless I ask otherwise.
4. Do NOT call \`loops-create\` yourself — the review card's Create button creates the loop once I confirm. After you call \`loops-review\`, just tell me to review the card and create it (or tell you what to change).

Use the PostHog MCP loop tools: \`loops-list\` first so you don't duplicate an existing loop, then \`loops-review\` to present the loop for confirmation. Never call \`loops-create\` directly — the review card handles creation.`;
}
