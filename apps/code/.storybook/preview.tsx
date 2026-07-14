import "./mocks/electron-trpc";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import type { Preview } from "@storybook/react-vite";
import "../../../packages/ui/src/styles/globals.css";
import { withAppProviders } from "./withAppProviders";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      options: {
        dark: { name: "dark", value: "#111113" },
        light: { name: "light", value: "#ffffff" },
      },
    },
  },

  decorators: [
    withAppProviders,
    (Story, context) => {
      const isDark = context.globals.theme !== "light";
      // Mirror the app's ThemeWrapper (packages/ui/src/primitives/ThemeWrapper.tsx)
      // so stories render with the shipped radius and accent colors.
      return (
        <Theme
          appearance={isDark ? "dark" : "light"}
          accentColor={isDark ? "yellow" : "orange"}
          grayColor="slate"
          panelBackground="solid"
          radius="medium"
          scaling="105%"
        >
          <Story />
        </Theme>
      );
    },
  ],

  globalTypes: {
    theme: {
      description: "Theme",
      defaultValue: "dark",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: ["dark", "light"],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: {
    backgrounds: {
      value: "dark",
    },
  },
};

export default preview;
