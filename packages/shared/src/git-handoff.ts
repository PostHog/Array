export interface HandoffLocalGitState {
  head: string | null;
  branch: string | null;
  upstreamHead: string | null;
  upstreamRemote: string | null;
  upstreamMergeRef: string | null;
}

export interface GitHandoffCheckpoint {
  checkpointId: string;
  commit: string;
  checkpointRef: string;
  headRef?: string;
  head: string | null;
  branch: string | null;
  indexTree: string;
  worktreeTree: string;
  timestamp: string;
  upstreamRemote: string | null;
  upstreamMergeRef: string | null;
  remoteUrl: string | null;
  /**
   * The exact commit the differential pack was built against (negative ref). The
   * receiver must have this commit's objects to unpack/apply. Recorded so the apply
   * side can fetch this precise SHA — the receiver's clone tip may have diverged from
   * it, but it's typically still reachable on the remote. Null = self-contained pack.
   */
  packBaseline?: string | null;
}
