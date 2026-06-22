import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(__dirname, "../../../out");

export const PRISTINE_APP = path.join(OUT_DIR, "mac-arm64/PostHog Code.app");
export const FEED_DIR = path.join(OUT_DIR, "dev-update-feed");
export const RUN_DIR = path.join(OUT_DIR, "e2e-update-run");
export const RUN_APP = path.join(RUN_DIR, "PostHog Code.app");
export const RUN_APP_BIN = path.join(RUN_APP, "Contents/MacOS/PostHog Code");

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

export function isAppRunning(): boolean {
  try {
    execFileSync("pgrep", ["-x", "PostHog Code"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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
