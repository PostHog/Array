import { Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { TaskActivityPane } from "./task-detail/TaskActivityPane";
import { TaskOverviewPane } from "./task-detail/TaskOverviewPane";
import { useTaskDetailState } from "./task-detail/useTaskDetailState";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const {
    task,
    workflowStages,
    workflowOptions,
    currentStageName,
    form,
    submitForm,
    repositoryValue,
    showRepoWarning,
    repoWarningMessage,
    repoPathDisplay,
    taskState,
    handlers,
  } = useTaskDetailState(initialTask);

  const overviewHandlers = {
    onRunTask: handlers.onRunTask,
    onCancel: handlers.onCancel,
    onRunModeChange: handlers.onRunModeChange,
    onExecutionModeChange: handlers.onExecutionModeChange,
    onArtifactSelect: handlers.onArtifactSelect,
    onWorkflowChange: handlers.onWorkflowChange,
  };

  const activityHandlers = {
    onAnswersComplete: handlers.onAnswersComplete,
    onClearLogs: handlers.onClearLogs,
    onClosePlan: handlers.onClosePlan,
    onSavePlan: handlers.onSavePlan,
  };

  return (
    <Flex direction="column" height="100%">
      <Flex height="100%" style={{ flex: 1 }}>
        <TaskOverviewPane
          task={task}
          control={form.control}
          submitForm={submitForm}
          currentStageName={currentStageName}
          workflowOptions={workflowOptions}
          workflowStages={workflowStages}
          progress={taskState.progress}
          repositoryValue={repositoryValue}
          showRepoWarning={showRepoWarning}
          repoWarningMessage={repoWarningMessage}
          repoPath={taskState.repoPath}
          repoPathDisplay={repoPathDisplay}
          selectedArtifact={taskState.selectedArtifact}
          executionMode={taskState.executionMode}
          runMode={taskState.runMode}
          isRunning={taskState.isRunning}
          handlers={overviewHandlers}
        />

        <TaskActivityPane
          task={task}
          repoPath={taskState.repoPath}
          executionMode={taskState.executionMode}
          selectedArtifact={taskState.selectedArtifact}
          isRunning={taskState.isRunning}
          logs={taskState.logs}
          planModePhase={taskState.planModePhase}
          clarifyingQuestions={taskState.clarifyingQuestions}
          questionAnswers={taskState.questionAnswers}
          planContent={taskState.planContent}
          workflow={taskState.workflow}
          handlers={activityHandlers}
        />
      </Flex>
    </Flex>
  );
}
