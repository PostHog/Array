import { useEffect, useRef } from "react";
import type { RegisteredFolder } from "../../folders/types";

/**
 * Syncs `selectedDirectory` to the path of `folders[view.folderId]` once per
 * folderId. The dependency on `folders` is required so the sync still fires
 * when the folder list hasn't loaded yet on initial mount, but we must not
 * re-sync on later `folders` refetches (e.g. after `addFolder`) — that would
 * clobber a folder the user just picked via the file dialog.
 */
export function useInitialDirectoryFromFolderId(
  folderId: string | undefined,
  folders: RegisteredFolder[],
  setSelectedDirectory: (path: string) => void,
) {
  const lastInitializedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!folderId) {
      lastInitializedRef.current = undefined;
      return;
    }
    if (lastInitializedRef.current === folderId) return;
    const folder = folders.find((f) => f.id === folderId);
    if (folder) {
      setSelectedDirectory(folder.path);
      lastInitializedRef.current = folderId;
    }
  }, [folderId, folders, setSelectedDirectory]);
}
