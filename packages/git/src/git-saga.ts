import { Saga } from "@posthog/shared";
import type { GitClient } from "./client";
import { getGitOperationManager } from "./operation-manager";

export interface GitSagaInput {
  baseDir: string;
  signal?: AbortSignal;
  /**
   * Extra env vars merged on top of the clean env when spawning the git
   * subprocess. Used to pass through SessionStart-hook env so UI-triggered
   * commits see the same `SSH_AUTH_SOCK` (etc.) the agent does.
   */
  env?: Record<string, string>;
}

export abstract class GitSaga<
  TInput extends GitSagaInput,
  TOutput,
> extends Saga<TInput, TOutput> {
  private _git: GitClient | null = null;

  /**
   * When true, the saga runs on the shared/concurrent path (`executeRead`) instead
   * of taking the per-repo EXCLUSIVE write lock (`executeWrite`).
   *
   * Only for sagas that are non-destructive to the real index and working tree —
   * i.e. they touch a throwaway temp index (`GIT_INDEX_FILE`) and only ever create
   * their OWN uniquely-named ref + content-addressed objects. Checkpoint capture is
   * the case: it must never queue behind, or block, an exclusive operation
   * (restore/handoff), so a slow snapshot on a large repo can't stall a user's
   * restore. A concurrent snapshot taken mid-restore is harmless — that turn is
   * being superseded — and `GIT_OPTIONAL_LOCKS=0` (set by executeRead) keeps its
   * `write-tree` from ever touching `.git/index.lock`.
   */
  protected readonly runsConcurrently: boolean = false;

  protected get git(): GitClient {
    if (!this._git) {
      throw new Error("git client accessed before execute() was called");
    }
    return this._git;
  }

  protected async execute(input: TInput): Promise<TOutput> {
    const manager = getGitOperationManager();
    const run = (git: GitClient) => {
      this._git = git;
      return this.executeGitOperations(input);
    };
    const options = { signal: input.signal, env: input.env };

    return this.runsConcurrently
      ? manager.executeRead(input.baseDir, run, options)
      : manager.executeWrite(input.baseDir, run, options);
  }

  protected abstract executeGitOperations(input: TInput): Promise<TOutput>;
}
