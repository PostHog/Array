import { useDroppable } from "@dnd-kit/react";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import { PanelDropZones } from "@posthog/ui/features/panels/components/PanelDropZones";
import type { SplitDirection } from "@posthog/ui/features/panels/panelLayoutStore";
import type { PanelContent } from "@posthog/ui/features/panels/panelTypes";
import type { AddableTabKind } from "@posthog/ui/features/panels/tabAvailability";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { Box, Flex } from "@radix-ui/themes";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { AddTabControl } from "./AddTabControl";
import { PanelTab } from "./PanelTab";
import { TabBarButton } from "./TabBarButton";

const activeTabStyle: React.CSSProperties = {
  height: "100%",
  width: "100%",
};
const hiddenTabStyle: React.CSSProperties = {
  height: "100%",
  width: "100%",
  position: "absolute",
  top: 0,
  left: 0,
  visibility: "hidden",
  pointerEvents: "none",
};

interface TabbedPanelProps {
  panelId: string;
  content: PanelContent;
  onActiveTabChange?: (panelId: string, tabId: string) => void;
  onCloseOtherTabs?: (panelId: string, tabId: string) => void;
  onCloseTabsToRight?: (panelId: string, tabId: string) => void;
  onKeepTab?: (panelId: string, tabId: string) => void;
  onPanelFocus?: (panelId: string) => void;
  draggingTabId?: string | null;
  draggingTabPanelId?: string | null;
  onAddTab?: (kind: AddableTabKind) => void;
  addableTabKinds?: readonly AddableTabKind[];
  onSplitPanel?: (direction: SplitDirection) => void;
  rightContent?: React.ReactNode;
  emptyState?: React.ReactNode;
}

export const TabbedPanel: React.FC<TabbedPanelProps> = ({
  panelId,
  content,
  onActiveTabChange,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onKeepTab,
  onPanelFocus,
  draggingTabId = null,
  draggingTabPanelId = null,
  onAddTab,
  addableTabKinds = [],
  onSplitPanel,
  rightContent,
  emptyState,
}) => {
  const hostClient = useHostTRPCClient();

  const handleSplitClick = async () => {
    const result = await hostClient.contextMenu.showSplitContextMenu.mutate();
    const direction = (result.direction as SplitDirection | null) ?? null;
    if (direction) {
      onSplitPanel?.(direction);
    }
  };

  const handleCloseTab = (tabId: string) => {
    const tab = content.tabs.find((t) => t.id === tabId);
    if (tab?.onClose) {
      tab.onClose();
    }
  };

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { ref: droppableRef } = useDroppable({
    id: `tab-bar-${panelId}`,
    data: { panelId, type: "tab-bar" },
  });

  const tabBarRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      droppableRef(node);
    },
    [droppableRef],
  );

  useEffect(() => {
    if (!scrollContainerRef.current || !content.activeTabId) return;

    const activeTabIndex = content.tabs.findIndex(
      (tab) => tab.id === content.activeTabId,
    );
    if (activeTabIndex === -1) return;

    const container = scrollContainerRef.current;
    const tabElement = container.children[activeTabIndex] as HTMLElement;
    if (!tabElement) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = tabElement.getBoundingClientRect();

    if (tabRect.right > containerRect.right - 64) {
      tabElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "end",
      });
    } else if (tabRect.left < containerRect.left) {
      tabElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
    }
  }, [content.activeTabId, content.tabs]);

  return (
    <Box
      position="relative"
      height="100%"
      id="tabbed-panel"
      className="flex flex-col"
    >
      {content.showTabs !== false && (
        <Box
          className="relative h-[32px] shrink-0 border-b"
          id="tabbed-panel-tab-bar"
          style={{
            borderColor: "var(--gray-6)",
          }}
        >
          <Flex
            ref={tabBarRef}
            className="scrollbar-overlay absolute top-0 right-0 left-0 h-[36px] items-start"
          >
            {content.tabs.map((tab, index) => (
              <PanelTab
                key={tab.id}
                tabId={tab.id}
                panelId={panelId}
                label={tab.label}
                tabData={tab.data}
                isActive={tab.id === content.activeTabId}
                index={index}
                draggable={tab.draggable}
                closeable={tab.closeable !== false}
                isPreview={tab.isPreview}
                onSelect={() => {
                  onActiveTabChange?.(panelId, tab.id);
                  onPanelFocus?.(panelId);
                  tab.onSelect?.();
                }}
                onClose={
                  tab.closeable !== false
                    ? () => handleCloseTab(tab.id)
                    : undefined
                }
                onCloseOthers={() => onCloseOtherTabs?.(panelId, tab.id)}
                onCloseToRight={() => onCloseTabsToRight?.(panelId, tab.id)}
                onKeep={() => onKeepTab?.(panelId, tab.id)}
                icon={tab.icon}
                hasUnsavedChanges={tab.hasUnsavedChanges}
                badge={tab.badge}
              />
            ))}
            {content.droppable && onAddTab && (
              <AddTabControl
                addableTabKinds={addableTabKinds}
                onAddTab={onAddTab}
              />
            )}
            {/* Spacer to increase DND area */}
            {content.droppable && (
              <Box flexShrink="0" className="h-[32px] min-w-[90px]" />
            )}
          </Flex>
          {(rightContent || (content.droppable && onSplitPanel)) && (
            <Flex
              align="center"
              className="absolute top-0 right-0 h-[32px] border-b border-b-(--gray-6) border-l border-l-(--gray-6) bg-(--color-background)"
            >
              {rightContent}
              {content.droppable && onSplitPanel && (
                <Tooltip content="Split panel" side="bottom">
                  <TabBarButton
                    ariaLabel="Split panel"
                    onClick={handleSplitClick}
                  >
                    <SquareSplitHorizontalIcon width={12} height={12} />
                  </TabBarButton>
                </Tooltip>
              )}
            </Flex>
          )}
        </Box>
      )}

      <Box
        flexGrow="1"
        className="overflow-hidden"
        position="relative"
        onClick={() => onPanelFocus?.(panelId)}
      >
        {content.tabs.length > 0 &&
        content.tabs.some((t) => t.id === content.activeTabId) ? (
          content.tabs.map((tab) => (
            <div
              key={tab.id}
              style={
                tab.id === content.activeTabId ? activeTabStyle : hiddenTabStyle
              }
            >
              {tab.component}
            </div>
          ))
        ) : emptyState ? (
          emptyState
        ) : (
          <Flex
            align="center"
            justify="center"
            height="100%"
            className="bg-(--gray-2)"
          >
            <Box>No content</Box>
          </Flex>
        )}

        {content.droppable && (
          <PanelDropZones
            panelId={panelId}
            isDragging={!!draggingTabId}
            allowSplit={
              // Allow split if:
              // 1. Current panel has > 1 tab (same-panel split), OR
              // 2. Dragging from a different panel (cross-panel split)
              content.tabs.length > 1 ||
              (draggingTabPanelId !== null && draggingTabPanelId !== panelId)
            }
          />
        )}
      </Box>
    </Box>
  );
};
