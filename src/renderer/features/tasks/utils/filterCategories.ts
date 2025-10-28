import type { FilterCategory } from "@features/tasks/stores/taskStore";
import { getUserDisplayName } from "@hooks/useUsers";
import type { Task } from "@shared/types";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterCategoryConfig {
  label: string;
  category: FilterCategory;
  options: FilterOption[];
}

function getTaskStatus(task: Task): string {
  const hasPR = task.latest_run?.output?.pr_url;
  return hasPR ? "completed" : task.latest_run?.status || "backlog";
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const STATUS_ORDER = [
  "failed",
  "in_progress",
  "started",
  "completed",
  "backlog",
];

const CREATED_AT_OPTIONS: FilterOption[] = [
  { label: "Today", value: "Today" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Last 30 days", value: "Last 30 days" },
  { label: "Last 90 days", value: "Last 90 days" },
  { label: "Older", value: "Older" },
];

function sortByStatus(a: string, b: string): number {
  const aIndex = STATUS_ORDER.indexOf(a);
  const bIndex = STATUS_ORDER.indexOf(b);
  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

function sortWithEmptyLast(emptyValue: string) {
  return (a: string, b: string): number => {
    if (a === emptyValue) return 1;
    if (b === emptyValue) return -1;
    return a.localeCompare(b);
  };
}

export function getFilterCategories(tasks: Task[]): FilterCategoryConfig[] {
  const statusSet = new Set<string>();
  const sourceSet = new Set<string>();
  const creatorSet = new Set<string>();
  const repoSet = new Set<string>();

  for (const task of tasks) {
    statusSet.add(getTaskStatus(task));
    sourceSet.add(task.origin_product);

    if (task.created_by) {
      creatorSet.add(getUserDisplayName(task.created_by));
    } else {
      creatorSet.add("No Creator");
    }

    if (
      task.repository_config?.organization &&
      task.repository_config?.repository
    ) {
      repoSet.add(
        `${task.repository_config.organization}/${task.repository_config.repository}`,
      );
    } else {
      repoSet.add("No Repository Connected");
    }
  }

  return [
    {
      label: "Status",
      category: "status" as FilterCategory,
      options: Array.from(statusSet)
        .sort(sortByStatus)
        .map((status) => ({
          label: capitalizeFirst(status),
          value: status,
        })),
    },
    {
      label: "Source",
      category: "source" as FilterCategory,
      options: Array.from(sourceSet)
        .sort()
        .map((source) => ({ label: source, value: source })),
    },
    {
      label: "Creator",
      category: "creator" as FilterCategory,
      options: Array.from(creatorSet)
        .sort(sortWithEmptyLast("No Creator"))
        .map((creator) => ({ label: creator, value: creator })),
    },
    {
      label: "Repository",
      category: "repository" as FilterCategory,
      options: Array.from(repoSet)
        .sort(sortWithEmptyLast("No Repository Connected"))
        .map((repo) => ({ label: repo, value: repo })),
    },
    {
      label: "Created at",
      category: "created_at" as FilterCategory,
      options: CREATED_AT_OPTIONS,
    },
  ];
}
