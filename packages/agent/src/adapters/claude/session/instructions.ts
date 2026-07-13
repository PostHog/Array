const BRANCH_NAMING = `
# Branch Naming

When working in a detached HEAD state, create a descriptive branch name based on the work being done before committing. Do this automatically without asking the user.

When creating a new branch, prefix it with \`posthog-code/\` (e.g. \`posthog-code/fix-login-redirect\`).
`;

const PULL_REQUEST_LINKS = `
# Pull Request Links

When you mention a pull request in any reply or summary, always hyperlink it to its full URL (e.g. a Markdown link like [#123](https://github.com/org/repo/pull/123)) rather than plain text, so readers can open it directly.
`;

const PLAN_MODE = `
# Plan Mode

Only enter plan mode (EnterPlanMode) when the user is requesting a significant change in approach or direction mid-task. Do NOT enter plan mode for:
- Confirmations or approvals ("yes", "looks good", "continue", "go ahead")
- Minor clarifications or small adjustments
- Answers to questions you asked (unless you are still in the initial planning phase and have not yet started executing)
- Feedback that does not require replanning

When in doubt, continue executing and incorporate the feedback inline.
`;

const MCP_TOOLS = `
# MCP Tool Access

If an MCP tool call is explicitly denied with a message, relay that denial message to the user exactly as given. Do NOT suggest checking "Claude Code settings."

If an MCP tool call returns an error, treat it as a normal tool error — troubleshoot, retry, or inform the user about the specific error. Do NOT assume it is a permissions issue and do NOT direct the user to any settings page.
`;

const SHELL_EFFICIENCY = `
# Shell Efficiency

Optimize for the fewest shell round trips.

- Batch related commands into one Bash invocation using \`&&\` (e.g. \`npm run typecheck && npm run lint && npm test\`).
- Emit all independent tool calls in the same response.
- Read multiple files at once.
- Never rerun a command solely to reproduce output you already have.
`;

export const APPENDED_INSTRUCTIONS =
  BRANCH_NAMING + PULL_REQUEST_LINKS + PLAN_MODE + MCP_TOOLS + SHELL_EFFICIENCY;
