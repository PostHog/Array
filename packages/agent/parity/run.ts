/**
 * Parity runner: drive scenarios through both codex adapters, extract a
 * normalized feature report from each ACP stream, and diff app-server vs
 * codex-acp. Writes raw captures + parity-report.json to parity/out/.
 *
 * Usage (from packages/agent):
 *   PARITY_API_KEY=<token> pnpm exec tsx parity/run.ts [--only acp|app-server] [--scenario name]
 * Env:
 *   PARITY_GATEWAY_URL  default http://localhost:3308/posthog_code/v1
 *   PARITY_API_KEY      PostHog token the local llm-gateway accepts (required for a live run)
 *   PARITY_MODEL        default gpt-5.5
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../src/utils/logger";
import {
  type AdapterMode,
  type CapturedRun,
  runScenario,
  type Scenario,
} from "./harness";

const OUT_DIR = join(import.meta.dirname, "out");
const RESOURCES = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "code",
  "resources",
  "codex-acp",
);
const CODEX_ACP_BIN = join(RESOURCES, "codex-acp");
const NATIVE_CODEX_BIN = join(RESOURCES, "codex");
const GATEWAY =
  process.env.PARITY_GATEWAY_URL ?? "http://localhost:3308/posthog_code/v1";
const API_KEY = process.env.PARITY_API_KEY ?? "";
const MODEL = process.env.PARITY_MODEL ?? "gpt-5.5";
const REPO = "/tmp/codex-parity-repo";

const SCENARIOS: Scenario[] = [
  {
    name: "basic-task",
    async run(conn, ctx) {
      const session = await ctx.step("newSession", () =>
        conn.newSession({
          cwd: ctx.cwd,
          mcpServers: [],
          _meta: {
            sessionId: "parity",
            systemPrompt: "You are a coding assistant in a tiny test repo.",
            model: ctx.model,
            permissionMode: "bypassPermissions",
          },
        }),
      );
      const sessionId = session.sessionId;
      await ctx.step("prompt", () =>
        conn.prompt({
          sessionId,
          prompt: [
            {
              type: "text",
              text: "Do exactly these steps and nothing else: 1) Read the file target.txt. 2) Edit it so the second line reads FOO instead of line2. 3) Run the shell command `cat target.txt`. 4) In one sentence confirm what you changed, then stop.",
            },
          ],
        }),
      );
    },
  },
  {
    name: "modes-and-resume",
    async run(conn, ctx) {
      const session = await ctx.step("newSession", () =>
        conn.newSession({
          cwd: ctx.cwd,
          mcpServers: [],
          _meta: {
            sessionId: "parity2",
            systemPrompt: "You are a coding assistant.",
            model: ctx.model,
            permissionMode: "auto",
          },
        }),
      );
      const sessionId = session.sessionId;
      // Mode switch — codex-acp supports it; app-server gap until migration.
      await ctx.step("setSessionConfigOption(mode)", () =>
        conn
          .setSessionConfigOption({
            sessionId,
            configId: "mode",
            value: "read-only",
          })
          .catch((e: any) => {
            throw e;
          }),
      );
      await ctx.step("prompt", () =>
        conn.prompt({
          sessionId,
          prompt: [
            {
              type: "text",
              text: "List the files in this repo with `ls`, then stop.",
            },
          ],
        }),
      );
      // Resume in the same connection (host calls resumeSession on reconnect).
      await ctx.step("resumeSession", () =>
        conn.resumeSession({
          sessionId,
          cwd: ctx.cwd,
          mcpServers: [],
          _meta: {
            systemPrompt: "You are a coding assistant.",
            model: ctx.model,
          },
        }),
      );
    },
  },
];

function extractFeatures(run: CapturedRun): Record<string, any> {
  const updateTypes = new Set<string>();
  const toolKinds = new Set<string>();
  const toolStatuses = new Set<string>();
  let hasDiff = false;
  let hasToolContent = false;
  const approvals: string[] = [];
  let usageFields = new Set<string>();
  let modeUpdate = false;
  const extNotifs = new Set<string>();

  for (const e of run.events) {
    if (e.kind === "requestPermission") approvals.push(e.data?.kind ?? "?");
    if (e.kind === "extNotification") extNotifs.add(e.op ?? "?");
    if (e.kind !== "sessionUpdate") continue;
    const u = e.sessionUpdate ?? "?";
    updateTypes.add(u);
    const d = e.data ?? {};
    if (u === "tool_call") {
      if (d.kind) toolKinds.add(d.kind);
      if (d.status) toolStatuses.add(d.status);
    }
    if (u === "tool_call_update") {
      if (d.status) toolStatuses.add(d.status);
      const content = d.content ?? [];
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "diff") hasDiff = true;
          if (c?.type === "content") hasToolContent = true;
        }
      }
      if (
        d.rawInput?.diff ||
        (typeof d.rawOutput === "string" && d.rawOutput.includes("diff"))
      )
        hasDiff = true;
    }
    if (u === "current_mode_update" || u === "config_option_update")
      modeUpdate = true;
    if (u === "usage_update")
      usageFields = new Set([
        ...usageFields,
        ...Object.keys(d.usage ?? d ?? {}),
      ]);
  }

  // newSession response: configOptions / modes
  const ns = run.stepResults.find((s) => s.op === "newSession")?.result ?? {};
  const configCategories = (ns.configOptions ?? [])
    .map((o: any) => o.category)
    .filter(Boolean);
  const modes = ns.modes ?? null;
  // prompt response usage / stopReason
  const promptRes = run.stepResults
    .filter((s) => s.op === "prompt")
    .map((s) => s.result ?? {});
  const stopReasons = promptRes.map((r) => r.stopReason).filter(Boolean);
  const promptUsage = promptRes.some(
    (r) => r.usage && Object.keys(r.usage).length > 0,
  );

  return {
    fatalError: run.fatalError ?? null,
    updateTypes: [...updateTypes].sort(),
    toolKinds: [...toolKinds].sort(),
    toolStatuses: [...toolStatuses].sort(),
    hasDiffContent: hasDiff,
    hasToolContent: hasToolContent,
    hasUsage:
      promptUsage ||
      updateTypes.has("usage_update") ||
      extNotifs.has("_posthog/usage_update"),
    usageFields: [...usageFields].sort(),
    configOptionCategories: [...new Set(configCategories)].sort(),
    modesPresent: !!modes,
    modeChangeEmitted: modeUpdate,
    approvalsRequested: approvals.length,
    extNotifications: [...extNotifs].sort(),
    stopReasons,
    steps: run.stepResults.map((s) => ({ op: s.op, ok: s.ok, error: s.error })),
  };
}

// Adapter-level features must match for parity. tool-rendering features depend
// on which tools the model chose (native codex edits via shell `execute`;
// codex-acp exposes Edit/Read) — a tool-surface difference, not an adapter bug —
// so they're reported as behavioral, not counted as parity gaps.
const ADAPTER_KEYS = [
  "fatalError",
  "updateTypes",
  "hasUsage",
  "usageFields",
  "configOptionCategories",
  "modesPresent",
  "modeChangeEmitted",
  "extNotifications",
  "stopReasons",
];
const BEHAVIORAL_KEYS = [
  "toolKinds",
  "toolStatuses",
  "hasDiffContent",
  "hasToolContent",
];

function diffFeatures(
  acp: Record<string, any>,
  app: Record<string, any>,
): Array<{
  feature: string;
  acp: any;
  appServer: any;
  match: boolean;
  behavioral: boolean;
}> {
  const j = (v: any) => JSON.stringify(v);
  const mk = (k: string, behavioral: boolean) => ({
    feature: k,
    acp: acp[k],
    appServer: app[k],
    match: j(acp[k]) === j(app[k]),
    behavioral,
  });
  return [
    ...ADAPTER_KEYS.map((k) => mk(k, false)),
    ...BEHAVIORAL_KEYS.map((k) => mk(k, true)),
  ];
}

/**
 * Recreate the repo from scratch. Runs before every (scenario, mode) pair so
 * the second arm starts from the same pristine state as the first — a scenario
 * edits target.txt, and comparing arms against different starting files would
 * bias the exact diff this harness exists to produce.
 */
