import { PlanEditor } from "@features/editor/components/PlanEditor";
import { LogView } from "@features/logs/components/LogView";
import { InteractiveTerminal } from "@features/terminal/components/InteractiveTerminal";
import type { AgentEvent } from "@posthog/agent";
import { Box } from "@radix-ui/themes";
import type { PlanModePhase, Task } from "@shared/types";

interface PlanViewProps {
  task: Task;
  repoPath: string | null;
  phase: PlanModePhase;
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    requiresInput: boolean;
  }>;
  answers: Array<{
    questionId: string;
    selectedOption: string;
    customInput?: string;
  }>;
  logs: AgentEvent[];
  isRunning: boolean;
  planContent: string | null;
  selectedArtifact: string | null;
  onAnswersComplete: (
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ) => void;
  onClearLogs?: () => void;
  onClosePlan?: () => void;
  onSavePlan?: (content: string) => void;
}

export function PlanView({
  task,
  repoPath,
  phase,
  questions,
  answers,
  logs,
  isRunning,
  planContent,
  selectedArtifact,
  onAnswersComplete,
  onClearLogs,
  onClosePlan,
  onSavePlan,
}: PlanViewProps) {
  // Show interactive questions when in questions phase
  if (phase === "questions" && questions.length > 0) {
    return (
      <Box height="100%" width="100%">
        <InteractiveTerminal
          questions={questions}
          answers={answers}
          onAnswersComplete={onAnswersComplete}
        />
      </Box>
    );
  }

  // Show plan editor when in review phase (artifacts handled at TaskDetail level)
  if (phase === "review" && repoPath && !selectedArtifact) {
    return (
      <Box height="100%" width="100%">
        <PlanEditor
          taskId={task.id}
          repoPath={repoPath}
          fileName="plan.md"
          initialContent={planContent || undefined}
          onClose={onClosePlan}
          onSave={onSavePlan}
        />
      </Box>
    );
  }

  // Default: show logs
  return (
    <Box height="100%" width="100%">
      <LogView logs={logs} isRunning={isRunning} onClearLogs={onClearLogs} />
    </Box>
  );
}
