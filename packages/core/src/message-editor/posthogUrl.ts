// Single source of truth for PostHog resource chip types. The union type is
// derived from this array so the two can never drift, and consumers can do a
// positive runtime membership check (e.g. isPostHogRef) instead of defining
// PostHog chips by exclusion.
export const POSTHOG_RESOURCE_TYPES = [
  "feature_flag",
  "experiment",
  "insight",
  "dashboard",
  "error_tracking",
  "recording",
  "survey",
  "notebook",
  "cohort",
  "action",
  "early_access_feature",
  "person",
  "group",
] as const;

export type PostHogResourceType = (typeof POSTHOG_RESOURCE_TYPES)[number];

const POSTHOG_RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(
  POSTHOG_RESOURCE_TYPES,
);

/** True when `type` is one of the PostHog resource chip types. */
export function isPostHogResourceType(
  type: string,
): type is PostHogResourceType {
  return POSTHOG_RESOURCE_TYPE_SET.has(type);
}

export interface ParsedPostHogUrl {
  resourceType: PostHogResourceType;
  projectId: string;
  resourceId: string;
  normalizedUrl: string;
  label: string;
}

const POSTHOG_HOSTS = new Set([
  "us.posthog.com",
  "eu.posthog.com",
  "localhost:8010",
]);

const RESOURCE_PATTERNS: Array<{
  pathSegments: string[];
  type: PostHogResourceType;
  labelPrefix: string;
  idSegmentCount?: number;
}> = [
  {
    pathSegments: ["feature_flags"],
    type: "feature_flag",
    labelPrefix: "Feature Flag",
  },
  {
    pathSegments: ["experiments"],
    type: "experiment",
    labelPrefix: "Experiment",
  },
  { pathSegments: ["insights"], type: "insight", labelPrefix: "Insight" },
  { pathSegments: ["dashboard"], type: "dashboard", labelPrefix: "Dashboard" },
  {
    pathSegments: ["error_tracking"],
    type: "error_tracking",
    labelPrefix: "Error",
  },
  { pathSegments: ["replay"], type: "recording", labelPrefix: "Recording" },
  { pathSegments: ["surveys"], type: "survey", labelPrefix: "Survey" },
  { pathSegments: ["notebooks"], type: "notebook", labelPrefix: "Notebook" },
  { pathSegments: ["cohorts"], type: "cohort", labelPrefix: "Cohort" },
  {
    pathSegments: ["data-management", "actions"],
    type: "action",
    labelPrefix: "Action",
  },
  {
    pathSegments: ["early_access_features"],
    type: "early_access_feature",
    labelPrefix: "Early Access Feature",
  },
  { pathSegments: ["persons"], type: "person", labelPrefix: "Person" },
  {
    pathSegments: ["groups"],
    type: "group",
    labelPrefix: "Group",
    idSegmentCount: 2,
  },
];

export function parsePostHogUrl(text: string): ParsedPostHogUrl | null {
  const trimmed = text.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!POSTHOG_HOSTS.has(url.host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);

  let projectId = "";
  let resourceSegments: string[];

  // Long format: /project/{projectId}/{resourcePath}/{resourceId}
  if (segments.length >= 2 && segments[0] === "project") {
    projectId = segments[1];
    resourceSegments = segments.slice(2);
  } else {
    // Short format: /{resourcePath}/{resourceId}
    resourceSegments = segments;
  }

  if (resourceSegments.length < 2) return null;

  const match = RESOURCE_PATTERNS.find((p) => {
    const idCount = p.idSegmentCount ?? 1;
    const expectedLength = p.pathSegments.length + idCount;
    if (resourceSegments.length !== expectedLength) return false;
    return p.pathSegments.every((seg, i) => seg === resourceSegments[i]);
  });

  if (!match) return null;

  const idSegments = resourceSegments.slice(match.pathSegments.length);
  const resourceId = idSegments.join("/");

  if (!resourceId) return null;

  const projectPrefix = projectId ? `/project/${projectId}` : "";
  const resourcePath = match.pathSegments.join("/");
  const normalizedUrl = `${url.protocol}//${url.host}${projectPrefix}/${resourcePath}/${resourceId}`;

  const displayId = /^\d+$/.test(resourceId) ? `#${resourceId}` : resourceId;
  const label = `${match.labelPrefix} ${displayId}`;

  return {
    resourceType: match.type,
    projectId,
    resourceId,
    normalizedUrl,
    label,
  };
}
