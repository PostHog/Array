import { GitPullRequest } from "@phosphor-icons/react";
import {
  getPrVisualConfig,
  type PrVisualConfig,
  parsePrNumber,
} from "@posthog/core/git-interaction/prStatus";
import { Button } from "@posthog/quill";
import { getPrVisualIcon } from "@posthog/ui/features/git-interaction/prIcon";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";

const COLOR_CLASSES: Record<PrVisualConfig["color"], string> = {
  gray: "border-(--gray-6) text-(--gray-11) hover:bg-(--gray-3)",
  green: "border-(--green-6) text-(--green-11) hover:bg-(--green-3)",
  red: "border-(--red-6) text-(--red-11) hover:bg-(--red-3)",
  purple: "border-(--purple-6) text-(--purple-11) hover:bg-(--purple-3)",
};

export function ChannelPrButton({
  prUrl,
  prState,
}: {
  prUrl: string;
  prState: SidebarPrState;
}) {
  const config = prState
    ? getPrVisualConfig(
        prState === "merged" ? "closed" : prState,
        prState === "merged",
        prState === "draft",
      )
    : null;
  const PrIcon = config ? getPrVisualIcon(config.icon) : GitPullRequest;
  const prNumber = parsePrNumber(prUrl);

  return (
    <Button
      variant="outline"
      size="xs"
      className={`w-fit ${config ? COLOR_CLASSES[config.color] : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        void openUrlInBrowser(prUrl);
      }}
    >
      <PrIcon size={11} weight="bold" />
      {config?.label ?? "View PR"}
      {prNumber ? ` #${prNumber}` : null}
    </Button>
  );
}
