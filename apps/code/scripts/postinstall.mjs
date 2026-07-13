#!/usr/bin/env node
// Postinstall for the Electron app: rebuild native modules for Electron's ABI,
// restore spawn-helper execute bits, patch the macOS Electron display name, and
// download bundled binaries. Pure Node so Windows does not need bash/Git Bash
// (pnpm otherwise hits the System32 WSL bash stub when no distro is installed).

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/code/scripts -> repo root (pnpm package cwd is apps/code, so the old
// bash script used `cd ../..` from cwd; from this file we need one more `..`).
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCRIPTS_DIR = __dirname;

function electronDistMissing(electronDist) {
  if (!existsSync(electronDist)) return true;
  try {
    return readdirSync(electronDist).length === 0;
  } catch {
    return true;
  }
}

// Self-heal missing Electron binary.
// pnpm skips package-level postinstall scripts when the lockfile is already
// satisfied, so if node_modules/electron/dist gets wiped (interrupted download,
// cache eviction, arch change, manual cleanup), `pnpm install` won't notice —
// and `electron-vite dev` then fails with "Electron failed to install
// correctly, please delete node_modules/electron and try installing again".
const electronDist = join(REPO_ROOT, "node_modules", "electron", "dist");
if (electronDistMissing(electronDist)) {
  console.log(`Electron binary missing at ${electronDist} — downloading...`);
  execFileSync(
    process.execPath,
    [join(REPO_ROOT, "node_modules", "electron", "install.js")],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );
}

console.log("Rebuilding native modules for Electron...");
execFileSync(
  process.execPath,
  [join(REPO_ROOT, "scripts", "rebuild-better-sqlite3-electron.mjs")],
  { cwd: REPO_ROOT, stdio: "inherit" },
);

// Restore the execute bit on node-pty's spawn-helper. pnpm extracts node-pty's
// prebuilt binaries without preserving the executable mode, so the helper lands
// without +x and posix_spawnp fails at runtime with "posix_spawnp failed" the
// first time a terminal session is opened. Skip on Windows (no POSIX +x).
if (process.platform !== "win32") {
  const prebuilds = join(REPO_ROOT, "node_modules", "node-pty", "prebuilds");
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) {
      const helper = join(prebuilds, entry, "spawn-helper");
      if (!existsSync(helper)) continue;
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0) {
        console.log(`Restoring execute bit on ${helper}`);
        chmodSync(helper, mode | 0o111);
      }
    }
  }
}

// Info.plist lives inside Electron.app — macOS only. Reuse the existing script.
if (process.platform === "darwin") {
  console.log("Patching Electron app name...");
  execFileSync("bash", [join(SCRIPTS_DIR, "patch-electron-name.sh")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

console.log("Downloading binaries...");
execFileSync(process.execPath, [join(SCRIPTS_DIR, "download-binaries.mjs")], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

console.log("Postinstall complete.");
