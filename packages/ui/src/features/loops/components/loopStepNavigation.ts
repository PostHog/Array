export function canNavigateToLoopStep(
  current: number,
  target: number,
  complete: boolean[],
): boolean {
  return target <= current || complete.slice(current, target).every(Boolean);
}
