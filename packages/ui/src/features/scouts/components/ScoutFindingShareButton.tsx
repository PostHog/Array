import { LinkIcon } from "@phosphor-icons/react";
import type { ScoutEmission } from "@posthog/api-client/posthog-client";
import { scoutSkillSlug } from "@posthog/core/scouts/scoutPresentation";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { track } from "@posthog/ui/shell/analytics";
import { toast } from "sonner";

/**
 * Per-finding "Share" CTA on a scout emission card: copies a link that drops
 * a coworker onto this scout's detail page with the finding expanded and
 * scrolled into view. Best effort – the link only resolves while the finding
 * is still inside the scout's runs window.
 */
export function ScoutFindingShareButton({
  emission,
  skillName,
}: {
  emission: ScoutEmission;
  skillName: string;
}) {
  const handleCopyLink = () => {
    const url = `${window.location.origin}/code/agents/scouts/${scoutSkillSlug(
      skillName,
    )}?finding=${encodeURIComponent(emission.id)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toast.success("Finding link copied");
        track(ANALYTICS_EVENTS.SCOUT_ACTION, {
          action_type: "copy_finding_link",
          surface: "scout_detail",
          skill_name: skillName,
          severity: emission.severity,
        });
      })
      .catch(() => toast.error("Couldn't copy link"));
  };

  return (
    <button
      type="button"
      onClick={handleCopyLink}
      title="Copy a link to this finding"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent-11 no-underline transition-colors hover:text-accent-12"
    >
      <LinkIcon size={11} />
      Share
    </button>
  );
}
