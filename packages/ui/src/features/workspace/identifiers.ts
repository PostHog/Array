/**
 * Shared TanStack Query key for the workspace map. The UI read hooks own this
 * query; every host invalidator (create/delete/focus/etc.) must invalidate this
 * exact key so the workspace UI stays in sync.
 */
export const WORKSPACE_QUERY_KEY = ["workspace", "getAll"] as const;
