import { ExternalLinkIcon, Pencil1Icon } from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Code,
  DataList,
  Flex,
  Link,
  SegmentedControl,
  Text,
  TextArea,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { format } from "date-fns";
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
      repository: task.repository_config
        ? `${task.repository_config.organization}/${task.repository_config.repository}`
        : "",
    },
  });

  const repositoryValue = watch("repository");

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
      repository: task.repository_config
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
    <Flex height="100%">
      {/* Left pane - Task details */}
      <Box width="50%" className="border-gray-6 border-r" overflowY="auto">
        <Box p="4">
          <Box mb="4">
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <Code
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
                  style={{ cursor: "text", outline: "none", width: "fit-content" }}
                />
              )}
            />
          </Box>

          <DataList.Root>
            <DataList.Item>
              <DataList.Label>Status</DataList.Label>
              <DataList.Value>
                <Badge color="gray">{currentStageName}</Badge>
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Progress</DataList.Label>
              <DataList.Value>
                {progress?.has_progress ? (
                  <Flex direction="column" gap="1">
                    <Badge
                      color={
                        progress.status === "completed"
                          ? "green"
                          : progress.status === "failed"
                            ? "red"
                            : "blue"
                      }
                    >
                      {progress.status?.replace(/_/g, " ") ?? "in progress"}
                    </Badge>
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
                ) : (
                  <Code size="2" color="gray">
                    No progress yet
                  </Code>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Workflow</DataList.Label>
              <DataList.Value>
                {workflowOptions.length > 0 ? (
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
                        size="2"
                      />
                    )}
                  />
                ) : (
                  <Code size="2" color="gray">
                    No workflows available
                  </Code>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Repository</DataList.Label>
              <DataList.Value>
                <Flex gap="2" align="center">
                  {repositories.length > 0 ? (
                    <Controller
                      name="repository"
                      control={control}
                      render={({ field }) => (
                        <Combobox
                          items={repositories.map((repo) => ({
                            value: `${repo.organization}/${repo.repository}`,
                            label: `${repo.organization}/${repo.repository}`,
                          }))}
                          value={field.value}
                          onValueChange={(value) => {
                            field.onChange(value);

                            let repositoryConfig:
                              | { organization: string; repository: string }
                              | undefined;

                            if (value) {
                              const [organization, repository] =
                                value.split("/");
                              if (organization && repository) {
                                repositoryConfig = { organization, repository };
                              }
                            }

                            updateTask({
                              taskId: task.id,
                              updates: { repository_config: repositoryConfig },
                            });
                          }}
                          placeholder="Select a repository..."
                          searchPlaceholder="Search repositories..."
                          emptyMessage="No repositories found"
                          size="2"
                        />
                      )}
                    />
                  ) : repositoryValue ? (
                    <Code size="2">{repositoryValue}</Code>
                  ) : (
                    <Code size="2" color="gray">
                      None
                    </Code>
                  )}
                  {repositoryValue && (
                    <Button
                      size="1"
                      variant="ghost"
                      onClick={() =>
                        window.electronAPI.openExternal(
                          `https://github.com/${repositoryValue}`,
                        )
                      }
                    >
                      <ExternalLinkIcon />
                    </Button>
                  )}
                </Flex>
              </DataList.Value>
            </DataList.Item>

            {task.github_branch && (
              <DataList.Item>
                <DataList.Label>Branch</DataList.Label>
                <DataList.Value>{task.github_branch}</DataList.Value>
              </DataList.Item>
            )}

            {task.github_pr_url && (
              <DataList.Item>
                <DataList.Label>Pull Request</DataList.Label>
                <DataList.Value>
                  <Link href={task.github_pr_url} target="_blank" size="2">
                    View Pull Request →
                  </Link>
                </DataList.Value>
              </DataList.Item>
            )}

            <DataList.Item>
              <DataList.Label>Created</DataList.Label>
              <DataList.Value>
                {format(new Date(task.created_at), "PPP p")}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Description</DataList.Label>
              <DataList.Value>
                <TextArea
                  {...register("description")}
                  onBlur={onSubmit}
                  placeholder="No description provided"
                  rows={3}
                  style={{ resize: "vertical", width: "100%" }}
                />
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Working Directory</DataList.Label>
              <DataList.Value>
                {repoPath ? (
                  <Button
                    size="1"
                    variant="ghost"
                    onClick={handleSelectRepo}
                    className="group cursor-pointer"
                  >
                    <Code variant="ghost" size="2">
                      {repoPath}
                    </Code>
                    <Pencil1Icon className="ml-2 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Button>
                ) : (
                  <Button size="1" variant="outline" onClick={handleSelectRepo}>
                    Choose folder
                  </Button>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Mode</DataList.Label>
              <DataList.Value>
                <SegmentedControl.Root
                  value={runMode}
                  onValueChange={handleRunModeChange}
                >
                  <SegmentedControl.Item value="local">
                    Local
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="cloud">
                    Cloud
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </DataList.Value>
            </DataList.Item>
          </DataList.Root>

          <Box mt="6">
            <Flex direction="column" gap="3">
              {!repoPath ? (
                <Button variant="classic" onClick={handleSelectRepo} size="3">
                  Choose working folder
                </Button>
              ) : (
                <Button
                  variant="classic"
                  onClick={handleRunTask}
                  disabled={isRunning}
                  size="3"
                >
                  {isRunning ? "Running..." : "Run Agent"}
                </Button>
              )}

              {isRunning && (
                <Button
                  onClick={handleCancel}
                  color="red"
                  size="3"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </Box>
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
  );
}
