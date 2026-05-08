import { ArrowCounterClockwise } from "@phosphor-icons/react";
import {
  type DiffLineAnnotation,
  diffAcceptRejectHunk,
  parseDiffFromFile,
} from "@pierre/diffs";
import { FileDiff, MultiFileDiff } from "@pierre/diffs/react";
import { useInView } from "@renderer/hooks/useInView";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { DIFF_METRICS, REVIEW_PREFETCH_ROOT_MARGIN } from "../constants";
import { useCommentState } from "../hooks/useCommentState";
import { useExpandableFileDiff } from "../hooks/useExpandableFileDiff";
import type {
  AnnotationMetadata,
  FilesDiffProps,
  InteractiveFileDiffProps,
  PatchDiffProps,
} from "../types";
import {
  buildCommentMergedOptions,
  buildHunkAnnotations,
} from "../utils/diffAnnotations";
import { buildFileAnnotations } from "../utils/prCommentAnnotations";
import { CommentAnnotation } from "./CommentAnnotation";
import { PrCommentThread } from "./PrCommentThread";

function renderSharedAnnotation(
  annotation: DiffLineAnnotation<AnnotationMetadata>,
  filePath: string,
  taskId: string,
  prUrl: string | null,
  reset: () => void,
): React.ReactNode {
  if (annotation.metadata.kind === "comment") {
    const { startLine, endLine, side } = annotation.metadata;
    return (
      <CommentAnnotation
        taskId={taskId}
        filePath={filePath}
        startLine={startLine}
        endLine={endLine}
        side={side}
        onDismiss={reset}
      />
    );
  }

  if (annotation.metadata.kind === "pr-comment") {
    return (
      <PrCommentThread
        taskId={taskId}
        prUrl={prUrl}
        filePath={filePath}
        metadata={annotation.metadata}
      />
    );
  }

  return null;
}

function HunkRevertButton({
  isReverting,
  onRevert,
}: {
  isReverting: boolean;
  onRevert: () => void;
}) {
  return (
    <div className="relative h-0 w-full overflow-visible">
      <button
        type="button"
        disabled={isReverting}
        onClick={onRevert}
        className={`absolute top-0 right-2 z-10 inline-flex items-center gap-0.5 rounded border-none bg-(--red-9) px-[6px] py-[1px] font-medium text-[10px] text-white leading-4.5 transition-opacity ${
          isReverting ? "opacity-60" : "opacity-0 hover:opacity-100"
        }`}
        style={{
          cursor: isReverting ? "default" : "pointer",
        }}
      >
        <ArrowCounterClockwise size={12} />
        {isReverting ? "Reverting..." : "Revert"}
      </button>
    </div>
  );
}

function ExpansionPlaceholder({
  patchFileDiff,
  renderCustomHeader,
}: {
  patchFileDiff: PatchDiffProps["fileDiff"];
  renderCustomHeader?: PatchDiffProps["renderCustomHeader"];
}) {
  return (
    <div className="overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2)">
      {renderCustomHeader?.(patchFileDiff)}
    </div>
  );
}

function isPatchDiff(props: InteractiveFileDiffProps): props is PatchDiffProps {
  return "fileDiff" in props && props.fileDiff != null;
}

export function InteractiveFileDiff(props: InteractiveFileDiffProps) {
  if (isPatchDiff(props)) {
    return <PatchDiffView {...props} />;
  }
  return <FilesDiffView {...props} />;
}

