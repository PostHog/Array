import { getCachedAuthState } from "@features/auth/hooks/authQueries";
import type { CloudRegion } from "@shared/types/regions";
import { getPostHogUrl } from "@utils/urls";

export interface LinkOverrides {
  projectId?: number | null;
  cloudRegion?: CloudRegion | null;
}

function resolveProjectId(override?: number | null): number | null {
  if (override != null) return override;
  return getCachedAuthState().currentProjectId ?? null;
}

function withProjectId(
  path: (projectId: number) => string,
  overrides?: LinkOverrides,
): string | null {
  const projectId = resolveProjectId(overrides?.projectId);
  if (!projectId) return null;
  return getPostHogUrl(path(projectId), overrides?.cloudRegion);
}

export function flagUrl(
  flagId: number,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) => `/project/${pid}/feature_flags/${flagId}`,
    overrides,
  );
}

export function flagUrlByKey(
  flagKey: string,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) =>
      `/project/${pid}/feature_flags?search=${encodeURIComponent(flagKey)}`,
    overrides,
  );
}

export function eventDefinitionUrl(
  definitionId: string,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) => `/project/${pid}/data-management/events/${definitionId}`,
    overrides,
  );
}

export function experimentUrl(
  experimentId: number,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) => `/project/${pid}/experiments/${experimentId}`,
    overrides,
  );
}

export function featureFlagsIndexUrl(overrides?: LinkOverrides): string | null {
  return withProjectId((pid) => `/project/${pid}/feature_flags`, overrides);
}

export function errorTrackingIssueUrl(
  issueId: string,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) => `/project/${pid}/error_tracking/${encodeURIComponent(issueId)}`,
    overrides,
  );
}
