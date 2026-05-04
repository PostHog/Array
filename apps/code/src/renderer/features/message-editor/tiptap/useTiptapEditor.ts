import { sessionStoreSetters } from "@features/sessions/stores/sessionStore";
import { useSettingsStore as useFeatureSettingsStore } from "@features/settings/stores/settingsStore";
import { trpc } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import type { EditorView } from "@tiptap/pm/view";
import { useEditor } from "@tiptap/react";
import { queryClient } from "@utils/queryClient";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePromptHistoryStore } from "../stores/promptHistoryStore";
import type { FileAttachment, MentionChip } from "../utils/content";
import { contentToXml, isContentEmpty } from "../utils/content";
import {
  githubIssueToMentionChip,
  githubPullRequestToMentionChip,
} from "../utils/githubIssueChip";
import {
  type ParsedGithubIssueUrl,
  parseGithubIssueUrl,
} from "../utils/githubIssueUrl";
import {
  persistImageFile,
  persistTextContent,
  resolveAndAttachDroppedFiles,
} from "../utils/persistFile";
import { getEditorExtensions } from "./extensions";
import { type DraftContext, useDraftSync } from "./useDraftSync";

export interface UseTiptapEditorOptions {
  sessionId: string;
  taskId?: string;
  placeholder?: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  isLoading?: boolean;
  autoFocus?: boolean;
  context?: DraftContext;
  capabilities?: {
    fileMentions?: boolean;
    commands?: boolean;
    bashMode?: boolean;
  };
  clearOnSubmit?: boolean;
  getPromptHistory?: () => string[];
  onBeforeSubmit?: (text: string, clearEditor: () => void) => boolean;
  onSubmit?: (text: string) => void;
  onBashCommand?: (command: string) => void;
  onBashModeChange?: (isBashMode: boolean) => void;
  onEmptyChange?: (isEmpty: boolean) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const EDITOR_CLASS =
  "cli-editor min-h-[1.5em] w-full break-words border-none bg-transparent pr-2 text-[14px] text-[var(--gray-12)] outline-none [overflow-wrap:break-word] [white-space:pre-wrap] [word-break:break-word]";

function insertChipWithTrailingSpace(
  view: EditorView,
  attrs: {
    type: MentionChip["type"];
    id: string;
    label: string;
    pastedText?: boolean;
  },
): void {
  const chipNode = view.state.schema.nodes.mentionChip.create({
    pastedText: false,
    ...attrs,
  });
  const space = view.state.schema.text(" ");
  const { tr } = view.state;
  tr.replaceSelectionWith(chipNode).insert(tr.selection.from, space);
  view.dispatch(tr);
}

async function pasteTextAsFile(
  view: EditorView,
  text: string,
  pasteCountRef: React.MutableRefObject<number>,
): Promise<void> {
  const result = await persistTextContent(text);
  pasteCountRef.current += 1;
  const lineCount = text.split("\n").length;
  insertChipWithTrailingSpace(view, {
    type: "file",
    id: result.path,
    label: `Pasted text #${pasteCountRef.current} (${lineCount} lines)`,
    pastedText: true,
  });
  view.focus();
}

function buildGithubRefPlaceholderChip(
  parsed: ParsedGithubIssueUrl,
): MentionChip {
  const source = {
    number: parsed.number,
    title: "Loading...",
    url: parsed.normalizedUrl,
  };
  return parsed.kind === "pr"
    ? githubPullRequestToMentionChip(source)
    : githubIssueToMentionChip(source);
}

function insertGithubRefPlaceholder(
  view: EditorView,
  parsed: ParsedGithubIssueUrl,
): void {
  insertChipWithTrailingSpace(view, buildGithubRefPlaceholderChip(parsed));
}

async function fetchGithubRefTitle(
  parsed: ParsedGithubIssueUrl,
): Promise<string | null> {
  const input = {
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
  };
  try {
    if (parsed.kind === "pr") {
      const pr = await queryClient.fetchQuery({
        ...trpc.git.getGithubPullRequest.queryOptions(input),
        staleTime: 60_000,
      });
      return pr?.title ?? null;
    }
    const issue = await queryClient.fetchQuery({
      ...trpc.git.getGithubIssue.queryOptions(input),
      staleTime: 60_000,
    });
    return issue?.title ?? null;
  } catch {
    return null;
  }
}

async function resolveGithubRefChip(
  view: EditorView,
  parsed: ParsedGithubIssueUrl,
): Promise<void> {
  const chipType = parsed.kind === "pr" ? "github_pr" : "github_issue";
  const placeholderLabel = `#${parsed.number} - Loading...`;
  const title = await fetchGithubRefTitle(parsed);
  const resolvedLabel =
    title !== null ? `#${parsed.number} - ${title}` : `#${parsed.number}`;

  if (view.isDestroyed) return;

  const { doc, tr } = view.state;
  let updated = false;
  doc.descendants((node, pos) => {
    if (
      node.type.name !== "mentionChip" ||
      node.attrs.type !== chipType ||
      node.attrs.id !== parsed.normalizedUrl ||
      node.attrs.label !== placeholderLabel
    ) {
      return true;
    }
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      label: resolvedLabel,
    });
    updated = true;
    return false;
  });

  if (updated) view.dispatch(tr);
}

