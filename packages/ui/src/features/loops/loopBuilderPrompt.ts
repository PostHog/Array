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
How to build it:

1. Call \`loops-list\` first so you don't duplicate an existing loop.
2. Turn what I want into a clear set of loop instructions (the prompt the loop runs on every fire). Infer what you reasonably can rather than over-asking.
3. Only ask about a choice you genuinely cannot infer, one focused question at a time, using your question tool so I can pick from options (never a plain-text question). The essentials, with sensible defaults you should assume unless I say otherwise:
   - When it runs: a schedule (e.g. weekday mornings), on a GitHub event, or manual only.
   - Whether it works on a repository (for code changes and PRs) or is report-only.
   - Whether it may open pull requests, and how I want to hear about runs (in-app, email, or Slack).
   - A short name.
4. As soon as you have a working draft and the essentials, call the PostHog MCP \`loops-review\` tool with the full assembled configuration (the same fields \`loops-create\` takes: name, instructions, runtime_adapter, triggers, behaviors, notifications, and so on). Make it a personal loop unless I ask otherwise.

The \`loops-review\` card IS the review surface: it renders the whole loop for me to read and gives me a Create button. Do NOT review the loop as plain text. Never paste the drafted config into a message and ask "does this look right?", and never just narrate that it's ready and stop. The moment you have enough, call \`loops-review\`. If I ask for changes, call \`loops-review\` again with the updated config. Never call \`loops-create\` yourself: the card's Create button creates the loop once I confirm.`;
}
