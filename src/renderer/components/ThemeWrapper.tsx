import { Theme } from "@radix-ui/themes";
import type React from "react";
import { useThemeStore } from "../stores/themeStore";

export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  return (
    <Theme
      appearance={isDarkMode ? "dark" : "light"}
      accentColor="orange"
      grayColor="slate"
      panelBackground="translucent"
      radius="none"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}
