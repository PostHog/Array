/**
 * Coarse host capabilities the shared UI branches on. Kept deliberately small:
 * a capability belongs here only when the UI must render differently by host
 * (not merely bind a different adapter). Hosts bind a constant value.
 */
export interface HostCapabilities {
  /**
   * Whether the host can access the local filesystem — local repository
   * folders, git worktrees, and a terminal. Desktop (Electron) has it; the
   * cloud-only browser host does not, so the UI falls back to remote
   * (connected-GitHub-org) repositories and cloud workspaces.
   */
  readonly localWorkspaces: boolean;
  /**
   * Whether the host can embed a live browser view inside the app window
   * (the Product View surface). Desktop (Electron) attaches a
   * `WebContentsView`; the web host cannot embed arbitrary cross-origin
   * sites, so the UI hides the Product entry points there.
   */
  readonly embeddedBrowser: boolean;
}

export const HOST_CAPABILITIES = Symbol.for(
  "posthog.platform.hostCapabilities",
);
