import { type CloudRegion, getCloudUrlFromRegion } from "@posthog/shared";
import {
  navigateToChannel,
  navigateToChannelDashboard,
  navigateToChannelTask,
} from "@posthog/ui/router/navigationBridge";

// The in-app destination a PostHog Code share link points at. The inverse of the
// `canvasShareUrl` / `channelShareUrl` builders in `posthogLinks.ts`.
export type ShareLinkTarget =
  | { kind: "canvas"; channelId: string; dashboardId: string }
  | { kind: "channel"; channelId: string; taskId?: string };

const REGIONS: CloudRegion[] = ["us", "eu", "dev"];

// Hosts we recognise as PostHog share-link origins. We match every region (not
// just the signed-in one) so a link works in-app regardless of which instance
// it was minted on — the inbound deep-link handlers already navigate by id
// against the current session, so bouncing through the browser buys nothing.
const POSTHOG_HOSTS = new Set(
  REGIONS.map((region) => {
    try {
      return new URL(getCloudUrlFromRegion(region)).host;
    } catch {
      return "";
    }
  }).filter(Boolean),
);

/**
 * Parse a PostHog Code share link into its in-app navigation target, or `null`
 * if it isn't one. Recognises `/code/canvas/<channelId>/<dashboardId>` and
 * `/code/channel/<channelId>[/tasks/<taskId>]` on a known PostHog host. The
 * host check keeps us from hijacking unrelated links that happen to share the
 * path shape.
 */
export function parseShareLink(href: string): ShareLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!POSTHOG_HOSTS.has(url.host)) return null;

  // Split the still-encoded pathname first, then decode each segment, so an id
  // containing an encoded slash (`%2F`) stays a single segment.
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

export function navigateToShareTarget(target: ShareLinkTarget): void {
  switch (target.kind) {
    case "canvas":
      navigateToChannelDashboard(target.channelId, target.dashboardId);
      break;
    case "channel":
      if (target.taskId) {
        navigateToChannelTask(target.channelId, target.taskId);
      } else {
        navigateToChannel(target.channelId);
      }
      break;
  }
}

/**
 * If `href` is a PostHog Code share link, navigate to it in-app and return true
 * (cancelling the click's default open-in-browser). Otherwise return false so
 * the caller lets the link open externally as usual.
 */
export function handleShareLinkClick(
  href: string | undefined,
  event: { preventDefault: () => void },
): boolean {
  if (!href) return false;
  const target = parseShareLink(href);
  if (!target) return false;
  event.preventDefault();
  navigateToShareTarget(target);
  return true;
}
