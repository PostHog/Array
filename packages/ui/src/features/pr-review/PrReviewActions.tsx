import {
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  GitMergeIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { PrMergeMethod } from "@posthog/core/git/router-schemas";
import {
  Button,
  ButtonGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@posthog/quill";
import { useState } from "react";
import { useApprovePr } from "./useApprovePr";
import { useMergePr } from "./useMergePr";
import { usePrInfo } from "./usePrInfo";

const MERGE_METHODS: PrMergeMethod[] = ["merge", "squash", "rebase"];

const MERGE_METHOD_LABELS: Record<PrMergeMethod, string> = {
  merge: "Merge pull request",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

interface PrReviewActionsProps {
  prUrl: string;
}

/** Approve + merge controls for a GitHub PR, mirroring the github.com merge box. */
export function PrReviewActions({ prUrl }: PrReviewActionsProps) {
  const infoQuery = usePrInfo(prUrl);
  const approve = useApprovePr(prUrl);
  const merge = useMergePr(prUrl);
  const [method, setMethod] = useState<PrMergeMethod>("merge");

  const info = infoQuery.data;
  const merged = info?.merged ?? false;
  const closed = !merged && info?.state?.toLowerCase() === "closed";
  const draft = info?.draft ?? false;

  if (merged || closed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-(--gray-5) bg-(--gray-2) px-3 py-2 text-[12px] text-gray-11">
        {merged ? (
          <>
            <GitMergeIcon size={14} className="text-(--purple-9)" />
            This pull request has been merged.
          </>
        ) : (
          <>
            <XCircleIcon size={14} className="text-(--red-9)" />
            This pull request is closed.
          </>
        )}
      </div>
    );
  }

  const approved = approve.isSuccess && approve.data.success;
  const approveDisabled = !info || approve.isPending || approved;
  const mergeDisabled = !info || draft || merge.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={approveDisabled}
        onClick={() => approve.mutate({ prUrl })}
        className="gap-1.5"
      >
        {approve.isPending ? (
          <Spinner />
        ) : approved ? (
          <CheckCircleIcon size={13} className="text-(--green-9)" />
        ) : (
          <CheckIcon size={13} />
        )}
        {approved ? "Approved" : "Approve"}
      </Button>
      <ButtonGroup>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={mergeDisabled}
          onClick={() => merge.mutate({ prUrl, method })}
          className="gap-1.5"
        >
          {merge.isPending ? <Spinner /> : <GitMergeIcon size={13} />}
          {MERGE_METHOD_LABELS[method]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="primary"
                size="sm"
                aria-label="Choose merge method"
                disabled={mergeDisabled}
              >
                <CaretDownIcon size={12} />
              </Button>
            }
          />
          <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
            {MERGE_METHODS.map((m) => (
              <DropdownMenuItem key={m} onClick={() => setMethod(m)}>
                {MERGE_METHOD_LABELS[m]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {draft && (
        <span className="text-[11px] text-gray-10">
          Draft pull requests can't be merged.
        </span>
      )}
    </div>
  );
}
