import { Box } from "@radix-ui/themes";
import { Link } from "@tiptap/extension-link";
import { Mention } from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Typography } from "@tiptap/extension-typography";
import { Underline } from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { markdownToTiptap, tiptapToMarkdown } from "../utils/tiptap-converter";
import { FileMentionList, type FileMentionListRef } from "./FileMentionList";
import { FormattingToolbar } from "./FormattingToolbar";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  repoPath?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  className?: string;
  style?: React.CSSProperties;
  showToolbar?: boolean;
  minHeight?: string;
}

export function RichTextEditor({
  value,
  onChange,
  repoPath,
  placeholder = "Add description...",
  autoFocus = false,
  onBlur,
  className,
  style,
  showToolbar = true,
  minHeight = "100px",
}: RichTextEditorProps) {
  const [files, setFiles] = useState<Array<{ path: string; name: string }>>([]);
  const filesRef = useRef(files);
  const onChangeRef = useRef(onChange);
  const repoPathRef = useRef(repoPath);

  // Keep refs updated
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    repoPathRef.current = repoPath;
  }, [repoPath]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable default keyboard shortcuts to override them
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "rich-text-link",
        },
      }),
      Typography,
      Placeholder.configure({
        placeholder,
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "file-mention",
        },
        suggestion: {
          items: async ({ query }: { query: string }) => {
            if (!repoPathRef.current) return [];

            try {
              const results = await window.electronAPI?.listRepoFiles(
                repoPathRef.current,
                query,
              );
              const fileList = results || [];
              setFiles(fileList);
              return fileList;
            } catch (error) {
              console.error("Error fetching files:", error);
              return [];
            }
          },
          render: () => {
            let component: { destroy: () => void } | null = null;
            let popup: HTMLDivElement | null = null;
            let root: ReturnType<typeof createRoot> | null = null;

            return {
              onStart: (props: any) => {
                popup = document.createElement("div");
                popup.style.position = "absolute";
                popup.style.zIndex = "1000";
                document.body.appendChild(popup);

                root = createRoot(popup);

                component = {
                  destroy: () => {
                    if (root) {
                      root.unmount();
                      root = null;
                    }
                    if (popup?.parentNode) {
                      popup.parentNode.removeChild(popup);
                    }
                    popup = null;
                  },
                };

                const ref: { current: FileMentionListRef | null } = {
                  current: null,
                };

                root.render(
                  <FileMentionList
                    items={filesRef.current}
                    command={props.command}
                    ref={(instance) => {
                      ref.current = instance;
                    }}
                  />,
                );

                // Store ref for keyboard handling
                (component as any).ref = ref;
              },

              onUpdate: (props: any) => {
                if (!root) return;

                const ref: { current: FileMentionListRef | null } = {
                  current: null,
                };

                root.render(
                  <FileMentionList
                    items={filesRef.current}
                    command={props.command}
                    ref={(instance) => {
                      ref.current = instance;
                    }}
                  />,
                );

                // Update position
                if (popup && props.clientRect) {
                  const rect =
                    typeof props.clientRect === "function"
                      ? props.clientRect()
                      : props.clientRect;

                  if (rect) {
                    popup.style.top = `${rect.bottom + window.scrollY}px`;
                    popup.style.left = `${rect.left + window.scrollX}px`;
                  }
                }

                // Store ref for keyboard handling
                (component as any).ref = ref;
              },

              onKeyDown: (props: any) => {
                if (!component) return false;
                const ref = (component as any).ref;
                if (ref?.current?.onKeyDown) {
                  return ref.current.onKeyDown(props);
                }
                return false;
              },

              onExit: () => {
                if (component) {
                  component.destroy();
                  component = null;
                }
              },
            };
          },
        } as Partial<SuggestionOptions>,
      }),
    ],
    content: markdownToTiptap(value),
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      const markdown = tiptapToMarkdown(json);
      onChangeRef.current(markdown);
    },
    onBlur,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "rich-text-editor-content",
        style: `outline: none; min-height: ${minHeight}; padding: var(--space-3);`,
      },
      handleKeyDown: (_view, event) => {
        // Custom keyboard shortcuts
        if (event.ctrlKey || event.metaKey) {
          switch (event.key) {
            case "b":
              event.preventDefault();
              editor?.chain().focus().toggleBold().run();
              return true;
            case "i":
              event.preventDefault();
              editor?.chain().focus().toggleItalic().run();
              return true;
            case "u":
              event.preventDefault();
              editor?.chain().focus().toggleUnderline().run();
              return true;
            case "e":
              event.preventDefault();
              editor?.chain().focus().toggleCode().run();
              return true;
            case "k": {
              event.preventDefault();
              const url = window.prompt("Enter URL:");
              if (url) {
                editor?.chain().focus().setLink({ href: url }).run();
              }
              return true;
            }
          }

          if (event.shiftKey) {
            switch (event.key) {
              case "X":
                event.preventDefault();
                editor?.chain().focus().toggleStrike().run();
                return true;
              case "C": {
                event.preventDefault();
                // Use the same logic as the toolbar button
                const { from } = editor?.state.selection || { from: 0 };
                const $from = editor?.state.doc.resolve(from);
                const currentNode = $from?.parent;
                let hasMentions = false;

                if (editor?.isActive("codeBlock")) {
                  editor.chain().focus().toggleCodeBlock().run();
                } else if (currentNode?.content) {
                  currentNode.content.forEach((node) => {
                    if (node.type.name === "mention") {
                      hasMentions = true;
                    }
                  });

                  if (hasMentions) {
                    // If there are mentions, create code block on a new line after current paragraph
                    const endOfParagraph = $from?.end($from.depth) || 0;

                    editor
                      ?.chain()
                      .focus()
                      .setTextSelection(endOfParagraph)
                      .insertContent([
                        {
                          type: "codeBlock",
                          content: [{ type: "text", text: "" }],
                        },
                      ])
                      .run();
                  } else {
                    editor?.chain().focus().toggleCodeBlock().run();
                  }
                } else {
                  editor?.chain().focus().toggleCodeBlock().run();
                }
                return true;
              }
              case "B":
                event.preventDefault();
                editor?.chain().focus().toggleBlockquote().run();
                return true;
              case "*":
                event.preventDefault();
                editor?.chain().focus().toggleBulletList().run();
                return true;
              case "&": // Shift+7 = &
                event.preventDefault();
                editor?.chain().focus().toggleOrderedList().run();
                return true;
            }
          }
        }
        return false;
      },
    },
  });

  // Update editor content when value changes externally
  useEffect(() => {
    if (editor && value !== tiptapToMarkdown(editor.getJSON())) {
      const { from, to } = editor.state.selection;
      editor.commands.setContent(markdownToTiptap(value));
      // Try to restore selection
      editor.commands.setTextSelection({
        from: Math.min(from, editor.state.doc.content.size),
        to: Math.min(to, editor.state.doc.content.size),
      });
    }
  }, [value, editor]);

  return (
    <Box
      className={className}
      style={{
        border: "1px solid var(--gray-a6)",
        borderRadius: "var(--radius-2)",
        backgroundColor: "var(--color-surface)",
        ...style,
      }}
    >
      {showToolbar && editor && <FormattingToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </Box>
  );
}
