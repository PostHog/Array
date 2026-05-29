// This file has been automatically migrated to valid ESM format by Storybook.
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui/src/**/*.mdx",
    "../../../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-docs"),
  ],
  framework: getAbsolutePath("@storybook/react-vite"),
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss(), react()],
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "../src"),
          "@main": path.resolve(__dirname, "../src/main"),
          "@renderer": path.resolve(__dirname, "../src/renderer"),
          "@shared": path.resolve(__dirname, "../src/shared"),
          "@api": path.resolve(__dirname, "../src/api"),
          "@features": path.resolve(__dirname, "../src/renderer/features"),
          "@components": path.resolve(__dirname, "../src/renderer/components"),
          "@stores": path.resolve(__dirname, "../src/renderer/stores"),
          "@hooks": path.resolve(__dirname, "../src/renderer/hooks"),
          "@utils": path.resolve(__dirname, "../src/renderer/utils"),
          "@posthog/agent/adapters/claude/permissions/permission-options":
            path.resolve(
              __dirname,
              "../../../packages/agent/dist/adapters/claude/permissions/permission-options.js",
            ),
          "@posthog/agent/adapters/claude/conversion/tool-use-to-acp":
            path.resolve(
              __dirname,
              "../../../packages/agent/dist/adapters/claude/conversion/tool-use-to-acp.js",
            ),
          "@posthog/agent/adapters/claude/questions/utils": path.resolve(
            __dirname,
            "../../../packages/agent/dist/adapters/claude/questions/utils.js",
          ),
          "@posthog/electron-trpc/renderer": path.resolve(
            __dirname,
            "./mocks/electron-trpc.ts",
          ),
        },
      },
    });
  },
};

export default config;
