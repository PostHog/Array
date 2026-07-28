export const TASK_ACTIVITY_QUERY_KEY = ["task-activity"] as const;

export const taskActivityQueryKey = (unreadOnly: boolean) =>
  unreadOnly
    ? ([...TASK_ACTIVITY_QUERY_KEY, { unreadOnly: true }] as const)
    : TASK_ACTIVITY_QUERY_KEY;
