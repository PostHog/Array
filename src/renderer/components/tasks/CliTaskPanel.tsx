import { CheckSquareIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { Box, Flex, Spinner, Text } from "@radix-ui/themes";
import { Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRepositoryIntegration } from "../../hooks/useRepositoryIntegration";
import { useCreateTask } from "../../hooks/useTasks";
import { useAuthStore } from "../../stores/authStore";
import { useFolderPickerStore } from "../../stores/folderPickerStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useTabStore } from "../../stores/tabStore";
import { useTaskExecutionStore } from "../../stores/taskExecutionStore";
import { formatRepoKey, parseRepoKey } from "../../utils/repository";
import { AsciiArt } from "../AsciiArt";
import { FolderPicker } from "../FolderPicker";
import { ShellTerminal } from "../ShellTerminal";

const FilePathHighlight = Extension.create({
  name: "filePathHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("filePathHighlight"),
        state: {
          init(_, { doc }) {
            return findFilePathDecorations(doc);
          },
          apply(tr, oldState) {
            return tr.docChanged ? findFilePathDecorations(tr.doc) : oldState;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function findFilePathDecorations(doc: Node) {
  const decorations: Decoration[] = [];
  const regex = /@[^\s]+/g;

  doc.descendants((node: Node, pos: number) => {
    if (node.isText && node.text) {
      let match: RegExpExecArray | null = null;
      regex.lastIndex = 0;
      match = regex.exec(node.text);
      while (match !== null) {
        const from = pos + match.index;
        const to = from + match[0].length;
        decorations.push(
          Decoration.inline(from, to, {
            class: "cli-file-path",
          }),
        );
        match = regex.exec(node.text);
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

export function CliTaskPanel() {
  const { mutate: createTask, isPending: isCreatingTask } = useCreateTask();
  const { createTab } = useTabStore();
  const { isRepoInIntegration } = useRepositoryIntegration();
  const { client, isAuthenticated } = useAuthStore();
  const { setRepoPath: saveRepoPath, setRepoWorkingDir } =
    useTaskExecutionStore();
  const { lastSelectedFolder, setLastSelectedFolder } = useFolderPickerStore();
  const cliMode = useLayoutStore((state) => state.cliMode);
  const setCliMode = useLayoutStore((state) => state.setCliMode);

  const [folderPath, setFolderPath] = useState(lastSelectedFolder || "");
  const [repository, setRepository] = useState("");
  const [cursorVisible, setCursorVisible] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const [isShellFocused, setIsShellFocused] = useState(false);
  const [fileHints, setFileHints] = useState<string[]>([]);
  const [selectedHintIndex, setSelectedHintIndex] = useState(0);
  const [showHints, setShowHints] = useState(false);
  const [visibleStartIndex, setVisibleStartIndex] = useState(0);
  const [loadingDots, setLoadingDots] = useState(".");
  const caretRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "What do you want to work on?",
      }),
      FilePathHighlight,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "cli-editor",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => {
        // Handle Shift+Tab for mode switching (needs to be before other handlers)
        // Only respond to actual keydown, not repeat or release events
        if (
          event.type === "keydown" &&
          !event.repeat &&
          event.key === "Tab" &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          setCliMode((current) => (current === "task" ? "shell" : "task"));
          return true;
        }

        if (showHints) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedHintIndex((prev) => {
              const newIndex = prev < fileHints.length - 1 ? prev + 1 : 0;

              // Scroll window when reaching halfway point
              const relativePos = newIndex - visibleStartIndex;
              if (
                relativePos >= 5 &&
                visibleStartIndex + 10 < fileHints.length
              ) {
                setVisibleStartIndex(visibleStartIndex + 1);
              } else if (newIndex === 0) {
                // Wrapped to start
                setVisibleStartIndex(0);
              }

              return newIndex;
            });
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedHintIndex((prev) => {
              const newIndex = prev > 0 ? prev - 1 : fileHints.length - 1;

              // Scroll window when reaching halfway point going up
              const relativePos = newIndex - visibleStartIndex;
              if (relativePos < 5 && visibleStartIndex > 0) {
                setVisibleStartIndex(visibleStartIndex - 1);
              } else if (newIndex === fileHints.length - 1) {
                // Wrapped to end
                setVisibleStartIndex(Math.max(0, fileHints.length - 10));
              }

              return newIndex;
            });
            return true;
          }
          if (event.key === "Tab" || event.key === "Enter") {
            if (!event.metaKey && !event.ctrlKey) {
              event.preventDefault();

              // Insert selected hint inline
              if (fileHints.length > 0) {
                const selectedFile = fileHints[selectedHintIndex];
                const { state } = _view;
                const { selection } = state;
                const { $from } = selection;

                const textBefore = $from.parent.textBetween(
                  Math.max(0, $from.parentOffset - 100),
                  $from.parentOffset,
                  undefined,
                  "\ufffc",
                );

                const lastAtIndex = textBefore.lastIndexOf("@");
                if (lastAtIndex !== -1) {
                  const deleteFrom =
                    $from.pos - ($from.parentOffset - lastAtIndex);
                  const deleteTo = $from.pos;

                  const tr = state.tr.deleteRange(deleteFrom, deleteTo);
                  tr.insertText(`@${selectedFile} `);
                  _view.dispatch(tr);

                  setShowHints(false);
                  setFileHints([]);
                }
              }

              return true;
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setShowHints(false);
            setFileHints([]);
            return true;
          }
        }

        if (event.key === "Escape") {
          event.preventDefault();
          _view.dom.blur();
          return true;
        }

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          handleSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      updateCaretPosition();

      // Check for file hints immediately
      if (!ed || !folderPath) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const { state } = ed;
      const { selection } = state;
      const { $from } = selection;

      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 100),
        $from.parentOffset,
        undefined,
        "\ufffc",
      );

      // Check if cursor is right after a space (in the blank space after a file mention)
      if (textBefore.endsWith(" ")) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const lastAtIndex = textBefore.lastIndexOf("@");
      if (lastAtIndex === -1) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const textAfterAt = textBefore.substring(lastAtIndex + 1);
      if (textAfterAt.includes(" ")) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const query = textAfterAt;
      window.electronAPI
        ?.listRepoFiles(folderPath, query || "")
        .then((results) => {
          const filePaths = (results || []).map((file) => file.path);
          setFileHints(filePaths);
          setShowHints(filePaths.length > 0);
          setSelectedHintIndex(0);
          setVisibleStartIndex(0);
        })
        .catch((error) => {
          console.error("Error fetching files:", error);
          setFileHints([]);
          setShowHints(false);
        });
    },
    onSelectionUpdate: ({ editor: ed }) => {
      updateCaretPosition();

      // Check for file hints on selection change too
      if (!ed || !folderPath) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const { state } = ed;
      const { selection } = state;
      const { $from } = selection;

      const textBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 100),
        $from.parentOffset,
        undefined,
        "\ufffc",
      );

      // Check if cursor is right after a space (in the blank space after a file mention)
      if (textBefore.endsWith(" ")) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const lastAtIndex = textBefore.lastIndexOf("@");
      if (lastAtIndex === -1) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const textAfterAt = textBefore.substring(lastAtIndex + 1);
      if (textAfterAt.includes(" ")) {
        setShowHints(false);
        setFileHints([]);
        return;
      }

      const query = textAfterAt;
      window.electronAPI
        ?.listRepoFiles(folderPath, query || "")
        .then((results) => {
          const filePaths = (results || []).map((file) => file.path);
          setFileHints(filePaths);
          setShowHints(filePaths.length > 0);
          setSelectedHintIndex(0);
          setVisibleStartIndex(0);
        })
        .catch((error) => {
          console.error("Error fetching files:", error);
          setFileHints([]);
          setShowHints(false);
        });
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
    }, 700);
    return () => clearInterval(interval);
  }, []);

  // Auto-focus when switching modes
  useEffect(() => {
    if (cliMode === "task" && editor) {
      // Use requestAnimationFrame to ensure the component is visible before focusing
      requestAnimationFrame(() => {
        editor?.commands.focus();
      });
    }
  }, [cliMode, editor]);

  // Track shell focus
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const handleFocusIn = () => setIsShellFocused(true);
    const handleFocusOut = () => setIsShellFocused(false);

    container.addEventListener("focusin", handleFocusIn);
    container.addEventListener("focusout", handleFocusOut);

    return () => {
      container.removeEventListener("focusin", handleFocusIn);
      container.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  // Animated loading dots
  useEffect(() => {
    if (!isCreatingTask) {
      setLoadingDots(".");
      return;
    }

    const interval = setInterval(() => {
      setLoadingDots((prev) => {
        if (prev === ".") return "..";
        if (prev === "..") return "...";
        return ".";
      });
    }, 400);
    return () => clearInterval(interval);
  }, [isCreatingTask]);

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
      height="100%"
      style={{
        position: "relative",
        width: "100%",
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
        <AsciiArt scale={0.6} opacity={0.3} />
      </Box>

      <Flex
        direction="column"
        height="100%"
        p="4"
        pl="0"
        gap="4"
        style={{
          fontFamily: "monospace",
          position: "relative",
          zIndex: 1,
          paddingTop: "23px",
        }}
      >
        {/* Folder Picker */}
        <Box style={{ minWidth: 0 }}>
          <FolderPicker
            value={folderPath}
            onChange={setFolderPath}
            placeholder="Select working directory..."
            size="1"
          />
        </Box>

        {/* CLI Terminal */}
        <Flex
          ref={terminalContainerRef}
          direction="column"
          flexGrow="1"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.3)",
            borderRadius: "var(--radius-2)",
            border: "1px solid var(--gray-a6)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Mode Header */}
          <Flex
            align="center"
            justify="between"
            p="2"
            style={{
              borderBottom: "1px solid var(--gray-a6)",
              fontFamily: "monospace",
              backgroundColor: "rgba(0, 0, 0, 0.2)",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <Flex align="center" gap="2">
              {cliMode === "task" ? (
                <>
                  <CheckSquareIcon
                    size={16}
                    weight="bold"
                    color="var(--accent-11)"
                  />
                  <Text
                    size="1"
                    weight="bold"
                    style={{ color: "var(--accent-11)" }}
                  >
                    Task mode
                  </Text>
                </>
              ) : (
                <>
                  <TerminalWindowIcon
                    size={16}
                    weight="bold"
                    color="var(--accent-11)"
                  />
                  <Text
                    size="1"
                    weight="bold"
                    style={{ color: "var(--accent-11)" }}
                  >
                    Shell mode
                  </Text>
                </>
              )}
            </Flex>
            <Flex
              align="center"
              gap="1"
              style={{
                fontSize: "var(--font-size-1)",
                color: "var(--gray-9)",
                fontFamily: "monospace",
              }}
            >
              <Text size="1" weight="bold">
                Shift
              </Text>
              <Text size="1">+</Text>
              <Text size="1" weight="bold">
                Tab
              </Text>
              <Text size="1">to switch</Text>
            </Flex>
          </Flex>

          {/* Terminal Content */}
          <Flex
            direction="column"
            flexGrow="1"
            p={cliMode === "task" ? "3" : "0"}
            style={{
              cursor: cliMode === "task" ? "text" : "default",
              position: "relative",
            }}
            onClick={() => cliMode === "task" && editor?.commands.focus()}
          >
            {/* Task Mode - TipTap Editor */}
            <Flex
              align="start"
              gap="2"
              style={{
                display: cliMode === "task" ? "flex" : "none",
                height: "100%",
              }}
            >
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
              <Box
                style={{
                  flex: 1,
                  position: "relative",
                  opacity: !isFocused && editor && !editor.isEmpty ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
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
                      border: !isFocused
                        ? "1px solid var(--accent-11)"
                        : "none",
                      pointerEvents: "none",
                      transition: "none",
                      mixBlendMode:
                        isFocused && cursorVisible ? "color" : "normal",
                    }}
                  />
                )}
                {showHints && fileHints.length > 0 && (
                  <Box
                    ref={hintsRef}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      left: 0,
                      width: "100%",
                      fontFamily: "monospace",
                      fontSize: "var(--font-size-1)",
                      color: "var(--gray-11)",
                      pointerEvents: "none",
                      whiteSpace: "pre",
                    }}
                  >
                    <Box
                      style={{
                        borderTop: "1px solid var(--gray-a6)",
                        paddingTop: "4px",
                      }}
                    >
                      {fileHints
                        .slice(visibleStartIndex, visibleStartIndex + 10)
                        .map((hint, relativeIndex) => {
                          const absoluteIndex =
                            visibleStartIndex + relativeIndex;
                          return (
                            <Box
                              key={hint}
                              style={{
                                backgroundColor:
                                  absoluteIndex === selectedHintIndex
                                    ? "var(--accent-a3)"
                                    : "transparent",
                                color:
                                  absoluteIndex === selectedHintIndex
                                    ? "var(--accent-11)"
                                    : "var(--gray-11)",
                                padding: "2px 4px",
                              }}
                            >
                              {hint}
                            </Box>
                          );
                        })}
                    </Box>
                  </Box>
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
                    color: var(--gray-11);
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                  }

                  .cli-editor .cli-file-path {
                    background-color: var(--accent-a3);
                    color: var(--accent-11);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-weight: 500;
                  }
                `}
                </style>
              </Box>
            </Flex>

            {/* Shell Mode - xterm.js Terminal */}
            <Box
              style={{
                display: cliMode === "shell" ? "block" : "none",
                height: "100%",
                width: "100%",
                opacity: !isShellFocused ? 0.5 : 1,
                transition: "opacity 0.2s",
              }}
            >
              <ShellTerminal cwd={folderPath || undefined} />
            </Box>

            {/* Key hint or loading indicator (task mode only) */}
            {cliMode === "task" && (
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
                {isCreatingTask ? (
                  <>
                    <Spinner size="1" />
                    <Text size="1">Spawning task{loadingDots}</Text>
                  </>
                ) : (
                  <>
                    <Text size="1" weight="bold">
                      {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
                    </Text>
                    <Text size="1">+</Text>
                    <Text size="1" weight="bold">
                      Enter
                    </Text>
                    <Text size="1">to submit</Text>
                  </>
                )}
              </Flex>
            )}
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}
