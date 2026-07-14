import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { MentionChip } from "./content";
import type { ParsedPostHogUrl, PostHogResourceType } from "./posthogUrl";

export function posthogResourceToMentionChip(
  parsed: ParsedPostHogUrl,
): MentionChip {
  return {
    type: parsed.resourceType,
    id: parsed.normalizedUrl,
    label: parsed.label,
  };
}

const LABEL_PREFIXES: Record<PostHogResourceType, string> = {
  feature_flag: "Feature Flag",
  experiment: "Experiment",
  insight: "Insight",
  dashboard: "Dashboard",
  error_tracking: "Error",
  recording: "Recording",
  survey: "Survey",
  notebook: "Notebook",
  cohort: "Cohort",
  action: "Action",
  early_access_feature: "Early Access Feature",
  person: "Person",
  group: "Group",
};

function formatDisplayId(resourceId: string, prefix: string): string {
  const displayId = /^\d+$/.test(resourceId) ? `#${resourceId}` : resourceId;
  return `${prefix} ${displayId}`;
}

/**
 * Suffix appended to a PostHog chip's label while its title is still being
 * fetched. Kept as a shared constant so serialization can strip it (see
 * stripPlaceholderLabelSuffix) and never persist "Loading..." into the XML.
 */
export const PLACEHOLDER_LABEL_SUFFIX = " - Loading...";

export function buildPostHogPlaceholderLabel(parsed: ParsedPostHogUrl): string {
  return `${formatDisplayId(parsed.resourceId, LABEL_PREFIXES[parsed.resourceType])}${PLACEHOLDER_LABEL_SUFFIX}`;
}

/**
 * Strip the transient "- Loading..." suffix from a chip label. Used at
 * serialization time so that a message submitted before resolvePostHogRefChip
 * finishes persists the clean base label (e.g. "Feature Flag #42") rather than
 * the placeholder — which would otherwise render "Loading..." forever when the
 * message is re-hydrated from history.
 */
export function stripPlaceholderLabelSuffix(label: string): string {
  return label.endsWith(PLACEHOLDER_LABEL_SUFFIX)
    ? label.slice(0, -PLACEHOLDER_LABEL_SUFFIX.length)
    : label;
}

export function buildResolvedLabel(
  parsed: ParsedPostHogUrl,
  title: string | null,
): string {
  const base = formatDisplayId(
    parsed.resourceId,
    LABEL_PREFIXES[parsed.resourceType],
  );
  return title ? `${base} - ${title}` : base;
}

async function resolveProjectId(client: PostHogAPIClient): Promise<string> {
  return String(await client.getDefaultProjectId());
}

export async function fetchPostHogResourceTitle(
  client: PostHogAPIClient,
  parsed: ParsedPostHogUrl,
): Promise<string | null> {
  try {
    const projectId = await resolveProjectId(client);
    switch (parsed.resourceType) {
      case "feature_flag": {
        const flag = await client.getFeatureFlag(projectId, parsed.resourceId);
        return flag?.name || flag?.key || null;
      }
      case "experiment": {
        const exp = await client.getExperiment(projectId, parsed.resourceId);
        return exp?.name || null;
      }
      case "insight": {
        const insight = await client.getInsight(projectId, parsed.resourceId);
        return insight?.name || null;
      }
      case "dashboard": {
        const dash = await client.getDashboard(projectId, parsed.resourceId);
        return dash?.name || null;
      }
      case "error_tracking": {
        const group = await client.getErrorTrackingGroup(
          projectId,
          parsed.resourceId,
        );
        return group?.title || null;
      }
      case "recording": {
        const rec = await client.getRecording(projectId, parsed.resourceId);
        return rec?.name || null;
      }
      case "survey": {
        const survey = await client.getSurvey(projectId, parsed.resourceId);
        return survey?.name || null;
      }
      case "notebook": {
        const nb = await client.getNotebook(projectId, parsed.resourceId);
        return nb?.title || null;
      }
      case "cohort": {
        const cohort = await client.getCohort(projectId, parsed.resourceId);
        return cohort?.name || null;
      }
      case "action": {
        const action = await client.getAction(projectId, parsed.resourceId);
        return action?.name || null;
      }
      case "early_access_feature": {
        const eaf = await client.getEarlyAccessFeature(
          projectId,
          parsed.resourceId,
        );
        return eaf?.name || null;
      }
      case "person": {
        const person = await client.getPerson(projectId, parsed.resourceId);
        return person?.name || null;
      }
      case "group": {
        const group = await client.getGroup(projectId, parsed.resourceId);
        return group?.name || null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
