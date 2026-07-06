/**
 * The autoresearch protocol: how we brief the agent, how the agent reports
 * metric measurements back, and how we read those reports out of the session
 * transcript. Prompt builders and the report parser are two sides of the same
 * contract — keep them in sync.
 */
import type { AcpMessage } from "@posthog/shared";
import { isJsonRpcNotification, isJsonRpcRequest } from "@posthog/shared";
import type {
  AutoresearchDraftConfig,
  AutoresearchInterruptionReason,
  AutoresearchReport,
  AutoresearchRun,
} from "./schemas";
import { computeBest } from "./stats";

const REPORT_BLOCK_EXAMPLE = [
  "```autoresearch",
  "metric: <number>",
  "name: <short metric label, e.g. bundle size — keep it identical every time>",
  "unit: <the metric's unit, e.g. kB, ms, % — omit for unitless counts>",
  "summary: <one line describing what you changed>",
  "```",
].join("\n");

function directionPhrase(config: AutoresearchDraftConfig): string {
  return config.direction === "maximize" ? "maximize" : "minimize";
}

/** The metric as we can name it so far — reports define it, the brief implies it. */
function metricPhrase(run: AutoresearchRun): string {
  return run.metricName ? `"${run.metricName}"` : "the metric";
}

function targetLine(config: AutoresearchDraftConfig): string {
  if (config.targetValue === null) return "";
  const comparator = config.direction === "maximize" ? "reaches" : "drops to";
  return `\nTarget: the run completes early once the metric ${comparator} ${config.targetValue}.`;
}

/**
 * Everything the kickoff says before the optimization brief. Hosts that
 * deliver the kickoff as a new task's initial prompt prepend this to the
 * user's own prompt content, so file/folder chips survive untouched.
 * The metric is not named here — the brief defines it and the agent labels
 * it in every report's `name:` line.
 */
export function buildKickoffPreamble(config: AutoresearchDraftConfig): string {
  return `You are now in autoresearch mode: an iterative optimization loop to ${directionPhrase(config)} the metric defined by the brief below.

Protocol for every iteration:
1. Make ONE focused change aimed at improving the metric. Keep changes small and attributable.
2. Measure the metric after your change.
3. End your reply with exactly one report block in this format (plain number, no units or thousands separators):

${REPORT_BLOCK_EXAMPLE}

The report block is parsed by a machine — without it the iteration does not count. Budget: up to ${config.maxIterations} iterations.${targetLine(config)}

Iteration 1 starts now. First establish and report the baseline measurement (your change for this iteration is the measurement setup itself if nothing exists yet), then keep improving in later iterations. If a change regresses the metric, revert it in the next iteration and try a different approach.

Optimization brief (what to optimize, how to measure it, constraints):`;
}

export function buildKickoffPrompt(
  config: AutoresearchDraftConfig & { instructions: string },
): string {
  return `${buildKickoffPreamble(config)}\n\n${config.instructions}`;
}

function historyBlock(run: AutoresearchRun): string {
  const { config, iterations } = run;
  const best = computeBest(iterations, config.direction);
  const last = iterations[iterations.length - 1];
  const unit = run.metricUnit ? ` ${run.metricUnit}` : "";

  const recent = iterations
    .slice(-5)
    .map(
      (iteration) =>
        `- Iteration ${iteration.index}: ${iteration.value}${unit}${iteration.summary ? ` — ${iteration.summary}` : ""}`,
    )
    .join("\n");

  return `Recent iterations:
${recent}

Best so far: ${best ? `${best.value}${unit} (iteration ${best.index})` : "none"}. Last: ${last ? `${last.value}${unit}` : "none"}.${targetLine(config)}`;
}

export function buildContinuationPrompt(run: AutoresearchRun): string {
  const { config, iterations } = run;
  const nextIndex = iterations.length + 1;

  return `Autoresearch iteration ${nextIndex} of ${config.maxIterations} for ${metricPhrase(run)} (${directionPhrase(config)}).

${historyBlock(run)}

Continue: make the next focused change, measure ${metricPhrase(run)}, and end your reply with the report block:

${REPORT_BLOCK_EXAMPLE}`;
}

/**
 * First half of a split iteration: think and change, don't measure. Runs on
 * the implement-stage model.
 */
export function buildImplementPrompt(run: AutoresearchRun): string {
  const nextIndex = run.iterations.length + 1;

  return `Autoresearch iteration ${nextIndex} of ${run.config.maxIterations} for ${metricPhrase(run)} (${directionPhrase(run.config)}) — implementation phase.

${historyBlock(run)}

Plan and implement ONE focused change aimed at improving the metric. Do NOT run the measurement in this turn — a separate measurement turn follows. Reply with a one-line summary of what you changed and why.`;
}

