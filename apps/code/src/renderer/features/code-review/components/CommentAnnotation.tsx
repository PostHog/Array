import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import { PaperPlaneTilt, X } from "@phosphor-icons/react";
import type { AnnotationSide } from "@pierre/diffs";
import { Button, Checkbox, Flex, IconButton, Text } from "@radix-ui/themes";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReviewDraftsStore } from "../stores/reviewDraftsStore";
import { buildInlineCommentPrompt } from "../utils/reviewPrompts";

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

  // Keep the checkbox in sync if another action toggles batchEnabled while
  // this textarea is open (e.g. user adds a draft elsewhere).
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

  const submitLabel = editingDraftId
    ? "Update comment"
    : batch
      ? "Add to review"
      : "Send to agent";

  return (
    <div className="px-3 py-1.5">
      <div
        data-comment-annotation=""
        className="whitespace-normal rounded-md border border-(--gray-5) bg-(--gray-2) px-2.5 py-2 font-sans"
      >
        <textarea
          ref={setTextareaRef}
          placeholder="Describe the changes you'd like..."
          onKeyDown={handleKeyDown}
          className="min-h-[48px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-1.5 text-(--gray-12) text-[13px] leading-normal outline-none"
        />
        <Flex align="center" justify="between" gap="3" className="mt-1.5">
          <Flex align="center" gap="3">
            <Button size="1" onClick={handleSubmit}>
              <PaperPlaneTilt size={12} weight="fill" />
              {submitLabel}
            </Button>
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={onDismiss}
            >
              <X size={12} />
            </IconButton>
          </Flex>
          {!editingDraftId && (
            <Text as="label" size="1" color="gray">
              <Flex align="center" gap="1.5" className="cursor-pointer">
                <Checkbox
                  size="1"
                  checked={batch}
                  onCheckedChange={(value) => setBatch(value === true)}
                />
                Add to review
              </Flex>
            </Text>
          )}
        </Flex>
      </div>
    </div>
  );
}
