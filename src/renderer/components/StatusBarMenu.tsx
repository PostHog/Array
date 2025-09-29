import React from 'react';
import { Flex, Text, DropdownMenu, Switch } from '@radix-ui/themes';
import { ChevronUpIcon, ExitIcon } from '@radix-ui/react-icons';
import { useThemeStore } from '../stores/themeStore';
import { useAuthStore } from '../stores/authStore';

export function StatusBarMenu() {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const toggleDarkMode = useThemeStore((state) => state.toggleDarkMode);
  const logout = useAuthStore((state) => state.logout);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          className="text-gray-9 hover:text-gray-11"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            margin: '-8px',
            display: 'flex',
            alignItems: 'center',
            transition: 'color 0.15s'
          }}
        >
          <ChevronUpIcon className="w-3 h-3" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content >
        <DropdownMenu.Item onSelect={(e) => e.preventDefault()} className='px-1'>
          <Flex align="center" justify="between" gap="4">
            <Text size="2">Dark Mode</Text>
            <Switch
              checked={isDarkMode}
              onCheckedChange={toggleDarkMode}
              size="1"
            />
          </Flex>
        </DropdownMenu.Item>

        <DropdownMenu.Separator className='mx-1' />

        <DropdownMenu.Item onSelect={logout} className='px-1'>
          <Flex align="center" gap="2">
            <ExitIcon />
            <Text size="2">Logout</Text>
          </Flex>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}