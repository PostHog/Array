import type { Schemas } from "@api/generated";
import type { TreeNode } from "@components/ui/sidebar/Types";
import { useTasks } from "@features/tasks/hooks/useTasks";
import type { ActiveFilters } from "@features/tasks/stores/taskStore";
import { getUserDisplayName } from "@hooks/useUsers";
import { filtersMatch } from "@lib/filters";
import {
  CheckCircleIcon,
  CircleIcon,
  FolderIcon,
  GearIcon,
  ListNumbersIcon,
  PlusIcon,
  VideoIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { TabState, Task } from "@shared/types";

interface TaskView {
  label: string;
  filters: ActiveFilters;
}

interface UseSidebarMenuDataProps {
  userName: string;
  activeTab: TabState | undefined;
  isLoading: boolean;
  activeFilters: ActiveFilters;
  currentUser: Schemas.User| undefined;
  setActiveFilters: (filters: ActiveFilters) => void;
  onNavigate: (
    type: "task-list" | "recordings" | "notetaker" | "settings",
    title: string,
  ) => void;
  onTaskClick: (task: Task) => void;
  onCreateTask: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onProjectClick: (repository: string) => void;
}

function getStatusIcon(status?: string) {
  if (status === "in_progress" || status === "started") {
    return (
      <CircleIcon size={12} weight="fill" style={{ color: "var(--blue-9)" }} />
    );
  }
  if (status === "completed") {
    return (
      <CheckCircleIcon
        size={12}
        weight="fill"
        style={{ color: "var(--green-9)" }}
      />
    );
  }
  if (status === "failed") {
    return (
      <XCircleIcon size={12} weight="fill" style={{ color: "var(--red-9)" }} />
    );
  }
  return <CircleIcon size={12} style={{ color: "var(--gray-8)" }} />;
}

export function useSidebarMenuData({
  userName,
  activeTab,
  isLoading,
  activeFilters,
  currentUser,
  setActiveFilters,
  onNavigate,
  onTaskClick,
  onCreateTask,
  onProjectClick,
}: UseSidebarMenuDataProps): TreeNode {
  const { data: allTasks = [] } = useTasks();
  const relevantTasks = allTasks
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 10);

  const repositoryMap = new Map<string, { fullPath: string; name: string }>();
  for (const task of allTasks) {
    const { organization, repository } = task.repository_config || {};
    if (organization && repository) {
      const fullPath = `${organization}/${repository}`;
      repositoryMap.set(fullPath, { fullPath, name: repository });
    }
  }

  const repositories = Array.from(repositoryMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const activeRepositoryFilters = activeFilters.repository || [];
  const activeRepositoryValue =
    activeRepositoryFilters.length === 1
      ? activeRepositoryFilters[0].value
      : null;

  const views: TaskView[] = [];

  if (currentUser) {
    const userDisplayName = getUserDisplayName(currentUser);
    views.push({
      label: "My tasks",
      filters: {
        creator: [{ value: userDisplayName, operator: "is" }],
      },
    });
  }

  views.push({
    label: "All tasks",
    filters: {},
  });

  return {
    label: userName,
    children: [
      ...views.map((view): TreeNode => {
        const isActive =
          activeTab?.type === "task-list" &&
          filtersMatch(activeFilters, view.filters);
        return {
          label: view.label,
          icon: (
            <ListNumbersIcon size={12} weight={isActive ? "fill" : "regular"} />
          ),
          action: () => {
            setActiveFilters(view.filters);
            onNavigate("task-list", "Tasks");
          },
          isActive,
          hoverAction: onCreateTask,
          hoverIcon: <PlusIcon size={12} />,
        };
      }),
      {
        label: "Notetaker",
        icon: (
          <VideoIcon
            size={12}
            weight={activeTab?.type === "notetaker" ? "fill" : "regular"}
          />
        ),
        action: () => onNavigate("notetaker", "Notetaker"),
        isActive: activeTab?.type === "notetaker",
      },
      {
        label: "Settings",
        icon: (
          <GearIcon
            size={12}
            weight={activeTab?.type === "settings" ? "fill" : "regular"}
          />
        ),
        forceSeparator: true,
        action: () => onNavigate("settings", "Settings"),
        isActive: activeTab?.type === "settings",
      },
      ...(relevantTasks.length > 0
        ? [
            {
              label: "Tasks",
              icon: <ListNumbersIcon size={12} />,
              children: relevantTasks.map((task): TreeNode => {
                const status = task.latest_run?.status || "pending";
                const statusLabel = status.replace("_", " ");
                const isActiveTask = !!(
                  activeTab?.type === "task-detail" &&
                  activeTab.data &&
                  typeof activeTab.data === "object" &&
                  "id" in activeTab.data &&
                  activeTab.data.id === task.id
                );
                return {
                  label: task.title,
                  icon: getStatusIcon(status),
                  action: () => onTaskClick(task),
                  isActive: isActiveTask,
                  tooltip: `${task.slug} | ${task.title} (${statusLabel})`,
                };
              }),
              forceSeparator: true,
            },
          ]
        : []),
      {
        label: "Projects",
        icon: <FolderIcon size={12} />,
        children: isLoading
          ? [{ label: "Loading..." }]
          : repositories.length > 0
            ? repositories.map(
                (repo): TreeNode => ({
                  label: repo.name,
                  action: () => onProjectClick(repo.fullPath),
                  isActive: activeRepositoryValue === repo.fullPath,
                }),
              )
            : [{ label: "No projects found" }],
      },
    ],
  };
}
