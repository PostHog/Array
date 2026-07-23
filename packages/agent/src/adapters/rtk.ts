import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * RTK (https://github.com/rtk-ai/rtk) is a CLI proxy that compresses the output
 * of common dev commands before they reach the model. Automatic rewriting is
 * deliberately limited to dedicated RTK modes with tested output contracts.
 *
 * Used automatically when `rtk` is on PATH; set `POSTHOG_RTK=0` to opt out.
 */

const SHELL_OPERATORS = /[|&;<>`\n]|\$\(/;

const LEADING_ASSIGNMENTS =
  /^((?:[A-Za-z_]\w*=(?:[^\s'"]+|'[^']*'|"[^"]*")\s+)+)(.+)$/;

function splitLeadingAssignments(segment: string): {
  assignments: string;
  command: string;
} {
  const match = segment.match(LEADING_ASSIGNMENTS);
  if (!match) return { assignments: "", command: segment };
  return { assignments: match[1], command: match[2] };
}

const TEST_COMMAND_PATTERNS = [
  /^pnpm(?:\s+--filter\s+\S+)?\s+test(?:\s|$)/,
  /^npm(?:\s+--workspace(?:=\S+|\s+\S+))?\s+(?:run\s+)?test(?:\s|$)/,
  /^(?:python|python3)\s+-m\s+(?:pytest|unittest)(?:\s|$)/,
  /^pytest(?:\s|$)/,
  /^uv\s+run\s+pytest(?:\s|$)/,
  /^poetry\s+run\s+pytest(?:\s|$)/,
];

const MACHINE_READABLE_TEST_FLAGS =
  /(?:^|\s)(?:-json|--(?:json|json-output|junit-xml|junitxml|log-format|logger|message-format|output-file|outputFile|reporter))(?:[=\s]|$)/;

function isSupportedTestCommand(command: string): boolean {
  return (
    !MACHINE_READABLE_TEST_FLAGS.test(command) &&
    TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
  );
}

export function shQuote(value: string): string {
  if (/^[\w./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Returns `command` rewritten to run through the RTK binary at `rtkPrefix`, or
 * null when it isn't safe or worthwhile to rewrite. Pure and side-effect free.
 */
export function rewriteBashForRtk(
  command: string,
  rtkPrefix: string,
): string | null {
  const trimmed = command.trim();
  if (!trimmed || SHELL_OPERATORS.test(trimmed)) return null;

  // Already routed through rtk — keep the rewrite idempotent.
  const quotedPrefix = shQuote(rtkPrefix);
  if (
    trimmed === quotedPrefix ||
    trimmed.startsWith(`${quotedPrefix} `) ||
    trimmed.startsWith("rtk ")
  ) {
    return null;
  }

  const { assignments, command: segmentCommand } =
    splitLeadingAssignments(trimmed);
  if (!isSupportedTestCommand(segmentCommand)) return null;
  return `${assignments}${quotedPrefix} test ${segmentCommand}`;
}

const MINIMUM_RTK_VERSION = [0, 43, 0] as const;

function isUsableRtkBinary(binary: string): boolean {
  try {
    if (!fs.statSync(binary).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(binary, fs.constants.X_OK);
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 1000,
    });
    if (result.status !== 0 || result.error) return false;
    const match = `${result.stdout ?? ""}${result.stderr ?? ""}`.match(
      /\brtk\s+(\d+)\.(\d+)\.(\d+)\b/i,
    );
    if (!match) return false;
    const version = match.slice(1).map(Number);
    for (let index = 0; index < MINIMUM_RTK_VERSION.length; index++) {
      if (version[index] > MINIMUM_RTK_VERSION[index]) return true;
      if (version[index] < MINIMUM_RTK_VERSION[index]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function findOnPath(bin: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathVar = env.PATH ?? env.Path ?? "";
  const exts =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (isUsableRtkBinary(full)) return full;
    }
  }
  return undefined;
}

/**
 * Resolves the RTK binary to route shell output through. Auto-detects `rtk` on
 * PATH by default, so an installed `rtk` is used automatically. `POSTHOG_RTK`
 * overrides:
 *   unset / "" / "1" / "true" → auto-detect `rtk` on PATH
 *   "0" / "false"             → disabled (opt out)
 *   any other value           → an explicit path to the binary
 */
export function resolveRtkPrefix(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.POSTHOG_RTK?.trim();
  const lowered = raw?.toLowerCase();

  // Explicit opt-out, even when rtk is installed.
  if (lowered === "0" || lowered === "false") return undefined;

  // An explicit binary-path override (anything other than a bare enable flag).
  if (raw && lowered !== "1" && lowered !== "true") {
    return isUsableRtkBinary(raw) ? raw : undefined;
  }

  // Default (unset) or explicit enable: use rtk if it is on PATH.
  return findOnPath("rtk", env);
}

/**
 * Detects the rtk binary a session on this host could use. The on/off flag
 * values of POSTHOG_RTK ("0"/"false"/"1"/"true"/unset) all mean auto-detect
 * here, so the answer reflects installation, not the per-session toggle a
 * previous session may have left in the environment. An explicit binary-path
 * override mirrors the resolver: honored when it exists, otherwise no binary.
 */
export function detectRtkBinary(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.POSTHOG_RTK?.trim();
  const lowered = raw?.toLowerCase();
  const isFlagValue =
    !raw || ["0", "false", "1", "true"].includes(lowered ?? "");
  if (!isFlagValue && raw) {
    return isUsableRtkBinary(raw) ? raw : undefined;
  }
  return findOnPath("rtk", env);
}
