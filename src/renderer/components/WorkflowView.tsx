import { Pencil1Icon } from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  IconButton,
  Select,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { AsciiArt } from "@renderer/components/AsciiArt";
import { WorkflowForm } from "@renderer/components/WorkflowForm";
import { useTasks } from "@renderer/hooks/useTasks";
import { useAgents, useWorkflows } from "@renderer/hooks/useWorkflows";
import { useStatusBarStore } from "@renderer/stores/statusBarStore";
import { useWorkflowStore } from "@renderer/stores/workflowStore";
import type { Task, WorkflowStage } from "@shared/types";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useState } from "react";

interface WorkflowViewProps {
  onSelectTask: (task: Task) => void;
}

export function WorkflowView({ onSelectTask }: WorkflowViewProps) {
  const { data: workflows = [], isLoading: workflowsLoading } = useWorkflows();
  const { data: tasks = [] } = useTasks();
  const { data: agents = [] } = useAgents();
  const { selectedWorkflowId, selectWorkflow, getTasksByStage } =
    useWorkflowStore();
  const { setStatusBar, reset } = useStatusBarStore();
  const [workflowFormOpen, setWorkflowFormOpen] = useState(false);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId),
    [workflows, selectedWorkflowId],
  );

  const tasksByStage = useMemo(() => {
    if (!selectedWorkflowId) return new Map<string, Task[]>();
    return getTasksByStage(selectedWorkflowId, workflows, tasks);
  }, [selectedWorkflowId, workflows, tasks, getTasksByStage]);

  const isLoading = workflowsLoading;

  useEffect(() => {
    if (workflows.length > 0 && !selectedWorkflowId) {
      const defaultWorkflow =
        workflows.find((w) => w.is_active && w.is_default) ||
        workflows.find((w) => w.is_active) ||
        workflows[0];
      if (defaultWorkflow) {
        selectWorkflow(defaultWorkflow.id);
      }
    }
  }, [workflows, selectedWorkflowId, selectWorkflow]);

  useEffect(() => {
    const totalTasks = Array.from(tasksByStage.values()).reduce(
      (sum, tasks) => sum + tasks.length,
      0,
    );

    setStatusBar({
      statusText: selectedWorkflow
        ? `Workflow: ${selectedWorkflow.name} (${totalTasks} tasks)`
        : "Workflow view",
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
  }, [setStatusBar, selectedWorkflow, tasksByStage]);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  if (isLoading && workflows.length === 0) {
    return (
      <Box height="100%" p="6">
        <Flex align="center" justify="center" height="100%">
          <Flex align="center" gap="3">
            <Spinner size="3" />
            <Text color="gray">Loading workflows...</Text>
          </Flex>
        </Flex>
      </Box>
    );
  }

  if (workflows.length === 0) {
    return (
      <Box height="100%" p="2">
        <Flex align="center" justify="center" height="100%">
          <Flex direction="column" align="center" gap="2">
            <Text color="gray">No workflows found</Text>
            <Text size="2" color="gray">
              Create workflows in PostHog to organize your tasks
            </Text>
          </Flex>
        </Flex>
      </Box>
    );
  }

  return (
    <Box height="100%" style={{ position: "relative" }}>
      {/* Background ASCII Art */}
      <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <AsciiArt scale={1} opacity={0.1} />
      </Box>

      {/* Foreground Content */}
      <Box height="100%" p="2" style={{ position: "relative", zIndex: 1 }}>
        <Flex direction="column" height="100%">
          {/* Workflow selector */}
          <Box p="4" className="border-gray-6 border-b">
            <Flex align="center" justify="between">
              <Flex align="center" gap="2">
                <Heading size="4">
                  {selectedWorkflow?.name || "Workflow View"}
                </Heading>
                {selectedWorkflow && (
                  <IconButton
                    size="1"
                    variant="ghost"
                    onClick={() => setWorkflowFormOpen(true)}
                    title="Edit workflow"
                  >
                    <Pencil1Icon />
                  </IconButton>
                )}
              </Flex>
              <Select.Root
                value={selectedWorkflowId || ""}
                onValueChange={(value) => selectWorkflow(value || null)}
              >
                <Select.Trigger />
                <Select.Content>
                  {workflows
                    .filter((w) => w.is_active)
                    .map((workflow) => (
                      <Select.Item key={workflow.id} value={workflow.id}>
                        {workflow.name} {workflow.is_default && "(Default)"}
                      </Select.Item>
                    ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            {selectedWorkflow?.description && (
              <Text size="2" color="gray">
                {selectedWorkflow.description}
              </Text>
            )}
          </Box>

          <Box flexGrow="1" p="4" overflowX="auto">
            <Flex gap="4" height="100%">
              {selectedWorkflow?.stages
                .filter((stage) => !stage.is_archived)
                .sort((a, b) => a.position - b.position)
                .map((stage) => (
                  <WorkflowColumn
                    key={stage.id}
                    stage={stage}
                    tasks={tasksByStage.get(stage.id) || []}
                    agents={agents}
                    onSelectTask={onSelectTask}
                  />
                ))}
            </Flex>
          </Box>
        </Flex>
      </Box>

      <WorkflowForm
        open={workflowFormOpen}
        onOpenChange={setWorkflowFormOpen}
        workflow={selectedWorkflow}
      />
    </Box>
  );
}

interface WorkflowColumnProps {
  stage: WorkflowStage;
  tasks: Task[];
  agents: Array<{ id: string; name: string }>;
  onSelectTask: (task: Task) => void;
}

function WorkflowColumn({
  stage,
  tasks,
  agents,
  onSelectTask,
}: WorkflowColumnProps) {
  const agentName = stage.agent_name
    ? agents.find((a) => a.id === stage.agent_name)?.name || stage.agent_name
    : null;

  return (
    <Flex direction="column" flexShrink="0" width="320px">
      <Card>
        <Box p="3" className="rounded-t-3">
          <Flex align="center" justify="between">
            <Text weight="medium">{stage.name}</Text>
            <Text size="2" color="gray">
              {tasks.length}
            </Text>
          </Flex>

          <Text size="1" color="gray">
            {agentName ? `Automated by ${agentName}` : "\u00A0"}
          </Text>
        </Box>

        <Box flexGrow="1" p="2" overflowY="auto">
          {tasks.length === 0 ? (
            <Flex align="center" justify="center" py="8">
              <Text size="2" color="gray">
                No tasks in {stage.name}
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="2">
              {tasks.map((task) => (
                <WorkflowTaskCard
                  key={task.id}
                  task={task}
                  onClick={() => onSelectTask(task)}
                />
              ))}
            </Flex>
          )}
        </Box>
      </Card>
    </Flex>
  );
}

interface WorkflowTaskCardProps {
  task: Task;
  onClick: () => void;
}

function WorkflowTaskCard({ task, onClick }: WorkflowTaskCardProps) {
  const createdAt = new Date(task.created_at);
  const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true });

  return (
    <Card
      className="cursor-pointer transition-colors duration-200"
      onClick={onClick}
    >
      <Text weight="medium" size="2" mb="1" className="leading-tight">
        {task.title}
      </Text>

      <Flex align="center" gap="2" mb="1">
        <Text size="1" color="gray">
          {timeAgo}
        </Text>

        {task.origin_product && (
          <Badge size="1" color="gray">
            {task.origin_product.replace("_", " ")}
          </Badge>
        )}
      </Flex>

      {task.repository_config &&
      typeof task.repository_config === "object" &&
      "organization" in task.repository_config &&
      "repository" in task.repository_config ? (
        <Text size="1" color="gray" className="font-mono">
          {String(task.repository_config.organization)}/
          {String(task.repository_config.repository)}
        </Text>
      ) : null}
    </Card>
  );
}
