import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@posthog/quill";
import {
  FEEDBACK_SURVEY_ID,
  FEEDBACK_SURVEY_QUESTION_ID,
} from "@posthog/ui/features/canvas/feedbackSurvey";
import { captureSurveyResponse } from "@posthog/ui/shell/analytics";
import { useState } from "react";

export type FeedbackModalMode = "feedback" | "leaving";

export interface FeedbackModalProps {
  /** `null` closes the modal. `"leaving"` shows a Skip button, `"feedback"` a Cancel button. */
  mode: FeedbackModalMode | null;
  /** Called after the response is submitted, and when the modal is skipped/cancelled/dismissed. */
  onFinished: () => void;
}

/**
 * Feedback modal for the Channels space. Submitting records the text as a
 * PostHog survey response (see {@link FEEDBACK_SURVEY_ID}). The secondary button
 * reads "Skip" when opened by "Go back to Code" (`mode === "leaving"`) and
 * "Cancel" when opened by "Leave feedback".
 */
export function FeedbackModal({ mode, onFinished }: FeedbackModalProps) {
  const open = mode !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Esc / outside-click dismiss behaves like the secondary button.
        if (!isOpen) onFinished();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave feedback</DialogTitle>
          <DialogDescription>
            How's the Channels experience? Tell us what's working and what you'd
            change.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open so the textarea resets on each open without
            syncing state to the `mode` prop in an effect. */}
        {mode !== null && (
          <FeedbackModalForm mode={mode} onFinished={onFinished} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackModalForm({
  mode,
  onFinished,
}: {
  mode: FeedbackModalMode;
  onFinished: () => void;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const response = value.trim();
    if (!response) return;
    captureSurveyResponse({
      surveyId: FEEDBACK_SURVEY_ID,
      questionId: FEEDBACK_SURVEY_QUESTION_ID,
      response,
    });
    onFinished();
  };

  return (
    <>
      <DialogBody>
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Share your feedback"
          rows={4}
          maxLength={4000}
          autoFocus
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onFinished}>
          {mode === "leaving" ? "Skip" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={value.trim().length === 0}
          onClick={handleSubmit}
        >
          Send feedback
        </Button>
      </DialogFooter>
    </>
  );
}
