import React, { useCallback } from 'react';
import { Flex, Box, Text, IconButton, Kbd } from '@radix-ui/themes';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useTabStore } from '../stores/tabStore';
import { useHotkeys } from 'react-hotkeys-hook';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore();

  // Keyboard navigation handlers
  const handlePrevTab = useCallback(() => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  const handleNextTab = useCallback(() => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  const handleCloseTab = useCallback(() => {
    console.log('Closing tab');
    if (tabs.length > 1) {
      closeTab(activeTabId);
    }
  }, [tabs, activeTabId, closeTab]);

  // Tab switching by number handlers
  const handleSwitchToTab = useCallback((index: number) => {
    if (tabs[index]) {
      setActiveTab(tabs[index].id);
    }
  }, [tabs, setActiveTab]);

  const HOTKEYS = {
    CTRL_PREV_TAB: 'ctrl+shift+[',
    MOD_PREV_TAB: 'mod+shift+[',
    CTRL_NEXT_TAB: 'ctrl+shift+]',
    MOD_NEXT_TAB: 'mod+shift+]',
    CTRL_CLOSE_TAB: 'ctrl+w',
    MOD_CLOSE_TAB: 'mod+w',
    // Cmd/Ctrl+1 through Cmd/Ctrl+9
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`TAB_${i + 1}`, `mod+${i + 1}, ctrl+${i + 1}`])
    ),
  };

  useHotkeys(Object.values(HOTKEYS), (event, { hotkey }) => {
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
  }, [handlePrevTab, handleNextTab, handleCloseTab, handleSwitchToTab]);

  return (
    <Flex className="drag border-b border-gray-6" height="40px">
      {/* Spacer for macOS window controls */}
      <Box width="80px" flexShrink="0" />

      {tabs.map((tab, index) => (
        <Flex
          key={tab.id}
          className={`no-drag cursor-pointer border-r border-gray-6 transition-colors group ${tab.id === activeTabId
            ? 'bg-accent-3 text-accent-12 border-b-2 border-b-accent-8 font-medium'
            : 'text-gray-11 hover:bg-gray-3 hover:text-gray-12'
            }`}
          align="center"
          px="4"
          onClick={() => setActiveTab(tab.id)}
        >
          {index < 9 && (
            <Kbd size="1" className="mr-2 opacity-70">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}{index + 1}
            </Kbd>
          )}

          <Text
            size="2"
            className={`max-w-[200px] overflow-hidden select-none text-ellipsis whitespace-nowrap ${tab.id === activeTabId ? 'font-medium' : ''
              }`}
            mr="2"
          >
            {tab.title}
          </Text>

          {tabs.length > 1 && (
            <IconButton
              size="1"
              variant="ghost"
              color={tab.id === activeTabId ? "accent" : "gray"}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <Cross2Icon />
            </IconButton>
          )}
        </Flex>
      ))}
    </Flex>
  );
}