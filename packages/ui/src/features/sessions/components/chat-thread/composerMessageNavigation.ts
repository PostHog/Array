export type ComposerNavigationDirection = -1 | 1;

export type ComposerNavigationAction =
  | { kind: "focus"; id: string; fresh: boolean }
  | { kind: "exitToBottom" };

export type ComposerNavigationResult =
  | { kind: "recall"; text: string; fresh: boolean }
  | { kind: "exitToBottom" };

export type ComposerMessageNavigationHandler = (
  direction: ComposerNavigationDirection,
) => ComposerNavigationResult | null;

export function composerMessageNavigation(
  userMessageIds: string[],
  focusedId: string | null,
  direction: ComposerNavigationDirection,
): ComposerNavigationAction | null {
  if (userMessageIds.length === 0) return null;

  const currentIndex = focusedId ? userMessageIds.indexOf(focusedId) : -1;

  if (direction === -1) {
    const previousIndex =
      currentIndex === -1
        ? userMessageIds.length - 1
        : Math.max(0, currentIndex - 1);
    const id = userMessageIds[previousIndex];
    return id ? { kind: "focus", id, fresh: currentIndex === -1 } : null;
  }

  // Down only means "toward newer" while already navigating; otherwise the
  // caret is just resting at the end of the input and the key stays inert.
  if (currentIndex === -1) return null;
  if (currentIndex >= userMessageIds.length - 1) {
    return { kind: "exitToBottom" };
  }
  const id = userMessageIds[currentIndex + 1];
  return id ? { kind: "focus", id, fresh: false } : null;
}