function PatchDiffView({
  fileDiff: patchFileDiff,
  repoPath,
  skipExpansion = false,
  options,
  renderCustomHeader,
  taskId,
  prUrl,
  commentThreads,
}: PatchDiffProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [containerRef, inView] = useInView<HTMLDivElement>({
    rootMargin: REVIEW_PREFETCH_ROOT_MARGIN,
    once: true,
  });
  const {
    fileDiff: initialFileDiff,
    tooLarge,
    pending,
  } = useExpandableFileDiff(patchFileDiff, repoPath, skipExpansion, inView);
  const [fileDiff, setFileDiff] = useState(initialFileDiff);
  const [revertingHunks, setRevertingHunks] = useState<Set<number>>(
    () => new Set(),
  );

  const {
    selectedRange,
    commentAnnotation,
    hasOpenComment,
    reset,
    handleLineSelectionEnd,
  } = useCommentState();

  const [lastPatch, setLastPatch] = useState(patchFileDiff);
  if (patchFileDiff !== lastPatch) {
    setLastPatch(patchFileDiff);
    setRevertingHunks(new Set());
    reset();
  }

  const [lastInitial, setLastInitial] = useState(initialFileDiff);
  if (initialFileDiff !== lastInitial) {
    setLastInitial(initialFileDiff);
    setFileDiff(initialFileDiff);
  }

  const currentFilePath = fileDiff.name ?? fileDiff.prevName ?? "";
  const filePathRef = useRef(currentFilePath);
  filePathRef.current = currentFilePath;

  const hunkAnnotations = useMemo(
    () => (repoPath ? buildHunkAnnotations(fileDiff) : []),
    [fileDiff, repoPath],
  );
  const prAnnotations = useMemo(
    () =>
      commentThreads
        ? buildFileAnnotations(commentThreads, currentFilePath)
        : [],
    [commentThreads, currentFilePath],
  );
  const annotations = useMemo(() => {
    const all = [...hunkAnnotations, ...prAnnotations];
    if (commentAnnotation) all.push(commentAnnotation);
    return all;
  }, [hunkAnnotations, prAnnotations, commentAnnotation]);

  const handleRevert = useCallback(
    async (hunkIndex: number) => {
      const filePath = filePathRef.current;
      if (!filePath || !repoPath) return;

      setRevertingHunks((prev) => new Set(prev).add(hunkIndex));
      setFileDiff((prev) => diffAcceptRejectHunk(prev, hunkIndex, "reject"));

      try {
        const [originalContent, modifiedContent] = await Promise.all([
          trpcClient.git.getFileAtHead.query({
            directoryPath: repoPath,
            filePath,
          }),
          trpcClient.fs.readRepoFile.query({
            repoPath,
            filePath,
          }),
        ]);

        const fullDiff = parseDiffFromFile(
          { name: filePath, contents: originalContent ?? "" },
          { name: filePath, contents: modifiedContent ?? "" },
        );

        const reverted = diffAcceptRejectHunk(fullDiff, hunkIndex, "reject");
        const newContent = reverted.additionLines.join("");

        await trpcClient.fs.writeRepoFile.mutate({
          repoPath,
          filePath,
          content: newContent,
        });

        queryClient.invalidateQueries(
          trpc.git.getDiffHead.queryFilter({ directoryPath: repoPath }),
        );
        queryClient.invalidateQueries(
          trpc.git.getChangedFilesHead.queryFilter({ directoryPath: repoPath }),
        );
      } catch {
        setFileDiff(initialFileDiff);
      } finally {
        setRevertingHunks((prev) => {
          const next = new Set(prev);
          next.delete(hunkIndex);
          return next;
        });
      }
    },
    [repoPath, initialFileDiff, queryClient, trpc],
  );

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMetadata>) => {
      if (annotation.metadata.kind === "hunk-revert") {
        const { hunkIndex } = annotation.metadata;
        return (
          <HunkRevertButton
            isReverting={revertingHunks.has(hunkIndex)}
            onRevert={() => handleRevert(hunkIndex)}
          />
        );
      }

      return renderSharedAnnotation(
        annotation,
        currentFilePath,
        taskId ?? "",
        prUrl ?? null,
        reset,
      );
    },
    [handleRevert, revertingHunks, reset, taskId, prUrl, currentFilePath],
  );

  const mergedOptions = useMemo(
    () =>
      buildCommentMergedOptions(
        options,
        hasOpenComment,
        handleLineSelectionEnd,
      ),
    [options, hasOpenComment, handleLineSelectionEnd],
  );

  return (
    <div ref={containerRef}>
      {pending ? (
        <ExpansionPlaceholder
          patchFileDiff={patchFileDiff}
          renderCustomHeader={renderCustomHeader}
        />
      ) : (
        <FileDiff
          fileDiff={fileDiff}
          options={mergedOptions}
          lineAnnotations={annotations}
          selectedLines={selectedRange}
          renderAnnotation={renderAnnotation}
          renderCustomHeader={renderCustomHeader}
          metrics={DIFF_METRICS}
        />
      )}
      {tooLarge && (
        <div className="border-(--gray-5) border-t bg-(--gray-2) px-3 py-1.5 text-(--gray-10) text-[12px]">
          File exceeds the 5,000-line review limit — surrounding context is
          hidden.
        </div>
      )}
    </div>
  );
}

function FilesDiffView({
  oldFile,
  newFile,
  options,
  renderCustomHeader,
  taskId,
  prUrl,
  commentThreads,
}: FilesDiffProps) {
  const {
    selectedRange,
    commentAnnotation,
    hasOpenComment,
    reset,
    handleLineSelectionEnd,
  } = useCommentState();

  const filePath = newFile.name || oldFile.name;

  const prAnnotations = useMemo(
    () =>
      commentThreads ? buildFileAnnotations(commentThreads, filePath) : [],
    [commentThreads, filePath],
  );
  const annotations = useMemo(() => {
    const all = [...prAnnotations];
    if (commentAnnotation) all.push(commentAnnotation);
    return all;
  }, [prAnnotations, commentAnnotation]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMetadata>) =>
      renderSharedAnnotation(
        annotation,
        filePath,
        taskId ?? "",
        prUrl ?? null,
        reset,
      ),
    [reset, taskId, prUrl, filePath],
  );

  const mergedOptions = useMemo(
    () =>
      buildCommentMergedOptions(
        options,
        hasOpenComment,
        handleLineSelectionEnd,
      ),
    [options, hasOpenComment, handleLineSelectionEnd],
  );

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={mergedOptions}
      lineAnnotations={annotations}
      selectedLines={selectedRange}
      renderAnnotation={renderAnnotation}
      renderCustomHeader={renderCustomHeader}
      metrics={DIFF_METRICS}
    />
  );
}
