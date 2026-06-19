import type { Task } from "@posthog/shared/domain-types";
import { BrowserPanel } from "../../browser/BrowserPanel";
import { CodeEditorPanel } from "../../code-editor/components/CodeEditorPanel";
import { CloudReviewPage } from "../../code-review/components/CloudReviewPage";
import { ReviewPage } from "../../code-review/components/ReviewPage";
import type { Tab } from "../../panels/panelTypes";
import { useIsWorkspaceCloudRun } from "../../workspace/useWorkspace";
import { ActionPanel } from "./ActionPanel";
import { CanvasInstructionsTab } from "./CanvasInstructionsTab";
import { ChangesPanel } from "./ChangesPanel";
import { ChannelContextTab } from "./ChannelContextTab";
import { FileTreePanel } from "./FileTreePanel";
import { TaskLogsPanel } from "./TaskLogsPanel";
import { TaskShellPanel } from "./TaskShellPanel";

interface TabContentRendererProps {
  tab: Tab;
  taskId: string;
  task: Task;
  panelId: string;
}

export function TabContentRenderer({
  tab,
  taskId,
  task,
  panelId,
}: TabContentRendererProps) {
  const isCloud = useIsWorkspaceCloudRun(taskId);
  const { data } = tab;

  switch (data.type) {
    case "logs":
      return <TaskLogsPanel taskId={taskId} task={task} />;

    case "terminal":
      return (
        <TaskShellPanel taskId={taskId} task={task} shellId={data.terminalId} />
      );

    case "file":
      return (
        <CodeEditorPanel
          taskId={taskId}
          task={task}
          absolutePath={data.absolutePath}
        />
      );

    case "review": {
      return isCloud ? (
        <CloudReviewPage task={task} />
      ) : (
        <ReviewPage task={task} />
      );
    }

    case "action":
      return (
        <ActionPanel
          taskId={taskId}
          actionId={data.actionId}
          command={data.command}
          cwd={data.cwd}
        />
      );

    case "context":
      return (
        <ChannelContextTab channelName={data.channelName} body={data.body} />
      );

    case "canvas-instructions":
      return <CanvasInstructionsTab body={data.body} />;

    case "browser":
      return (
        <BrowserPanel
          browserId={data.browserId}
          initialUrl={data.url}
          taskId={taskId}
          panelId={panelId}
        />
      );

    case "other":
      switch (tab.id) {
        case "files":
          return <FileTreePanel taskId={taskId} task={task} />;
        case "changes":
          return <ChangesPanel taskId={taskId} task={task} />;
        default:
          return <div>Unknown tab: {tab.id}</div>;
      }

    default:
      return <div>Unknown tab type</div>;
  }
}