function showPasteHint(message: string, description: string): void {
  const store = useFeatureSettingsStore.getState();
  const key =
    message === "Pasted as file attachment" ? "paste-as-file" : "paste-inline";
  if (!store.shouldShowHint(key)) return;
  store.recordHintShown(key);
  toast.info(message, description);
}

export function useTiptapEditor(options: UseTiptapEditorOptions) {
  const {
    sessionId,
    taskId,
    placeholder = "",
    disabled = false,
    submitDisabled = false,
    isLoading = false,
    autoFocus = false,
    context,
    capabilities = {},
    clearOnSubmit = true,
    getPromptHistory,
    onBeforeSubmit,
    onSubmit,
    onBashCommand,
    onBashModeChange,
    onEmptyChange,
    onFocus,
    onBlur,
  } = options;

  const {
    fileMentions = true,
    commands = true,
    bashMode: enableBashMode = true,
  } = capabilities;

  const callbackRefs = useRef({
    onBeforeSubmit,
    onSubmit,
    onBashCommand,
    onBashModeChange,
    onEmptyChange,
    onFocus,
    onBlur,
  });
  callbackRefs.current = {
    onBeforeSubmit,
    onSubmit,
    onBashCommand,
    onBashModeChange,
    onEmptyChange,
    onFocus,
    onBlur,
  };

  const submitDisabledRef = useRef(submitDisabled);
  submitDisabledRef.current = submitDisabled;

  const getPromptHistoryRef = useRef(getPromptHistory);
  getPromptHistoryRef.current = getPromptHistory;

  const prevBashModeRef = useRef(false);
  const prevIsEmptyRef = useRef(true);
  const submitRef = useRef<() => void>(() => {});
  const draftRef = useRef<ReturnType<typeof useDraftSync> | null>(null);

  const pasteCountRef = useRef(0);
  const historyActions = usePromptHistoryStore.getState();
  const [isEmptyState, setIsEmptyState] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const attachmentsRef = useRef<FileAttachment[]>([]);

  const editor = useEditor(
    {
      extensions: getEditorExtensions({
        sessionId,
        placeholder,
        fileMentions,
        commands,
      }),
      editable: !disabled,
      autofocus: autoFocus ? "end" : false,
      editorProps: {
        attributes: { class: EDITOR_CLASS, spellcheck: "false" },
        handleDOMEvents: {
          click: (_view, event) => {
            const target = (event.target as HTMLElement).closest("a");
            if (target) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        handleKeyDown: (view, event) => {
          if (
            event.key === "v" &&
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey
          ) {
            event.preventDefault();
            (async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!text?.trim()) return;
                useFeatureSettingsStore
                  .getState()
                  .markHintLearned("paste-inline");
                await pasteTextAsFile(view, text, pasteCountRef);
              } catch (_error) {
                toast.error("Failed to paste as file attachment");
              }
            })();
            return true;
          }

          if (isSendMessageSubmitKey(event)) {
            if (!view.editable || submitDisabledRef.current) return false;
            // tippy.js sets data-state="hidden" when hiding via .hide()
            const visibleSuggestion = document.querySelector(
              "[data-tippy-root] .tippy-box:not([data-state='hidden'])",
            );
            if (visibleSuggestion) return false;
            event.preventDefault();
            historyActions.reset();
            submitRef.current();
            return true;
          }

          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            const historyGetter = getPromptHistoryRef.current;
            if (!taskId && !historyGetter) return false;

            const currentText = view.state.doc.textContent;
            const isEmpty = !currentText.trim();
            const { from } = view.state.selection;
            const isAtStart = from === 1;
            const isAtEnd = from === view.state.doc.content.size - 1;

            const forceNavigate = event.shiftKey;
            const history = historyGetter?.() ?? [];

            if (
              event.key === "ArrowUp" &&
              (forceNavigate || isEmpty || isAtStart)
            ) {
              if (taskId) {
                const queuedContent =
                  sessionStoreSetters.dequeueMessagesAsText(taskId);
                if (queuedContent !== null && queuedContent !== undefined) {
                  event.preventDefault();
                  view.dispatch(
                    view.state.tr
                      .delete(1, view.state.doc.content.size - 1)
                      .insertText(queuedContent, 1),
                  );
                  return true;
                }
              }

              const newText = historyActions.navigateUp(history, currentText);
              if (newText !== null) {
                event.preventDefault();
                view.dispatch(
                  view.state.tr
                    .delete(1, view.state.doc.content.size - 1)
                    .insertText(newText, 1),
                );
                return true;
              }
            }

            if (
              event.key === "ArrowDown" &&
              (forceNavigate || isEmpty || isAtEnd)
            ) {
              const newText = historyActions.navigateDown(history);
              if (newText !== null) {
                event.preventDefault();
                view.dispatch(
                  view.state.tr
                    .delete(1, view.state.doc.content.size - 1)
                    .insertText(newText, 1),
                );
                return true;
              }
            }
          }

          return false;
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false;

          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;

          event.preventDefault();

          resolveAndAttachDroppedFiles(files, (a) => {
            setAttachments((prev) => {
              if (prev.some((existing) => existing.id === a.id)) return prev;
              return [...prev, a];
            });
          }).catch(() => toast.error("Failed to attach files"));

          return true;
        },
        handlePaste: (view, event) => {
          const { from, to } = view.state.selection;
          const clipboardText = event.clipboardData?.getData("text/plain");
          const trimmedClipboardText = clipboardText?.trim();

          // Auto-wrap selected text as markdown link when pasting a URL
          if (
            from !== to &&
            trimmedClipboardText &&
            /^https?:\/\/\S+$/.test(trimmedClipboardText)
          ) {
            event.preventDefault();
            const selectedText = view.state.doc.textBetween(from, to);
            const linkMarkdown = `[${selectedText}](${trimmedClipboardText})`;
            view.dispatch(
              view.state.tr.replaceWith(
                from,
                to,
                view.state.schema.text(linkMarkdown),
              ),
            );
            return true;
          }

          // Auto-convert a pasted GitHub issue or PR URL into a chip
          if (from === to && trimmedClipboardText) {
            const parsedRef = parseGithubIssueUrl(trimmedClipboardText);
            if (parsedRef) {
              event.preventDefault();
              insertGithubRefPlaceholder(view, parsedRef);
              void resolveGithubRefChip(view, parsedRef);
              return true;
            }
          }

          const items = event.clipboardData?.items;
          if (!items) return false;

          const imageItems: DataTransferItem[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith("image/")) {
              imageItems.push(item);
            }
          }

          if (imageItems.length > 0) {
            event.preventDefault();

            (async () => {
              for (const item of imageItems) {
                const file = item.getAsFile();
                if (!file) continue;

                try {
                  const result = await persistImageFile(file);

                  setAttachments((prev) => {
                    if (prev.some((a) => a.id === result.path)) return prev;
                    return [...prev, { id: result.path, label: result.name }];
                  });
                } catch (_error) {
                  toast.error("Failed to paste image");
                }
              }
            })();

            return true;
          }

          // Auto-convert long pasted text into a file attachment
          const autoConvertThreshold =
            useFeatureSettingsStore.getState().autoConvertLongText;
          if (
            clipboardText &&
            autoConvertThreshold !== "off" &&
            clipboardText.length > Number(autoConvertThreshold)
          ) {
            event.preventDefault();

            (async () => {
              try {
                await pasteTextAsFile(view, clipboardText, pasteCountRef);
                showPasteHint(
                  "Pasted as file attachment",
                  "Click the chip to convert back to text.",
                );
              } catch (_error) {
                toast.error("Failed to convert pasted text to attachment");
              }
            })();

            return true;
          }

          if (clipboardText && clipboardText.length > 200) {
            showPasteHint(
              "Pasted as text",
              "Use ⌘⇧V to paste as a file attachment instead.",
            );
          }

          return false;
        },
      },
      onCreate: () => {
        setIsReady(true);
        const content = draftRef.current?.getContent();
        const newIsEmpty = isContentEmpty(content ?? null);
        setIsEmptyState(newIsEmpty);
        prevIsEmptyRef.current = newIsEmpty;
        callbackRefs.current.onEmptyChange?.(newIsEmpty);
      },
      onUpdate: ({ editor: e }) => {
        const text = e.getText();
        const newBashMode = enableBashMode && text.trimStart().startsWith("!");

        if (newBashMode !== prevBashModeRef.current) {
          prevBashModeRef.current = newBashMode;
          callbackRefs.current.onBashModeChange?.(newBashMode);
        }

        draftRef.current?.saveDraft(e, attachmentsRef.current);
        const content = draftRef.current?.getContent(attachmentsRef.current);
        const newIsEmpty = isContentEmpty(content ?? null);
        setIsEmptyState(newIsEmpty);

        if (newIsEmpty !== prevIsEmptyRef.current) {
          prevIsEmptyRef.current = newIsEmpty;
          callbackRefs.current.onEmptyChange?.(newIsEmpty);
        }

        e.commands.scrollIntoView();
      },
      onFocus: () => {
        callbackRefs.current.onFocus?.();
      },
      onBlur: () => {
        callbackRefs.current.onBlur?.();
      },
    },
    [sessionId, disabled, fileMentions, commands, placeholder],
  );

  const draft = useDraftSync(editor, sessionId, context);
  draftRef.current = draft;

  // Keep attachmentsRef in sync with state (synchronous, no effect needed)
  attachmentsRef.current = attachments;

  // Re-save draft when attachments change so persistence stays up to date
  useEffect(() => {
    if (editor) {
      draftRef.current?.saveDraft(editor, attachments);
    }
  }, [attachments, editor]);

  // Notify parent when emptiness changes due to attachment add/remove.
  // Only reacts to attachment changes; text changes are handled by onUpdate.
  // We read editor text directly because isEmptyState may include stale
  // attachment info (isContentEmpty counts attachments in its input).
  useEffect(() => {
    if (!editor) return;
    const hasText = !!editor.getText().trim();
    const newIsEmpty = !hasText && attachments.length === 0;
    if (newIsEmpty !== prevIsEmptyRef.current) {
      prevIsEmptyRef.current = newIsEmpty;
      callbackRefs.current.onEmptyChange?.(newIsEmpty);
    }
  }, [attachments, editor]);

  // Restore attachments from draft on mount
  useEffect(() => {
    setAttachments(draft.restoredAttachments);
    // Only run on mount / session change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.restoredAttachments]);

  const submit = useCallback(() => {
    if (!editor) return;
    if (disabled || submitDisabled) return;

    const content = draft.getContent(attachments);
    if (isContentEmpty(content)) return;

    const text = editor.getText().trim();

    const doClear = () => {
      if (!clearOnSubmit) return;
      editor.commands.clearContent();
      prevBashModeRef.current = false;
      pasteCountRef.current = 0;
      setAttachments([]);
      draft.clearDraft();
    };

    if (enableBashMode && text.startsWith("!")) {
      // Bash mode requires immediate execution, can't be queued.
      // Intentionally bypasses onBeforeSubmit — bash commands run inline and
      // cannot be deferred the way normal prompts can.
      if (isLoading) {
        toast.error("Cannot run shell commands while agent is generating");
        return;
      }
      const command = text.slice(1).trim();
      if (command) callbackRefs.current.onBashCommand?.(command);
    } else {
      const serialized = contentToXml(content);

      if (callbackRefs.current.onBeforeSubmit) {
        if (!callbackRefs.current.onBeforeSubmit(serialized, doClear)) {
          return;
        }
      }

      // Normal prompts can be queued when loading
      callbackRefs.current.onSubmit?.(serialized);
    }

    doClear();
  }, [
    editor,
    disabled,
    submitDisabled,
    isLoading,
    draft,
    clearOnSubmit,
    attachments,
    enableBashMode,
  ]);

  submitRef.current = submit;

  const focus = useCallback(() => {
    if (editor?.view) {
      editor.commands.focus("end");
    }
  }, [editor]);
  const blur = useCallback(() => editor?.commands.blur(), [editor]);
  const clear = useCallback(() => {
    editor?.commands.clearContent();
    prevBashModeRef.current = false;
    setAttachments([]);
    draft.clearDraft();
  }, [editor, draft]);
  const getText = useCallback(() => editor?.getText() ?? "", [editor]);
  const setContent = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.commands.setContent(text);
      editor.commands.focus("end");
      draft.saveDraft(editor, attachments);
    },
    [editor, draft, attachments],
  );
  const insertChip = useCallback(
    (chip: MentionChip) => {
      if (!editor) return;
      editor.commands.insertMentionChip({
        type: chip.type,
        id: chip.id,
        label: chip.label,
        pastedText: false,
      });
      draft.saveDraft(editor, attachments);
    },
    [editor, draft, attachments],
  );

  const removeChipById = useCallback(
    (chipId: string) => {
      if (!editor) return;
      editor.commands.removeMentionChipById(chipId);
      draft.saveDraft(editor, attachments);
    },
    [editor, draft, attachments],
  );

  const replaceChipAttrs = useCallback(
    (
      chipId: string,
      attrs: Partial<{
        id: string;
        label: string;
        type: MentionChip["type"];
      }>,
    ) => {
      if (!editor) return;
      editor.commands.replaceMentionChipById(chipId, attrs);
      draft.saveDraft(editor, attachments);
    },
    [editor, draft, attachments],
  );

  const addAttachment = useCallback((attachment: FileAttachment) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.id === attachment.id)) return prev;
      return [...prev, attachment];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const isEmpty = !editor || (isEmptyState && attachments.length === 0);
  const isBashMode =
    enableBashMode && (editor?.getText().trimStart().startsWith("!") ?? false);

  return {
    editor,
    isReady,
    isEmpty,
    isBashMode,
    submit,
    focus,
    blur,
    clear,
    getText,
    getContent: draft.getContent,
    setContent,
    insertChip,
    removeChipById,
    replaceChipAttrs,
    attachments,
    addAttachment,
    removeAttachment,
  };
}
