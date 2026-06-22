import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const OUT_DIR = path.join(__dirname, "../../../out");

export const PRISTINE_APP = path.join(OUT_DIR, "mac-arm64/PostHog Code.app");
export const FEED_DIR = path.join(OUT_DIR, "dev-update-feed");
export const RUN_DIR = path.join(OUT_DIR, "e2e-update-run");
export const RUN_APP = path.join(RUN_DIR, "PostHog Code.app");
export const RUN_APP_BIN = path.join(RUN_APP, "Contents/MacOS/PostHog Code");

export const MAIN_LOG = path.join(homedir(), ".posthog-code/logs/main.log");
export const SHIPIT_DIR = path.join(
  homedir(),
  "Library/Caches/com.posthog.array.ShipIt",
);

const SERVE_SCRIPT = path.join(
  __dirname,
  "../../../scripts/dev-update/serve.mjs",
);

// Copy the pristine built app into a disposable run dir so the in-place update
// swap never mutates the build output, which lets a retry start from 1.0.0
// again. ditto preserves the code signature that Squirrel.Mac verifies.
export function prepareRunApp(): void {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });
  execFileSync("ditto", [PRISTINE_APP, RUN_APP]);
}

export function startFeedServer(port: number): ChildProcess {
  return spawn("node", [SERVE_SCRIPT, FEED_DIR, String(port)], {
    stdio: "inherit",
  });
}

export function readBundleVersion(appPath: string): string {
  return execFileSync(
    "plutil",
    [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      path.join(appPath, "Contents/Info.plist"),
    ],
    { encoding: "utf8" },
  ).trim();
}

export function readMainLog(): string {
  try {
    return readFileSync(MAIN_LOG, "utf8");
  } catch {
    return "";
  }
}

// Squirrel.Mac's ShipIt helper performs the in-place swap and leaves its cache
// under ~/Library/Caches/<bundleId>.ShipIt, which is direct evidence the install
// went through Squirrel rather than anything the test did itself.
export function shipItEvidence(): { exists: boolean; entries: string[] } {
  try {
    return { exists: true, entries: readdirSync(SHIPIT_DIR) };
  } catch {
    return { exists: false, entries: [] };
  }
}

export function isAppRunning(): boolean {
  try {
    execFileSync("pgrep", ["-x", "PostHog Code"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Executable paths of the running main app processes (not helpers). Used to prove
// Squirrel's auto-relaunched process is running from the swapped bundle.
export function runningAppExecutables(): string[] {
  let pids: string[];
  try {
    pids = execFileSync("pgrep", ["-x", "PostHog Code"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
  return pids
    .map((pid) => {
      try {
        return execFileSync("ps", ["-p", pid, "-o", "comm="], {
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function killApp(): void {
  try {
    execFileSync("pkill", ["-x", "PostHog Code"]);
  } catch {
    // nothing running, fine
  }
}

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms: ${message}`);
}
