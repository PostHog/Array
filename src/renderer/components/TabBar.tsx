import React from 'react';
import { Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useTabStore } from '../stores/tabStore';
import { useHotkeys } from 'react-hotkeys-hook';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore();

  // Keyboard shortcuts for tab navigation
  useHotkeys('cmd+shift+[, ctrl+shift+[', () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  useHotkeys('cmd+shift+], ctrl+shift+]', () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  useHotkeys('cmd+w, ctrl+w', () => {
    if (tabs.length > 1) {
      closeTab(activeTabId);
    }
  }, [tabs, activeTabId, closeTab]);

  return (
    <Flex className="drag border-b border-gray-6" height="40px">
      {/* Spacer for macOS window controls */}
      <Box width="80px" flexShrink="0" />

      {tabs.map((tab) => (
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