function setupRepo(): void {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: REPO });
  writeFileSync(join(REPO, "target.txt"), "line1\nline2\nline3\n");
  execFileSync("git", ["add", "-A"], { cwd: REPO });
  // -c commit.gpgsign=false: ignore the user's global commit-signing config
  // (e.g. 1Password SSH signer), which fails in this non-interactive context.
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.email=p@p.dev",
      "-c",
      "user.name=parity",
      "commit",
      "-qm",
      "init",
    ],
    { cwd: REPO },
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes("--only")
    ? (args[args.indexOf("--only") + 1] as AdapterMode)
    : null;
  const scenarioFilter = args.includes("--scenario")
    ? args[args.indexOf("--scenario") + 1]
    : null;
  mkdirSync(OUT_DIR, { recursive: true });

  const modes: AdapterMode[] = [];
  if (!only || only === "acp") modes.push("acp");
  if ((!only || only === "app-server") && existsSync(NATIVE_CODEX_BIN))
    modes.push("app-server");
  else if (only === "app-server")
    console.warn(
      `native codex binary missing at ${NATIVE_CODEX_BIN}; app-server arm skipped`,
    );

  const scenarios = SCENARIOS.filter(
    (s) => !scenarioFilter || s.name === scenarioFilter,
  );
  const logger = new Logger({
    debug: !!process.env.PARITY_DEBUG,
    prefix: "[parity]",
  });
  const featuresByMode: Record<string, Record<string, any>> = {};

  for (const scenario of scenarios) {
    featuresByMode[scenario.name] = {};
    for (const mode of modes) {
      console.log(`\n▶ ${scenario.name} via ${mode} ...`);
      setupRepo();
      // codex spawns detached (own process group); a timed-out run orphans it
      // holding a flock under ~/.codex/tmp, which wedges the next run. Kill any
      // stragglers first — process death releases the flock, matched on THIS
      // checkout's absolute resources path so unrelated runs are never killed.
      // (Uses the default CODEX_HOME: an isolated empty home makes codex-acp
      // crash at startup.)
      try {
        execFileSync("pkill", ["-9", "-f", RESOURCES], {
          stdio: "ignore",
        });
      } catch {
        /* none running */
      }
      const cfg = {
        cwd: REPO,
        codexOptions: {
          cwd: REPO,
          binaryPath: CODEX_ACP_BIN,
          apiBaseUrl: GATEWAY,
          apiKey: API_KEY,
          model: MODEL,
        },
        timeoutMs: 240000,
        logger,
      };
      const run = await runScenario(mode, scenario, cfg);
      writeFileSync(
        join(OUT_DIR, `${scenario.name}.${mode}.json`),
        JSON.stringify(run, null, 2),
      );
      const feats = extractFeatures(run);
      featuresByMode[scenario.name][mode] = feats;
      writeFileSync(
        join(OUT_DIR, `${scenario.name}.${mode}.features.json`),
        JSON.stringify(feats, null, 2),
      );
      console.log(
        `  steps: ${feats.steps.map((s: any) => `${s.op}${s.ok ? "✓" : "✗"}`).join(" ")}`,
      );
      console.log(
        `  updates: ${feats.updateTypes.join(",")} | tools: ${feats.toolKinds.join(",")} | usage:${feats.hasUsage} diff:${feats.hasDiffContent} stop:${feats.stopReasons.join(",")}`,
      );
      if (feats.fatalError) console.log(`  ⚠ fatalError: ${feats.fatalError}`);
    }
  }

  // Diff report (only meaningful when both arms ran)
  const report: any = { gateway: GATEWAY, model: MODEL, scenarios: {} };
  let totalGaps = 0;
  for (const scenario of scenarios) {
    const acp = featuresByMode[scenario.name].acp;
    const app = featuresByMode[scenario.name]["app-server"];
    if (acp && app) {
      const diff = diffFeatures(acp, app);
      const gaps = diff.filter((d) => !d.match && !d.behavioral);
      const behavioral = diff.filter((d) => !d.match && d.behavioral);
      totalGaps += gaps.length;
      report.scenarios[scenario.name] = {
        gaps,
        behavioral,
        allMatch: gaps.length === 0,
      };
      console.log(`\n=== parity diff: ${scenario.name} ===`);
      if (!gaps.length) console.log("  ✅ adapter parity");
      for (const g of gaps)
        console.log(
          `  ✗ ${g.feature}: acp=${JSON.stringify(g.acp)} app-server=${JSON.stringify(g.appServer)}`,
        );
      for (const b of behavioral)
        console.log(
          `  · behavioral: ${b.feature} acp=${JSON.stringify(b.acp)} app-server=${JSON.stringify(b.appServer)}`,
        );
    } else {
      report.scenarios[scenario.name] = {
        baselineOnly: acp ? "acp" : "app-server",
        features: acp ?? app,
      };
    }
  }
  writeFileSync(
    join(OUT_DIR, "parity-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `\nWrote ${join(OUT_DIR, "parity-report.json")} — ${totalGaps} parity gap(s).`,
  );
  process.exit(totalGaps > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("parity runner failed:", e);
  process.exit(2);
});
