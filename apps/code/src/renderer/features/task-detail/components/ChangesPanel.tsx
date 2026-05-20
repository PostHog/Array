import { TreeFileRow } from "@components/TreeDirectoryRow";
import { PanelMessage } from "@components/ui/PanelMessage";
import { Tooltip } from "@components/ui/Tooltip";
import { useEffectiveDiffSource } from "@features/code-review/hooks/useEffectiveDiffSource";
import { useExternalApps } from "@features/external-apps/hooks/useExternalApps";
import {
  useGitQueries,
  useLocalBranchChangedFiles,
  usePrChangedFiles,
} from "@features/git-interaction/hooks/useGitQueries";
import { makeFileKey } from "@features/git-interaction/utils/fileKey";
import { invalidateGitWorkingTreeQueries } from "@features/git-interaction/utils/gitCacheKeys";
import { partitionByStaged } from "@features/git-interaction/utils/partitionByStaged";
import { updateGitCacheFromSnapshot } from "@features/git-interaction/utils/updateGitCache";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useCloudChangedFiles } from "@features/task-detail/hooks/useCloudChangedFiles";
import {
  ArrowCounterClockwiseIcon,
  CodeIcon,
  CopyIcon,
  FilePlus,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useReviewNavigationStore } from "@renderer/features/code-review/stores/reviewNavigationStore";
import { getStatusIndicator } from "@renderer/features/git-interaction/utils/gitStatusUtils";
import { useIsCloudTask } from "@renderer/features/workspace/hooks/useIsCloudTask";
import { useWorkspace } from "@renderer/features/workspace/hooks/useWorkspace";
import { trpcClient } from "@renderer/trpc/client";
import { track } from "@renderer/utils/analytics";
import { getFileExtension } from "@renderer/utils/path";
import type { ChangedFile, Task } from "@shared/types";
import { ANALYTICS_EVENTS, type FileChangeType } from "@shared/types/analytics";
import { useQueryClient } from "@tanstack/react-query";
import { showMessageBox } from "@utils/dialog";
import { handleExternalAppAction } from "@utils/handleExternalAppAction";
import { logger } from "@utils/logger";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ChangesTreeView } from "./ChangesTreeView";

const log = logger.scope("changes-panel");

interface ChangesPanelProps {
  taskId: string;
  task: Task;
}

interface ChangedFileItemProps {
  file: ChangedFile;
  taskId: string;
  isActive: boolean;
  repoPath?: string;
  mainRepoPath?: string;
  onStageToggle?: (file: ChangedFile) => void;
  depth?: number;
}

function getDiscardInfo(
  file: ChangedFile,
  fileName: string,
): { message: string; action: string } {
  switch (file.status) {
    case "modified":
      return {
        message: `Are you sure you want to discard changes in '${fileName}'?`,
        action: "Discard File",
      };
    case "deleted":
      return {
        message: `Are you sure you want to restore '${fileName}'?`,
        action: "Restore File",
      };
    case "added":
      return {
        message: `Are you sure you want to remove '${fileName}'?`,
        action: "Remove File",
      };
    case "untracked":
      return {
        message: `Are you sure you want to delete '${fileName}'?`,
        action: "Delete File",
      };
    case "renamed":
      return {
        message: `Are you sure you want to undo the rename of '${fileName}'?`,
        action: "Undo Rename File",
      };
    default:
      return {
        message: `Are you sure you want to discard changes in '${fileName}'?`,
        action: "Discard File",
      };
  }
}

