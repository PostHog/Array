import { Theme } from "@radix-ui/themes";
import { useThemeStore } from "@renderer/stores/themeStore";
import type React from "react";

export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  return (
    <Theme
      appearance={isDarkMode ? "dark" : "light"}
      accentColor="orange"
      grayColor="slate"
      panelBackground="translucent"
      radius="none"
      scaling="90%"
    >
      {children}
    </Theme>
  );
}
