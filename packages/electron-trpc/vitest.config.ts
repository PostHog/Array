/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Disable retries so flaky-test detection sees raw pass/fail results.
    retry: 0,
    reporters: [
      "default",
      ["junit", { outputFile: "./junit.xml", addFileAttribute: true }],
    ],
    coverage: {
      all: true,
      include: ["src/**/*"],
      reporter: ["text", "cobertura", "html"],
      reportsDirectory: path.resolve(__dirname, "./coverage/"),
    },
  },
});
