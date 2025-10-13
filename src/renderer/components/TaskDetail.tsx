import {
  DiamondIcon,
  FilesIcon,
  GitBranchIcon,
  GithubLogoIcon,
} from "@phosphor-icons/react";
import { GearIcon, GlobeIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  DataList,
  Flex,
  Heading,
  IconButton,
  Link,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useIntegrations, useRepositories } from "../hooks/useIntegrations";
import { useTasks, useUpdateTask } from "../hooks/useTasks";
import { useWorkflowStages, useWorkflows } from "../hooks/useWorkflows";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTabStore } from "../stores/tabStore";
import { useTaskExecutionStore } from "../stores/taskExecutionStore";
import { AsciiArt } from "./AsciiArt";
import { Combobox } from "./Combobox";
import { LogView } from "./LogView";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const { setStatusBar, reset } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
    selectRepositoryForTask,
    runTask,
    cancelTask,
    clearTaskLogs,
    getRepoWorkingDir,
    setRepoPath,
  } = useTaskExecutionStore();
  const { data: integrations = [] } = useIntegrations();
  const githubIntegration = useMemo(
    () => integrations.find((i) => i.kind === "github"),
    [integrations],
  );
  const { data: repositories = [] } = useRepositories(githubIntegration?.id);
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

  const { isRunning, logs, repoPath, runMode, progress } = taskState;

  const {
    register,
    handleSubmit,
    reset: resetForm,
    control,
    watch,
  } = useForm({
    defaultValues: {
      title: task.title,
      description: task.description || "",
      workflow: task.workflow || "",
      repository:
        task.repository_config &&
        task.repository_config.organization &&
        task.repository_config.repository
          ? `${task.repository_config.organization}/${task.repository_config.repository}`
          : "",
    },
  });

  const repositoryValue = watch("repository");

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
      const repoKey = `${task.repository_config.organization}/${task.repository_config.repository}`;
      const savedPath = getRepoWorkingDir(repoKey);
      if (savedPath) {
        setRepoPath(task.id, savedPath);
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
      repository:
        task.repository_config &&
        task.repository_config.organization &&
        task.repository_config.repository
          ? `${task.repository_config.organization}/${task.repository_config.repository}`
          : "",
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

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        document.activeElement instanceof HTMLElement
      ) {
        document.activeElement.blur();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  // Simple event handlers that delegate to store actions
  const handleSelectRepo = () => {
    const repoKey = repositoryValue || undefined;
    selectRepositoryForTask(task.id, repoKey);
  };

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
                      width: "100%",
                    }}
                  />
                )}
              />

              <Flex direction="column">
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <Text
                      size="3"
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
                        width: "100%",
                        minHeight: "3em",
                        whiteSpace: "pre-wrap",
                      }}
                      color={field.value ? undefined : "gray"}
                    >
                      {field.value || "No description provided"}
                    </Text>
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

                {progress?.has_progress && (
                  <DataList.Item>
                    <DataList.Label>Progress</DataList.Label>
                    <DataList.Value>
                      <Button
                        size="1"
                        color={
                          progress.status === "completed"
                            ? "green"
                            : progress.status === "failed"
                              ? "red"
                              : "blue"
                        }
                      >
                        {progress.status?.replace(/_/g, " ") ?? "in progress"}
                      </Button>
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
                    <Button size="1" variant="outline" color="gray">
                      <GithubLogoIcon />
                      {repositoryValue || "No repository connected"}
                    </Button>
                  </DataList.Value>
                </DataList.Item>

                <DataList.Item>
                  <DataList.Label>Working Directory</DataList.Label>
                  <DataList.Value>
                    {repoPath ? (
                      <Button
                        size="1"
                        variant="outline"
                        color="gray"
                        onClick={handleSelectRepo}
                      >
                        <FilesIcon />
                        {displayRepoPath}
                      </Button>
                    ) : (
                      <Button
                        size="1"
                        variant="outline"
                        color="gray"
                        onClick={handleSelectRepo}
                      >
                        <FilesIcon />
                        Choose folder
                      </Button>
                    )}
                  </DataList.Value>
                </DataList.Item>

                {task.github_branch && (
                  <DataList.Item>
                    <DataList.Label>Branch</DataList.Label>
                    <DataList.Value>
                      <Button size="1" variant="outline" color="gray">
                        <GitBranchIcon />
                        {task.github_branch}
                      </Button>
                    </DataList.Value>
                  </DataList.Item>
                )}
              </DataList.Root>

              <Box className="border-gray-6 border-t" />

              {task.github_pr_url && (
                <Link href={task.github_pr_url} target="_blank" size="2">
                  View Pull Request
                </Link>
              )}

              {progress?.has_progress && (
                <Flex direction="column" gap="1">
                  <Text size="2" color="gray">
                    Steps {progress.completed_steps ?? 0}/
                    {typeof progress.total_steps === "number"
                      ? progress.total_steps
                      : "?"}
                    {typeof progress.progress_percentage === "number"
                      ? ` · ${Math.round(progress.progress_percentage)}%`
                      : ""}
                  </Text>
                  {progress.current_step && (
                    <Text size="2" color="gray">
                      Current step: {progress.current_step}
                    </Text>
                  )}
                </Flex>
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
              {!repoPath ? (
                <Button variant="classic" onClick={handleSelectRepo} size="2">
                  Choose working folder
                </Button>
              ) : (
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
                      : runMode === "cloud"
                        ? "Run Agent"
                        : "Run Agent (Local)"}
                  </Button>
                  <Tooltip content="Toggle between Local or Cloud Agent">
                    <IconButton
                      size="2"
                      variant="classic"
                      color={runMode === "cloud" ? "accent" : "gray"}
                      onClick={() =>
                        handleRunModeChange(
                          runMode === "local" ? "cloud" : "local",
                        )
                      }
                    >
                      {runMode === "cloud" ? <GlobeIcon /> : <GearIcon />}
                    </IconButton>
                  </Tooltip>
                </Flex>
              )}

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

        {/* Right pane - Logs */}
        <Box
          width="50%"
          className="bg-panel-solid"
          style={{ position: "relative" }}
        >
          {/* Background ASCII Art */}
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
          {/* Foreground LogView */}
          <Box style={{ position: "relative", zIndex: 1, height: "100%" }}>
            <LogView
              logs={logs}
              isRunning={isRunning}
              onClearLogs={handleClearLogs}
            />
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
