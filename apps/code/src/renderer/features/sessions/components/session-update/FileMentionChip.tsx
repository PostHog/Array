import { FileIcon } from "@components/ui/FileIcon";
import { usePanelLayoutStore } from "@features/panels";
import { useSessionTaskId } from "@features/sessions/hooks/useSessionTaskId";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { Flex, Text } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { handleExternalAppAction } from "@utils/handleExternalAppAction";
import { isAbsolutePath } from "@utils/path";
import { memo, useCallback } from "react";
import { getFilename } from "./toolCallUtils";

interface FileMentionChipProps {
  filePath: string;
}

function toRelativePath(absolutePath: string, repoPath: string | null): string {
  if (!absolutePath) return absolutePath;
  if (!repoPath) return absolutePath;
  const normalizedRepo = repoPath.endsWith("/")
    ? repoPath.slice(0, -1)
    : repoPath;
  if (absolutePath.startsWith(`${normalizedRepo}/`)) {
    return absolutePath.slice(normalizedRepo.length + 1);
  }
  if (absolutePath === normalizedRepo) {
    return "";
  }
  return absolutePath;
}

export const FileMentionChip = memo(function FileMentionChip({
  filePath,
}: FileMentionChipProps) {
  const taskId = useSessionTaskId();
  const repoPath = useCwd(taskId ?? "");
  const workspace = useWorkspace(taskId ?? undefined);
  const openFileInSplit = usePanelLayoutStore((s) => s.openFileInSplit);

  const filename = getFilename(filePath);
  const mainRepoPath = workspace?.folderPath;

  const handleClick = useCallback(() => {
    if (!taskId) return;
    const relativePath = toRelativePath(filePath, repoPath ?? null);
    openFileInSplit(taskId, relativePath, true);
  }, [taskId, filePath, repoPath, openFileInSplit]);

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      const absolutePath = isAbsolutePath(filePath)
        ? filePath
        : repoPath
          ? `${repoPath}/${filePath}`
          : filePath;

      const result = await trpcClient.contextMenu.showFileContextMenu.mutate({
        filePath: absolutePath,
        showCollapseAll: false,
      });

      if (!result.action) return;

      if (result.action.type === "external-app") {
        await handleExternalAppAction(
          result.action.action,
          absolutePath,
          filename,
          { workspace, mainRepoPath },
        );
      }
    },
    [filePath, repoPath, filename, workspace, mainRepoPath],
  );

  const isClickable = !!taskId;

  const relativePath = toRelativePath(filePath, repoPath ?? null);
  const directory =
    relativePath && relativePath !== filename
      ? relativePath.replace(`/${filename}`, "")
      : null;

  return (
    <Flex
      align="center"
      gap="1"
      asChild
      onClick={isClickable ? handleClick : undefined}
      onContextMenu={handleContextMenu}
      className={`relative top-[1px] inline-flex min-w-0 max-w-full ${isClickable ? "cursor-pointer hover:underline" : ""}`}
    >
      <Text className="text-[13px]">
        <FileIcon filename={filename} size={12} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden font-mono text-[13px] leading-none">
          <span className="flex-shrink-0 whitespace-nowrap font-semibold">
            {filename}
          </span>
          {directory && (
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-gray-9">
              {directory}
            </span>
          )}
        </span>
      </Text>
    </Flex>
  );
});
