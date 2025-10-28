import type { Task } from "@shared/types";
import {
  type OrderByField,
  type OrderDirection,
  TASK_STATUS_ORDER,
} from "../stores/taskStore.types";

export function getTaskStatus(task: Task): string {
  const hasPR = task.latest_run?.output?.pr_url;
  return hasPR ? "completed" : task.latest_run?.status || "backlog";
}

export function sortTasks(
  tasks: Task[],
  orderBy: OrderByField,
  orderDirection: OrderDirection,
): Task[] {
  return [...tasks].sort((a, b) => {
    let compareResult = 0;

    switch (orderBy) {
      case "created_at":
        compareResult =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case "status": {
        const statusA = getTaskStatus(a);
        const statusB = getTaskStatus(b);
        const indexA = TASK_STATUS_ORDER.indexOf(statusA);
        const indexB = TASK_STATUS_ORDER.indexOf(statusB);

        // Use index-based comparison if both found, otherwise alphabetical
        if (indexA !== -1 && indexB !== -1) {
          compareResult = indexA - indexB;
        } else if (indexA !== -1) {
          compareResult = -1;
        } else if (indexB !== -1) {
          compareResult = 1;
        } else {
          compareResult = statusA.localeCompare(statusB);
        }
        break;
      }
      case "title":
        compareResult = a.title.localeCompare(b.title);
        break;
      case "repository": {
        const repoA = a.repository_config
          ? `${a.repository_config.organization}/${a.repository_config.repository}`
          : "";
        const repoB = b.repository_config
          ? `${b.repository_config.organization}/${b.repository_config.repository}`
          : "";
        compareResult = repoA.localeCompare(repoB);
        break;
      }
      case "working_directory":
        compareResult = 0;
        break;
      case "source":
        compareResult = a.origin_product.localeCompare(b.origin_product);
        break;
      default:
        compareResult = 0;
    }

    return orderDirection === "asc" ? compareResult : -compareResult;
  });
}
