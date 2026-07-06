import { CheckIcon, GitDiffIcon } from "@phosphor-icons/react";
import { Button, Spinner } from "@posthog/quill";
import { PatchedFileDiff } from "@posthog/ui/features/code-review/components/PatchedFileDiff";
import { useDiffOptions } from "@posthog/ui/features/code-review/reviewShellParts";
import { usePrChangedFiles } from "@posthog/ui/features/git-interaction/useGitQueries";
import { DetailSection } from "@posthog/ui/features/inbox/components/DetailSection";
import { useMemo, useRef, useState } from "react";
import {
  fileViewedFingerprint,
  isFileViewed,
  usePrViewedFilesStore,
} from "./prViewedFilesStore";

interface PrFilesChangedSectionProps {
  prUrl: string;
}

/**
 * GitHub-style "Files changed" list for a PR: one collapsible diff per file,
 * all collapsed by default. An expanded file gets a footer row with the
 * "Viewed" toggle; marking a file viewed folds it back up.
 */
export function PrFilesChangedSection({ prUrl }: PrFilesChangedSectionProps) {
  const filesQuery = usePrChangedFiles(prUrl);
  const diffOptions = useDiffOptions();
  const viewedByPr = usePrViewedFilesStore((s) => s.viewedByPr);
  const markViewed = usePrViewedFilesStore((s) => s.markViewed);
  const unmarkViewed = usePrViewedFilesStore((s) => s.unmarkViewed);

  // Per-file collapse overrides on top of a section-wide baseline, so
  // expand/collapse-all is one state flip instead of a map rebuild.
  const [baselineCollapsed, setBaselineCollapsed] = useState(true);
  const [collapseOverrides, setCollapseOverrides] = useState<
    Map<string, boolean>
  >(new Map());
  const fileContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  const isCollapsed = (path: string) =>
    collapseOverrides.get(path) ?? baselineCollapsed;
  const allExpanded = files.every((file) => !isCollapsed(file.path));

  const setAllCollapsed = (collapsed: boolean) => {
    setBaselineCollapsed(collapsed);
    setCollapseOverrides(new Map());
  };

  return (
    <DetailSection
      Icon={GitDiffIcon}
      title={`Files changed (${files.length})`}
      rightSlot={
        <span className="flex items-center gap-2">
          <span className="cursor-default select-none text-[11px] text-gray-10 tabular-nums">
            {viewedCount} / {files.length} viewed
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAllCollapsed(allExpanded)}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {files.map((file) => {
          const viewed = isFileViewed(viewedByPr, prUrl, file);
          const collapsed = isCollapsed(file.path);
          const setCollapsed = (next: boolean) =>
            setCollapseOverrides((prev) => new Map(prev).set(file.path, next));
          return (
            <div
              key={file.path}
              ref={(el) => {
                if (el) fileContainerRefs.current.set(file.path, el);
                else fileContainerRefs.current.delete(file.path);
              }}
              className="overflow-hidden rounded-md border border-(--gray-5)"
            >
              <PatchedFileDiff
                file={file}
                taskId={prUrl}
                options={diffOptions}
                collapsed={collapsed}
                onToggle={() => setCollapsed(!collapsed)}
                externalUrl={`${prUrl}/files`}
                prUrl={prUrl}
              />
              {!collapsed && (
                <div className="flex items-center justify-end border-t border-t-(--gray-5) bg-(--gray-2) px-3 py-[4px]">
                  <ViewedToggle
                    viewed={viewed}
                    onChange={(next) => {
                      if (next) {
                        markViewed(
                          prUrl,
                          file.path,
                          fileViewedFingerprint(file),
                        );
                        // Fold the file away once it's read, like GitHub.
                        setCollapsed(true);
                        // The click point was at the bottom of a diff that
                        // just vanished, which would leave the viewport deep
                        // in the content below — scroll the folded file back
                        // into view. rAF runs after React commits the
                        // collapse but before the browser paints.
                        requestAnimationFrame(() => {
                          fileContainerRefs.current
                            .get(file.path)
                            ?.scrollIntoView({ block: "nearest" });
                        });
                      } else {
                        unmarkViewed(prUrl, file.path);
                      }
                    }}
                  />
                </div>
              )}
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
    <button
      type="button"
      aria-pressed={viewed}
      onClick={() => onChange(!viewed)}
      className="inline-flex shrink-0 cursor-pointer items-center gap-[5px] rounded border-0 bg-transparent px-[6px] py-[2px] text-[11px] text-gray-11 hover:bg-gray-4"
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
    </button>
  );
}
