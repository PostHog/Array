import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
import { foldersApi } from "@features/folders/hooks/useFolders";
import { useEnsureWorkspace } from "@features/workspace/hooks/useWorkspace";
import { Folder, Warning } from "@phosphor-icons/react";
import { Box, Button, Code, Flex, Spinner, Text } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { logger } from "@utils/logger";
import { getTaskRepository } from "@utils/repository";
import { toast } from "@utils/toast";
import { useCallback, useState } from "react";

const log = logger.scope("workspace-setup-prompt");

interface WorkspaceSetupPromptProps {
  taskId: string;
  task: Task;
}

export function WorkspaceSetupPrompt({
  taskId,
  task,
}: WorkspaceSetupPromptProps) {
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);
  const repository = getTaskRepository(task);
  const { ensureWorkspace } = useEnsureWorkspace();

  const proceedWithSetup = useCallback(
    async (path: string) => {
      setPendingPath(null);
      setDetectedRepo(null);
      setSelectedPath(path);
      setIsSettingUp(true);

      try {
        await foldersApi.addFolder(path);
        await ensureWorkspace(taskId, path, "worktree");
        log.info("Workspace setup complete", { taskId, path });
      } catch (error) {
        log.error("Failed to set up workspace", { error });
        toast.error("Failed to set up workspace. Please try again.");
      } finally {
        setSelectedPath("");
        setIsSettingUp(false);
      }
    },
    [taskId, ensureWorkspace],
  );

  const handleFolderSelect = useCallback(
    async (path: string) => {
      if (repository) {
        let detected = null;
        try {
          detected = await trpcClient.git.detectRepo.query({
            directoryPath: path,
          });
        } catch (error) {
          log.warn("Failed to detect repo for mismatch check", {
            error,
            path,
          });
        }

        if (detected) {
          const detectedFullName = `${detected.organization}/${detected.repository}`;
          if (detectedFullName.toLowerCase() !== repository.toLowerCase()) {
            setPendingPath(path);
            setDetectedRepo(detectedFullName);
            return;
          }
        }
      }

      await proceedWithSetup(path);
    },
    [repository, proceedWithSetup],
  );

  const handleConfirm = useCallback(async () => {
    if (pendingPath) {
      await proceedWithSetup(pendingPath);
    }
  }, [pendingPath, proceedWithSetup]);

  const handleBack = useCallback(() => {
    setPendingPath(null);
    setDetectedRepo(null);
  }, []);

  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="3"
      className="absolute inset-0"
    >
      {isSettingUp ? (
        <>
          <Spinner size="3" />
          <Text className="text-gray-11 text-sm">Setting up workspace...</Text>
        </>
      ) : pendingPath ? (
        <>
          <Warning size={32} weight="duotone" className="text-amber-9" />
          <Text className="font-medium text-base text-gray-12">
            Repository mismatch
          </Text>
          <Text align="center" className="max-w-xs text-gray-11 text-sm">
            This task is linked to <Code>{repository}</Code> but the selected
            folder belongs to <Code>{detectedRepo}</Code>.
          </Text>
          <Flex gap="2" mt="1">
            <Button variant="soft" color="gray" onClick={handleBack}>
              Go back
            </Button>
            <Button variant="solid" onClick={handleConfirm}>
              Continue anyway
            </Button>
          </Flex>
        </>
      ) : (
        <>
          <Folder size={32} weight="duotone" className="text-gray-9" />
          <Text className="font-medium text-base text-gray-12">
            Select a repository folder
          </Text>
          {repository && (
            <Text className="text-gray-11 text-sm">
              This task is linked to <Code>{repository}</Code>
            </Text>
          )}
          <Box mt="1">
            <FolderPicker
              value={selectedPath}
              onChange={handleFolderSelect}
              placeholder="Select folder..."
              size="2"
            />
          </Box>
        </>
      )}
    </Flex>
  );
}
