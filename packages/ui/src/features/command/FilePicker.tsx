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
import { CommandKeyHints } from "@posthog/ui/features/command/CommandKeyHints";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import {
  type FileItem,
  pathToFileItem,
  searchFiles,
  useRepoFiles,
} from "@posthog/ui/features/repo-files/useRepoFiles";
import { FileIcon } from "@posthog/ui/primitives/FileIcon";
import { useCallback, useMemo, useState } from "react";

interface FilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  repoPath: string | undefined;
}

type FileSection = { label?: string; items: FileItem[] };

// Cap the empty-query list to keep render cost bounded without virtualization.
// Typed queries are already capped upstream by fzf (MENTION_DISPLAY_LIMIT = 20).
const EMPTY_QUERY_LIMIT = 200;

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
      return [{ items: fileItems.slice(0, EMPTY_QUERY_LIMIT) }];
    }
    // recentFiles is string[] of paths from panelLayoutStore, ordered most-recent-first.
    const recentPathSet = new Set(recentFiles);
    const recentItems = recentFiles.map(pathToFileItem);
    const rest = fileItems
      .filter((f) => !recentPathSet.has(f.path))
      .slice(0, Math.max(0, EMPTY_QUERY_LIMIT - recentItems.length));
    return [
      { label: "Recent", items: recentItems },
      { label: "Other files", items: rest },
    ];
  }, [fzf, fileItems, searchQuery, recentFiles]);

  const handleSelect = useCallback(
    (path: string) => {
      openFileInSplit(taskId, path, false);
      handleOpenChange(false);
    },
    [openFileInSplit, taskId, handleOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[720px] max-w-[90vw] gap-0 p-0"
        showCloseButton={false}
      >
        {/*
         * `items` accepts `Value[] | { items: Value[] }[]` — we always use the
         * grouped shape so the same render path covers both the labeled
         * (Recent / Other files) and unlabeled (search results) cases.
         */}
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
            {(section: FileSection, index: number) => (
              <AutocompleteGroup
                key={section.label ?? `group-${index}`}
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
