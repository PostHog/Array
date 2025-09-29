import React, { useEffect, useState } from 'react';
import { Flex, Box, Heading, Text, Select, Card, Badge, Spinner } from '@radix-ui/themes';
import { useWorkflowStore } from '../stores/workflowStore';
import { useTaskStore } from '../stores/taskStore';
import { useStatusBarStore } from '../stores/statusBarStore';
import { Task, WorkflowStage } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';

interface WorkflowViewProps {
  onSelectTask: (task: Task) => void;
}

export function WorkflowView({ onSelectTask }: WorkflowViewProps) {
  const { workflows, selectedWorkflowId, fetchWorkflows, selectWorkflow, getTasksByStage, isLoading } = useWorkflowStore();
  const { fetchTasks } = useTaskStore();
  const { setStatusBar, reset } = useStatusBarStore();
  const [tasksByStage, setTasksByStage] = useState<Map<string, Task[]>>(new Map());

  useEffect(() => {
    fetchWorkflows();
    fetchTasks();
  }, [fetchWorkflows, fetchTasks]);

  useEffect(() => {
    if (selectedWorkflowId) {
      setTasksByStage(getTasksByStage(selectedWorkflowId));
    }
  }, [selectedWorkflowId, getTasksByStage]);

  const selectedWorkflow = workflows.find(w => w.id === selectedWorkflowId);

  useEffect(() => {
    const totalTasks = Array.from(tasksByStage.values()).reduce((sum, tasks) => sum + tasks.length, 0);

    setStatusBar({
      statusText: selectedWorkflow ? `Workflow: ${selectedWorkflow.name} (${totalTasks} tasks)` : 'Workflow view',
      keyHints: [
        {
          keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'K'],
          description: 'Command'
        },
        {
          keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'R'],
          description: 'Refresh'
        }
      ],
      mode: 'replace'
    });

    return () => {
      reset();
    };
  }, [setStatusBar, reset, selectedWorkflow, tasksByStage]);

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
      <Box height="100%" p="6">
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
    <Box height="100%" p="6">
      <Flex direction="column" height="100%">
      {/* Workflow selector */}
      <Box p="4" className="border-b border-gray-6">
        <Flex align="center" justify="between">
          <Heading size="4">Workflow View</Heading>
          <Select.Root
            value={selectedWorkflowId || ''}
            onValueChange={(value) => selectWorkflow(value || null)}
          >
            <Select.Trigger />
            <Select.Content>
              {workflows.filter(w => w.is_active).map(workflow => (
                <Select.Item key={workflow.id} value={workflow.id}>
                  {workflow.name} {workflow.is_default && '(Default)'}
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

      {/* Kanban board */}
      <Box flexGrow="1" p="4" overflowX="auto">
        <Flex gap="4" height="100%">
          {/* Workflow stages */}
          {selectedWorkflow?.stages
            .filter(stage => !stage.is_archived)
            .sort((a, b) => a.position - b.position)
            .map(stage => (
              <WorkflowColumn
                key={stage.id}
                stage={stage}
                tasks={tasksByStage.get(stage.id) || []}
                onSelectTask={onSelectTask}
              />
            ))}
        </Flex>
      </Box>
    </Flex>
    </Box>
  );
}

interface WorkflowColumnProps {
  stage: WorkflowStage;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

function WorkflowColumn({ stage, tasks, onSelectTask }: WorkflowColumnProps) {
  return (
    <Flex direction="column" flexShrink="0" width="320px">
      <Box
        p="3"
        className="rounded-t-3"
        style={{
          backgroundColor: `${stage.color}20`,
          borderBottom: `2px solid ${stage.color}`,
        }}
      >
        <Flex align="center" justify="between">
          <Text weight="medium">{stage.name}</Text>
          <Text size="2" color="gray">{tasks.length}</Text>
        </Flex>
        {stage.agent_name && (
          <Text size="1" color="gray">
            Automated by {stage.agent_name}
          </Text>
        )}
      </Box>

      <Box
        flexGrow="1"
        p="2"
        overflowY="auto"
        className="bg-panel-solid rounded-b-3"
      >
        {tasks.length === 0 ? (
          <Flex align="center" justify="center" py="8">
            <Text size="2" color="gray">
              No tasks in {stage.name}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap="2">
            {tasks.map(task => (
              <WorkflowTaskCard
                key={task.id}
                task={task}
                onClick={() => onSelectTask(task)}
              />
            ))}
          </Flex>
        )}
      </Box>
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
        <Text size="1" color="gray">{timeAgo}</Text>

        {task.origin_product && (
          <Badge size="1" color="gray">
            {task.origin_product.replace('_', ' ')}
          </Badge>
        )}
      </Flex>

      {task.repository_config && (
        <Text size="1" color="gray" className="font-mono">
          {task.repository_config.organization}/{task.repository_config.repository}
        </Text>
      )}
    </Card>
  );
}