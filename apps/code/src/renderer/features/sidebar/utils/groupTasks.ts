import { getTaskRepository, parseRepository } from "@renderer/utils/repository";
import { normalizeRepoKey } from "@shared/utils/repo";

export interface TaskRepositoryInfo {
  fullPath: string;
  name: string;
  organization?: string;
}

export interface GroupableTask {
  repository: TaskRepositoryInfo | null;
}

export interface TaskGroup<T extends GroupableTask> {
  id: string;
  name: string;
  tasks: T[];
}

export function getRepositoryInfo(
  task: { repository?: string | null },
  folderPath?: string,
): TaskRepositoryInfo | null {
  const repository = getTaskRepository(task);
  if (repository) {
    const normalized = normalizeRepoKey(repository);
    const parsed = parseRepository(normalized);
    if (parsed) {
      return {
        fullPath: normalized.toLowerCase(),
        name: parsed.repoName,
        organization: parsed.organization,
      };
    }
    // Malformed repository string (e.g. legacy single-segment values). Fall
    // through so the task lands in the folder-path or "other" bucket instead
    // of colliding with a real owner/repo group.
  }
  if (folderPath) {
    const name = folderPath.split("/").pop() ?? folderPath;
    return {
      fullPath: folderPath,
      name,
    };
  }
  return null;
}

export function groupByRepository<T extends GroupableTask>(
  tasks: T[],
  folderOrder: string[],
): TaskGroup<T>[] {
  const groupMap = new Map<string, TaskGroup<T>>();

  for (const task of tasks) {
    const repository = task.repository;
    const groupId = repository?.fullPath ?? "other";
    const groupName = repository?.name ?? "Other";

    let group = groupMap.get(groupId);
    if (!group) {
      group = { id: groupId, name: groupName, tasks: [] };
      groupMap.set(groupId, group);
    }

    group.tasks.push(task);
  }

  const groups = Array.from(groupMap.values());

  // Disambiguate groups that share a display name (e.g. `posthog/posthog`
  // and `jane/posthog` both rendering as "posthog") by prefixing the
  // organization when it's available.
  const nameCounts = new Map<string, number>();
  for (const group of groups) {
    nameCounts.set(group.name, (nameCounts.get(group.name) ?? 0) + 1);
  }
  for (const group of groups) {
    if ((nameCounts.get(group.name) ?? 0) > 1) {
      const organization = group.tasks[0]?.repository?.organization;
      if (organization) {
        group.name = `${organization}/${group.name}`;
      }
    }
  }

  if (folderOrder.length === 0) {
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups.sort((a, b) => {
    const aIndex = folderOrder.indexOf(a.id);
    const bIndex = folderOrder.indexOf(b.id);
    if (aIndex === -1 && bIndex === -1) {
      return a.name.localeCompare(b.name);
    }
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}
