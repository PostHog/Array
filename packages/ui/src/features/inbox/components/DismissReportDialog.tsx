import {
  DISMISSAL_REASON_OPTIONS,
  type DismissalReasonOptionValue,
  isDismissalReasonSnooze,
} from "@posthog/shared";
import type { SignalReport } from "@posthog/shared/domain-types";
import {
  AlertDialog,
  Flex,
  RadioGroup,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { Button } from "../../../primitives/Button";
import {
  ExplainedPauseLabel,
  ExplainedSuppressLabel,
} from "./utils/ExplainedDismissOptionLabels";

export interface DismissReportDialogResult {
  reason: DismissalReasonOptionValue;
  note: string;
}

export interface DismissReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: SignalReport;
  isSubmitting: boolean;
  /**
   * When snooze is not allowed for the current selection, the "Already fixed elsewhere"
   * option is disabled because that path snoozes instead of dismissing.
   */
  snoozeDisabledReason: string | null;
  onConfirm: (result: DismissReportDialogResult) => void;
}

export function DismissReportDialog({
  open,
  onOpenChange,
  report,
  isSubmitting,
  snoozeDisabledReason,
  onConfirm,
}: DismissReportDialogProps) {
  const [reason, setReason] = useState<DismissalReasonOptionValue | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote("");
    }
  }, [open]);

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm({ reason, note: note.trim() });
  };

  const alreadyFixedDisabled = snoozeDisabledReason !== null;

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>
          <Text className="text-balance font-bold text-lg">
            Dismiss report "
            {report.title?.trim() ? report.title : "Untitled signal"}"?
          </Text>
        </AlertDialog.Title>
        <AlertDialog.Description className="text-gray-10 text-sm">
          This report will be removed from your inbox.
          <br />
          Your feedback is saved on the report and helps the agent.
        </AlertDialog.Description>

        <Flex direction="column" gap="4" mt="4">
          <RadioGroup.Root
            size="1"
            value={reason ?? ""}
            onValueChange={(value) =>
              setReason(value as DismissalReasonOptionValue)
            }
          >
            <Flex direction="column" gap="2">
              {DISMISSAL_REASON_OPTIONS.map((option) => {
                const snoozesInsteadOfDismiss = isDismissalReasonSnooze(
                  option.value,
                );
                const disabled =
                  snoozesInsteadOfDismiss && alreadyFixedDisabled;

                return snoozesInsteadOfDismiss ? (
                  <ExplainedPauseLabel
                    key={option.value}
                    label={option.label}
                    value={option.value}
                    disabled={disabled}
                    disabledReason={disabled ? snoozeDisabledReason : undefined}
                  />
                ) : (
                  <ExplainedSuppressLabel
                    key={option.value}
                    label={option.label}
                    value={option.value}
                  />
                );
              })}
            </Flex>
          </RadioGroup.Root>

          <TextArea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional: add detail"
            size="1"
            rows={3}
            maxLength={4000}
            disabled={isSubmitting}
          />
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button
            variant="solid"
            disabled={!reason || isSubmitting}
            disabledReason={!reason ? "you haven't picked a reason" : null}
            onClick={handleConfirm}
            loading={isSubmitting}
          >
            Dismiss & teach the agent
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
