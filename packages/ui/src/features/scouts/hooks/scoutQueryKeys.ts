export const scoutQueryKeys = {
  configs: (projectId: number | null) =>
    ["scouts", "configs", projectId] as const,
  runs: (projectId: number | null) => ["scouts", "runs", projectId] as const,
  emissions: (projectId: number | null, runId: string) =>
    ["scouts", "emissions", projectId, runId] as const,
  emissionReports: (projectId: number | null, runId: string) =>
    ["scouts", "emissionReports", projectId, runId] as const,
};
