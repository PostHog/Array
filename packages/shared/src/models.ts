/**
 * Model families that must be picked explicitly for every task: they are never
 * carried over from `lastUsedModel` as the implicit default for a new task or
 * one-click cloud run. Currently the premium Fable tier, which is priced well
 * above the standard models — a user who tried it once shouldn't keep paying
 * for it by default. Explicit selections (composer pick, action-pinned model,
 * deep-link model) are unaffected.
 */
export function isModelExcludedFromDefault(
  modelId: string | null | undefined,
): boolean {
  return !!modelId && modelId.toLowerCase().includes("fable");
}
