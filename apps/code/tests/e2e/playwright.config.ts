import { defineConfig } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  // The update specs need a signed feed; they run only via their dedicated
  // configs (playwright.update*.config.ts), never in the general suite.
  testIgnore: "**/update*.spec.ts",
  timeout: 60000,
  retries: isCI ? 2 : 0,
  // Must run serially - Electron app has single instance lock
  workers: 1,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "../playwright-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "electron",
      testMatch: "**/*.spec.ts",
      testIgnore: "**/update*.spec.ts",
    },
  ],
});
