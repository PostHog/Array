import { FileIcon } from "@components/ui/FileIcon";
import { CommandKeyHints } from "@features/command/components/CommandKeyHints";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import {
  type FileItem,
  pathToFileItem,
  searchFiles,
  useRepoFiles,
} from "@hooks/useRepoFiles";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
  Dialog,
  DialogContent,
} from "@posthog/quill";
import { useCallback, useMemo, useState } from "react";

interface FilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  repoPath: string | undefined;
}

export function FilePicker({
  open,
  onOpenChange,
  taskId,
  repoPath,
}: FilePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const openFileInSplit = usePanelLayoutStore((state) => state.openFileInSplit);
  const recentFiles = usePanelLayoutStore(
    (state) => state.taskLayouts[taskId]?.recentFiles ?? [],
  );

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      onOpenChange(isOpen);
      if (!isOpen) setSearchQuery("");
    },
    [onOpenChange],
  );

  const { files: fileItems, fzf } = useRepoFiles(repoPath, open);

  const displayedFiles = useMemo<FileItem[]>(() => {
    if (!searchQuery.trim() && recentFiles.length > 0) {
      return recentFiles.map(pathToFileItem);
    }
    return searchFiles(fzf, fileItems, searchQuery);
  }, [fzf, fileItems, searchQuery, recentFiles]);

  const handleSelect = (path: string | null): void => {
    if (path === null) return;
    openFileInSplit(taskId, path, false);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[720px] max-w-[90vw] gap-0 p-0"
        showCloseButton={false}
      >
        <Autocomplete<FileItem>
          inline
          defaultOpen
          items={displayedFiles}
          filter={null}
          value={searchQuery}
          autoHighlight="always"
          onValueChange={(val, eventDetails) => {
            if (eventDetails.reason !== "input-change") return;
            if (typeof val === "string") setSearchQuery(val);
          }}
        >
          <AutocompleteInput placeholder="Search files…" autoFocus showClear />
          <AutocompleteStatus
            emptyContent={
              <span>
                No files match <strong>"{searchQuery}"</strong>
              </span>
            }
          />
          <AutocompleteList className="max-h-[60vh] pt-1">
            {(file: FileItem) => (
              <AutocompleteItem
                key={file.path}
                value={file.path}
                onClick={() => handleSelect(file.path)}
                className="block"
              >
                <FileIcon filename={file.name} size={14} />
                {file.name}
                {file.dir && (
                  <span className="text-muted-foreground text-xs">
                    {file.dir}
                  </span>
                )}
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </Autocomplete>
        <CommandKeyHints />
      </DialogContent>
    </Dialog>
  );
}
