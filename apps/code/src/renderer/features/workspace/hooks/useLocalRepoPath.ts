import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { selectIsFocusedOnWorktree, useFocusStore } from "@stores/focusStore";

/**
 * Resolves the local repo path to run git commands against for a task.
 * When the user is focused on the worktree, commands target the main repo
 * (`folderPath`); otherwise they target the worktree itself.
 */
export function useLocalRepoPath(taskId: string): string | undefined {
  const workspace = useWorkspace(taskId);
  const isFocused = useFocusStore(
    selectIsFocusedOnWorktree(workspace?.worktreePath ?? ""),
  );
  return isFocused
    ? workspace?.folderPath
    : (workspace?.worktreePath ?? workspace?.folderPath);
}
