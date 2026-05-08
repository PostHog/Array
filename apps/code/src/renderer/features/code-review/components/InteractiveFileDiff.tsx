import { ArrowCounterClockwise } from "@phosphor-icons/react";
import {
  type DiffLineAnnotation,
  diffAcceptRejectHunk,
  parseDiffFromFile,
} from "@pierre/diffs";
import { FileDiff, MultiFileDiff } from "@pierre/diffs/react";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type CommentEditSeed,
  useCommentState,
} from "../hooks/useCommentState";
import { useExpandableFileDiff } from "../hooks/useExpandableFileDiff";
import { useReviewDraftsStore } from "../stores/reviewDraftsStore";
import type {
  AnnotationMetadata,
  FilesDiffProps,
  InteractiveFileDiffProps,
  PatchDiffProps,
} from "../types";
import {
  buildCommentMergedOptions,
  buildDraftAnnotations,
  buildHunkAnnotations,
} from "../utils/diffAnnotations";
import { buildFileAnnotations } from "../utils/prCommentAnnotations";
import { CommentAnnotation } from "./CommentAnnotation";
import { DraftCommentAnnotation } from "./DraftCommentAnnotation";
import { PrCommentThread } from "./PrCommentThread";

interface SharedAnnotationContext {
  taskId: string;
  filePath: string;
  prUrl: string | null;
  reset: () => void;
  editSeed: CommentEditSeed | null;
  onEditDraft: (draftId: string) => void;
}

function renderSharedAnnotation(
  annotation: DiffLineAnnotation<AnnotationMetadata>,
  ctx: SharedAnnotationContext,
): React.ReactNode {
  if (annotation.metadata.kind === "comment") {
    const { startLine, endLine, side } = annotation.metadata;
    const seed = ctx.editSeed;
    return (
      <CommentAnnotation
        taskId={ctx.taskId}
        filePath={ctx.filePath}
        startLine={startLine}
        endLine={endLine}
        side={side}
        onDismiss={ctx.reset}
        initialText={seed?.text}
        editingDraftId={seed?.draftId}
      />
    );
  }

  if (annotation.metadata.kind === "draft-comment") {
    return (
      <DraftCommentAnnotation
        taskId={ctx.taskId}
        draftId={annotation.metadata.draftId}
        onEdit={ctx.onEditDraft}
      />
    );
  }

  if (annotation.metadata.kind === "pr-comment") {
    return (
      <PrCommentThread
        taskId={ctx.taskId}
        prUrl={ctx.prUrl}
        filePath={ctx.filePath}
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

function isPatchDiff(props: InteractiveFileDiffProps): props is PatchDiffProps {
  return "fileDiff" in props && props.fileDiff != null;
}

export function InteractiveFileDiff(props: InteractiveFileDiffProps) {
  if (isPatchDiff(props)) {
    return <PatchDiffView {...props} />;
  }
  return <FilesDiffView {...props} />;
}

function useFileDrafts(taskId: string | undefined, filePath: string) {
  return useReviewDraftsStore((s) =>
    taskId
      ? (s.drafts[taskId] ?? []).filter((d) => d.filePath === filePath)
      : [],
  );
}

function useEditDraftHandler(
  fileDrafts: ReturnType<typeof useFileDrafts>,
  openCommentForEdit: (seed: CommentEditSeed) => void,
) {
  return useCallback(
    (draftId: string) => {
      const draft = fileDrafts.find((d) => d.id === draftId);
      if (!draft) return;
      openCommentForEdit({
        draftId: draft.id,
        text: draft.text,
        filePath: draft.filePath,
        startLine: draft.startLine,
        endLine: draft.endLine,
        side: draft.side,
      });
    },
    [fileDrafts, openCommentForEdit],
  );
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
  const initialFileDiff = useExpandableFileDiff(
    patchFileDiff,
    repoPath,
    skipExpansion,
  );
  const [fileDiff, setFileDiff] = useState(initialFileDiff);
  const [revertingHunks, setRevertingHunks] = useState<Set<number>>(
    () => new Set(),
  );

  const {
    selectedRange,
    commentAnnotation,
    hasOpenComment,
    editSeed,
    reset,
    handleLineSelectionEnd,
    openCommentForEdit,
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

  const fileDrafts = useFileDrafts(taskId, currentFilePath);
  const handleEditDraft = useEditDraftHandler(fileDrafts, openCommentForEdit);

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
  const draftAnnotations = useMemo(() => {
    const drafts = editSeed
      ? fileDrafts.filter((d) => d.id !== editSeed.draftId)
      : fileDrafts;
    return buildDraftAnnotations(drafts);
  }, [fileDrafts, editSeed]);
  const annotations = useMemo(() => {
    const all = [...hunkAnnotations, ...prAnnotations, ...draftAnnotations];
    if (commentAnnotation) all.push(commentAnnotation);
    return all;
  }, [hunkAnnotations, prAnnotations, draftAnnotations, commentAnnotation]);

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

      return renderSharedAnnotation(annotation, {
        taskId: taskId ?? "",
        filePath: currentFilePath,
        prUrl: prUrl ?? null,
        reset,
        editSeed,
        onEditDraft: handleEditDraft,
      });
    },
    [
      handleRevert,
      revertingHunks,
      reset,
      taskId,
      prUrl,
      currentFilePath,
      editSeed,
      handleEditDraft,
    ],
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
    <FileDiff
      fileDiff={fileDiff}
      options={mergedOptions}
      lineAnnotations={annotations}
      selectedLines={selectedRange}
      renderAnnotation={renderAnnotation}
      renderCustomHeader={renderCustomHeader}
    />
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
    editSeed,
    reset,
    handleLineSelectionEnd,
    openCommentForEdit,
  } = useCommentState();

  const filePath = newFile.name || oldFile.name;

  const fileDrafts = useFileDrafts(taskId, filePath);
  const handleEditDraft = useEditDraftHandler(fileDrafts, openCommentForEdit);

  const prAnnotations = useMemo(
    () =>
      commentThreads ? buildFileAnnotations(commentThreads, filePath) : [],
    [commentThreads, filePath],
  );
  const draftAnnotations = useMemo(() => {
    const drafts = editSeed
      ? fileDrafts.filter((d) => d.id !== editSeed.draftId)
      : fileDrafts;
    return buildDraftAnnotations(drafts);
  }, [fileDrafts, editSeed]);
  const annotations = useMemo(() => {
    const all = [...prAnnotations, ...draftAnnotations];
    if (commentAnnotation) all.push(commentAnnotation);
    return all;
  }, [prAnnotations, draftAnnotations, commentAnnotation]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMetadata>) =>
      renderSharedAnnotation(annotation, {
        taskId: taskId ?? "",
        filePath,
        prUrl: prUrl ?? null,
        reset,
        editSeed,
        onEditDraft: handleEditDraft,
      }),
    [reset, taskId, prUrl, filePath, editSeed, handleEditDraft],
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
    />
  );
}
