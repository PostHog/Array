import { trpc } from "@renderer/trpc";
import { queryClient } from "@utils/queryClient";

export function invalidateGitWorkingTreeQueries(repoPath: string) {
  const input = { directoryPath: repoPath };
  queryClient.invalidateQueries(
    trpc.git.getChangedFilesHead.queryFilter(input),
  );
  queryClient.invalidateQueries(trpc.git.getDiffStats.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getDiffCached.pathFilter());
  queryClient.invalidateQueries(trpc.git.getDiffUnstaged.pathFilter());
}

export function invalidateGitBranchQueries(repoPath: string) {
  const input = { directoryPath: repoPath };
  queryClient.invalidateQueries(trpc.git.getCurrentBranch.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getAllBranches.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getGitBusyState.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getGitSyncStatus.queryFilter(input));
  queryClient.invalidateQueries(
    trpc.git.getChangedFilesHead.queryFilter(input),
  );
  queryClient.invalidateQueries(trpc.git.getDiffStats.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getLatestCommit.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getPrStatus.queryFilter(input));
  queryClient.invalidateQueries(trpc.git.getFileAtHead.pathFilter());
  queryClient.invalidateQueries(
    trpc.git.getLocalBranchChangedFiles.pathFilter(),
  );
}

export function clearGitReviewQueries() {
  queryClient.removeQueries(trpc.git.getDiffCached.pathFilter());
  queryClient.removeQueries(trpc.git.getDiffUnstaged.pathFilter());
  queryClient.removeQueries(trpc.git.getFileAtHead.pathFilter());
  queryClient.removeQueries(trpc.fs.readRepoFile.pathFilter());
  queryClient.removeQueries(trpc.fs.readRepoFiles.pathFilter());
  queryClient.removeQueries(trpc.fs.readRepoFileBounded.pathFilter());
  queryClient.removeQueries(trpc.fs.readRepoFilesBounded.pathFilter());
  queryClient.removeQueries(trpc.git.getLocalBranchChangedFiles.pathFilter());
  queryClient.removeQueries(trpc.git.getPrChangedFiles.pathFilter());
  queryClient.removeQueries(trpc.git.getPrDetailsByUrl.pathFilter());
  queryClient.removeQueries(trpc.git.getPrReviewComments.pathFilter());
}
