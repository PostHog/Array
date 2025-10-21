import type { Task, WorkflowStage } from "@shared/types";
import { useEffect, useMemo } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { useBlurOnEscape } from "../../hooks/useBlurOnEscape";
import { useRepositoryIntegration } from "../../hooks/useRepositoryIntegration";
import { useTasks, useUpdateTask } from "../../hooks/useTasks";
import { useWorkflowStages, useWorkflows } from "../../hooks/useWorkflows";
import { useStatusBarStore } from "../../stores/statusBarStore";
import { useTabStore } from "../../stores/tabStore";
import {
  type TaskExecutionState,
  useTaskExecutionStore,
} from "../../stores/taskExecutionStore";
import {
  REPO_NOT_IN_INTEGRATION_WARNING,
  repoConfigToKey,
} from "../../utils/repository";

export interface TaskDetailFormValues {
  title: string;
  description: string;
  workflow: string;
  repository: string;
}

export interface TaskDetailState {
  task: Task;
  workflowStages: WorkflowStage[];
  workflowOptions: Array<{ value: string; label: string }>;
  currentStageName: string;
  form: UseFormReturn<TaskDetailFormValues>;
  submitForm: () => void;
  repositoryValue: string;
  showRepoWarning: boolean;
  repoWarningMessage: string;
  repoPathDisplay: string | null;
  taskState: TaskExecutionState;
  handlers: {
    onRunTask: () => void;
    onCancel: () => void;
    onRunModeChange: (mode: "local" | "cloud") => void;
    onExecutionModeChange: (mode: "plan" | "workflow") => void;
    onClearLogs: () => void;
    onAnswersComplete: (
      answers: Array<{
        questionId: string;
        selectedOption: string;
        customInput?: string;
      }>,
    ) => Promise<void>;
    onClosePlan: () => void;
    onSavePlan: (content: string) => void;
    onArtifactSelect: (fileName: string) => void;
    onWorkflowChange: (workflowId: string) => void;
  };
}

