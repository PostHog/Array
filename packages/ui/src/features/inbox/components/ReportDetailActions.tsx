import {
  CaretDownIcon,
  ChatCircleIcon,
  GitPullRequestIcon,
} from "@phosphor-icons/react";
import { extractRepoSelectionRepository } from "@posthog/core/inbox/artefacts";
import { canCreateImplementationPr } from "@posthog/core/inbox/reportActions";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { useCreatePrReport } from "@posthog/ui/features/inbox/hooks/useCreatePrReport";
import { useDiscussReport } from "@posthog/ui/features/inbox/hooks/useDiscussReport";
import { useInboxReportArtefacts } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useReportActionTracker } from "@posthog/ui/features/inbox/hooks/useReportActionTracker";
import { Flex, Popover, Spinner, Text, TextArea } from "@radix-ui/themes";
import { useCallback, useState } from "react";

interface ReportDetailActionsProps {
  report: SignalReport;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function ReportDetailActions({ report }: ReportDetailActionsProps) {
  const showCreatePr = canCreateImplementationPr(report);
  const { data: artefactsResp } = useInboxReportArtefacts(report.id);
  const cloudRepository = extractRepoSelectionRepository(
    artefactsResp?.results,
  );

  const fireAction = useReportActionTracker(report);

  const { discussReport, isDiscussing } = useDiscussReport({
    reportId: report.id,
    reportTitle: report.title ?? null,
    cloudRepository,
  });

  const { createPrReport, isCreatingPr } = useCreatePrReport({
    reportId: report.id,
    reportTitle: report.title ?? null,
    cloudRepository,
  });

  const [discussQuestion, setDiscussQuestion] = useState("");
  const [discussOpen, setDiscussOpen] = useState(false);

  const submitDiscuss = useCallback(() => {
    const trimmed = discussQuestion.trim();
    if (!trimmed) return;
    fireAction("discuss", {
      has_question: true,
      question_text: trimmed.slice(0, 500),
    });
    setDiscussQuestion("");
    setDiscussOpen(false);
    void discussReport(trimmed);
  }, [discussQuestion, discussReport, fireAction]);

  const handleCreatePr = useCallback(() => {
    fireAction("create_pr");
    void createPrReport();
  }, [createPrReport, fireAction]);

  const submitDisabled = discussQuestion.trim().length === 0 || isDiscussing;

  return (
    <>
      <Popover.Root
        open={discussOpen}
        onOpenChange={(next) => {
          setDiscussOpen(next);
          if (!next) setDiscussQuestion("");
        }}
      >
        <Popover.Trigger>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDiscussing}
            className="gap-1"
            title="Discuss this report with your agent"
          >
            {isDiscussing ? <Spinner size="1" /> : <ChatCircleIcon size={12} />}
            Discuss
            <CaretDownIcon size={12} />
          </Button>
        </Popover.Trigger>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          className="w-[420px] border border-(--gray-6) bg-(--color-panel-solid) p-3 shadow-6"
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitDiscuss();
            }}
          >
            <TextArea
              aria-label="Question to discuss with the agent"
              autoFocus
              placeholder="Ask about this report…"
              resize="vertical"
              rows={5}
              size="2"
              value={discussQuestion}
              onChange={(event) => setDiscussQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitDiscuss();
                }
              }}
            />
            <Flex justify="between" align="center" gap="2">
              <Text size="1" color="gray">
                {isMac ? "⌘↵" : "Ctrl+↵"} to send
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDiscussOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={submitDisabled}
                >
                  Discuss
                </Button>
              </Flex>
            </Flex>
          </form>
        </Popover.Content>
      </Popover.Root>

      {showCreatePr && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={isCreatingPr}
          onClick={handleCreatePr}
          title="Have Self-driving open a pull request for this report"
        >
          {isCreatingPr ? (
            <Spinner size="1" />
          ) : (
            <GitPullRequestIcon size={12} />
          )}
          Create PR
        </Button>
      )}
    </>
  );
}
