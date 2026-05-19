import "./message-editor.css";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { ArrowUp, Stop } from "@phosphor-icons/react";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@posthog/quill";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { cycleModeOption } from "@renderer/features/sessions/stores/sessionStore";
import { EditorContent } from "@tiptap/react";
import { hasOpenOverlay } from "@utils/overlay";
import clsx from "clsx";
import { forwardRef, useCallback, useEffect, useImperativeHandle } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useDraftStore } from "../stores/draftStore";
import { useTiptapEditor } from "../tiptap/useTiptapEditor";
import type { EditorHandle } from "../types";
import { AttachmentMenu } from "./AttachmentMenu";
import { AttachmentsBar } from "./AttachmentsBar";
import { ModeSelector } from "./ModeSelector";

export type { EditorHandle };

export interface PromptInputProps {
  sessionId: string;
  placeholder?: string;
  // editor state
  disabled?: boolean;
  isLoading?: boolean;
  autoFocus?: boolean;
  isActiveSession?: boolean;
  submitDisabledExternal?: boolean;
  clearOnSubmit?: boolean;
  // session context
  taskId?: string;
  repoPath?: string | null;
  // mode
  modeOption?: SessionConfigOption;
  onModeChange?: (value: string) => void;
  allowBypassPermissions?: boolean;
  // capabilities
  enableBashMode?: boolean;
  enableCommands?: boolean;
  // toolbar slots
  modelSelector?: React.ReactElement | null | false;
  reasoningSelector?: React.ReactElement | null | false;
  historyButton?: React.ReactNode;
  // prompt history provider
  getPromptHistory?: () => string[];
  // callbacks
  onBeforeSubmit?: (text: string, clearEditor: () => void) => boolean;
  onSubmit?: (text: string) => void;
  onBashCommand?: (command: string) => void;
  onBashModeChange?: (isBashMode: boolean) => void;
  onCancel?: () => void;
  onAttachFiles?: (files: File[]) => void;
  onEmptyChange?: (isEmpty: boolean) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  // manual submit override (for flows like new-task that submit outside the editor hook)
  onSubmitClick?: () => void;
  submitTooltipOverride?: string;
  editorHeight?: "default" | "large";
  tourTarget?: string;
}

