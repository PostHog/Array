import type { RegisteredFolder } from "@main/services/folders/schemas";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInitialDirectoryFromFolderId } from "./useInitialDirectoryFromFolderId";

const folder = (id: string, path: string): RegisteredFolder => ({
  id,
  path,
  name: id,
  remoteUrl: null,
  lastAccessed: "2026-05-21T00:00:00Z",
  createdAt: "2026-05-21T00:00:00Z",
});

describe("useInitialDirectoryFromFolderId", () => {
  it("syncs the directory to the folder matching folderId on first render", () => {
    const setSelectedDirectory = vi.fn();
    renderHook(() =>
      useInitialDirectoryFromFolderId(
        "a",
        [folder("a", "/repos/a")],
        setSelectedDirectory,
      ),
    );
    expect(setSelectedDirectory).toHaveBeenCalledExactlyOnceWith("/repos/a");
  });

  it("waits for folders to load before syncing", () => {
    const setSelectedDirectory = vi.fn();
    const { rerender } = renderHook(
      ({ folders }: { folders: RegisteredFolder[] }) =>
        useInitialDirectoryFromFolderId("a", folders, setSelectedDirectory),
      { initialProps: { folders: [] as RegisteredFolder[] } },
    );
    expect(setSelectedDirectory).not.toHaveBeenCalled();

    rerender({ folders: [folder("a", "/repos/a")] });
    expect(setSelectedDirectory).toHaveBeenCalledExactlyOnceWith("/repos/a");
  });

  it("does not re-sync when folders changes but folderId stays the same", () => {
    const setSelectedDirectory = vi.fn();
    const { rerender } = renderHook(
      ({ folders }: { folders: RegisteredFolder[] }) =>
        useInitialDirectoryFromFolderId("a", folders, setSelectedDirectory),
      { initialProps: { folders: [folder("a", "/repos/a")] } },
    );
    expect(setSelectedDirectory).toHaveBeenCalledExactlyOnceWith("/repos/a");

    // Simulate adding a folder (e.g. after the user picks one via "Open
    // folder..."). The folders list changes but the user's pick must not be
    // clobbered by re-syncing from the original folderId.
    rerender({
      folders: [folder("a", "/repos/a"), folder("b", "/repos/picked")],
    });
    expect(setSelectedDirectory).toHaveBeenCalledTimes(1);
  });

  it("re-syncs when folderId changes", () => {
    const setSelectedDirectory = vi.fn();
    const folders = [folder("a", "/repos/a"), folder("b", "/repos/b")];
    const { rerender } = renderHook(
      ({ folderId }: { folderId: string }) =>
        useInitialDirectoryFromFolderId(
          folderId,
          folders,
          setSelectedDirectory,
        ),
      { initialProps: { folderId: "a" } },
    );
    expect(setSelectedDirectory).toHaveBeenLastCalledWith("/repos/a");

    rerender({ folderId: "b" });
    expect(setSelectedDirectory).toHaveBeenLastCalledWith("/repos/b");
    expect(setSelectedDirectory).toHaveBeenCalledTimes(2);
  });

  it("does nothing when folderId is undefined", () => {
    const setSelectedDirectory = vi.fn();
    renderHook(() =>
      useInitialDirectoryFromFolderId(
        undefined,
        [folder("a", "/repos/a")],
        setSelectedDirectory,
      ),
    );
    expect(setSelectedDirectory).not.toHaveBeenCalled();
  });
});
