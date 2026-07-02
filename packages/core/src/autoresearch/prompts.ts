/**
 * The autoresearch protocol: how we brief the agent, how the agent reports
 * metric measurements back, and how we read those reports out of the session
 * transcript. Prompt builders and the report parser are two sides of the same
 * contract — keep them in sync.
 */
import type { AcpMessage } from "@posthog/shared";
import { isJsonRpcNotification, isJsonRpcRequest } from "@posthog/shared";
import type {
  AutoresearchConfig,
  AutoresearchDraftConfig,
  AutoresearchReport,
  AutoresearchRun,
} from "./schemas";
import { computeBest } from "./stats";

const REPORT_BLOCK_EXAMPLE = [
  "```autoresearch",
  "metric: <number>",
  "summary: <one line describing what you changed>",
  "```",
].join("\n");

function directionPhrase(config: AutoresearchDraftConfig): string {
  return config.direction === "maximize" ? "maximize" : "minimize";
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
 */
export function buildKickoffPreamble(config: AutoresearchDraftConfig): string {
  return `You are now in autoresearch mode: an iterative optimization loop to ${directionPhrase(config)} the metric "${config.metricName}".

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

export function buildContinuationPrompt(run: AutoresearchRun): string {
  const { config, iterations } = run;
  const best = computeBest(iterations, config.direction);
  const last = iterations[iterations.length - 1];
  const nextIndex = iterations.length + 1;

  const recent = iterations
    .slice(-5)
    .map(
      (iteration) =>
        `- Iteration ${iteration.index}: ${iteration.value}${iteration.summary ? ` — ${iteration.summary}` : ""}`,
    )
    .join("\n");

  return `Autoresearch iteration ${nextIndex} of ${config.maxIterations} for "${config.metricName}" (${directionPhrase(config)}).

Recent iterations:
${recent}

Best so far: ${best ? `${best.value} (iteration ${best.index})` : "none"}. Last: ${last ? last.value : "none"}.${targetLine(config)}

Continue: make the next focused change, measure "${config.metricName}", and end your reply with the report block:

${REPORT_BLOCK_EXAMPLE}`;
}

export function buildReportReminderPrompt(config: AutoresearchConfig): string {
  return `Your last reply did not include a parseable autoresearch report block, so the iteration was not recorded. Measure "${config.metricName}" now and reply ending with exactly:

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

function parseReportBody(body: string): AutoresearchReport | null {
  let value: number | null = null;
  let summary: string | null = null;
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    if (key === "metric") {
      const numeric = Number.parseFloat(raw.replace(/,/g, ""));
      if (Number.isFinite(numeric)) value = numeric;
    } else if (key === "summary" && raw.length > 0) {
      summary = raw;
    }
  }
  return value === null ? null : { value, summary };
}

interface AgentMessageChunkUpdate {
  update?: {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
  };
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
