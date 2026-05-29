import { ArrowUp, Trash } from "@phosphor-icons/react";
import type { AnnotationSide } from "@pierre/diffs";
import { buildInlineCommentPrompt } from "@posthog/core/code-review/reviewPrompts";
import {
  Checkbox,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@posthog/quill";
import { Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSendMessageSubmitKey } from "../../../utils/sendMessageKey";
import { sendPromptToAgent } from "../../sessions/sendPromptToAgent";
import { useReviewDraftsStore } from "../reviewDraftsStore";

interface CommentAnnotationProps {
  taskId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  side: AnnotationSide;
  onDismiss: () => void;
  initialText?: string;
  editingDraftId?: string;
}

export function CommentAnnotation({
  taskId,
  filePath,
  startLine,
  endLine,
  side,
  onDismiss,
  initialText,
  editingDraftId,
}: CommentAnnotationProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addDraft = useReviewDraftsStore((s) => s.addDraft);
  const updateDraft = useReviewDraftsStore((s) => s.updateDraft);
  const setBatchEnabled = useReviewDraftsStore((s) => s.setBatchEnabled);
  const initialBatchEnabled = useReviewDraftsStore((s) =>
    s.isBatchEnabled(taskId),
  );

  const [batch, setBatch] = useState(
    editingDraftId ? true : initialBatchEnabled,
  );
  const [isEmpty, setIsEmpty] = useState(!initialText?.trim());

  const setTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      (
        textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>
      ).current = el;
      if (el) {
        if (initialText !== undefined) {
          el.value = initialText;
        }
        requestAnimationFrame(() => el.focus());
      }
    },
    [initialText],
  );

  useEffect(() => {
    if (editingDraftId) return;
    setBatch(initialBatchEnabled);
  }, [initialBatchEnabled, editingDraftId]);

  const handleSubmit = useCallback(() => {
    const text = textareaRef.current?.value?.trim();
    if (!text) return;

    if (editingDraftId) {
      updateDraft(taskId, editingDraftId, text);
      onDismiss();
      return;
    }

    if (batch) {
      addDraft(taskId, { filePath, startLine, endLine, side, text });
      setBatchEnabled(taskId, true);
      onDismiss();
      return;
    }

    onDismiss();
    sendPromptToAgent(
      taskId,
      buildInlineCommentPrompt(filePath, startLine, endLine, side, text),
    );
  }, [
    taskId,
    filePath,
    startLine,
    endLine,
    side,
    onDismiss,
    batch,
    editingDraftId,
    addDraft,
    updateDraft,
    setBatchEnabled,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    },
    [handleSubmit, onDismiss],
  );

  const submitTooltip = isEmpty
    ? "Enter a comment"
    : editingDraftId
      ? "Save"
      : batch
        ? "Add to review"
        : "Send to agent";

  return (
    <div data-comment-annotation="" className="px-3 py-1.5 font-sans">
      <InputGroup>
        <InputGroupTextarea
          ref={setTextareaRef}
          placeholder="Describe the changes you'd like..."
          onKeyDown={handleKeyDown}
          onChange={(e) => setIsEmpty(!e.currentTarget.value.trim())}
          className="min-h-[48px] resize-none text-[13px]"
        />
        <InputGroupAddon align="block-end">
          <Tooltip content="Discard">
            <InputGroupButton
              size="icon-sm"
              variant="default"
              onClick={onDismiss}
              aria-label="Discard"
            >
              <Trash size={14} />
            </InputGroupButton>
          </Tooltip>
          <div className="ml-auto flex items-center gap-3">
            {!editingDraftId && (
              <Text as="label" size="1" color="gray">
                <span className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    size="sm"
                    checked={batch}
                    onCheckedChange={(value) => setBatch(value === true)}
                  />
                  Add to review
                </span>
              </Text>
            )}
            <Tooltip content={submitTooltip}>
              <InputGroupButton
                size="icon-sm"
                variant="primary"
                onClick={handleSubmit}
                disabled={isEmpty}
                aria-label={editingDraftId ? "Save" : "Submit"}
              >
                <ArrowUp size={14} weight="bold" />
              </InputGroupButton>
            </Tooltip>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