export function useTaskDetailState(initialTask: Task): TaskDetailState {
  const { setStatusBar, reset: resetStatusBar } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode,
    runTask,
    cancelTask,
    clearTaskLogs,
    getRepoWorkingDir,
    setRepoPath,
    setExecutionMode,
    setPlanModePhase,
    setClarifyingQuestions,
    addQuestionAnswer,
    setPlanContent,
    setSelectedArtifact,
  } = useTaskExecutionStore();
  const { isRepoInIntegration } = useRepositoryIntegration();
  const { data: tasks = [] } = useTasks();
  const { mutate: updateTask } = useUpdateTask();
  const { updateTabTitle, activeTabId } = useTabStore();
  const { data: workflows = [] } = useWorkflows();

  const task = useMemo(() => {
    return tasks.find((t) => t.id === initialTask.id) ?? initialTask;
  }, [tasks, initialTask]);

  const { data: workflowStages = [] } = useWorkflowStages(task.workflow || "");

  const taskState = getTaskState(task.id);
  const {
    isRunning,
    logs,
    repoPath,
    executionMode,
    planModePhase,
    clarifyingQuestions,
  } = taskState;

  const form = useForm<TaskDetailFormValues>({
    defaultValues: {
      title: task.title,
      description: task.description || "",
      workflow: task.workflow || "",
      repository: repoConfigToKey(task.repository_config),
    },
  });

  const { handleSubmit, reset: resetForm, watch } = form;

  const workflowOptions = useMemo(
    () =>
      workflows.map((wf) => ({
        value: wf.id,
        label: wf.name,
      })),
    [workflows],
  );

  const currentStageName = useMemo(() => {
    if (!task.current_stage) return "Backlog";
    const stage = workflowStages.find((s) => s.id === task.current_stage);
    return stage?.name || task.current_stage;
  }, [task.current_stage, workflowStages]);

  const repositoryValue = watch("repository") ?? "";

  const showRepoWarning = Boolean(
    repositoryValue && !isRepoInIntegration(repositoryValue),
  );

  const repoPathDisplay = useMemo(() => {
    if (!repoPath) return null;
    const homeDirPattern = /^\/Users\/[^/]+/;
    return homeDirPattern.test(repoPath)
      ? repoPath.replace(homeDirPattern, "~")
      : repoPath;
  }, [repoPath]);

  useEffect(() => {
    if (task.repository_config && !repoPath) {
      const repoKey = repoConfigToKey(task.repository_config);
      if (repoKey) {
        const savedPath = getRepoWorkingDir(repoKey);
        if (savedPath) {
          setRepoPath(task.id, savedPath);
        }
      }
    }
  }, [
    task.id,
    task.repository_config,
    repoPath,
    getRepoWorkingDir,
    setRepoPath,
  ]);

  useEffect(() => {
    resetForm({
      title: task.title,
      description: task.description || "",
      workflow: task.workflow || "",
      repository: repoConfigToKey(task.repository_config),
    });
  }, [
    task.title,
    task.description,
    task.workflow,
    task.repository_config,
    resetForm,
  ]);

  const defaultWorkflow = useMemo(() => {
    return workflows.find((w) => w.is_active && w.is_default) ?? workflows[0];
  }, [workflows]);

  useEffect(() => {
    if (workflows.length > 0 && !task.workflow && defaultWorkflow) {
      updateTask({
        taskId: task.id,
        updates: { workflow: defaultWorkflow.id },
      });
    }
  }, [workflows, task.workflow, task.id, updateTask, defaultWorkflow]);

  useEffect(() => {
    if (!task.workflow && executionMode === "workflow") {
      setExecutionMode(task.id, "plan");
    }
  }, [task.workflow, executionMode, task.id, setExecutionMode]);

  useEffect(() => {
    setStatusBar({
      statusText: isRunning ? "Agent running..." : "Task details",
      keyHints: [
        {
          keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "K"],
          description: "Command",
        },
        {
          keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "R"],
          description: "Refresh",
        },
      ],
      mode: "replace",
    });

    return () => {
      resetStatusBar();
    };
  }, [setStatusBar, resetStatusBar, isRunning]);

  useBlurOnEscape();

  useHotkeys(
    "shift+tab",
    (event) => {
      event.preventDefault();
      const newMode = executionMode === "plan" ? "workflow" : "plan";
      setExecutionMode(task.id, newMode);
    },
    { enableOnFormTags: true },
  );

  useEffect(() => {
    const artifactEvent = logs.find(
      (log) => log.type === "artifact" && "kind" in log && "content" in log,
    );

    if (
      artifactEvent &&
      clarifyingQuestions.length === 0 &&
      "kind" in artifactEvent &&
      "content" in artifactEvent
    ) {
      const event = artifactEvent as {
        kind?: string;
        content?: Array<{
          id: string;
          question: string;
          options: string[];
        }>;
      };

      if (event.kind === "research_questions" && event.content) {
        const questions = event.content.map((question) => ({
          id: question.id,
          question: question.question,
          options: question.options,
          requiresInput: question.options.some((option) =>
            option.toLowerCase().includes("something else"),
          ),
        }));

        setClarifyingQuestions(task.id, questions);
        setPlanModePhase(task.id, "questions");
      }
    }
  }, [
    logs,
    clarifyingQuestions.length,
    task.id,
    setClarifyingQuestions,
    setPlanModePhase,
  ]);

  useEffect(() => {
    if (planModePhase === "planning" && !isRunning && repoPath) {
      const loadPlan = async () => {
        try {
          const content = await window.electronAPI?.readPlanFile(
            repoPath,
            task.id,
          );
          if (content) {
            setPlanContent(task.id, content);
            setPlanModePhase(task.id, "review");
          }
        } catch (error) {
          console.error("Failed to load plan:", error);
        }
      };
      void loadPlan();
    }
  }, [
    planModePhase,
    isRunning,
    repoPath,
    task.id,
    setPlanContent,
    setPlanModePhase,
  ]);

  const submitForm = handleSubmit((data) => {
    if (data.title !== task.title) {
      updateTask({ taskId: task.id, updates: { title: data.title } });
      if (activeTabId) {
        updateTabTitle(activeTabId, data.title);
      }
    }

    if (data.description !== task.description) {
      updateTask({
        taskId: task.id,
        updates: { description: data.description || undefined },
      });
    }
  });

  const onRunTask = () => {
    void runTask(task.id, task);
  };

  const onCancel = () => {
    void cancelTask(task.id);
  };

  const onRunModeChange = (mode: "local" | "cloud") => {
    setRunMode(task.id, mode);
  };

  const onExecutionModeChange = (mode: "plan" | "workflow") => {
    setExecutionMode(task.id, mode);
  };

  const onClearLogs = () => {
    clearTaskLogs(task.id);
  };

  const onAnswersComplete: TaskDetailState["handlers"]["onAnswersComplete"] =
    async (answers) => {
      answers.forEach((answer) => {
        addQuestionAnswer(task.id, answer);
      });

      if (repoPath) {
        try {
          await window.electronAPI?.saveQuestionAnswers(
            repoPath,
            task.id,
            answers,
          );
          setPlanModePhase(task.id, "planning");
          void runTask(task.id, task);
        } catch (error) {
          console.error("Failed to save questions:", error);
        }
      }
    };

  const onClosePlan = () => {
    setPlanModePhase(task.id, "idle");
    setSelectedArtifact(task.id, null);
  };

  const onSavePlan = (content: string) => {
    setPlanContent(task.id, content);
  };

  const onArtifactSelect = (fileName: string) => {
    setSelectedArtifact(task.id, fileName);
  };

  const onWorkflowChange = (workflowId: string) => {
    updateTask({
      taskId: task.id,
      updates: { workflow: workflowId },
    });
  };

  return {
    task,
    workflowStages,
    workflowOptions,
    currentStageName,
    form,
    submitForm,
    repositoryValue,
    showRepoWarning,
    repoWarningMessage: REPO_NOT_IN_INTEGRATION_WARNING,
    repoPathDisplay,
    taskState,
    handlers: {
      onRunTask,
      onCancel,
      onRunModeChange,
      onExecutionModeChange,
      onClearLogs,
      onAnswersComplete,
      onClosePlan,
      onSavePlan,
      onArtifactSelect,
      onWorkflowChange,
    },
  };
}
