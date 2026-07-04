import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRtkPrefix } from "../adapters/claude/session/rtk";

const execFileAsync = promisify(execFile);

/**
 * The `summary` block of `rtk gain --format json` — RTK's own tally of the
 * output it compressed away before it reached the model. The counts are RTK's
 * token estimates (its own output labels them "Input/Output tokens" and "Tokens
 * saved"), not raw bytes.
 */
export interface RtkSavingsSummary {
  totalCommands: number;
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
  avgSavingsPct: number;
}

interface ResolveRtkSavingsOptions {
  env?: NodeJS.ProcessEnv;
  /** Resolves the rtk binary to invoke; undefined disables reporting. Overridable for tests. */
  resolveBinary?: (env: NodeJS.ProcessEnv) => string | undefined;
  /** Runs `rtk gain` and returns its stdout; overridable for tests. */
  runGain?: (binary: string, env: NodeJS.ProcessEnv) => Promise<string>;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseGainSummary(stdout: string): RtkSavingsSummary | null {
  const parsed: unknown = JSON.parse(stdout);
  // `JSON.parse("null")` returns null, and a non-object payload has no summary —
  // guard before indexing rather than leaning on the caller's try/catch.
  if (!parsed || typeof parsed !== "object") return null;
  const summary = (parsed as { summary?: Record<string, unknown> }).summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    totalCommands: toFiniteNumber(summary.total_commands),
    inputTokens: toFiniteNumber(summary.total_input),
    outputTokens: toFiniteNumber(summary.total_output),
    tokensSaved: toFiniteNumber(summary.total_saved),
    avgSavingsPct: toFiniteNumber(summary.avg_savings_pct),
  };
}

async function defaultRunGain(
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(binary, ["gain", "--format", "json"], {
    timeout: 5_000,
    env,
  });
  return stdout;
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
    const stdout = await runGain(binary, env);
    const summary = parseGainSummary(stdout);
    // No rtk-wrapped commands ran this session — nothing worth reporting.
    if (!summary || summary.totalCommands <= 0) return null;
    return summary;
  } catch {
    return null;
  }
}
