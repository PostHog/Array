/**
 * Filter a model id down to one that may serve as an implicit default.
 *
 * Premium model families (currently Fable) are never carried over from
 * `lastUsedModel` as the default for a new task or one-click cloud run — a
 * user who tried one once shouldn't keep paying its price tier by inertia.
 * Explicit selections (composer pick, action-pinned model, deep-link model)
 * are unaffected.
 *
 * Returns the id unchanged when it may be used as a default, or undefined
 * when it must be an explicit per-task pick instead.
 */
export function defaultEligibleModel(
  modelId: string | null | undefined,
): string | undefined {
  if (!modelId) return undefined;
  // Anchored family check (not a bare substring) so an unrelated id that
  // merely contains the word can't be excluded; provider prefixes such as
  // "anthropic/" are ignored.
  const family = modelId.toLowerCase().split("/").pop() ?? "";
  return family.startsWith("claude-fable") ? undefined : modelId;
}
