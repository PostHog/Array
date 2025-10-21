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
import type { Task, TaskRun, WorkflowStage } from "@shared/types";
import { format, formatDistanceToNow } from "date-fns";
import { type Control, Controller } from "react-hook-form";
import { Combobox } from "../Combobox";
import { RichTextEditor } from "../RichTextEditor";
import { TaskArtifacts } from "../TaskArtifacts";
import type { TaskDetailFormValues } from "./useTaskDetailState";

interface TaskOverviewPaneHandlers {
  onRunTask: () => void;
  onCancel: () => void;
  onRunModeChange: (mode: "local" | "cloud") => void;
  onExecutionModeChange: (mode: "plan" | "workflow") => void;
  onArtifactSelect: (fileName: string) => void;
  onWorkflowChange: (workflowId: string) => void;
}

interface TaskOverviewPaneProps {
  task: Task;
  control: Control<TaskDetailFormValues>;
  submitForm: () => void;
  currentStageName: string;
  workflowOptions: Array<{ value: string; label: string }>;
  workflowStages: WorkflowStage[];
  progress: TaskRun | null;
  repositoryValue: string;
  showRepoWarning: boolean;
  repoWarningMessage: string;
  repoPath: string | null;
  repoPathDisplay: string | null;
  selectedArtifact: string | null;
  executionMode: "plan" | "workflow";
  runMode: "local" | "cloud";
  isRunning: boolean;
  handlers: TaskOverviewPaneHandlers;
}

export function TaskOverviewPane({
  task,
  control,
  submitForm,
  currentStageName,
  workflowOptions,
  workflowStages,
  progress,
  repositoryValue,
  showRepoWarning,
  repoWarningMessage,
  repoPath,
  repoPathDisplay,
  selectedArtifact,
  executionMode,
  runMode,
  isRunning,
  handlers,
}: TaskOverviewPaneProps) {
  return (
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
                  ref={(element) => {
                    if (element && element.textContent !== field.value) {
                      element.textContent = field.value;
                    }
                  }}
                  onBlur={(event) => {
                    field.onChange(event.currentTarget.textContent || "");
                    submitForm();
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
                  onBlur={submitForm}
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
                          (workflowStage) =>
                            workflowStage.id === progress.current_stage,
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
                          handlers.onWorkflowChange(value);
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
                    <Tooltip content={repoWarningMessage}>
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
                    {repoPathDisplay}
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
          {repoPath && (
            <TaskArtifacts
              taskId={task.id}
              repoPath={repoPath}
              selectedArtifact={selectedArtifact}
              onArtifactSelect={handlers.onArtifactSelect}
            />
          )}

          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" style={{ color: "var(--gray-11)" }}>
              Mode
            </Text>
            <SegmentedControl.Root
              value={executionMode}
              onValueChange={(value) => {
                if (value === "workflow" && !task.workflow) {
                  return;
                }
                handlers.onExecutionModeChange(value as "plan" | "workflow");
              }}
              size="1"
            >
              <SegmentedControl.Item value="plan">Auto</SegmentedControl.Item>
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
              onClick={handlers.onRunTask}
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
                    handlers.onRunModeChange(
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
              onClick={handlers.onCancel}
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
  );
}
