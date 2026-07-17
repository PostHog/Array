// One-shot handoff of a starter instruction into a just-created canvas's hero
// composer. A surface that creates a canvas on behalf of a suggestion (e.g. the
// new-task screen's "Set up a workflow" card) stashes the prompt here BEFORE
// navigating; the hero takes (and clears) it on mount. Ephemeral by design —
// nothing is persisted, and an entry survives at most one navigation.
const pending = new Map<string, string>();

export function setPendingCanvasPrefill(
  dashboardId: string,
  instruction: string,
): void {
  pending.set(dashboardId, instruction);
}

// Returns the stashed instruction for this canvas and removes it, so a
// remount (or another canvas) can never replay it.
export function takePendingCanvasPrefill(dashboardId: string): string | null {
  const instruction = pending.get(dashboardId) ?? null;
  pending.delete(dashboardId);
  return instruction;
}
