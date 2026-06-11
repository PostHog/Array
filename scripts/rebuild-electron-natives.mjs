import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appRequire = createRequire(path.join(repoRoot, "apps/code/package.json"));
const electronVersion = appRequire("electron/package.json").version;

// Only better-sqlite3 needs an Electron-ABI rebuild; node-pty is N-API based
// and loads under any runtime unchanged.
const moduleDir = path.join(repoRoot, "node_modules/better-sqlite3");
const moduleRequire = createRequire(path.join(moduleDir, "package.json"));
const prebuildInstall = moduleRequire.resolve("prebuild-install/bin.js");

rmSync(path.join(moduleDir, "build"), { recursive: true, force: true });
rmSync(path.join(moduleDir, "prebuilds"), { recursive: true, force: true });

const run = (args) =>
  execFileSync(process.execPath, args, { cwd: moduleDir, stdio: "inherit" });

console.log(`Building better-sqlite3 for Electron ${electronVersion}...`);
try {
  run([prebuildInstall, "--runtime=electron", `--target=${electronVersion}`]);
} catch {
  console.log("No Electron prebuild available, compiling with node-gyp...");
  run([
    moduleRequire.resolve("node-gyp/bin/node-gyp.js"),
    "rebuild",
    `--target=${electronVersion}`,
    "--dist-url=https://electronjs.org/headers",
  ]);
}
console.log(`better-sqlite3 built for Electron ${electronVersion}.`);
