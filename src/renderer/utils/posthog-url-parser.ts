/**
 * PostHog URL parser for extracting resource types and IDs from URLs
 */

export type PostHogResourceType =
  | "error"
  | "experiment"
  | "insight"
  | "feature_flag"
  | "generic";

export interface PostHogUrlInfo {
  type: PostHogResourceType;
  id?: string;
  projectId?: string;
  url: string;
  label?: string;
}

/**
 * Parse PostHog URLs to extract resource type and metadata
 */
export function parsePostHogUrl(url: string): PostHogUrlInfo | null {
  try {
    const urlObj = new URL(url);

    // Check if it's a PostHog domain
    if (!isPostHogDomain(urlObj.hostname)) {
      return null;
    }

    const pathname = urlObj.pathname;

    // Error tracking URLs: /project/{id}/error_tracking/{error_id}
    const errorTrackingMatch = pathname.match(
      /^\/project\/(\d+)\/error_tracking\/([a-f0-9-]+)$/i,
    );
    if (errorTrackingMatch) {
      const [, projectId, errorId] = errorTrackingMatch;
      return {
        type: "error",
        id: errorId,
        projectId,
        url,
        label: `Error ${errorId.slice(0, 8)}...`,
      };
    }

    // Experiments URLs: /project/{id}/experiments/{experiment_id}
    const experimentMatch = pathname.match(
      /^\/project\/(\d+)\/experiments\/(\d+)$/,
    );
    if (experimentMatch) {
      const [, projectId, experimentId] = experimentMatch;
      return {
        type: "experiment",
        id: experimentId,
        projectId,
        url,
        label: `Experiment #${experimentId}`,
      };
    }

    // Insights URLs: /project/{id}/insights/{insight_id}
    const insightMatch = pathname.match(
      /^\/project\/(\d+)\/insights\/([a-zA-Z0-9-]+)$/,
    );
    if (insightMatch) {
      const [, projectId, insightId] = insightMatch;
      return {
        type: "insight",
        id: insightId,
        projectId,
        url,
        label: `Insight ${insightId}`,
      };
    }

    // Feature flags URLs: /project/{id}/feature_flags/{flag_id}
    const featureFlagMatch = pathname.match(
      /^\/project\/(\d+)\/feature_flags\/(\d+)$/,
    );
    if (featureFlagMatch) {
      const [, projectId, flagId] = featureFlagMatch;
      return {
        type: "feature_flag",
        id: flagId,
        projectId,
        url,
        label: `Feature Flag #${flagId}`,
      };
    }

    // Generic PostHog URL (couldn't match specific resource type)
    return {
      type: "generic",
      url,
      label: "PostHog Resource",
    };
  } catch (_error) {
    // Invalid URL format
    return null;
  }
}

/**
 * Check if a hostname belongs to PostHog
 */
function isPostHogDomain(hostname: string): boolean {
  const posthogDomains = [
    "posthog.com",
    "app.posthog.com",
    "us.posthog.com",
    "eu.posthog.com",
    "localhost",
  ];

  return posthogDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

/**
 * Check if a string looks like a URL
 */
export function isUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a URL is a PostHog URL
 */
export function isPostHogUrl(url: string): boolean {
  const info = parsePostHogUrl(url);
  return info !== null;
}

/**
 * Extract URLs from a text string
 */
export function extractUrlsFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"'`(){}[\]]+/g;
  const matches = text.match(urlRegex) || [];
  return matches.filter(isUrl);
}

/**
 * Extract URL from markdown link syntax: [text](url)
 * Returns the URL if found, otherwise returns the original string
 */
export function extractUrlFromMarkdown(text: string): string {
  const markdownLinkMatch = text.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (markdownLinkMatch) {
    return markdownLinkMatch[2]; // Return the URL part
  }
  return text; // Return original if not a markdown link
}
