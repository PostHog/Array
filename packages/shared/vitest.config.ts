import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Disable retries so flaky-test detection sees raw pass/fail results.
    retry: 0,
    reporters: [
      "default",
      ["junit", { outputFile: "./junit.xml", addFileAttribute: true }],
    ],
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
