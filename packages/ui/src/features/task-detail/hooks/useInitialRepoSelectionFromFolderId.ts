import { parseRepository, type WorkspaceMode } from "@posthog/shared";
import { useEffect, useRef } from "react";
import type { RegisteredFolder } from "../../folders/types";
import type { LocalWorkspaceMode } from "../../settings/settingsStore";

export interface ReposReadyInput {
  /** True while the integrations + per-installation repo queries are in flight. */
  isLoadingRepos: boolean;
  /** Number of connectable `owner/repo` slugs currently known. */
  repositoriesCount: number;
  /** Whether the user has any connected GitHub integration at all. */
  hasGithubIntegration: boolean;
}

/**
 * Whether the cloud-repo list has *settled*, i.e. it's safe to conclude a folder is or
 * isn't cloud-capable. Distinguishes "settled empty because the user has no GitHub
 * integration" (ready) from "transiently empty while per-installation repo queries are
 * still producing data" (not ready). The latter window is real: `isLoadingRepos` can flip
 * false before `repositories` populates (see the validation effect in TaskInput), so
 * `!isLoadingRepos` alone would mis-judge a cloud-capable repo during that gap.
 */
export function areReposReady({
  isLoadingRepos,
  repositoriesCount,
  hasGithubIntegration,
}: ReposReadyInput): boolean {
  if (isLoadingRepos) return false;
  return repositoriesCount > 0 || !hasGithubIntegration;
}

export interface RepoSelectionInput {
  folder: RegisteredFolder;
  /** Lower-cased `owner/repo` slugs the user can use in cloud mode. */
  repositories: string[];
  /** Whether the integrations list has finished loading (gate the mode switch). */
  reposLoaded: boolean;
  currentMode: WorkspaceMode;
  /** Mode to fall back to when leaving cloud (local or worktree). */
  lastUsedLocalMode: LocalWorkspaceMode;
}

export interface RepoSelection {
  /** Local directory to select (always the folder's path). */
  directory: string;
  /** Cloud `owner/repo` slug to select, or undefined to leave the cloud pick as-is. */
  cloudRepository?: string;
  /** Workspace mode to switch to, or undefined to keep the current mode. */
  nextMode?: LocalWorkspaceMode;
}

/**
 * Pure resolver: given the folder a user picked (e.g. via the sidebar "+"), decide
 * what to select in both the local-directory and cloud-repo pickers, and whether the
 * workspace mode must change.
 *
 * Rules (see plan): prefill both selectors; keep the current mode when it can represent
 * the repo; only switch when it can't, i.e. you're in cloud but the repo has no cloud
 * counterpart (no remote slug, or the slug isn't a connected integration), in which case
 * fall back to the last-used local mode.
 */
export function resolveRepoSelectionForFolder({
  folder,
  repositories,
  reposLoaded,
  currentMode,
  lastUsedLocalMode,
}: RepoSelectionInput): RepoSelection {
  const slug = folder.remoteUrl?.toLowerCase();
  // A folder is cloud-capable only when its remote is a real `owner/repo` (guards against
  // legacy single-segment values) AND that repo is one of the user's connected integrations.
  const cloudRepository =
    slug && parseRepository(slug) !== null && repositories.includes(slug)
      ? slug
      : undefined;

  const selection: RepoSelection = {
    directory: folder.path,
    cloudRepository,
  };

  // Only decide the mode once the integrations list has loaded, so we never switch out
  // of cloud while the repo list is still in flight (it would look "not cloud-capable").
  if (reposLoaded && currentMode === "cloud" && !cloudRepository) {
    selection.nextMode = lastUsedLocalMode;
  }

  return selection;
}

export interface UseInitialRepoSelectionParams {
  folderId: string | undefined;
  folders: RegisteredFolder[];
  /** Lower-cased `owner/repo` slugs the user can use in cloud mode. */
  repositories: string[];
  /** Whether the integrations list has finished loading (gate the mode switch). */
  reposLoaded: boolean;
  currentMode: WorkspaceMode;
  /** Mode to fall back to when leaving cloud (local or worktree). */
  lastUsedLocalMode: LocalWorkspaceMode;
  setSelectedDirectory: (path: string) => void;
  setSelectedRepository: (repo: string) => void;
  /** Switches the workspace mode (without persisting it as the user's preference). */
  switchWorkspaceMode: (mode: WorkspaceMode) => void;
}

/**
 * Applies {@link resolveRepoSelectionForFolder} to the live pickers when a `folderId`
 * prefill arrives, syncing both the local directory and the cloud repo and switching
 * mode when required. Runs once per `folderId` (guarded by refs) so it never clobbers a
 * repo/mode the user changed afterward, and re-runs when `folderId` changes.
 *
 * The dependency on `folders` / `repositories` lets the sync still fire when those lists
 * load after the initial mount.
 */
export function useInitialRepoSelectionFromFolderId({
  folderId,
  folders,
  repositories,
  reposLoaded,
  currentMode,
  lastUsedLocalMode,
  setSelectedDirectory,
  setSelectedRepository,
  switchWorkspaceMode,
}: UseInitialRepoSelectionParams) {
  // Two guards: the local directory syncs immediately (once the folder loads), while the
  // cloud repo + mode decision waits for the integrations list, so it isn't marked "done"
  // before it can tell whether the repo is cloud-capable.
  const dirInitRef = useRef<string | undefined>(undefined);
  const repoModeInitRef = useRef<string | undefined>(undefined);
  // Read the current mode through a ref so it doesn't retrigger the effect (which would
  // re-run the once-per-folderId logic after we change the mode ourselves).
  const currentModeRef = useRef(currentMode);
  currentModeRef.current = currentMode;

  useEffect(() => {
    if (!folderId) {
      dirInitRef.current = undefined;
      repoModeInitRef.current = undefined;
      return;
    }
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    const selection = resolveRepoSelectionForFolder({
      folder,
      repositories,
      reposLoaded,
      currentMode: currentModeRef.current,
      lastUsedLocalMode,
    });

    if (dirInitRef.current !== folderId) {
      setSelectedDirectory(selection.directory);
      dirInitRef.current = folderId;
    }

    // Defer the cloud/mode decision until the integrations list has loaded.
    if (reposLoaded && repoModeInitRef.current !== folderId) {
      if (selection.cloudRepository) {
        setSelectedRepository(selection.cloudRepository);
      }
      if (selection.nextMode && selection.nextMode !== currentModeRef.current) {
        switchWorkspaceMode(selection.nextMode);
      }
      repoModeInitRef.current = folderId;
    }
  }, [
    folderId,
    folders,
    repositories,
    reposLoaded,
    lastUsedLocalMode,
    setSelectedDirectory,
    setSelectedRepository,
    switchWorkspaceMode,
  ]);
}
