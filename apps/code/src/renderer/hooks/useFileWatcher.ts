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
import { useCallback, useEffect, useRef } from "react";

const log = logger.scope("file-watcher");

const GIT_INVALIDATION_DEBOUNCE_MS = 500;

export function useFileWatcher(repoPath: string | null, taskId?: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const closeTabsForFile = usePanelLayoutStore((s) => s.closeTabsForFile);

  const gitInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const scheduleGitWorkingTreeInvalidation = useCallback((rp: string) => {
    if (gitInvalidateTimerRef.current) {
      clearTimeout(gitInvalidateTimerRef.current);
    }
    gitInvalidateTimerRef.current = setTimeout(() => {
      gitInvalidateTimerRef.current = null;
      invalidateGitWorkingTreeQueries(rp);
    }, GIT_INVALIDATION_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (gitInvalidateTimerRef.current) {
        clearTimeout(gitInvalidateTimerRef.current);
        gitInvalidateTimerRef.current = null;
      }
    };
  }, []);

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
        scheduleGitWorkingTreeInvalidation(repoPath);
      },
    }),
  );

  useSubscription(
    trpc.fileWatcher.onFileDeleted.subscriptionOptions(undefined, {
      enabled: !!repoPath,
      onData: ({ repoPath: rp, filePath }) => {
        if (rp !== repoPath) return;
        scheduleGitWorkingTreeInvalidation(repoPath);
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
        scheduleGitWorkingTreeInvalidation(repoPath);
      },
    }),
  );
}
