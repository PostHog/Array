/**
 * Returns the id unless it's a premium family (currently Fable) that must be
 * an explicit per-task pick and never the implicit default for a new task.
 */
export function defaultEligibleModel(
  modelId: string | null | undefined,
): string | undefined {
  if (!modelId) return undefined;
  const family = modelId.toLowerCase().split("/").pop() ?? "";
  return family.startsWith("claude-fable") ? undefined : modelId;
}
