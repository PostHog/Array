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
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteLabel,
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

type FileSection = { label?: string; items: FileItem[] };

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

  const sections = useMemo<FileSection[]>(() => {
    if (searchQuery.trim()) {
      return [{ items: searchFiles(fzf, fileItems, searchQuery) }];
    }
    if (recentFiles.length === 0) {
      return [{ items: searchFiles(fzf, fileItems, "") }];
    }
    const recentSet = new Set(recentFiles);
    const recentItems = recentFiles.map(pathToFileItem);
    const rest = fileItems.filter((f) => !recentSet.has(f.path));
    return [
      { label: "Recent", items: recentItems },
      { label: "Other files", items: rest },
    ];
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
          items={sections}
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
          <AutocompleteList
            className={`max-h-[60vh] ${sections[0]?.label ? "" : "pt-1"}`}
          >
            {(section: FileSection) => (
              <AutocompleteGroup
                key={section.label ?? "all"}
                items={section.items}
              >
                {section.label && (
                  <AutocompleteLabel>{section.label}</AutocompleteLabel>
                )}
                <AutocompleteCollection>
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
                </AutocompleteCollection>
              </AutocompleteGroup>
            )}
          </AutocompleteList>
        </Autocomplete>
        <CommandKeyHints />
      </DialogContent>
    </Dialog>
  );
}
