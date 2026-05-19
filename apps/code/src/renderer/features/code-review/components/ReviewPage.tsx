import { useDiffViewerStore } from "@features/code-editor/stores/diffViewerStore";
import {
  useLocalBranchChangedFiles,
  usePrChangedFiles,
} from "@features/git-interaction/hooks/useGitQueries";
import { usePrDetails } from "@features/git-interaction/hooks/usePrDetails";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import type { parsePatchFiles } from "@pierre/diffs";
import { Flex, Text } from "@radix-ui/themes";
import { useReviewNavigationStore } from "@renderer/features/code-review/stores/reviewNavigationStore";
import { trpc, useTRPC } from "@renderer/trpc/client";
import type { ChangedFile, Task } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { REVIEW_FILE_CACHE_TIME_MS, REVIEW_MAX_FILE_LINES } from "../constants";
import { useEffectiveDiffSource } from "../hooks/useEffectiveDiffSource";
import { useReviewDiffs } from "../hooks/useReviewDiffs";
import type { DiffOptions } from "../types";
import type { PrCommentThread } from "../utils/prCommentAnnotations";
import type { ResolvedDiffSource } from "../utils/resolveDiffSource";
import {
  buildItemIndex,
  type ReviewListItem,
  ReviewShell,
  useReviewState,
} from "./ReviewShell";
import {
  buildPatchReviewItems,
  buildRemoteReviewItems,
  buildUntrackedReviewItems,
} from "./reviewItemBuilders";

const EMPTY_CHANGED_FILES: ChangedFile[] = [];

