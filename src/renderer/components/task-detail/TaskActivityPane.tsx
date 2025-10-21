import type { AgentEvent } from "@posthog/agent";
import { Box } from "@radix-ui/themes";
import type {
  ClarifyingQuestion,
  PlanModePhase,
  QuestionAnswer,
  Task,
  Workflow,
} from "@shared/types";
import { AsciiArt } from "../AsciiArt";
import { LogView } from "../LogView";
import { PlanEditor } from "../PlanEditor";
import { PlanView } from "../PlanView";

interface TaskActivityPaneHandlers {
  onAnswersComplete: (
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ) => Promise<void>;
  onClearLogs: () => void;
  onClosePlan: () => void;
  onSavePlan: (content: string) => void;
}

interface TaskActivityPaneProps {
  task: Task;
  repoPath: string | null;
  executionMode: "plan" | "workflow";
  selectedArtifact: string | null;
  isRunning: boolean;
  logs: AgentEvent[];
  planModePhase: PlanModePhase;
  clarifyingQuestions: ClarifyingQuestion[];
  questionAnswers: QuestionAnswer[];
  planContent: string | null;
  workflow: Workflow | null;
  handlers: TaskActivityPaneHandlers;
}

export function TaskActivityPane({
  task,
  repoPath,
  executionMode,
  selectedArtifact,
  isRunning,
  logs,
  planModePhase,
  clarifyingQuestions,
  questionAnswers,
  planContent,
  workflow,
  handlers,
}: TaskActivityPaneProps) {
  return (
    <Box
      width="50%"
      className="bg-panel-solid"
      style={{ position: "relative" }}
    >
      <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <AsciiArt scale={1} opacity={0.1} />
      </Box>
      <Box style={{ position: "relative", zIndex: 1, height: "100%" }}>
        {selectedArtifact && repoPath ? (
          <PlanEditor
            taskId={task.id}
            repoPath={repoPath}
            fileName={selectedArtifact}
            onClose={handlers.onClosePlan}
            onSave={handlers.onSavePlan}
          />
        ) : executionMode === "plan" ? (
          <PlanView
            task={task}
            repoPath={repoPath}
            phase={planModePhase}
            questions={clarifyingQuestions}
            answers={questionAnswers}
            logs={logs}
            isRunning={isRunning}
            planContent={planContent}
            selectedArtifact={selectedArtifact}
            onAnswersComplete={handlers.onAnswersComplete}
            onClearLogs={handlers.onClearLogs}
            onClosePlan={handlers.onClosePlan}
            onSavePlan={handlers.onSavePlan}
          />
        ) : (
          <LogView
            logs={logs}
            isRunning={isRunning}
            onClearLogs={handlers.onClearLogs}
            workflow={workflow}
          />
        )}
      </Box>
    </Box>
  );
}