/**
 * Second half of a split iteration: run the measurement and report. Runs on
 * the measure-stage model, which can be a cheap one — this turn is tool
 * calls, not thinking.
 */
export function buildMeasurePrompt(run: AutoresearchRun): string {
  return `Measurement phase: run the measurement for ${metricPhrase(run)} exactly as the brief describes, without changing any code. End your reply with the report block:

${REPORT_BLOCK_EXAMPLE}`;
}

const INTERRUPTION_PHRASE: Record<AutoresearchInterruptionReason, string> = {
  "session-error": "the agent session disconnected",
  "rate-limited": "a usage limit was hit",
  "send-failed": "the agent could not be reached",
  "app-restart": "the app restarted",
};

/**
 * The prompt that (re-)enters the loop at the run's current phase — the
 * single source of truth for phase → prompt, shared by resume and the manual
 * resume path so the two can't drift.
 */
export function buildPhasePrompt(run: AutoresearchRun): string {
  if (run.phase === "implement") return buildImplementPrompt(run);
  if (run.phase === "measure") return buildMeasurePrompt(run);
  return buildContinuationPrompt(run);
}

/**
 * Continuation sent when the loop re-engages after an interruption. States
 * why the loop went quiet so the agent can re-check the workspace state
 * (a half-applied change from the aborted iteration must be measured or
 * reverted, not assumed), then re-enters at the phase the run was in.
 */
export function buildResumePrompt(
  run: AutoresearchRun,
  reason: AutoresearchInterruptionReason,
): string {
  return `The autoresearch loop was interrupted (${INTERRUPTION_PHRASE[reason]}) and is resuming now. Check the working tree for any half-applied change from the aborted iteration before continuing.

${buildPhasePrompt(run)}`;
}

export function buildReportReminderPrompt(run: AutoresearchRun): string {
  return `Your last reply did not include a parseable autoresearch report block, so the iteration was not recorded. Measure ${metricPhrase(run)} now and reply ending with exactly:

${REPORT_BLOCK_EXAMPLE}`;
}

const REPORT_BLOCK_REGEX = /```autoresearch\s*\n([\s\S]*?)```/g;

/**
 * Parse the agent's metric report from a reply. The last well-formed
 * ```autoresearch fenced block wins, so an agent quoting the protocol and
 * then reporting still parses correctly.
 */
export function parseMetricReport(text: string): AutoresearchReport | null {
  let report: AutoresearchReport | null = null;
  for (const match of text.matchAll(REPORT_BLOCK_REGEX)) {
    const parsed = parseReportBody(match[1]);
    if (parsed) report = parsed;
  }
  return report;
}

/** Anything longer is prose, not a unit; ignore it rather than blow up the UI. */
const MAX_UNIT_LENGTH = 16;

function parseReportBody(body: string): AutoresearchReport | null {
  let value: number | null = null;
  let name: string | null = null;
  let unit: string | null = null;
  let summary: string | null = null;
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    if (key === "metric") {
      const numeric = Number.parseFloat(raw.replace(/,/g, ""));
      if (Number.isFinite(numeric)) value = numeric;
    } else if (key === "name" && raw.length > 0) {
      name = raw;
    } else if (
      key === "unit" &&
      raw.length > 0 &&
      raw.length <= MAX_UNIT_LENGTH
    ) {
      unit = raw;
    } else if (key === "summary" && raw.length > 0) {
      summary = raw;
    }
  }
  return value === null ? null : { value, name, unit, summary };
}

interface AgentMessageChunkUpdate {
  update?: {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
  };
}

/**
 * Number of session/prompt requests in the transcript. Used as a turn
 * cursor: `isPromptPending` can flip false without a turn having run (a
 * rate-limited or failed send resets it), so a completion only counts when
 * the prompt-request count moved past the last one handled. The count is
 * stable across transcript replays, unlike event indexes.
 */
export function countPromptRequests(events: AcpMessage[]): number {
  let count = 0;
  for (const event of events) {
    const msg = event.message;
    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") count++;
  }
  return count;
}

/**
 * Concatenated text of the agent's reply to the most recent user prompt:
 * every agent_message_chunk after the last session/prompt request.
 */
export function extractLastAgentTurnText(events: AcpMessage[]): string {
  let lastPromptIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message;
    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
      lastPromptIndex = i;
      break;
    }
  }

  const parts: string[] = [];
  for (let i = lastPromptIndex + 1; i < events.length; i++) {
    const msg = events[i].message;
    if (!isJsonRpcNotification(msg) || msg.method !== "session/update") {
      continue;
    }
    const update = (msg.params as AgentMessageChunkUpdate | undefined)?.update;
    if (
      update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text" &&
      typeof update.content.text === "string"
    ) {
      parts.push(update.content.text);
    }
  }
  return parts.join("");
}
