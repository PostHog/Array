/** Default prefix applied to branches PostHog Code creates. */
export const BRANCH_PREFIX = "posthog-code/";

/**
 * Normalize a user-provided branch prefix into a safe value, falling back to
 * {@link BRANCH_PREFIX} when empty. Strips leading slashes and collapses
 * repeated slashes (git refs cannot start with `/` or contain `//`). The
 * prefix is used verbatim in front of the generated slug, so a trailing `/`
 * (e.g. `team/`) or a trailing dash (e.g. `team-`) is preserved as typed.
 */
export function normalizeBranchPrefix(input?: string | null): string {
  const trimmed = (input ?? "").trim();
  if (trimmed === "") return BRANCH_PREFIX;
  const cleaned = trimmed.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  return cleaned === "" ? BRANCH_PREFIX : cleaned;
}
