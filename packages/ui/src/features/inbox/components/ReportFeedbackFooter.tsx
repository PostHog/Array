import { ThumbsDownIcon, ThumbsUpIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { INBOX_FEEDBACK_NOTE_MAX_LENGTH } from "@posthog/shared";
import type { SignalReport } from "@posthog/shared/types";
import { useReportFeedback } from "@posthog/ui/features/inbox/hooks/useReportFeedback";
import { Flex, Text, TextArea } from "@radix-ui/themes";

/**
 * Thumbs rating at the end of the report body, where the reader has just
 * finished reading. The rating submits on the first click, so there's no text
 * field to mistake for the dismissal reason. Only once it's recorded does an
 * optional note appear, so the note can never gate the rating, and ignoring it
 * leaves the flow exactly as it was.
 */
export function ReportFeedbackFooter({ report }: { report: SignalReport }) {
  const feedback = useReportFeedback(report);
  const isPositive = feedback.sentiment === "positive";
  const isNegative = feedback.sentiment === "negative";

  return (
    <Flex direction="column" gap="2">
      {/*
        `select-none` stays on the rating row: on the wrapper it would also cover
        the note field, where it blocks selecting text to edit or copy a draft.
      */}
      <Flex align="center" gap="2" wrap="wrap" className="select-none">
        <Text size="1" color="gray">
          {feedback.sentiment
            ? "Thanks for the feedback"
            : "Was this report useful?"}
        </Text>
        <Flex align="center" gap="1">
          <Button
            type="button"
            variant={isPositive ? "primary" : "outline"}
            size="sm"
            aria-label="This report was useful"
            aria-pressed={isPositive}
            title="Yes, this was useful"
            onClick={() => feedback.rate("positive")}
          >
            <ThumbsUpIcon size={12} weight={isPositive ? "fill" : "regular"} />
          </Button>
          <Button
            type="button"
            variant={isNegative ? "primary" : "outline"}
            size="sm"
            aria-label="This report was not useful"
            aria-pressed={isNegative}
            title="No, this wasn't useful"
            onClick={() => feedback.rate("negative")}
          >
            <ThumbsDownIcon
              size={12}
              weight={isNegative ? "fill" : "regular"}
            />
          </Button>
        </Flex>
        {feedback.sentiment && !feedback.noteOpen && !feedback.noteSent && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={feedback.openNote}
          >
            Add a note
          </Button>
        )}
        {feedback.noteSent && (
          <Text size="1" color="gray">
            Note added
          </Text>
        )}
      </Flex>
      {feedback.noteOpen && (
        <form
          className="flex max-w-prose flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            feedback.submitNote();
          }}
        >
          <TextArea
            // The placeholder is the only visible prompt and it disappears on
            // the first keystroke, so the field carries its own name for
            // screen readers.
            aria-label="Add a note about this report"
            autoFocus
            className="w-full"
            maxLength={INBOX_FEEDBACK_NOTE_MAX_LENGTH}
            placeholder="What was useful or off?"
            resize="vertical"
            rows={3}
            size="2"
            value={feedback.noteDraft}
            onChange={(event) => feedback.setNoteDraft(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!feedback.noteDraft.trim()}
            title={feedback.noteDraft.trim() ? undefined : "Write a note first"}
          >
            Send
          </Button>
        </form>
      )}
    </Flex>
  );
}
