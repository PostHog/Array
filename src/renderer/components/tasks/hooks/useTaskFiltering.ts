import type { Task } from "@shared/types";
import { useMemo } from "react";
import type { OrderByField, OrderDirection } from "../../../stores/taskStore";

export function useTaskFiltering(
  tasks: Task[],
  orderBy: OrderByField,
  orderDirection: OrderDirection,
  filter: string,
) {
  return useMemo(() => {
    // Sort tasks
    const orderedTasks = [...tasks].sort((a, b) => {
      let compareResult = 0;

      switch (orderBy) {
        case "created_at":
          compareResult =
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "status":
          compareResult = (a.status || "").localeCompare(b.status || "");
          break;
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

    // Filter tasks
    return orderedTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(filter.toLowerCase()) ||
        task.description?.toLowerCase().includes(filter.toLowerCase()),
    );
  }, [tasks, orderBy, orderDirection, filter]);
}
