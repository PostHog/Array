import { resolveRtkPrefix, shQuote } from "./rtk";

/**
 * Instruction-level RTK integration for Codex sessions.
 *
 * The Claude adapter routes eligible commands through RTK deterministically
 * with a PreToolUse hook that rewrites the Bash input. Codex executes shell
 * commands internally over JSON-RPC and its app-server protocol has no
 * command-rewrite channel — the adapter can only approve or deny — so the
 * only integration point is the developer instructions: tell the model to
 * prefix eligible commands itself.
 *
 * The advertised rule mirrors the Claude hook: only recognized bare test
 * commands use RTK's dedicated failure-focused test mode.
 */
export function buildRtkGuidance(rtkPrefix: string): string {
  const prefix = shQuote(rtkPrefix);

  return `## rtk output compression

For recognized bare test commands, prefix the original command with \`${prefix} test\` so passing test noise is removed while failures remain. Supported commands are pnpm and npm tests, plus Python pytest and unittest forms.

Examples: \`${prefix} test pnpm test\`, \`${prefix} test python -m pytest\`.

Do not use RTK for machine-readable test output, other commands, or commands containing pipes, shell chains, or redirection.`;
}

/**
 * Appends the RTK guidance to Codex developer instructions when an RTK binary
 * is usable. Gated on `resolveRtkPrefix` — not `detectRtkBinary` — so the
 * per-run `POSTHOG_RTK=0` opt-out (the cloud kill-switch flag) disables the
 * guidance along with everything else.
 */
export function appendRtkGuidanceForCodex(
  instructions: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const rtkPrefix = resolveRtkPrefix(env);
  if (!rtkPrefix) return instructions;
  return [instructions, buildRtkGuidance(rtkPrefix)]
    .filter(Boolean)
    .join("\n\n");
}
