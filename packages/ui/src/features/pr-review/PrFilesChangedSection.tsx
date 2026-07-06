import { CheckIcon, GitDiffIcon } from "@phosphor-icons/react";
import { Spinner } from "@posthog/quill";
import { PatchedFileDiff } from "@posthog/ui/features/code-review/components/PatchedFileDiff";
import { useDiffOptions } from "@posthog/ui/features/code-review/reviewShellParts";
import { usePrChangedFiles } from "@posthog/ui/features/git-interaction/useGitQueries";
import { DetailSection } from "@posthog/ui/features/inbox/components/DetailSection";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import { useMemo, useState } from "react";
import {
  fileViewedFingerprint,
  isFileViewed,
  usePrViewedFilesStore,
} from "./prViewedFilesStore";

interface PrFilesChangedSectionProps {
  prUrl: string;
}

/**
 * GitHub-style "Files changed" list for a PR: one collapsible diff per file
 * with a "Viewed" toggle. Viewed files default to collapsed; expanding or
 * collapsing by hand overrides that until the viewed state changes again.
 */
export function PrFilesChangedSection({ prUrl }: PrFilesChangedSectionProps) {
  const filesQuery = usePrChangedFiles(prUrl);
  const diffOptions = useDiffOptions();
  const viewedByPr = usePrViewedFilesStore((s) => s.viewedByPr);
  const markViewed = usePrViewedFilesStore((s) => s.markViewed);
  const unmarkViewed = usePrViewedFilesStore((s) => s.unmarkViewed);

  const [collapseOverrides, setCollapseOverrides] = useState<
    Map<string, boolean>
  >(new Map());

  const files = filesQuery.data;

  const viewedCount = useMemo(
    () =>
      (files ?? []).filter((file) => isFileViewed(viewedByPr, prUrl, file))
        .length,
    [files, viewedByPr, prUrl],
  );

  if (filesQuery.isLoading) {
    return (
      <DetailSection Icon={GitDiffIcon} title="Files changed">
        <div className="flex items-center gap-2 py-3 text-[12px] text-gray-10">
          <Spinner />
          Loading changed files…
        </div>
      </DetailSection>
    );
  }

  if (filesQuery.isError || !files) {
    return (
      <DetailSection Icon={GitDiffIcon} title="Files changed">
        <div className="py-3 text-[12px] text-gray-10">
          Couldn't load the changed files for this pull request.
        </div>
      </DetailSection>
    );
  }

  if (files.length === 0) {
    return (
      <DetailSection Icon={GitDiffIcon} title="Files changed">
        <div className="py-3 text-[12px] text-gray-10">No changed files.</div>
      </DetailSection>
    );
  }

  return (
    <DetailSection
      Icon={GitDiffIcon}
      title={`Files changed (${files.length})`}
      rightSlot={
        <span className="cursor-default select-none text-[11px] text-gray-10 tabular-nums">
          {viewedCount} / {files.length} viewed
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {files.map((file) => {
          const viewed = isFileViewed(viewedByPr, prUrl, file);
          const collapsed = collapseOverrides.get(file.path) ?? viewed;
          return (
            <div
              key={file.path}
              className="overflow-hidden rounded-md border border-(--gray-5)"
            >
              <PatchedFileDiff
                file={file}
                taskId={prUrl}
                options={diffOptions}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapseOverrides((prev) =>
                    new Map(prev).set(file.path, !collapsed),
                  )
                }
                externalUrl={`${prUrl}/files`}
                prUrl={prUrl}
                headerTrailing={
                  <ViewedToggle
                    viewed={viewed}
                    onChange={(next) => {
                      // Drop the manual override so the new viewed state
                      // decides the collapse (checked → fold, unchecked →
                      // unfold), matching GitHub.
                      setCollapseOverrides((prev) => {
                        if (!prev.has(file.path)) return prev;
                        const map = new Map(prev);
                        map.delete(file.path);
                        return map;
                      });
                      if (next) {
                        markViewed(
                          prUrl,
                          file.path,
                          fileViewedFingerprint(file),
                        );
                      } else {
                        unmarkViewed(prUrl, file.path);
                      }
                    }}
                  />
                }
              />
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

function ViewedToggle({
  viewed,
  onChange,
}: {
  viewed: boolean;
  onChange: (viewed: boolean) => void;
}) {
  return (
    <NestedButton
      aria-label={viewed ? "Mark as not viewed" : "Mark as viewed"}
      aria-pressed={viewed}
      className="ml-[6px] inline-flex shrink-0 cursor-pointer items-center gap-[5px] rounded px-[6px] py-[2px] text-[11px] text-gray-11 hover:bg-gray-4"
      onActivate={() => onChange(!viewed)}
    >
      <span
        className={`inline-flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border ${
          viewed
            ? "border-(--accent-9) bg-(--accent-9) text-white"
            : "border-(--gray-7)"
        }`}
      >
        {viewed && <CheckIcon size={9} weight="bold" />}
      </span>
      Viewed
    </NestedButton>
  );
}
