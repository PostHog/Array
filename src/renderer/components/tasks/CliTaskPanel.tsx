import { Box, Flex, Text } from "@radix-ui/themes";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRepositoryIntegration } from "../../hooks/useRepositoryIntegration";
import { useCreateTask } from "../../hooks/useTasks";
import { useAuthStore } from "../../stores/authStore";
import { useFolderPickerStore } from "../../stores/folderPickerStore";
import { useTabStore } from "../../stores/tabStore";
import { useTaskExecutionStore } from "../../stores/taskExecutionStore";
import { formatRepoKey, parseRepoKey } from "../../utils/repository";
import { AsciiArt } from "../AsciiArt";
import { FolderPicker } from "../FolderPicker";

export function CliTaskPanel() {
  const { mutate: createTask } = useCreateTask();
  const { createTab } = useTabStore();
  const { isRepoInIntegration } = useRepositoryIntegration();
  const { client, isAuthenticated } = useAuthStore();
  const { setRepoPath: saveRepoPath, setRepoWorkingDir } =
    useTaskExecutionStore();
  const { lastSelectedFolder, setLastSelectedFolder } = useFolderPickerStore();

  const [folderPath, setFolderPath] = useState(lastSelectedFolder || "");
  const [repository, setRepository] = useState("");
  const [cursorVisible, setCursorVisible] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const caretRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "What do you want to work on?",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "cli-editor",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          handleSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: () => {
      updateCaretPosition();
    },
    onSelectionUpdate: () => {
      updateCaretPosition();
    },
    onFocus: () => {
      setIsFocused(true);
      updateCaretPosition();
    },
    onBlur: () => {
      setIsFocused(false);
    },
  });

  const updateCaretPosition = useCallback(() => {
    if (!editor || !caretRef.current) return;

    const { view } = editor;
    const { from } = view.state.selection;

    try {
      const coords = view.coordsAtPos(from);
      const editorEl = view.dom.parentElement;
      if (!editorEl) return;

      const editorRect = editorEl.getBoundingClientRect();

      if (coords) {
        caretRef.current.style.left = `${coords.left - editorRect.left}px`;
        caretRef.current.style.top = `${coords.top - editorRect.top}px`;
      }
    } catch (error) {
      console.error("Error updating caret position:", error);
    }
  }, [editor]);

  // Blinking cursor effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  // Update caret position on mount and when editor changes
  useEffect(() => {
    if (editor) {
      updateCaretPosition();
    }
  }, [editor, updateCaretPosition]);

  // Auto-detect repository from folder
  const detectRepoFromFolder = useCallback(
    async (newPath: string) => {
      if (!newPath?.trim()) {
        return;
      }

      try {
        const repoInfo = await window.electronAPI?.detectRepo(newPath);
        if (repoInfo) {
          const repoKey = formatRepoKey(
            repoInfo.organization,
            repoInfo.repository,
          );
          setRepository(repoKey);

          if (!isRepoInIntegration(repoKey)) {
            setRepository(repoKey);
          }
        }
      } catch {
        // Ignore errors
      }
    },
    [isRepoInIntegration],
  );

  useEffect(() => {
    if (folderPath) {
      detectRepoFromFolder(folderPath);
    }
  }, [folderPath, detectRepoFromFolder]);

  const handleSubmit = useCallback(() => {
    if (!editor || !isAuthenticated || !client || !folderPath.trim()) {
      return;
    }

    const content = editor.getText().trim();
    if (!content) {
      return;
    }

    const repositoryConfig = repository
      ? (parseRepoKey(repository) ?? undefined)
      : undefined;

    createTask(
      {
        description: content,
        repositoryConfig,
      },
      {
        onSuccess: (newTask) => {
          if (folderPath && folderPath.trim().length > 0) {
            saveRepoPath(newTask.id, folderPath);
            setLastSelectedFolder(folderPath);

            if (repositoryConfig) {
              const repoKey = `${repositoryConfig.organization}/${repositoryConfig.repository}`;
              setRepoWorkingDir(repoKey, folderPath);
            }
          }

          createTab({
            type: "task-detail",
            title: newTask.title,
            data: newTask,
          });
          editor.commands.clearContent();
        },
        onError: (error) => {
          console.error("Failed to create task:", error);
        },
      },
    );
  }, [
    editor,
    isAuthenticated,
    client,
    folderPath,
    repository,
    createTask,
    saveRepoPath,
    setLastSelectedFolder,
    setRepoWorkingDir,
    createTab,
  ]);

  return (
    <Box
      width="30%"
      height="100%"
      style={{
        position: "relative",
      }}
    >
      {/* Background ASCII Art */}
      <Box
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          overflow: "hidden",
        }}
      >
        <AsciiArt scale={0.7} opacity={0.15} />
      </Box>

      <Flex
        direction="column"
        height="100%"
        p="4"
        gap="4"
        style={{ fontFamily: "monospace", position: "relative", zIndex: 1 }}
      >
        {/* Folder Picker */}
        <Box>
          <FolderPicker
            value={folderPath}
            onChange={setFolderPath}
            placeholder="Select working directory..."
            size="1"
          />
        </Box>

        {/* CLI Terminal */}
        <Flex
          direction="column"
          flexGrow="1"
          p="3"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.3)",
            borderRadius: "var(--radius-2)",
            border: "1px solid var(--gray-a6)",
            cursor: "text",
            position: "relative",
          }}
          onClick={() => editor?.commands.focus()}
        >
          <Flex align="start" gap="2">
            <Text
              size="2"
              weight="bold"
              style={{
                color: "var(--accent-11)",
                fontFamily: "monospace",
                userSelect: "none",
                WebkitUserSelect: "none",
                bottom: "1px",
                position: "relative",
              }}
            >
              &gt;
            </Text>
            <Box style={{ flex: 1, position: "relative" }}>
              <EditorContent editor={editor} />
              {editor && (isFocused || !editor.isEmpty) && (
                <div
                  ref={caretRef}
                  style={{
                    top: 0,
                    position: "absolute",
                    width: "8px",
                    height: "16px",
                    backgroundColor:
                      isFocused && cursorVisible
                        ? "var(--accent-11)"
                        : "transparent",
                    border: !isFocused ? "1px solid var(--accent-11)" : "none",
                    pointerEvents: "none",
                    transition: "none",
                  }}
                />
              )}
              <style>
                {`
                  .cli-editor {
                    font-family: monospace;
                    background-color: transparent;
                    border: none;
                    outline: none;
                    color: var(--gray-12);
                    font-size: var(--font-size-1);
                    width: 100%;
                  }

                  .cli-editor.ProseMirror {
                    caret-color: transparent;
                  }

                  .cli-editor.ProseMirror p {
                    margin: 0;
                  }

                  .cli-editor.ProseMirror.ProseMirror-focused p.is-editor-empty:first-child::before {
                    content: '';
                  }

                  .cli-editor.ProseMirror:not(.ProseMirror-focused) p.is-editor-empty:first-child::before {
                    color: var(--gray-9);
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                  }
                `}
              </style>
            </Box>
          </Flex>

          {/* Key hint */}
          <Flex
            align="center"
            gap="1"
            style={{
              position: "absolute",
              bottom: "8px",
              right: "8px",
              fontSize: "var(--font-size-1)",
              color: "var(--gray-9)",
              fontFamily: "monospace",
            }}
          >
            <Text size="1" weight="bold">
              {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
            </Text>
            <Text size="1">+</Text>
            <Text size="1" weight="bold">
              Enter
            </Text>
            <Text size="1">to submit</Text>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}
