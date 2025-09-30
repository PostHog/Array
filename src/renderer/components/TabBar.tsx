import { Cross2Icon } from "@radix-ui/react-icons";
import { Box, Flex, IconButton, Kbd, Text } from "@radix-ui/themes";
import type React from "react";
import { useCallback, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTabStore } from "../stores/tabStore";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTabs } =
    useTabStore();
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"left" | "right" | null>(
    null,
  );

  // Keyboard navigation handlers
  const handlePrevTab = useCallback(() => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  const handleNextTab = useCallback(() => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  const handleCloseTab = useCallback(() => {
    console.log("Closing tab");
    if (tabs.length > 1) {
      closeTab(activeTabId);
    }
  }, [tabs, activeTabId, closeTab]);

  // Tab switching by number handlers
  const handleSwitchToTab = useCallback(
    (index: number) => {
      if (tabs[index]) {
        setActiveTab(tabs[index].id);
      }
    },
    [tabs, setActiveTab],
  );

  const HOTKEYS = {
    CTRL_PREV_TAB: "ctrl+shift+[",
    MOD_PREV_TAB: "mod+shift+[",
    CTRL_NEXT_TAB: "ctrl+shift+]",
    MOD_NEXT_TAB: "mod+shift+]",
    CTRL_CLOSE_TAB: "ctrl+w",
    MOD_CLOSE_TAB: "mod+w",
    // Cmd/Ctrl+1 through Cmd/Ctrl+9
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `TAB_${i + 1}`,
        `mod+${i + 1}, ctrl+${i + 1}`,
      ]),
    ),
  };

  useHotkeys(
    Object.values(HOTKEYS),
    (_event, { hotkey }) => {
      switch (hotkey) {
        case HOTKEYS.CTRL_PREV_TAB:
        case HOTKEYS.MOD_PREV_TAB:
          handlePrevTab();
          break;
        case HOTKEYS.CTRL_NEXT_TAB:
        case HOTKEYS.MOD_NEXT_TAB:
          handleNextTab();
          break;
        case HOTKEYS.MOD_CLOSE_TAB:
        case HOTKEYS.CTRL_CLOSE_TAB:
          handleCloseTab();
          break;
        default: {
          // Check if it's a tab switching shortcut
          const tabMatch = hotkey.match(/[1-9]/);
          if (tabMatch) {
            const tabIndex = parseInt(tabMatch[0], 10) - 1;
            handleSwitchToTab(tabIndex);
          }
          break;
        }
      }
    },
    [handlePrevTab, handleNextTab, handleCloseTab, handleSwitchToTab],
  );

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const mouseX = e.clientX;

    setDragOverTab(tabId);
    setDropPosition(mouseX < midpoint ? "left" : "right");
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverTab(null);
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetTabId: string) => {
      e.preventDefault();
      const sourceTabId = e.dataTransfer.getData("text/plain");

      if (sourceTabId && sourceTabId !== targetTabId) {
        const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId);
        let targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);

        if (sourceIndex !== -1 && targetIndex !== -1) {
          // Adjust target index based on drop position
          if (dropPosition === "right") {
            targetIndex = targetIndex + 1;
          }

          // If moving to the right, adjust for the source being removed
          if (sourceIndex < targetIndex) {
            targetIndex = targetIndex - 1;
          }

          reorderTabs(sourceIndex, targetIndex);
        }
      }

      setDraggedTab(null);
      setDragOverTab(null);
      setDropPosition(null);
    },
    [tabs, reorderTabs, dropPosition],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
    setDragOverTab(null);
    setDropPosition(null);
  }, []);

  return (
    <Flex
      className="drag border-gray-6 border-b"
      height="40px"
      minHeight="40px"
    >
      {/* Spacer for macOS window controls */}
      <Box width="80px" flexShrink="0" />

      {tabs.map((tab, index) => {
        const isDragging = draggedTab === tab.id;
        const isDragOver = dragOverTab === tab.id;
        const showLeftIndicator = isDragOver && dropPosition === "left";
        const showRightIndicator = isDragOver && dropPosition === "right";

        return (
          <Flex
            key={tab.id}
            className={`no-drag group relative cursor-pointer border-gray-6 border-r border-b-2 transition-colors ${
              tab.id === activeTabId
                ? "border-b-accent-8 bg-accent-3 text-accent-12"
                : "border-b-transparent text-gray-11 hover:bg-gray-3 hover:text-gray-12"
            } ${isDragging ? "opacity-50" : ""}`}
            align="center"
            px="4"
            draggable
            onClick={() => setActiveTab(tab.id)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
          >
            {showLeftIndicator && (
              <Box
                className="absolute top-0 bottom-0 left-0 z-10 w-0.5 bg-accent-8"
                style={{ marginLeft: "-1px" }}
              />
            )}

            {showRightIndicator && (
              <Box
                className="absolute top-0 right-0 bottom-0 z-10 w-0.5 bg-accent-8"
                style={{ marginRight: "-1px" }}
              />
            )}
            {index < 9 && (
              <Kbd size="1" className="mr-2 opacity-70">
                {navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}
                {index + 1}
              </Kbd>
            )}

            <Text
              size="2"
              className="max-w-[200px] select-none overflow-hidden text-ellipsis whitespace-nowrap"
              mr="2"
            >
              {tab.title}
            </Text>

            {tabs.length > 1 && (
              <IconButton
                size="1"
                variant="ghost"
                color={tab.id !== activeTabId ? "gray" : undefined}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Cross2Icon />
              </IconButton>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
}
