import React from 'react';
import { Theme } from '@radix-ui/themes';
import { useThemeStore } from '../stores/themeStore';

export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  return (
    <Theme
      appearance={isDarkMode ? 'dark' : 'light'}
      accentColor="orange"
      grayColor="slate"
      panelBackground="solid"
      radius="none"
      scaling="90%"
    >
      {children}
    </Theme>
  );
}