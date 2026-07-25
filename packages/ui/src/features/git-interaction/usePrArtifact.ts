import type { Icon } from "@phosphor-icons/react";
import {
  getPrVisualConfig,
  parsePrNumber,
} from "@posthog/core/git-interaction/prStatus";
import { getPrVisualIcon } from "@posthog/ui/features/git-interaction/prIcon";
import { usePrDetails } from "@posthog/ui/features/git-interaction/usePrDetails";
import { parseHttpsUrl } from "@posthog/ui/utils/posthogLinks";

/**
 * A PR link's live state, ready to render.
 *
 * PR rows exist on three surfaces with three different shells, but the data
 * behind them — validate the URL, fetch the state, pick an icon and a label — is
 * the same everywhere and used to be copied three times. The origin check is
 * part of that: PR URLs come from run output, so a row must not fetch from an
 * arbitrary host just because the backend put one there.
 */
export function usePrArtifact(url: string | null): {
  /** The URL, or null if it isn't an https github.com link. */
  safeUrl: string | null;
  prNumber: string | undefined;
  title: string;
  /** The lifecycle label ("Open", "Merged", …), or null until it resolves. */
  stateLabel: string | null;
  Icon: Icon;
  /** CSS variable for the icon's colour. */
  iconColor: string;
  /** Bare colour name, for surfaces that tint more than the icon. */
  accentColor: string;
} {
  const parsed = url ? parseHttpsUrl(url) : null;
  const safeUrl = parsed?.origin === "https://github.com" ? parsed.href : null;
  const {
    meta: { state, merged, draft },
  } = usePrDetails(safeUrl);

  const config = getPrVisualConfig(state ?? "open", merged, draft);
  const prNumber = safeUrl ? parsePrNumber(safeUrl) : undefined;

  return {
    safeUrl,
    prNumber,
    title: prNumber ? `Pull request #${prNumber}` : "Pull request",
    // Only once the state has resolved, to avoid a flash of "Open".
    stateLabel: state ? config.label : null,
    Icon: getPrVisualIcon(config.icon),
    iconColor: `var(--${config.color}-9)`,
    accentColor: config.color,
  };
}
