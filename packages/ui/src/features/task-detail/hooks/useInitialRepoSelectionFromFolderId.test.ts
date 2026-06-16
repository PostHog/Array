import type { WorkspaceMode } from "@posthog/shared";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RegisteredFolder } from "../../folders/types";
import {
  resolveRepoSelectionForFolder,
  useInitialRepoSelectionFromFolderId,
} from "./useInitialRepoSelectionFromFolderId";

const folder = (
  id: string,
  path: string,
  remoteUrl: string | null = null,
): RegisteredFolder => ({
  id,
  path,
  name: id,
  remoteUrl,
  lastAccessed: "2026-05-21T00:00:00Z",
  createdAt: "2026-05-21T00:00:00Z",
});

describe("resolveRepoSelectionForFolder", () => {
  it("prefills both selectors for a cloud-capable folder and keeps cloud mode", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", "posthog/posthog"),
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
        lastUsedLocalMode: "local",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: "posthog/posthog",
      nextMode: undefined,
    });
  });

  it("prefills the cloud repo while keeping local mode (no switch)", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", "posthog/posthog"),
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "local",
        lastUsedLocalMode: "local",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: "posthog/posthog",
      nextMode: undefined,
    });
  });

  it("lower-cases the remote slug before matching", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", "PostHog/PostHog"),
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
        lastUsedLocalMode: "local",
      }).cloudRepository,
    ).toBe("posthog/posthog");
  });

  it("switches to the last-used local mode for a local-only folder while in cloud", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", null),
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
        lastUsedLocalMode: "worktree",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: undefined,
      nextMode: "worktree",
    });
  });

  it("treats a remote not in the integrations list as not cloud-capable", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", "acme/private"),
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
        lastUsedLocalMode: "local",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: undefined,
      nextMode: "local",
    });
  });

  it("ignores legacy single-segment remote values", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", "posthog"),
        repositories: ["posthog"],
        reposLoaded: true,
        currentMode: "cloud",
        lastUsedLocalMode: "local",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: undefined,
      nextMode: "local",
    });
  });

  it("never switches mode before the integrations list has loaded", () => {
    expect(
      resolveRepoSelectionForFolder({
        folder: folder("a", "/repos/a", null),
        repositories: [],
        reposLoaded: false,
        currentMode: "cloud",
        lastUsedLocalMode: "local",
      }),
    ).toEqual({
      directory: "/repos/a",
      cloudRepository: undefined,
      nextMode: undefined,
    });
  });
});

type HookArgs = {
  folderId: string | undefined;
  folders: RegisteredFolder[];
  repositories: string[];
  reposLoaded: boolean;
  currentMode: WorkspaceMode;
};

function renderRepoSelectionHook(initial: HookArgs) {
  const setSelectedDirectory = vi.fn();
  const setSelectedRepository = vi.fn();
  const setWorkspaceMode = vi.fn();
  const utils = renderHook(
    (props: HookArgs) =>
      useInitialRepoSelectionFromFolderId({
        folderId: props.folderId,
        folders: props.folders,
        repositories: props.repositories,
        reposLoaded: props.reposLoaded,
        currentMode: props.currentMode,
        lastUsedLocalMode: "local",
        setSelectedDirectory,
        setSelectedRepository,
        switchWorkspaceMode: setWorkspaceMode,
      }),
    { initialProps: initial },
  );
  return {
    ...utils,
    setSelectedDirectory,
    setSelectedRepository,
    setWorkspaceMode,
  };
}

describe("useInitialRepoSelectionFromFolderId", () => {
  it("syncs the directory immediately and the cloud repo once repos load", () => {
    const { rerender, setSelectedDirectory, setSelectedRepository } =
      renderRepoSelectionHook({
        folderId: "a",
        folders: [folder("a", "/repos/a", "posthog/posthog")],
        repositories: [],
        reposLoaded: false,
        currentMode: "cloud",
      });
    // Directory applies right away, even before the integrations list loads.
    expect(setSelectedDirectory).toHaveBeenCalledExactlyOnceWith("/repos/a");
    expect(setSelectedRepository).not.toHaveBeenCalled();

    rerender({
      folderId: "a",
      folders: [folder("a", "/repos/a", "posthog/posthog")],
      repositories: ["posthog/posthog"],
      reposLoaded: true,
      currentMode: "cloud",
    });
    expect(setSelectedRepository).toHaveBeenCalledExactlyOnceWith(
      "posthog/posthog",
    );
    // Directory is not re-applied (once per folderId).
    expect(setSelectedDirectory).toHaveBeenCalledTimes(1);
  });

  it("switches to local mode for a local-only folder once repos load", () => {
    const { setWorkspaceMode, setSelectedRepository } = renderRepoSelectionHook(
      {
        folderId: "a",
        folders: [folder("a", "/repos/a", null)],
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
      },
    );
    expect(setWorkspaceMode).toHaveBeenCalledExactlyOnceWith("local");
    expect(setSelectedRepository).not.toHaveBeenCalled();
  });

  it("does not re-sync when folders changes but folderId stays the same", () => {
    const { rerender, setSelectedDirectory } = renderRepoSelectionHook({
      folderId: "a",
      folders: [folder("a", "/repos/a")],
      repositories: [],
      reposLoaded: false,
      currentMode: "local",
    });
    expect(setSelectedDirectory).toHaveBeenCalledExactlyOnceWith("/repos/a");

    // Simulate the user picking a different folder afterward; the changed list must
    // not clobber their pick by re-syncing from the original folderId.
    rerender({
      folderId: "a",
      folders: [folder("a", "/repos/a"), folder("b", "/repos/picked")],
      repositories: [],
      reposLoaded: false,
      currentMode: "local",
    });
    expect(setSelectedDirectory).toHaveBeenCalledTimes(1);
  });

  it("re-syncs when folderId changes", () => {
    const folders = [
      folder("a", "/repos/a", "posthog/a"),
      folder("b", "/repos/b", "posthog/b"),
    ];
    const { rerender, setSelectedDirectory, setSelectedRepository } =
      renderRepoSelectionHook({
        folderId: "a",
        folders,
        repositories: ["posthog/a", "posthog/b"],
        reposLoaded: true,
        currentMode: "cloud",
      });
    expect(setSelectedDirectory).toHaveBeenLastCalledWith("/repos/a");
    expect(setSelectedRepository).toHaveBeenLastCalledWith("posthog/a");

    rerender({
      folderId: "b",
      folders,
      repositories: ["posthog/a", "posthog/b"],
      reposLoaded: true,
      currentMode: "cloud",
    });
    expect(setSelectedDirectory).toHaveBeenLastCalledWith("/repos/b");
    expect(setSelectedRepository).toHaveBeenLastCalledWith("posthog/b");
  });

  it("does nothing when folderId is undefined", () => {
    const { setSelectedDirectory, setSelectedRepository, setWorkspaceMode } =
      renderRepoSelectionHook({
        folderId: undefined,
        folders: [folder("a", "/repos/a", "posthog/posthog")],
        repositories: ["posthog/posthog"],
        reposLoaded: true,
        currentMode: "cloud",
      });
    expect(setSelectedDirectory).not.toHaveBeenCalled();
    expect(setSelectedRepository).not.toHaveBeenCalled();
    expect(setWorkspaceMode).not.toHaveBeenCalled();
  });
});
