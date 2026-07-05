#!/usr/bin/env node

/**
 * End-to-end memory benchmark run for the PostHog Code dev app.
 *
 * Owns the full lifecycle so every run is comparable:
 *   1. launches a fresh dev app (POSTHOG_CODE_CDP_PORT, default :9223)
 *   2. waits for CDP + boot settle
 *   3. samples idle RSS (scripts/bench-memory.mjs)
 *   4. drives the reported-hot user workflow over CDP with playwright-core:
 *      sends N cheap agent turns in the restored thread and waits for replies
 *   5. samples post-workflow RSS
 *   6. tears the app down
 *
 * Usage:
 *   node scripts/bench-memory-run.mjs [--port 9223] [--messages 2]
 *     [--label <label>] [--out results.jsonl] [--idle-only]
 *
 * Prints a JSON report; final line is `TOTAL_RSS_MB=<post-workflow median>`
 * (idle median with --idle-only) for predicate extraction via `tail -1`.
 *
 * NOTE: workflow turns hit the real agent backend with trivial prompts
 * ("reply with exactly <token>") to keep token cost minimal while exercising
 * the real agent-session memory path.
 */

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const flag = (name) => args.includes(`--${name}`);

const port = Number(arg("port", 9223));
const messageCount = Number(arg("messages", 2));
const label = arg("label", "run");
const outFile = arg("out", null);
const idleOnly = flag("idle-only");

const BOOT_SETTLE_MS = 20_000;
const CDP_TIMEOUT_MS = 120_000;
const REPLY_TIMEOUT_MS = 120_000;
const POST_WORKFLOW_SETTLE_MS = 10_000;

function log(message) {
  console.error(`[bench-run] ${message}`);
}

async function portListening() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function sample(sampleLabel, durationS) {
  const out = execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts/bench-memory.mjs"),
      "--port",
      String(port),
      "--duration",
      String(durationS),
      "--interval",
      "2",
      "--label",
      sampleLabel,
    ],
    { encoding: "utf8" },
  );
  const json = out.slice(0, out.lastIndexOf("TOTAL_RSS_MB="));
  return JSON.parse(json);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function driveWorkflow() {
  const { chromium } = await import(
    path.join(repoRoot, "node_modules/playwright-core/index.mjs")
  );
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => !p.url().startsWith("devtools://"));
    if (!page) throw new Error("no renderer page target found");

    const composer = page.locator('[contenteditable="true"]').last();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    const turns = [];
    for (let i = 0; i < messageCount; i++) {
      const token = `pong-${label}-${i}`;
      const started = Date.now();
      await composer.click();
      await composer.pressSequentially(
        `Reply with exactly: ${token} (benchmark turn, nothing else)`,
      );
      await page.getByRole("button", { name: "Send message" }).click();
      // The reply contains the token; the composed message shows it too, so
      // wait for at least two occurrences in the page text.
      await page.waitForFunction(
        (t) => (document.body.innerText.split(t).length - 1) >= 2,
        token,
        { timeout: REPLY_TIMEOUT_MS, polling: 1000 },
      );
      turns.push({ token, ms: Date.now() - started });
      log(`turn ${i + 1}/${messageCount} done in ${turns[i].ms}ms`);
    }
    return turns;
  } finally {
    // Do not browser.close(): over CDP that can close the app's window.
    // Disconnecting the CDP session is enough.
    await browser.close().catch(() => {});
  }
}

if (await portListening()) {
  console.error(
    `bench-run: something already listens on :${port}. This harness owns the app lifecycle; stop the running instance first.`,
  );
  process.exit(1);
}

log("launching dev app...");
const child = spawn("pnpm", ["dev:code"], {
  cwd: repoRoot,
  env: { ...process.env, POSTHOG_CODE_CDP_PORT: String(port) },
  stdio: ["ignore", "ignore", "ignore"],
  detached: true,
});

function teardown() {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}
process.on("exit", teardown);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const deadline = Date.now() + CDP_TIMEOUT_MS;
while (!(await portListening())) {
  if (Date.now() > deadline) {
    console.error("bench-run: app never opened CDP port");
    process.exit(1);
  }
  await sleep(1000);
}
log(`CDP up on :${port}, settling ${BOOT_SETTLE_MS / 1000}s...`);
await sleep(BOOT_SETTLE_MS);

const idle = sample(`${label}-idle`, 20);
log(`idle: ${idle.totalRssMb}MB`);

let workflow = null;
let post = null;
if (!idleOnly) {
  const turns = await driveWorkflow();
  await sleep(POST_WORKFLOW_SETTLE_MS);
  post = sample(`${label}-post`, 30);
  workflow = { turns };
  log(`post-workflow: ${post.totalRssMb}MB`);
}

teardown();

const report = {
  label,
  port,
  messages: idleOnly ? 0 : messageCount,
  idle,
  workflow,
  post,
  metricMb: idleOnly ? idle.totalRssMb : post.totalRssMb,
};
console.log(JSON.stringify(report, null, 2));
if (outFile) appendFileSync(outFile, `${JSON.stringify(report)}\n`);
console.log(`TOTAL_RSS_MB=${report.metricMb}`);
