import { DiamondIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { GearIcon, GlobeIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Code,
  DataList,
  Flex,
  Heading,
  IconButton,
  Link,
  SegmentedControl,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type { ClarifyingQuestion, Task } from "@shared/types";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { useBlurOnEscape } from "../hooks/useBlurOnEscape";
import { useRepositoryIntegration } from "../hooks/useRepositoryIntegration";
import { useTasks, useUpdateTask } from "../hooks/useTasks";
import { useWorkflowStages, useWorkflows } from "../hooks/useWorkflows";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTabStore } from "../stores/tabStore";
import { useTaskExecutionStore } from "../stores/taskExecutionStore";
import {
  REPO_NOT_IN_INTEGRATION_WARNING,
  repoConfigToKey,
} from "../utils/repository";
import { AsciiArt } from "./AsciiArt";
import { Combobox } from "./Combobox";
import { LogView } from "./LogView";
import { PlanEditor } from "./PlanEditor";
import { PlanView } from "./PlanView";
import { RichTextEditor } from "./RichTextEditor";
import { TaskArtifacts } from "./TaskArtifacts";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const { setStatusBar, reset } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
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

  const task = tasks.find((t) => t.id === initialTask.id) || initialTask;

  const { data: workflowStages = [] } = useWorkflowStages(task.workflow || "");

  const workflowOptions = useMemo(
    () =>
      workflows.map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
      })),
    [workflows],
  );

  const currentStageName = useMemo(() => {
    if (!task.current_stage) return "Backlog";
    const stage = workflowStages.find((s) => s.id === task.current_stage);
    return stage?.name || task.current_stage;
  }, [task.current_stage, workflowStages]);

  const taskState = getTaskState(task.id);

  const {
    isRunning,
    logs,
    repoPath,
    runMode,
    progress,
    executionMode,
    planModePhase,
    clarifyingQuestions,
    questionAnswers,
    planContent,
    selectedArtifact,
    workflow,
  } = taskState;

  const {
    handleSubmit,
    reset: resetForm,
    control,
    watch,
  } = useForm({
    defaultValues: {
      title: task.title,
      description: task.description || "",
      workflow: task.workflow || "",
      repository: repoConfigToKey(task.repository_config),
    },
  });

  const repositoryValue = watch("repository");

  const showRepoWarning = useMemo(
    () => repositoryValue && !isRepoInIntegration(repositoryValue),
    [repositoryValue, isRepoInIntegration],
  );

  const displayRepoPath = useMemo(() => {
    if (!repoPath) return null;
    // Replace home directory with ~
    const homeDirPattern = /^\/Users\/[^/]+/; // macOS/Linux pattern
    if (homeDirPattern.test(repoPath)) {
      return repoPath.replace(homeDirPattern, "~");
    }
    return repoPath;
  }, [repoPath]);

  // Initialize repoPath from mapping if task has repository_config
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

  // Default to first workflow if not set
  useEffect(() => {
    if (workflows.length > 0 && !task.workflow) {
      const defaultWorkflow =
        workflows.find((w) => w.is_active && w.is_default) || workflows[0];
      if (defaultWorkflow) {
        updateTask({
          taskId: task.id,
          updates: { workflow: defaultWorkflow.id },
        });
      }
    }
  }, [workflows, task.workflow, task.id, updateTask]);

  // Auto-switch to auto mode if no workflow is assigned
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
      reset();
    };
  }, [setStatusBar, reset, isRunning]);

  useBlurOnEscape();

  // Keyboard shortcut: Shift+Tab to toggle execution mode
  useHotkeys(
    "shift+tab",
    (e) => {
      e.preventDefault();
      const newMode = executionMode === "plan" ? "workflow" : "plan";
      setExecutionMode(task.id, newMode);
    },
    {
      enableOnFormTags: true,
    },
  );

  const handleRunTask = () => {
    runTask(task.id, task);
  };

  const handleCancel = () => {
    cancelTask(task.id);
  };

  const handleRunModeChange = (value: string) => {
    setStoreRunMode(task.id, value as "local" | "cloud");
  };

  const handleClearLogs = () => {
    clearTaskLogs(task.id);
  };

  const handleExecutionModeChange = (value: string) => {
    setExecutionMode(task.id, value as "plan" | "workflow");
  };

  const handleAnswersComplete = async (
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ) => {
    // Save all answers to store
    for (const answer of answers) {
      addQuestionAnswer(task.id, answer);
    }

    // Save answers to questions.json
    if (repoPath) {
      try {
        await window.electronAPI?.saveQuestionAnswers(
          repoPath,
          task.id,
          answers,
        );
        console.log("Answers saved to questions.json");

        // Set phase to planning and trigger next run
        setPlanModePhase(task.id, "planning");

        // Trigger the next phase (planning) by running the task again
        runTask(task.id, task);
      } catch (error) {
        console.error("Failed to save answers to questions.json:", error);
      }
    }
  };

  const handleClosePlan = () => {
    setPlanModePhase(task.id, "idle");
    setSelectedArtifact(task.id, null);
  };

  const handleSavePlan = (content: string) => {
    setPlanContent(task.id, content);
  };

  const handleArtifactSelect = (fileName: string) => {
    setSelectedArtifact(task.id, fileName);
    // If in plan mode, this will open the editor automatically via PlanView
  };

  // Listen for research_questions artifact event from agent
  useEffect(() => {
    // Check logs for research_questions artifact event
    const artifactEvent = logs.find(
      (log) => log.type === "artifact" && "kind" in log && "content" in log,
    );

    if (artifactEvent && clarifyingQuestions.length === 0) {
      // Type guard to check if the content is an array of questions
      const event = artifactEvent as {
        type: string;
        ts: number;
        kind?: string;
        content?: Array<{
          id: string;
          question: string;
          options: string[];
        }>;
      };

      if (event.kind === "research_questions" && event.content) {
        const questions = event.content;

        console.log(
          "[TaskDetail] Received research_questions artifact with",
          questions.length,
          "questions",
        );

        // Convert to ClarifyingQuestion format
        const clarifyingQs: ClarifyingQuestion[] = questions.map(
          (q: { id: string; question: string; options: string[] }) => ({
            id: q.id,
            question: q.question,
            options: q.options,
            requiresInput: q.options.some((opt: string) =>
              opt.toLowerCase().includes("something else"),
            ),
          }),
        );

        setClarifyingQuestions(task.id, clarifyingQs);
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

  // Listen for plan completion
  useEffect(() => {
    if (planModePhase === "planning" && !isRunning) {
      // Plan generation completed, load plan content and switch to review
      const loadPlan = async () => {
        if (repoPath) {
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
        }
      };
      loadPlan();
    }
  }, [
    planModePhase,
    isRunning,
    repoPath,
    task.id,
    setPlanContent,
    setPlanModePhase,
  ]);

  const onSubmit = handleSubmit((data) => {
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

  return (
    <Flex direction="column" height="100%">
      <Flex height="100%" style={{ flex: 1 }}>
        <Box width="50%" className="border-gray-6 border-r" overflowY="auto">
          <Box p="4">
            <Flex direction="column" gap="4">
              <Flex direction="row" gap="2" align="baseline">
                <Code
                  size="3"
                  color="gray"
                  variant="ghost"
                  style={{ flexShrink: 0 }}
                >
                  {task.slug}
                </Code>
                <Controller
                  name="title"
                  control={control}
                  render={({ field }) => (
                    <Heading
                      size="5"
                      contentEditable
                      suppressContentEditableWarning
                      ref={(el) => {
                        if (el && el.textContent !== field.value) {
                          el.textContent = field.value;
                        }
                      }}
                      onBlur={(e) => {
                        field.onChange(e.currentTarget.textContent || "");
                        onSubmit();
                      }}
                      style={{
                        cursor: "text",
                        outline: "none",
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                  )}
                />
              </Flex>

              <Flex direction="column">
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <RichTextEditor
                      value={field.value}
                      onChange={field.onChange}
                      repoPath={repoPath}
                      placeholder="No description provided. Use @ to mention files, or format text with markdown."
                      onBlur={onSubmit}
                      showToolbar={true}
                      minHeight="100px"
                      style={{
                        minHeight: "100px",
                      }}
                    />
                  )}
                />

                <Box className="border-gray-6 border-t" mt="4" />
              </Flex>

              <DataList.Root>
                <DataList.Item>
                  <DataList.Label>Status</DataList.Label>
                  <DataList.Value>
                    <Button size="1" color="gray">
                      {currentStageName}
                    </Button>
                  </DataList.Value>
                </DataList.Item>

                {progress && (
                  <DataList.Item>
                    <DataList.Label>Run Status</DataList.Label>
                    <DataList.Value>
                      <Text size="2">
                        {progress.status.replace(/_/g, " ")}
                        {progress.current_stage &&
                          (() => {
                            const stage = workflowStages.find(
                              (s) => s.id === progress.current_stage,
                            );
                            return stage
                              ? ` · ${stage.name}`
                              : ` · ${progress.current_stage}`;
                          })()}
                      </Text>
                    </DataList.Value>
                  </DataList.Item>
                )}

                {workflowOptions.length > 0 && (
                  <DataList.Item>
                    <DataList.Label>Workflow</DataList.Label>
                    <DataList.Value>
                      <Controller
                        name="workflow"
                        control={control}
                        rules={{ required: true }}
                        render={({ field }) => (
                          <Combobox
                            items={workflowOptions}
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              updateTask({
                                taskId: task.id,
                                updates: { workflow: value },
                              });
                            }}
                            placeholder="Select a workflow..."
                            searchPlaceholder="Search workflows..."
                            emptyMessage="No workflows found"
                            size="1"
                            variant="outline"
                            icon={<DiamondIcon />}
                          />
                        )}
                      />
                    </DataList.Value>
                  </DataList.Item>
                )}

                <DataList.Item>
                  <DataList.Label>Repository</DataList.Label>
                  <DataList.Value>
                    <Flex align="center" gap="2">
                      {repositoryValue ? (
                        <Code size="2" color="gray">
                          {repositoryValue}
                        </Code>
                      ) : (
                        <Text size="2" color="gray">
                          No repository connected
                        </Text>
                      )}
                      {showRepoWarning && (
                        <Tooltip content={REPO_NOT_IN_INTEGRATION_WARNING}>
                          <WarningCircleIcon
                            size={16}
                            weight="fill"
                            style={{ color: "var(--orange-9)" }}
                          />
                        </Tooltip>
                      )}
                    </Flex>
                  </DataList.Value>
                </DataList.Item>

                <DataList.Item>
                  <DataList.Label>Working Directory</DataList.Label>
                  <DataList.Value>
                    {repoPath ? (
                      <Code size="2" color="gray">
                        {displayRepoPath}
                      </Code>
                    ) : (
                      <Text size="2" color="gray">
                        Not set
                      </Text>
                    )}
                  </DataList.Value>
                </DataList.Item>

                {task.github_branch && (
                  <DataList.Item>
                    <DataList.Label>Branch</DataList.Label>
                    <DataList.Value>
                      <Code size="2" color="gray">
                        {task.github_branch}
                      </Code>
                    </DataList.Value>
                  </DataList.Item>
                )}
              </DataList.Root>

              {task.github_pr_url && (
                <Link href={task.github_pr_url} target="_blank" size="2">
                  View Pull Request
                </Link>
              )}

              <Tooltip content={format(new Date(task.created_at), "PPP p")}>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  style={{ width: "fit-content" }}
                >
                  Created{" "}
                  {formatDistanceToNow(new Date(task.created_at), {
                    addSuffix: true,
                  })}
                </Button>
              </Tooltip>
            </Flex>

            <Flex direction="column" gap="3" mt="4">
              {/* Task Artifacts */}
              {repoPath && (
                <TaskArtifacts
                  taskId={task.id}
                  repoPath={repoPath}
                  selectedArtifact={selectedArtifact}
                  onArtifactSelect={handleArtifactSelect}
                />
              )}

              {/* Execution Mode Toggle */}
              <Flex direction="column" gap="1">
                <Text
                  size="1"
                  weight="medium"
                  style={{ color: "var(--gray-11)" }}
                >
                  Mode
                </Text>
                <SegmentedControl.Root
                  value={executionMode}
                  onValueChange={(value) => {
                    // Don't allow switching to workflow if no workflow assigned
                    if (value === "workflow" && !task.workflow) {
                      return;
                    }
                    handleExecutionModeChange(value);
                  }}
                  size="1"
                >
                  <SegmentedControl.Item value="plan">
                    Auto
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="workflow">
                    Workflow
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
                <Text size="1" style={{ color: "var(--gray-10)" }}>
                  {!task.workflow
                    ? "Auto mode (no workflow assigned)"
                    : "Press Shift+Tab to toggle"}
                </Text>
              </Flex>

              <Flex gap="2">
                <Button
                  variant="classic"
                  onClick={handleRunTask}
                  disabled={isRunning}
                  size="2"
                  style={{ flex: 1 }}
                >
                  {isRunning
                    ? "Running..."
                    : executionMode === "plan"
                      ? runMode === "cloud"
                        ? "Run Auto (Cloud)"
                        : "Run Auto (Local)"
                      : runMode === "cloud"
                        ? "Run Workflow (Cloud)"
                        : "Run Workflow (Local)"}
                </Button>
                {executionMode === "workflow" && (
                  <Tooltip content="Toggle between Local or Cloud Agent">
                    <IconButton
                      size="2"
                      variant="classic"
                      color={runMode === "cloud" ? "blue" : "gray"}
                      onClick={() =>
                        handleRunModeChange(
                          runMode === "local" ? "cloud" : "local",
                        )
                      }
                    >
                      {runMode === "cloud" ? <GlobeIcon /> : <GearIcon />}
                    </IconButton>
                  </Tooltip>
                )}
              </Flex>

              {isRunning && (
                <Button
                  onClick={handleCancel}
                  color="red"
                  size="2"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </Box>
        </Box>

        {/* Right pane - Logs/Plan View */}
        <Box
          width="50%"
          className="bg-panel-solid"
          style={{ position: "relative" }}
        >
          {/* Background ASCII Art */}
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
          {/* Foreground View (LogView, PlanView, or Artifact Editor) */}
          <Box style={{ position: "relative", zIndex: 1, height: "100%" }}>
            {selectedArtifact && repoPath ? (
              // Viewing an artifact - show editor regardless of mode
              <PlanEditor
                taskId={task.id}
                repoPath={repoPath}
                fileName={selectedArtifact}
                onClose={handleClosePlan}
                onSave={handleSavePlan}
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
                onAnswersComplete={handleAnswersComplete}
                onClearLogs={handleClearLogs}
                onClosePlan={handleClosePlan}
                onSavePlan={handleSavePlan}
              />
            ) : (
              <LogView
                logs={logs}
                isRunning={isRunning}
                onClearLogs={handleClearLogs}
                workflow={workflow}
              />
            )}
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
