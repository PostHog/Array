import {
  type CloudRegion,
  getCloudUrlFromRegion,
  REGION_LABELS,
} from "@posthog/shared";
import { useAuthStore } from "@posthog/ui/features/auth/store";
import { getPostHogUrl } from "@posthog/ui/utils/urls";

export interface LinkOverrides {
  projectId?: number | null;
  cloudRegion?: CloudRegion | null;
}

export interface ErrorTrackingIssueLinkOverrides extends LinkOverrides {
  fingerprint?: string | null;
}

function resolveProjectId(override?: number | null): number | null {
  if (override != null) return override;
  return useAuthStore.getState().authState.currentProjectId ?? null;
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

export function skillUrl(
  skillName: string,
  overrides?: LinkOverrides,
): string | null {
  return withProjectId(
    (pid) => `/project/${pid}/skills/${encodeURIComponent(skillName)}`,
    overrides,
  );
}

/**
 * The shareable https link for a canvas (a dashboard inside a channel):
 * `<instance>/code/canvas/<channelId>/<dashboardId>`. Opening it in a browser
 * hits a web interstitial that deep-links into the desktop app (or offers the
 * download), so the link works for anyone — app installed or not. Not
 * project-scoped: the ids are globally-unique desktop file-system row ids. The
 * inbound desktop side lives in `CanvasLinkService` / `useCanvasDeepLink`.
 */
export function canvasShareUrl(
  channelId: string,
  dashboardId: string,
  regionOverride?: CloudRegion | null,
): string | null {
  return getPostHogUrl(
    `/code/canvas/${encodeURIComponent(channelId)}/${encodeURIComponent(dashboardId)}`,
    regionOverride,
  );
}

/**
 * The shareable https link for a channel — or a thread (channel-filed task)
 * inside it: `<instance>/code/channel/<channelId>[/tasks/<taskId>]`. Opening
 * it in a browser hits a web interstitial that deep-links into the desktop app
 * (or offers the download), so the link works for anyone — app installed or
 * not. Not project-scoped: the ids are globally-unique row ids. The inbound
 * desktop side lives in `ChannelLinkService` / `useChannelDeepLink`.
 */
export function channelShareUrl(
  channelId: string,
  taskId?: string,
): string | null {
  const base = `/code/channel/${encodeURIComponent(channelId)}`;
  return getPostHogUrl(
    taskId ? `${base}/tasks/${encodeURIComponent(taskId)}` : base,
  );
}

export type ShareLinkTarget =
  | { kind: "canvas"; channelId: string; dashboardId: string }
  | { kind: "channel"; channelId: string; taskId?: string };

const POSTHOG_HOSTS = new Set(
  (Object.keys(REGION_LABELS) as CloudRegion[])
    .map((region) => {
      try {
        return new URL(getCloudUrlFromRegion(region)).host;
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

export function parseShareLink(href: string): ShareLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!POSTHOG_HOSTS.has(url.host)) return null;

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (segments[0] !== "code") return null;

  if (segments[1] === "canvas" && segments.length === 4) {
    return { kind: "canvas", channelId: segments[2], dashboardId: segments[3] };
  }

  if (segments[1] === "channel") {
    if (segments.length === 3) {
      return { kind: "channel", channelId: segments[2] };
    }
    if (segments.length === 5 && segments[3] === "tasks") {
      return { kind: "channel", channelId: segments[2], taskId: segments[4] };
    }
  }

  return null;
}

export function errorTrackingIssueUrl(
  issueId: string,
  overrides?: ErrorTrackingIssueLinkOverrides,
): string | null {
  return withProjectId((pid) => {
    const path = `/project/${pid}/error_tracking/${encodeURIComponent(issueId)}`;
    return overrides?.fingerprint
      ? `${path}?fingerprint=${encodeURIComponent(overrides.fingerprint)}`
      : path;
  }, overrides);
}
