import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@main": path.resolve(__dirname, "./src/main"),
      "@renderer": path.resolve(__dirname, "./src/renderer"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@api": path.resolve(__dirname, "./src/api"),
      "@features": path.resolve(__dirname, "./src/renderer/features"),
      "@components": path.resolve(__dirname, "./src/renderer/components"),
      "@stores": path.resolve(__dirname, "./src/renderer/stores"),
      "@hooks": path.resolve(__dirname, "./src/renderer/hooks"),
      "@utils": path.resolve(__dirname, "./src/renderer/utils"),
    },
  },
});