function CompactIconButton({
  tooltip,
  onClick,
  children,
}: {
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        onClick={onClick}
        className="mx-0.5 size-[18px] shrink-0 p-0"
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

function ChangedFileItem({
  file,
  taskId,
  isActive,
  repoPath,
  mainRepoPath,
  onStageToggle,
  depth = 0,
}: ChangedFileItemProps) {
  const requestScrollToFile = useReviewNavigationStore(
    (state) => state.requestScrollToFile,
  );
  const queryClient = useQueryClient();
  const { detectedApps } = useExternalApps();
  const workspace = useWorkspace(taskId);

  const [isHovered, setIsHovered] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const isLocal = !!repoPath;
  const isToolbarVisible = isLocal && (isHovered || isDropdownOpen);

  const fileName = file.path.split("/").pop() || file.path;
  const fullPath = repoPath ? `${repoPath}/${file.path}` : file.path;
  const indicator = getStatusIndicator(file.status);

  const fileKey = makeFileKey(file.staged, file.path);

  const handleClick = () => {
    track(ANALYTICS_EVENTS.FILE_DIFF_VIEWED, {
      change_type: file.status as FileChangeType,
      file_extension: getFileExtension(file.path),
      task_id: taskId,
    });
    requestScrollToFile(taskId, fileKey);
  };

  const workspaceContext = {
    workspace,
    mainRepoPath,
  };

  const handleContextMenu = repoPath
    ? async (e: React.MouseEvent) => {
        e.preventDefault();
        const result = await trpcClient.contextMenu.showFileContextMenu.mutate({
          filePath: fullPath,
        });

        if (!result.action) return;

        if (result.action.type === "external-app") {
          await handleExternalAppAction(
            result.action.action,
            fullPath,
            fileName,
            workspaceContext,
          );
        }
      }
    : undefined;

  const handleOpenWith = async (appId: string) => {
    await handleExternalAppAction(
      { type: "open-in-app", appId },
      fullPath,
      fileName,
      workspaceContext,
    );

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleCopyPath = async () => {
    await handleExternalAppAction({ type: "copy-path" }, fullPath, fileName);
  };

  const handleDiscard = repoPath
    ? async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const { message, action } = getDiscardInfo(file, fileName);

        const dialogResult = await showMessageBox({
          type: "warning",
          title: "Discard changes",
          message,
          buttons: ["Cancel", action],
          defaultId: 1,
          cancelId: 0,
        });

        if (dialogResult.response !== 1) return;

        const discardResult = await trpcClient.git.discardFileChanges.mutate({
          directoryPath: repoPath,
          filePath: file.originalPath ?? file.path,
          fileStatus: file.status,
        });

        if (discardResult.state) {
          updateGitCacheFromSnapshot(
            queryClient,
            repoPath,
            discardResult.state,
          );
        }
      }
    : undefined;

  const hasLineStats =
    file.linesAdded !== undefined || file.linesRemoved !== undefined;

  const tooltipContent = `${file.path} - ${indicator.fullLabel}`;

  const trailing = (
    <>
      {hasLineStats && !isToolbarVisible && (
        <Flex
          align="center"
          gap="1"
          className="shrink-0 font-mono text-[10px] leading-none"
        >
          {(file.linesAdded ?? 0) > 0 && (
            <Text className="text-(--green-9)">+{file.linesAdded}</Text>
          )}
          {(file.linesRemoved ?? 0) > 0 && (
            <Text className="text-(--red-9)">-{file.linesRemoved}</Text>
          )}
        </Flex>
      )}

      {isToolbarVisible && (handleDiscard || onStageToggle) && (
        <Flex align="center" gap="1" className="shrink-0">
          {onStageToggle && (
            <CompactIconButton
              tooltip={file.staged ? "Unstage" : "Stage"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStageToggle(file);
              }}
            >
              {file.staged ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
            </CompactIconButton>
          )}
          {handleDiscard && (
            <CompactIconButton
              tooltip="Discard changes"
              onClick={handleDiscard}
            >
              <ArrowCounterClockwiseIcon size={12} />
            </CompactIconButton>
          )}

          <DropdownMenu.Root
            open={isDropdownOpen}
            onOpenChange={setIsDropdownOpen}
          >
            <Tooltip content="Open file">
              <DropdownMenu.Trigger>
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={(e) => e.stopPropagation()}
                  className="h-[18px] w-[18px] shrink-0 p-0"
                >
                  <FilePlus size={12} weight="regular" />
                </IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Content size="1" align="end">
              {detectedApps
                .filter(
                  (app) => app.type !== "terminal" && app.type !== "git-client",
                )
                .map((app) => (
                  <DropdownMenu.Item
                    key={app.id}
                    onSelect={() => handleOpenWith(app.id)}
                  >
                    <Flex align="center" gap="2">
                      {app.icon ? (
                        <img
                          src={app.icon}
                          width={16}
                          height={16}
                          alt=""
                          className="rounded-[2px]"
                        />
                      ) : (
                        <CodeIcon size={16} weight="regular" />
                      )}
                      <Text className="text-[13px]">{app.name}</Text>
                    </Flex>
                  </DropdownMenu.Item>
                ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={handleCopyPath}>
                <Flex align="center" gap="2">
                  <CopyIcon size={16} weight="regular" />
                  <Text className="text-[13px]">Copy Path</Text>
                </Flex>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      )}

      <Badge
        size="1"
        color={indicator.color}
        className="shrink-0 px-[4px] py-0 text-[10px]"
      >
        {indicator.label}
      </Badge>
    </>
  );

  return (
    <Tooltip content={tooltipContent} side="top" delayDuration={500}>
      <TreeFileRow
        fileName={fileName}
        depth={depth}
        isActive={isActive}
        onClick={handleClick}
        onDoubleClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        trailing={trailing}
      />
    </Tooltip>
  );
}

function CloudChangesPanel({ taskId, task }: ChangesPanelProps) {
  const {
    prUrl,
    effectiveBranch,
    isRunActive,
    changedFiles,
    isLoading,
    hasError,
  } = useCloudChangedFiles(taskId, task);

  const activeFilePath = useReviewNavigationStore(
    (s) => s.activeFilePaths[taskId] ?? null,
  );

  const effectiveFiles = changedFiles;

  const renderFile = useCallback(
    (file: ChangedFile, depth: number) => (
      <ChangedFileItem
        key={file.path}
        file={file}
        taskId={taskId}
        isActive={activeFilePath === file.path}
        depth={depth}
      />
    ),
    [taskId, activeFilePath],
  );

  // No branch/PR yet and run is active — show waiting state
  if (!prUrl && !effectiveBranch && effectiveFiles.length === 0) {
    if (isRunActive) {
      return (
        <PanelMessage detail="Changes will appear once the agent starts writing code">
          <Flex align="center" gap="2">
            <Spinner size="1" />
            <Text className="text-sm">Waiting for changes...</Text>
          </Flex>
        </PanelMessage>
      );
    }
    return <PanelMessage>No file changes yet</PanelMessage>;
  }

  if (isLoading && effectiveFiles.length === 0) {
    return <PanelMessage>Loading changes...</PanelMessage>;
  }

  if (effectiveFiles.length === 0) {
    if (hasError && prUrl) {
      return (
        <PanelMessage>
          <Flex direction="column" align="center" gap="2">
            <Text>Could not load file changes</Text>
            <Button size="1" variant="soft" asChild>
              <a href={prUrl} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </Button>
          </Flex>
        </PanelMessage>
      );
    }
    if (prUrl) {
      return <PanelMessage>No file changes in pull request</PanelMessage>;
    }
    if (isRunActive) {
      return (
        <PanelMessage detail="Changes will appear as the agent modifies files">
          <Flex align="center" gap="2">
            <Spinner size="1" />
            <Text className="text-sm">Waiting for changes...</Text>
          </Flex>
        </PanelMessage>
      );
    }
    return <PanelMessage>No file changes yet</PanelMessage>;
  }

  return (
    <Box height="100%" overflowY="auto" py="2" id="changes-panel-cloud">
      <Flex direction="column">
        <ChangesTreeView files={effectiveFiles} renderFile={renderFile} />
        {isRunActive && (
          <Flex align="center" gap="2" px="3" py="2">
            <Spinner size="1" />
            <Text color="gray" className="text-[13px]">
              Agent is still running...
            </Text>
          </Flex>
        )}
      </Flex>
    </Box>
  );
}

export function ChangesPanel({ taskId, task }: ChangesPanelProps) {
  const isCloud = useIsCloudTask(taskId);

  if (isCloud) {
    return <CloudChangesPanel taskId={taskId} task={task} />;
  }

  return <LocalChangesPanel taskId={taskId} task={task} />;
}

function LocalChangesPanel({ taskId, task }: ChangesPanelProps) {
  const { effectiveSource, prUrl, linkedBranch } =
    useEffectiveDiffSource(taskId);
  const repoPath = useCwd(taskId);

  if (effectiveSource === "branch") {
    return (
      <BranchChangesPanel
        taskId={taskId}
        repoPath={repoPath}
        branch={linkedBranch}
      />
    );
  }

  if (effectiveSource === "pr") {
    return <PrChangesPanel taskId={taskId} prUrl={prUrl} />;
  }

  return <LocalWorkingTreeChangesPanel taskId={taskId} task={task} />;
}

function LocalWorkingTreeChangesPanel({
  taskId,
  task: _task,
}: ChangesPanelProps) {
  const workspace = useWorkspace(taskId);
  const repoPath = useCwd(taskId);
  const queryClient = useQueryClient();
  const activeFilePath = useReviewNavigationStore(
    (s) => s.activeFilePaths[taskId] ?? null,
  );
  const { changedFiles, changesLoading: isLoading } = useGitQueries(repoPath);

  const { stagedFiles, unstagedFiles } = useMemo(
    () => partitionByStaged(changedFiles),
    [changedFiles],
  );

  const hasStagedFiles = stagedFiles.length > 0;

  const handleStageToggle = useCallback(
    async (file: ChangedFile) => {
      if (!repoPath) return;
      const paths = [file.originalPath ?? file.path];
      const endpoint = file.staged
        ? trpcClient.git.unstageFiles
        : trpcClient.git.stageFiles;
      try {
        const result = await endpoint.mutate({
          directoryPath: repoPath,
          paths,
        });
        updateGitCacheFromSnapshot(queryClient, repoPath, result);
        invalidateGitWorkingTreeQueries(repoPath);
      } catch (error) {
        log.error("Failed to toggle staging", { file: file.path, error });
      }
    },
    [repoPath, queryClient],
  );

  const renderLocalFile = useCallback(
    (file: ChangedFile, depth: number) => {
      const key = makeFileKey(file.staged, file.path);
      return (
        <ChangedFileItem
          key={key}
          file={file}
          taskId={taskId}
          repoPath={repoPath}
          isActive={activeFilePath === key}
          mainRepoPath={workspace?.folderPath}
          onStageToggle={handleStageToggle}
          depth={depth}
        />
      );
    },
    [
      taskId,
      repoPath,
      activeFilePath,
      workspace?.folderPath,
      handleStageToggle,
    ],
  );

  if (!repoPath) {
    return <PanelMessage>No repository path available</PanelMessage>;
  }

  if (isLoading) {
    return <PanelMessage>Loading changes...</PanelMessage>;
  }

  const hasChanges = changedFiles.length > 0;

  if (!hasChanges) {
    return (
      <Box height="100%" overflowY="auto" py="2">
        <Flex direction="column" height="100%">
          <PanelMessage>No file changes yet</PanelMessage>
        </Flex>
      </Box>
    );
  }

  const fileGroups: { files: ChangedFile[]; header?: string }[] = hasStagedFiles
    ? [
        { files: stagedFiles, header: "Staged Changes" },
        { files: unstagedFiles, header: "Changes" },
      ]
    : [{ files: changedFiles }];

  return (
    <Box height="100%" overflowY="auto" py="2" id="changes-panel-local">
      <Flex direction="column">
        {fileGroups.map(({ files, header }) => (
          <Fragment key={header ?? "all"}>
            {header && (
              <Flex px="2" py="1" className="select-none">
                <Text color="gray" className="font-medium text-[13px]">
                  {header} ({files.length})
                </Text>
              </Flex>
            )}
            <ChangesTreeView files={files} renderFile={renderLocalFile} />
          </Fragment>
        ))}
      </Flex>
    </Box>
  );
}

interface RemoteChangesListProps {
  taskId: string;
  files: ChangedFile[];
  isLoading: boolean;
  emptyMessage: string;
  panelId: string;
}

function RemoteChangesList({
  taskId,
  files,
  isLoading,
  emptyMessage,
  panelId,
}: RemoteChangesListProps) {
  const activeFilePath = useReviewNavigationStore(
    (s) => s.activeFilePaths[taskId] ?? null,
  );

  const renderFile = useCallback(
    (file: ChangedFile, depth: number) => {
      const key = makeFileKey(file.staged, file.path);
      return (
        <ChangedFileItem
          key={key}
          file={file}
          taskId={taskId}
          isActive={activeFilePath === key}
          depth={depth}
        />
      );
    },
    [taskId, activeFilePath],
  );

  if (isLoading && files.length === 0) {
    return <PanelMessage>Loading changes...</PanelMessage>;
  }

  if (files.length === 0) {
    return <PanelMessage>{emptyMessage}</PanelMessage>;
  }

  return (
    <Box height="100%" overflowY="auto" py="2" id={panelId}>
      <Flex direction="column">
        <ChangesTreeView files={files} renderFile={renderFile} />
      </Flex>
    </Box>
  );
}

function BranchChangesPanel({
  taskId,
  repoPath,
  branch,
}: {
  taskId: string;
  repoPath: string | undefined;
  branch: string | null;
}) {
  const { data: files = [], isLoading } = useLocalBranchChangedFiles(
    repoPath ?? null,
    branch,
  );

  if (!repoPath || !branch) {
    return <PanelMessage>No branch selected</PanelMessage>;
  }

  return (
    <RemoteChangesList
      taskId={taskId}
      files={files}
      isLoading={isLoading}
      emptyMessage="No file changes in branch"
      panelId="changes-panel-branch"
    />
  );
}

function PrChangesPanel({
  taskId,
  prUrl,
}: {
  taskId: string;
  prUrl: string | null;
}) {
  const { data: files = [], isLoading } = usePrChangedFiles(prUrl);

  if (!prUrl) {
    return <PanelMessage>No pull request linked</PanelMessage>;
  }

  return (
    <RemoteChangesList
      taskId={taskId}
      files={files}
      isLoading={isLoading}
      emptyMessage="No file changes in pull request"
      panelId="changes-panel-pr"
    />
  );
}
