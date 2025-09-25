import React, { useEffect, useState } from 'react';
import { useWorkflowStore } from '../stores/workflowStore';
import { useTaskStore } from '../stores/taskStore';
import { Task, WorkflowStage } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

interface WorkflowViewProps {
  onSelectTask: (task: Task) => void;
}

export function WorkflowView({ onSelectTask }: WorkflowViewProps) {
  const { workflows, selectedWorkflowId, fetchWorkflows, selectWorkflow, getTasksByStage, isLoading } = useWorkflowStore();
  const { fetchTasks } = useTaskStore();
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

  if (isLoading && workflows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-dark-text-muted">Loading workflows...</div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-dark-text-muted mb-4">No workflows found</p>
          <p className="text-sm text-dark-text-muted">
            Create workflows in PostHog to organize your tasks
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-bg">
      {/* Workflow selector */}
      <div className="p-4 border-b border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-dark-text">Workflow View</h2>
          <select
            value={selectedWorkflowId || ''}
            onChange={(e) => selectWorkflow(e.target.value || null)}
            className="px-3 py-1 bg-dark-surface border border-dark-border rounded-md text-dark-text focus:ring-2 focus:ring-posthog-500 focus:border-transparent"
          >
            {workflows.filter(w => w.is_active).map(workflow => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name} {workflow.is_default && '(Default)'}
              </option>
            ))}
          </select>
        </div>
        {selectedWorkflow?.description && (
          <p className="mt-2 text-sm text-dark-text-muted">{selectedWorkflow.description}</p>
        )}
      </div>

      {/* Kanban board */}
      <div className="flex-1 p-4 overflow-x-auto">
        <div className="flex gap-4 h-full">
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
        </div>
      </div>
    </div>
  );
}

interface WorkflowColumnProps {
  stage: WorkflowStage;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

function WorkflowColumn({ stage, tasks, onSelectTask }: WorkflowColumnProps) {
  return (
    <div className="flex-shrink-0 w-80 flex flex-col">
      <div
        className="p-3 rounded-t-lg border-b-2"
        style={{
          backgroundColor: `${stage.color}20`,
          borderBottomColor: stage.color,
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-dark-text">{stage.name}</h3>
          <span className="text-sm text-dark-text-muted">{tasks.length}</span>
        </div>
        {stage.agent_name && (
          <span className="text-xs text-dark-text-muted">
            Automated by {stage.agent_name}
          </span>
        )}
      </div>

      <div className="flex-1 bg-dark-surface rounded-b-lg p-2 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-dark-text-muted text-sm">
            No tasks in {stage.name}
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => (
              <WorkflowTaskCard
                key={task.id}
                task={task}
                onClick={() => onSelectTask(task)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
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
    <div
      className="p-3 bg-dark-bg rounded-md border border-dark-border hover:border-posthog-500 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <h4 className="font-medium text-dark-text text-sm mb-1 line-clamp-2">
        {task.title}
      </h4>
      
      <div className="flex items-center gap-2 text-xs text-dark-text-muted">
        <span>{timeAgo}</span>
        
        {task.origin_product && (
          <span className="px-1.5 py-0.5 bg-dark-surface rounded">
            {task.origin_product.replace('_', ' ')}
          </span>
        )}
      </div>
      
      {task.repository_config && (
        <div className="mt-1 text-xs text-dark-text-muted">
          {task.repository_config.organization}/{task.repository_config.repository}
        </div>
      )}
    </div>
  );
}