import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";

interface UseFileAutocompleteOptions {
  folderPath: string | null;
  editor: Editor | null;
  enabled?: boolean;
}

interface UseFileAutocompleteReturn {
  fileHints: string[];
  selectedHintIndex: number;
  showHints: boolean;
  visibleStartIndex: number;
  selectHint: (hint: string) => void;
  handleKeyDown: (event: KeyboardEvent) => boolean;
  setSelectedHintIndex: (index: number) => void;
  setVisibleStartIndex: (index: number) => void;
}

/**
 * Hook to manage file path autocomplete for @ mentions in Tiptap editor
 * Handles:
 * - Detecting @ character and extracting query
 * - Fetching file suggestions from electronAPI
 * - Managing hint selection state
 * - Keyboard navigation (arrow up/down/enter)
 */
export function useFileAutocomplete({
  folderPath,
  editor,
  enabled = true,
}: UseFileAutocompleteOptions): UseFileAutocompleteReturn {
  const [fileHints, setFileHints] = useState<string[]>([]);
  const [selectedHintIndex, setSelectedHintIndex] = useState(0);
  const [showHints, setShowHints] = useState(false);
  const [visibleStartIndex, setVisibleStartIndex] = useState(0);

  /**
   * Extract query after @ character from current cursor position
   */
  const getFileQuery = useCallback((): string | null => {
    if (!editor || !folderPath) return null;

    const { state } = editor;
    const { selection } = state;
    const { $from } = selection;

    const textBefore = $from.parent.textBetween(
      Math.max(0, $from.parentOffset - 100),
      $from.parentOffset,
      undefined,
      "\ufffc",
    );

    // Check if cursor is right after a space
    if (textBefore.endsWith(" ")) {
      return null;
    }

    const lastAtIndex = textBefore.lastIndexOf("@");
    if (lastAtIndex === -1) {
      return null;
    }

    const textAfterAt = textBefore.substring(lastAtIndex + 1);
    if (textAfterAt.includes(" ")) {
      return null;
    }

    return textAfterAt;
  }, [editor, folderPath]);

  /**
   * Fetch file hints from electron API
   */
  const fetchFileHints = useCallback(
    async (query: string | null) => {
      if (!folderPath || !enabled) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      if (query === null) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      try {
        const results = await window.electronAPI?.listRepoFiles(
          folderPath,
          query || "",
        );
        const filePaths = (results || []).map((file) => file.path);
        setFileHints(filePaths);
        setShowHints(filePaths.length > 0);
        setSelectedHintIndex(0);
        setVisibleStartIndex(0);
      } catch (error) {
        console.error("Error fetching files:", error);
        setFileHints([]);
        setShowHints(false);
      }
    },
    [folderPath, enabled],
  );

  /**
   * Update hints based on current editor state
   */
  const updateHints = useCallback(() => {
    const query = getFileQuery();
    fetchFileHints(query);
  }, [getFileQuery, fetchFileHints]);

  /**
   * Insert selected file hint into editor
   */
  const selectHint = useCallback(
    (hint: string) => {
      if (!editor) return;

      const { state } = editor;
      const { selection } = state;
      const { $from } = selection;

      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 100),
        $from.parentOffset,
        undefined,
        "\ufffc",
      );

      const lastAtIndex = textBefore.lastIndexOf("@");
      if (lastAtIndex === -1) return;

      const from = $from.pos - ($from.parentOffset - lastAtIndex);
      const to = $from.pos;

      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(`@${hint} `)
        .run();

      setShowHints(false);
      setFileHints([]);
    },
    [editor],
  );

  /**
   * Handle keyboard navigation in hints
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!showHints || fileHints.length === 0) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedHintIndex((prev) => {
          const next = (prev + 1) % fileHints.length;
          const maxVisible = 8;
          if (next >= visibleStartIndex + maxVisible) {
            setVisibleStartIndex(next - maxVisible + 1);
          } else if (next < visibleStartIndex) {
            setVisibleStartIndex(next);
          }
          return next;
        });
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedHintIndex((prev) => {
          const next = (prev - 1 + fileHints.length) % fileHints.length;
          const maxVisible = 8;
          if (next < visibleStartIndex) {
            setVisibleStartIndex(next);
          } else if (next >= visibleStartIndex + maxVisible) {
            setVisibleStartIndex(next - maxVisible + 1);
          }
          return next;
        });
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (fileHints[selectedHintIndex]) {
          selectHint(fileHints[selectedHintIndex]);
        }
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setShowHints(false);
        setFileHints([]);
        return true;
      }

      return false;
    },
    [showHints, fileHints, selectedHintIndex, visibleStartIndex, selectHint],
  );

  // Update hints when editor content changes
  useEffect(() => {
    if (!editor || !enabled) return;

    const handleUpdate = () => {
      updateHints();
    };

    const handleSelectionUpdate = () => {
      updateHints();
    };

    editor.on("update", handleUpdate);
    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, enabled, updateHints]);

  return {
    fileHints,
    selectedHintIndex,
    showHints,
    visibleStartIndex,
    selectHint,
    handleKeyDown,
    setSelectedHintIndex,
    setVisibleStartIndex,
  };
}
