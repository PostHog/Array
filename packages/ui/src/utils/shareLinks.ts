import {
  navigateToChannel,
  navigateToChannelDashboard,
  navigateToChannelTask,
} from "@posthog/ui/router/navigationBridge";
import {
  parseShareLink,
  type ShareLinkTarget,
} from "@posthog/ui/utils/posthogLinks";

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
