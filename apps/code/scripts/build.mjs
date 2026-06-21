#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function runViteBuild(config) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vite", "build", "--config", config], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`vite build -c ${config} exited with code ${code}`));
      } else {
        resolve();
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  await Promise.all([
    runViteBuild("vite.main.config.mts"),
    runViteBuild("vite.preload.config.mts"),
    runViteBuild("vite.workspace-server.config.mts"),
  ]);
  await runViteBuild("vite.renderer.config.mts");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
