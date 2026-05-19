import {
  invalidateGitBranchQueries,
  invalidateGitWorkingTreeQueries,
} from "@features/git-interaction/utils/gitCacheKeys";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { toRelativePath } from "@utils/path";
import { useEffect } from "react";

const log = logger.scope("file-watcher");

export function useFileWatcher(repoPath: string | null, taskId?: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const closeTabsForFile = usePanelLayoutStore((s) => s.closeTabsForFile);

  useEffect(() => {
    if (!repoPath) return;

    trpcClient.fileWatcher.start.mutate({ repoPath }).catch((error) => {
      log.error("Failed to start file watcher:", error);
    });

    return () => {
      trpcClient.fileWatcher.stop.mutate({ repoPath });
    };
  }, [repoPath]);

  useSubscription(
    trpc.fileWatcher.onFileChanged.subscriptionOptions(undefined, {
      enabled: !!repoPath,
      onData: ({ repoPath: rp, filePath }) => {
        if (rp !== repoPath) return;
        const relativePath = toRelativePath(filePath, repoPath);
        queryClient.invalidateQueries(
          trpc.fs.readRepoFile.queryFilter({
            repoPath,
            filePath: relativePath,
          }),
        );
        queryClient.invalidateQueries(
          trpc.fs.readRepoFileBounded.queryFilter({
            repoPath,
            filePath: relativePath,
          }),
        );
      },
    }),
  );

  useSubscription(
    trpc.fileWatcher.onFileDeleted.subscriptionOptions(undefined, {
      enabled: !!repoPath,
      onData: ({ repoPath: rp, filePath }) => {
        if (rp !== repoPath) return;
        if (!taskId) return;
        const relativePath = toRelativePath(filePath, repoPath);
        closeTabsForFile(taskId, relativePath);
      },
    }),
  );

  useSubscription(
    trpc.fileWatcher.onGitStateChanged.subscriptionOptions(undefined, {
      enabled: !!repoPath,
      onData: ({ repoPath: rp }) => {
        if (rp !== repoPath) return;
        invalidateGitBranchQueries(repoPath);
      },
    }),
  );

  useSubscription(
    trpc.fileWatcher.onWorkingTreeChanged.subscriptionOptions(undefined, {
      enabled: !!repoPath,
      onData: ({ repoPath: rp }) => {
        if (rp !== repoPath) return;
        invalidateGitWorkingTreeQueries(repoPath);
      },
    }),
  );
}
