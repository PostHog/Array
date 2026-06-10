export const scoutQueryKeys = {
  configs: (projectId: number | null) =>
    ["scouts", "configs", projectId] as const,
  runs: (projectId: number | null) => ["scouts", "runs", projectId] as const,
  run: (projectId: number | null, runId: string) =>
    ["scouts", "run", projectId, runId] as const,
  emissions: (projectId: number | null, runId: string) =>
    ["scouts", "emissions", projectId, runId] as const,
  scratchpad: (projectId: number | null) =>
    ["scouts", "scratchpad", projectId] as const,
};
