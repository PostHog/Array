export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters?: {
    repository?: string;
    createdBy?: number;
    originProduct?: string;
    internal?: boolean;
  }) => [...taskKeys.lists(), filters] as const,
  allSummaries: () => [...taskKeys.all, "summaries"] as const,
  summaries: (ids: string[]) =>
    [...taskKeys.allSummaries(), [...ids].sort()] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
};
