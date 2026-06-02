import { TaskInput } from "@features/task-detail/components/TaskInput";
import { useAppView } from "@hooks/useAppView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

function CodeIndexRoute() {
  const view = useAppView();

  return (
    <TaskInput
      initialPrompt={view.initialPrompt}
      initialPromptKey={view.taskInputRequestId}
      initialCloudRepository={view.initialCloudRepository}
      initialModel={view.initialModel}
      initialMode={view.initialMode}
      reportAssociation={view.reportAssociation}
    />
  );
}
