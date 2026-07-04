import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRtkPrefix } from "../adapters/claude/session/rtk";

const execFileAsync = promisify(execFile);

/**
 * The `summary` block of `rtk gain --format json` — RTK's own tally of how much
 * command output it compressed away before it reached the model.
 */
export interface RtkSavingsSummary {
  totalCommands: number;
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
  avgSavingsPct: number;
}

interface GainOutput {
  stdout: string;
  stderr: string;
}

interface ResolveRtkSavingsOptions {
  env?: NodeJS.ProcessEnv;
  /** Resolves the rtk binary to invoke; undefined disables reporting. Overridable for tests. */
  resolveBinary?: (env: NodeJS.ProcessEnv) => string | undefined;
  /** Runs `rtk gain` and returns its stdio; overridable for tests. */
  runGain?: (binary: string) => Promise<GainOutput>;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseGainSummary(stdout: string): RtkSavingsSummary | null {
  const parsed = JSON.parse(stdout) as { summary?: Record<string, unknown> };
  const summary = parsed.summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    totalCommands: toFiniteNumber(summary.total_commands),
    inputTokens: toFiniteNumber(summary.total_input),
    outputTokens: toFiniteNumber(summary.total_output),
    tokensSaved: toFiniteNumber(summary.total_saved),
    avgSavingsPct: toFiniteNumber(summary.avg_savings_pct),
  };
}

async function defaultRunGain(binary: string): Promise<GainOutput> {
  const { stdout, stderr } = await execFileAsync(
    binary,
    ["gain", "--format", "json"],
    { timeout: 5_000 },
  );
  return { stdout, stderr };
}

/**
 * Reads RTK's own token-savings tally (`rtk gain --format json`).
 *
 * Best-effort: returns null when RTK is disabled or unavailable, when it has
 * tracked nothing, or on any exec/parse failure — reporting savings must never
 * disrupt a run. The tally is machine-global, which equals a single run's
 * savings in the ephemeral cloud sandbox (fresh DB per run). A long-lived host
 * would need to snapshot-and-diff instead.
 */
export async function resolveRtkSavings({
  env = process.env,
  resolveBinary = resolveRtkPrefix,
  runGain = defaultRunGain,
}: ResolveRtkSavingsOptions = {}): Promise<RtkSavingsSummary | null> {
  const binary = resolveBinary(env);
  if (!binary) return null;

  try {
    const { stdout } = await runGain(binary);
    const summary = parseGainSummary(stdout);
    // Nothing was compressed this run — no point emitting a zero.
    if (!summary || summary.totalCommands <= 0) return null;
    return summary;
  } catch {
    return null;
  }
}
