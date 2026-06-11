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

const moduleDir = path.join(repoRoot, "node_modules/better-sqlite3");
const moduleRequire = createRequire(path.join(moduleDir, "package.json"));
const prebuildInstall = moduleRequire.resolve("prebuild-install/bin.js");

rmSync(path.join(moduleDir, "build"), { recursive: true, force: true });

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: moduleDir, stdio: "inherit" });

console.log(`Building better-sqlite3 for Electron ${electronVersion}...`);
try {
  run(process.execPath, [
    prebuildInstall,
    "--runtime=electron",
    `--target=${electronVersion}`,
  ]);
} catch {
  console.log("No Electron prebuild available, compiling with node-gyp...");
  run(path.join(repoRoot, "node_modules/.bin/node-gyp"), [
    "rebuild",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--dist-url=https://electronjs.org/headers",
  ]);
}
console.log(`better-sqlite3 built for Electron ${electronVersion}.`);
