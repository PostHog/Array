import { usePrDetails } from "@features/git-interaction/hooks/usePrDetails";
import { GitMerge, GitPullRequestIcon } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import { Tooltip } from "@radix-ui/themes";

export type ImplementationPrLinkSize = "sm" | "md";

interface ReportImplementationPrLinkProps {
  prUrl: string;
  /** `sm`: inbox list row. `md`: report detail header or implementation task bar. */
  size?: ImplementationPrLinkSize;
  /** Optional analytics callback fired when the PR link is clicked. */
  onLinkClick?: () => void;
}

function parseGitHubPrReference(prUrl: string): {
  reference: string;
  prNumber: string;
} {
  try {
    const parsed = new URL(prUrl);
    const match = parsed.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:$|[/?#])/,
    );
    if (match) {
      return {
        reference: `${match[1]}/${match[2]}#${match[3]}`,
        prNumber: `#${match[3]}`,
      };
    }
  } catch {
    // Fall through to regex fallback for non-URL-safe inputs
  }

  const prMatch = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/);
  const prNumber = prMatch ? `#${prMatch[1]}` : "PR";
  return {
    reference: prUrl,
    prNumber,
  };
}

export function ReportImplementationPrLink({
  prUrl,
  size = "sm",
  onLinkClick,
}: ReportImplementationPrLinkProps) {
  const {
    meta: { state, merged, isLoading },
  } = usePrDetails(prUrl);

  const isSm = size === "sm";

  const colorClass = isLoading
    ? "bg-gray-4 text-gray-11 hover:bg-gray-5"
    : merged
      ? "bg-violet-4 text-violet-11 hover:bg-violet-5"
      : state === "closed"
        ? "bg-red-4 text-red-11 hover:bg-red-5"
        : "bg-green-4 text-green-11 hover:bg-green-5";

  const { reference: prReference, prNumber } = parseGitHubPrReference(prUrl);

  const tooltip = merged
    ? `Merged — ${prReference}`
    : state === "closed"
      ? `Closed — ${prReference}`
      : prReference;

  const iconSize = isSm ? 10 : 12;

  return (
    <Tooltip content={tooltip}>
      <a
        href={prUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          onLinkClick?.();
        }}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full font-medium",
          isSm
            ? "gap-0.5 px-1.5 py-0 text-[10px]"
            : "gap-1 px-2 py-0.5 text-[11px]",
          colorClass,
        )}
        style={isSm ? { height: "20px" } : undefined}
      >
        {merged ? (
          <GitMerge size={iconSize} weight="bold" />
        ) : (
          <GitPullRequestIcon size={iconSize} weight="bold" />
        )}
        {prNumber}
      </a>
    </Tooltip>
  );
}
