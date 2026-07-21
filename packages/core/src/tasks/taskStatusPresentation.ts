import { readPrUrls } from "@posthog/shared";

export type TaskStatusPresentationKind =
  | "pr"
  | "completed"
  | "failed"
  | "running"
  | "started"
  | "chat";

export function getTaskStatusPresentationKind(task: {
  latest_run?: {
    environment?: "local" | "cloud";
    status: string;
    output: Record<string, unknown> | null;
  };
}): TaskStatusPresentationKind {
  const latestRun = task.latest_run;

  if (readPrUrls(latestRun?.output)[0]) {
    return "pr";
  }

  if (latestRun?.environment === "cloud") {
    return "chat";
  }

  switch (latestRun?.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "in_progress":
      return "running";
    case "queued":
    case "started":
      return "started";
    default:
      return "chat";
  }
}
