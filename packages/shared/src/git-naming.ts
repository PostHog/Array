/** Default prefix applied to branches PostHog Code creates. */
export const BRANCH_PREFIX = "posthog-code/";

/**
 * Normalize a user-provided branch prefix into a safe, slash-terminated value,
 * falling back to {@link BRANCH_PREFIX} when empty. Strips leading slashes and
 * collapses repeated slashes (git refs cannot start with `/` or contain `//`),
 * then guarantees exactly one trailing `/` so the prefix is always a
 * slash-terminated namespace (`team` → `team/`).
 */
export function normalizeBranchPrefix(input?: string | null): string {
  const trimmed = (input ?? "").trim();
  if (trimmed === "") return BRANCH_PREFIX;
  const cleaned = trimmed
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return cleaned === "" ? BRANCH_PREFIX : `${cleaned}/`;
}
