import { Cloud as CloudIcon } from "@phosphor-icons/react";
import type { Task } from "@posthog/shared/domain-types";
import { Flex, Text } from "@radix-ui/themes";
import type React from "react";
import { useMemo } from "react";
import { useIsWorkspaceCloudRun } from "../../workspace/useWorkspace";
import { useTabInjection } from "../hooks/usePanelLayoutHooks";
import type { SplitDirection } from "../panelLayoutStore";
import type { LeafPanel } from "../panelTypes";
import { TabbedPanel } from "./TabbedPanel";

interface LeafNodeRendererProps {
  node: LeafPanel;
  taskId: string;
  task: Task;
  closeTab: (taskId: string, panelId: string, tabId: string) => void;
  closeOtherTabs: (panelId: string, tabId: string) => void;
  closeTabsToRight: (panelId: string, tabId: string) => void;
  keepTab: (panelId: string, tabId: string) => void;
  draggingTabId: string | null;
  draggingTabPanelId: string | null;
  onActiveTabChange: (panelId: string, tabId: string) => void;
  onPanelFocus: (panelId: string) => void;
  onAddTerminal: (panelId: string) => void;
  onSplitPanel: (panelId: string, direction: SplitDirection) => void;
}

export const LeafNodeRenderer: React.FC<LeafNodeRendererProps> = ({
  node,
  taskId,
  task,
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  keepTab,
  draggingTabId,
  draggingTabPanelId,
  onActiveTabChange,
  onPanelFocus,
  onAddTerminal,
  onSplitPanel,
}) => {
  const isCloud = useIsWorkspaceCloudRun(taskId);
  const inputTabs = useMemo(
    () =>
      isCloud
        ? node.content.tabs.filter((t) => t.data.type !== "terminal")
        : node.content.tabs,
    [node.content.tabs, isCloud],
  );
  const tabs = useTabInjection(inputTabs, node.id, taskId, task, closeTab);
  const activeTabId = tabs.some((t) => t.id === node.content.activeTabId)
    ? node.content.activeTabId
    : (tabs[0]?.id ?? node.content.activeTabId);

  const cloudEmptyState = useMemo(
    () =>
      isCloud ? (
        <Flex
          align="center"
          justify="center"
          height="100%"
          className="bg-(--gray-2)"
        >
          <Flex direction="column" align="center" gap="2">
            <CloudIcon size={24} className="text-gray-10" />
            <Text color="gray" className="text-sm">
              Cloud runs are read-only
            </Text>
          </Flex>
        </Flex>
      ) : undefined,
    [isCloud],
  );

  const contentWithComponents = {
    ...node.content,
    tabs,
    activeTabId,
  };

  return (
    <TabbedPanel
      panelId={node.id}
      content={contentWithComponents}
      onActiveTabChange={onActiveTabChange}
      onCloseOtherTabs={closeOtherTabs}
      onCloseTabsToRight={closeTabsToRight}
      onKeepTab={keepTab}
      onPanelFocus={onPanelFocus}
      draggingTabId={draggingTabId}
      draggingTabPanelId={draggingTabPanelId}
      onAddTerminal={isCloud ? undefined : () => onAddTerminal(node.id)}
      onSplitPanel={(direction) => onSplitPanel(node.id, direction)}
      emptyState={cloudEmptyState}
    />
  );
};
