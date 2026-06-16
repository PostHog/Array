import { GitMergeIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import { usePrDetails } from "@posthog/ui/features/git-interaction/usePrDetails";
import { usePrDiffStatsFromBatch } from "@posthog/ui/features/inbox/context/PrDiffStatsBatchContext";
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
  // On list surfaces the surrounding `PrDiffStatsBatchContext` already carries
  // this PR's status from the single batched request, so read it from there and
  // skip the per-PR query. Fall back to `usePrDetails` only on the standalone
  // detail view, where no batch provider is mounted.
  const batchEntry = usePrDiffStatsFromBatch(prUrl);
  const fallback = usePrDetails(batchEntry.hasBatch ? null : prUrl);

  const state = batchEntry.hasBatch
    ? (batchEntry.stats?.state ?? null)
    : fallback.meta.state;
  const merged = batchEntry.hasBatch
    ? (batchEntry.stats?.merged ?? false)
    : fallback.meta.merged;
  const draft = batchEntry.hasBatch
    ? (batchEntry.stats?.draft ?? false)
    : fallback.meta.draft;
  const isLoading = batchEntry.hasBatch
    ? batchEntry.isLoading && !batchEntry.stats
    : fallback.meta.isLoading;

  // If neither source could resolve a status (PR 404s, gh failed, or the batch
  // had no entry for this PR), don't render a misleading "open" badge.
  if (!isLoading && state === null) return null;

  const isSm = size === "sm";

  // A draft PR is still `state === "open"` on GitHub, so check `draft` before
  // falling through to the open (green) styling.
  const colorClass = isLoading
    ? "bg-gray-4 text-gray-11 hover:bg-gray-5"
    : merged
      ? "bg-violet-4 text-violet-11 hover:bg-violet-5"
      : state === "closed"
        ? "bg-red-4 text-red-11 hover:bg-red-5"
        : draft
          ? "bg-gray-4 text-gray-11 hover:bg-gray-5"
          : "bg-green-4 text-green-11 hover:bg-green-5";

  const { reference: prReference, prNumber } = parseGitHubPrReference(prUrl);

  const tooltip = merged
    ? `Merged – ${prReference}`
    : state === "closed"
      ? `Closed – ${prReference}`
      : draft
        ? `Draft – ${prReference}`
        : `Open – ${prReference}`;

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
            ? "h-5 gap-0.5 px-1.5 py-0 text-[10px]"
            : "gap-1 px-2 py-0.5 text-[11px]",
          colorClass,
        )}
      >
        {merged ? (
          <GitMergeIcon size={iconSize} weight="bold" />
        ) : (
          <GitPullRequestIcon size={iconSize} weight="bold" />
        )}
        {prNumber}
      </a>
    </Tooltip>
  );
}
