import { openExternalUrl } from "../../../shell/openExternal";

export type PostHogEntityLink =
  | { kind: "featureFlag"; id: string }
  | { kind: "experiment"; id: string }
  | { kind: "survey"; id: string }
  | { kind: "earlyAccessFeature"; id: string }
  | { kind: "cohort"; id: string }
  | { kind: "person"; id: string }
  | { kind: "replay"; id: string; timestampSeconds?: number };

const ENTITY_PATHS: Record<PostHogEntityLink["kind"], string> = {
  featureFlag: "feature_flags",
  experiment: "experiments",
  survey: "surveys",
  earlyAccessFeature: "early_access_features",
  cohort: "cohorts",
  person: "person",
  replay: "replay",
};

/** Build a cloud web-app URL for an entity, e.g. `https://us.posthog.com/project/1/feature_flags/42`. */
export function buildPostHogEntityUrl(
  host: string,
  teamId: number,
  entity: PostHogEntityLink,
): string {
  const base = host.endsWith("/") ? host.slice(0, -1) : host;
  const url = `${base}/project/${teamId}/${ENTITY_PATHS[entity.kind]}/${encodeURIComponent(entity.id)}`;
  if (entity.kind === "replay" && entity.timestampSeconds != null) {
    return `${url}?t=${Math.max(0, Math.floor(entity.timestampSeconds))}`;
  }
  return url;
}

/** Open a cloud URL in the system browser (via the host's os.openExternal). */
export function openInPostHog(url: string): void {
  openExternalUrl(url);
}