function usePrefetchUntrackedFileContents(
  repoPath: string,
  files: ChangedFile[],
  enabled: boolean,
) {
  const trpcClient = useTRPC();
  const queryClient = useQueryClient();
  const filePaths = useMemo(
    () => [...new Set(files.map((file) => file.path))],
    [files],
  );

  useEffect(() => {
    if (!enabled || filePaths.length === 0) return;

    let cancelled = false;

    const run = async () => {
      const batchResult = await queryClient.fetchQuery({
        ...trpc.fs.readRepoFilesBounded.queryOptions(
          {
            repoPath,
            filePaths,
            maxLines: REVIEW_MAX_FILE_LINES,
          },
          {
            staleTime: 30_000,
            gcTime: REVIEW_FILE_CACHE_TIME_MS,
          },
        ),
      });

      if (cancelled) return;

      for (const [filePath, result] of Object.entries(batchResult)) {
        queryClient.setQueryData(
          trpcClient.fs.readRepoFileBounded.queryKey({
            repoPath,
            filePath,
            maxLines: REVIEW_MAX_FILE_LINES,
          }),
          result,
        );
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [enabled, filePaths, queryClient, repoPath, trpcClient]);
}

interface ReviewPageProps {
  task: Task;
}

export function ReviewPage({ task }: ReviewPageProps) {
  const taskId = task.id;
  const repoPath = useCwd(taskId);
  const openFile = usePanelLayoutStore((s) => s.openFile);

  const isReviewOpen = useReviewNavigationStore(
    (s) => (s.reviewModes[taskId] ?? "closed") !== "closed",
  );

  const {
    effectiveSource,
    prUrl,
    linkedBranch,
    defaultBranch,
    branchSourceAvailable,
    prSourceAvailable,
  } = useEffectiveDiffSource(taskId);

  const showReviewComments = useDiffViewerStore((s) => s.showReviewComments);
  const { commentThreads } = usePrDetails(prUrl, {
    includeComments: isReviewOpen && showReviewComments,
  });
  const effectiveCommentThreads = showReviewComments
    ? commentThreads
    : undefined;

  const isLocalActive = isReviewOpen && effectiveSource === "local";

  const {
    changedFiles,
    changesLoading,
    hasStagedFiles,
    stagedParsedFiles,
    unstagedParsedFiles,
    untrackedFiles,
    totalFileCount,
    allPaths,
    diffLoading,
    refetch,
  } = useReviewDiffs(repoPath, isLocalActive);

  const {
    diffOptions,
    linesAdded,
    linesRemoved,
    collapsedFiles,
    toggleFile,
    expandAll,
    collapseAll,
    uncollapseFile,
  } = useReviewState(changedFiles, allPaths);

  const stagedPathSet = useMemo(
    () => new Set(stagedParsedFiles.map((f) => f.name ?? f.prevName ?? "")),
    [stagedParsedFiles],
  );

  if (!repoPath) {
    return (
      <Flex align="center" justify="center" height="100%">
        <Text color="gray" className="text-sm">
          No repository path available
        </Text>
      </Flex>
    );
  }

  if (effectiveSource === "branch" || effectiveSource === "pr") {
    return (
      <RemoteReviewPage
        task={task}
        repoPath={repoPath}
        branch={effectiveSource === "branch" ? linkedBranch : null}
        prUrl={prUrl}
        isReviewOpen={isReviewOpen}
        effectiveSource={effectiveSource}
        defaultBranch={defaultBranch}
        branchSourceAvailable={branchSourceAvailable}
        prSourceAvailable={prSourceAvailable}
        commentThreads={effectiveCommentThreads}
      />
    );
  }

  return (
    <LocalReviewContent
      task={task}
      repoPath={repoPath}
      taskId={taskId}
      openFile={openFile}
      prUrl={prUrl}
      totalFileCount={totalFileCount}
      linesAdded={linesAdded}
      linesRemoved={linesRemoved}
      changesLoading={changesLoading}
      diffLoading={diffLoading}
      diffOptions={diffOptions}
      collapsedFiles={collapsedFiles}
      toggleFile={toggleFile}
      expandAll={expandAll}
      collapseAll={collapseAll}
      uncollapseFile={uncollapseFile}
      refetch={refetch}
      hasStagedFiles={hasStagedFiles}
      stagedParsedFiles={stagedParsedFiles}
      unstagedParsedFiles={unstagedParsedFiles}
      untrackedFiles={untrackedFiles}
      stagedPathSet={stagedPathSet}
      commentThreads={effectiveCommentThreads}
      effectiveSource={effectiveSource}
      branchSourceAvailable={branchSourceAvailable}
      prSourceAvailable={prSourceAvailable}
      defaultBranch={defaultBranch}
    />
  );
}

function LocalReviewContent({
  task,
  repoPath,
  taskId,
  openFile,
  prUrl,
  totalFileCount,
  linesAdded,
  linesRemoved,
  changesLoading,
  diffLoading,
  diffOptions,
  collapsedFiles,
  toggleFile,
  expandAll,
  collapseAll,
  uncollapseFile,
  refetch,
  hasStagedFiles,
  stagedParsedFiles,
  unstagedParsedFiles,
  untrackedFiles,
  stagedPathSet,
  commentThreads,
  effectiveSource,
  branchSourceAvailable,
  prSourceAvailable,
  defaultBranch,
}: {
  task: Task;
  repoPath: string;
  taskId: string;
  openFile: (taskId: string, path: string, preview: boolean) => void;
  prUrl: string | null;
  totalFileCount: number;
  linesAdded: number;
  linesRemoved: number;
  changesLoading: boolean;
  diffLoading: boolean;
  diffOptions: DiffOptions;
  collapsedFiles: Set<string>;
  toggleFile: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  uncollapseFile: (filePath: string) => void;
  refetch: () => void;
  hasStagedFiles: boolean;
  stagedParsedFiles: ReturnType<typeof parsePatchFiles>[number]["files"];
  unstagedParsedFiles: ReturnType<typeof parsePatchFiles>[number]["files"];
  untrackedFiles: ChangedFile[];
  stagedPathSet: Set<string>;
  commentThreads?: Map<number, PrCommentThread>;
  effectiveSource: ResolvedDiffSource;
  branchSourceAvailable: boolean;
  prSourceAvailable: boolean;
  defaultBranch: string | null;
}) {
  usePrefetchUntrackedFileContents(repoPath, untrackedFiles, true);

  const items = useMemo<ReviewListItem[]>(() => {
    const reviewItems: ReviewListItem[] = [];

    if (hasStagedFiles && stagedParsedFiles.length > 0) {
      reviewItems.push({
        key: "section:staged",
        node: <SectionLabel label="Staged Changes" />,
      });
      reviewItems.push(
        ...buildPatchReviewItems({
          files: stagedParsedFiles,
          staged: true,
          repoPath,
          taskId,
          diffOptions,
          collapsedFiles,
          toggleFile,
          openFile,
          prUrl,
          commentThreads,
        }),
      );
    }

    if (
      hasStagedFiles &&
      (unstagedParsedFiles.length > 0 || untrackedFiles.length > 0)
    ) {
      reviewItems.push({
        key: "section:changes",
        node: <SectionLabel label="Changes" />,
      });
    }

    reviewItems.push(
      ...buildPatchReviewItems({
        files: unstagedParsedFiles,
        alsoStagedPaths: stagedPathSet,
        repoPath,
        taskId,
        diffOptions,
        collapsedFiles,
        toggleFile,
        openFile,
        prUrl,
        commentThreads,
      }),
    );
    reviewItems.push(
      ...buildUntrackedReviewItems({
        files: untrackedFiles,
        repoPath,
        taskId,
        diffOptions,
        collapsedFiles,
        toggleFile,
      }),
    );

    return reviewItems;
  }, [
    collapsedFiles,
    commentThreads,
    diffOptions,
    hasStagedFiles,
    openFile,
    prUrl,
    repoPath,
    stagedParsedFiles,
    stagedPathSet,
    taskId,
    toggleFile,
    untrackedFiles,
    unstagedParsedFiles,
  ]);

  const itemIndexByFilePath = useMemo(() => buildItemIndex(items), [items]);

  return (
    <ReviewShell
      task={task}
      fileCount={totalFileCount}
      linesAdded={linesAdded}
      linesRemoved={linesRemoved}
      isLoading={changesLoading || diffLoading}
      isEmpty={totalFileCount === 0}
      allExpanded={collapsedFiles.size === 0}
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
      onUncollapseFile={uncollapseFile}
      onRefresh={refetch}
      effectiveSource={effectiveSource}
      branchSourceAvailable={branchSourceAvailable}
      prSourceAvailable={prSourceAvailable}
      defaultBranch={defaultBranch}
      items={items}
      itemIndexByFilePath={itemIndexByFilePath}
    />
  );
}

function RemoteReviewPage({
  task,
  repoPath,
  branch,
  prUrl,
  isReviewOpen,
  effectiveSource,
  defaultBranch,
  branchSourceAvailable,
  prSourceAvailable,
  commentThreads,
}: {
  task: Task;
  repoPath: string | null;
  branch: string | null;
  prUrl: string | null;
  isReviewOpen: boolean;
  effectiveSource: ResolvedDiffSource;
  defaultBranch: string | null;
  branchSourceAvailable: boolean;
  prSourceAvailable: boolean;
  commentThreads?: Map<number, PrCommentThread>;
}) {
  const taskId = task.id;
  const isBranch = effectiveSource === "branch";

  const { data: branchFiles = EMPTY_CHANGED_FILES, isLoading: branchLoading } =
    useLocalBranchChangedFiles(
      isBranch && isReviewOpen ? repoPath : null,
      isBranch && isReviewOpen ? branch : null,
    );
  const { data: prFiles = EMPTY_CHANGED_FILES, isLoading: prLoading } =
    usePrChangedFiles(!isBranch && isReviewOpen ? prUrl : null);

  const files = isBranch ? branchFiles : prFiles;
  const isLoading = isBranch
    ? (branchLoading || (!repoPath && isReviewOpen)) && files.length === 0
    : prLoading && files.length === 0;

  const allPaths = useMemo(() => files.map((f) => f.path), [files]);
  const reviewState = useReviewState(files, allPaths);

  const items = useMemo(
    () =>
      buildRemoteReviewItems({
        files,
        taskId,
        prUrl,
        options: reviewState.diffOptions,
        collapsedFiles: reviewState.collapsedFiles,
        toggleFile: reviewState.toggleFile,
        commentThreads,
      }),
    [
      commentThreads,
      files,
      prUrl,
      reviewState.collapsedFiles,
      reviewState.diffOptions,
      reviewState.toggleFile,
      taskId,
    ],
  );
  const itemIndexByFilePath = useMemo(() => buildItemIndex(items), [items]);

  return (
    <ReviewShell
      task={task}
      fileCount={files.length}
      linesAdded={reviewState.linesAdded}
      linesRemoved={reviewState.linesRemoved}
      isLoading={isLoading}
      isEmpty={files.length === 0}
      allExpanded={reviewState.collapsedFiles.size === 0}
      onExpandAll={reviewState.expandAll}
      onCollapseAll={reviewState.collapseAll}
      onUncollapseFile={reviewState.uncollapseFile}
      effectiveSource={effectiveSource}
      branchSourceAvailable={branchSourceAvailable}
      prSourceAvailable={prSourceAvailable}
      defaultBranch={defaultBranch}
      items={items}
      itemIndexByFilePath={itemIndexByFilePath}
    />
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Flex px="3" py="2">
      <Text color="gray" className="font-medium text-[13px]">
        {label}
      </Text>
    </Flex>
  );
}