export const PromptInput = forwardRef<EditorHandle, PromptInputProps>(
  (
    {
      sessionId,
      placeholder = "Type a message...",
      disabled = false,
      isLoading = false,
      autoFocus = false,
      isActiveSession = true,
      submitDisabledExternal = false,
      clearOnSubmit,
      taskId,
      repoPath,
      modeOption,
      onModeChange,
      allowBypassPermissions = false,
      enableBashMode = false,
      enableCommands = true,
      modelSelector,
      reasoningSelector,
      historyButton,
      getPromptHistory,
      onBeforeSubmit,
      onSubmit,
      onBashCommand,
      onBashModeChange,
      onCancel,
      onAttachFiles,
      onEmptyChange,
      onFocus,
      onBlur,
      onSubmitClick,
      submitTooltipOverride,
      editorHeight = "default",
      tourTarget,
    },
    ref,
  ) => {
    const focusRequested = useDraftStore((s) => s.focusRequested[sessionId]);
    const clearFocusRequest = useDraftStore((s) => s.actions.clearFocusRequest);

    const {
      editor,
      isReady,
      isEmpty,
      isBashMode,
      submit,
      focus,
      blur,
      clear,
      getText,
      getContent,
      setContent,
      insertChip,
      attachments,
      addAttachment,
      removeAttachment,
    } = useTiptapEditor({
      sessionId,
      taskId,
      placeholder,
      disabled,
      submitDisabled: submitDisabledExternal,
      isLoading,
      autoFocus,
      clearOnSubmit,
      context: { taskId, repoPath: repoPath ?? undefined },
      capabilities: {
        bashMode: enableBashMode,
        commands: enableCommands,
      },
      getPromptHistory,
      onBeforeSubmit,
      onSubmit,
      onBashCommand,
      onBashModeChange,
      onEmptyChange,
      onFocus,
      onBlur,
    });

    useImperativeHandle(
      ref,
      () => ({
        focus,
        blur,
        clear,
        isEmpty: () => isEmpty,
        getContent,
        getText,
        setContent,
        insertChip,
        addAttachment,
        removeAttachment,
      }),
      [
        focus,
        blur,
        clear,
        isEmpty,
        getContent,
        getText,
        setContent,
        insertChip,
        addAttachment,
        removeAttachment,
      ],
    );

    useEffect(() => {
      if (!focusRequested || !isReady) return;
      focus();
      clearFocusRequest(sessionId);
    }, [focusRequested, focus, clearFocusRequest, sessionId, isReady]);

    useHotkeys(
      "escape",
      (e) => {
        if (hasOpenOverlay()) return;
        if (!isActiveSession) return;
        if (isLoading && onCancel) {
          e.preventDefault();
          onCancel();
        }
      },
      {
        enableOnFormTags: true,
        enableOnContentEditable: true,
        enabled: isLoading && !!onCancel,
      },
      [isActiveSession, isLoading, onCancel],
    );

    useHotkeys(
      "shift+tab",
      (e) => {
        if (!editor?.isFocused) return;
        if (hasOpenOverlay()) return;
        if (!modeOption || !onModeChange) return;
        const nextMode = cycleModeOption(modeOption, {
          allowBypassPermissions,
        });
        if (!nextMode) return;
        e.preventDefault();
        onModeChange(nextMode);
      },
      {
        enableOnFormTags: true,
        enableOnContentEditable: true,
        enabled: !disabled && !!modeOption && !!onModeChange,
      },
      [editor, modeOption, onModeChange, allowBypassPermissions, disabled],
    );

    const handleContainerClick = useCallback(
      (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
          !target.closest("button") &&
          !target.closest('[role="menu"]') &&
          !target.closest(".ProseMirror")
        ) {
          focus();
        }
      },
      [focus],
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
    }, []);

    const handleSubmitClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onSubmitClick) {
        onSubmitClick();
      } else {
        submit();
      }
    };

    const submitBlocked = submitDisabledExternal || isEmpty;
    const submitTooltip =
      submitTooltipOverride ??
      (submitBlocked ? "Enter a message" : "Send message");

    const submitButton =
      isLoading && onCancel ? (
        <Tooltip content="Stop">
          <InputGroupButton
            variant="destructive"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Stop"
          >
            <Stop size={14} weight="fill" />
          </InputGroupButton>
        </Tooltip>
      ) : (
        <Tooltip content={submitTooltip}>
          <InputGroupButton
            variant="primary"
            size="icon-sm"
            onClick={handleSubmitClick}
            disabled={submitBlocked}
            aria-label="Send message"
            {...(tourTarget && { "data-tour": `${tourTarget}-submit` })}
          >
            <ArrowUp size={14} weight="bold" />
          </InputGroupButton>
        </Tooltip>
      );

    return (
      <Flex direction="column" gap="1">
        <InputGroup
          onClick={handleContainerClick}
          onContextMenu={handleContextMenu}
          className={`h-auto cursor-text bg-card ${isBashMode ? "ring-1 ring-blue-9" : ""}`}
          {...(tourTarget && {
            "data-tour": `${tourTarget}-editor`,
            "data-tour-ready": !isEmpty ? "true" : undefined,
          })}
        >
          {attachments.length > 0 && (
            <InputGroupAddon align="block-start">
              <AttachmentsBar
                attachments={attachments}
                onRemove={removeAttachment}
              />
            </InputGroupAddon>
          )}
          <div
            className={clsx(
              "cli-editor-scroll relative min-h-[50px] w-full flex-1 overflow-y-auto px-2 py-2 text-[14px]",
              editorHeight === "large" ? "max-h-[45vh]" : "max-h-[200px]",
            )}
          >
            <EditorContent editor={editor} />
          </div>
          <InputGroupAddon align="block-end">
            <AttachmentMenu
              disabled={disabled}
              repoPath={repoPath}
              onAddAttachment={addAttachment}
              onAttachFiles={onAttachFiles}
              onInsertChip={insertChip}
            />
            {modeOption && onModeChange && (
              <ModeSelector
                modeOption={modeOption}
                onChange={onModeChange}
                allowBypassPermissions={allowBypassPermissions}
                disabled={disabled}
              />
            )}
            {modelSelector && <span>{modelSelector}</span>}
            {reasoningSelector && <span>{reasoningSelector}</span>}
            {isBashMode && (
              <Text className="font-mono text-(--blue-9) text-[13px]">
                ! bash
              </Text>
            )}
            <span className="ml-auto flex items-center gap-1">
              {historyButton}
              {submitButton}
            </span>
          </InputGroupAddon>
        </InputGroup>
      </Flex>
    );
  },
);

PromptInput.displayName = "PromptInput";
