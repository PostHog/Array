/**
 * Custom `renderCall`/`renderResult` for the `subagent` tool: collapsed
 * (default) and expanded (Ctrl+O) views, live progress for running parallel
 * tasks, and per-run usage stats. Purely presentational over `format.ts`'s
 * pure data — no behavior change to any other module. Modes: `single` and
 * `parallel` only — there is no chain mode.
 */

import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getFinalOutput } from "./format";
import {
  isFailedResult,
  type SingleRunResult,
  type UsageStats,
} from "./run-agent";

const COLLAPSED_RESULT_LINES = 3;

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatUsageStats(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`\u2191${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`\u2193${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0)
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function statusIcon(theme: Theme, result: SingleRunResult): string {
  if (result.exitCode === -1) return theme.fg("warning", "\u23f3");
  return isFailedResult(result)
    ? theme.fg("error", "\u2717")
    : theme.fg("success", "\u2713");
}

interface SubagentRenderDetails {
  mode: "single" | "parallel";
  results: SingleRunResult[];
}

export function renderSubagentCall(
  args: {
    agent?: string;
    task?: string;
    tasks?: Array<{ agent: string; task: string }>;
  },
  theme: Theme,
): InstanceType<typeof Text> {
  if (args.tasks && args.tasks.length > 0) {
    let text =
      theme.fg("toolTitle", theme.bold("subagent ")) +
      theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
    for (const task of args.tasks.slice(0, 3)) {
      text += `\n  ${theme.fg("accent", task.agent)} ${theme.fg("dim", task.task.slice(0, 40))}`;
    }
    return new Text(text, 0, 0);
  }

  const agentName = args.agent ?? "...";
  const preview = args.task ? args.task.slice(0, 60) : "...";
  return new Text(
    `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", agentName)}\n  ${theme.fg("dim", preview)}`,
    0,
    0,
  );
}

function renderSingle(
  result: SingleRunResult,
  theme: Theme,
  expanded: boolean,
) {
  const icon = statusIcon(theme, result);
  const finalOutput = getFinalOutput(result.messages);
  const usageStr = formatUsageStats(result.usage, result.model);

  if (!expanded) {
    let text = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
    if (isFailedResult(result) && result.errorMessage) {
      text += `\n${theme.fg("error", result.errorMessage)}`;
    } else {
      const preview = finalOutput
        .split("\n")
        .slice(0, COLLAPSED_RESULT_LINES)
        .join("\n");
      text += preview
        ? `\n${theme.fg("toolOutput", preview)}`
        : `\n${theme.fg("muted", "(no output)")}`;
    }
    if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
    return new Text(text, 0, 0);
  }

  const container = new Container();
  container.addChild(
    new Text(
      `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}`,
      0,
      0,
    ),
  );
  container.addChild(new Spacer(1));
  container.addChild(
    new Text(
      theme.fg("muted", "\u2500\u2500\u2500 Task \u2500\u2500\u2500"),
      0,
      0,
    ),
  );
  container.addChild(new Text(theme.fg("dim", result.task), 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(
    new Text(
      theme.fg("muted", "\u2500\u2500\u2500 Output \u2500\u2500\u2500"),
      0,
      0,
    ),
  );
  if (isFailedResult(result) && result.errorMessage) {
    container.addChild(new Text(theme.fg("error", result.errorMessage), 0, 0));
  } else if (finalOutput) {
    container.addChild(
      new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()),
    );
  } else {
    container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
  }
  if (usageStr) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
  }
  return container;
}

export function renderSubagentResult(
  result: AgentToolResult<SubagentRenderDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): InstanceType<typeof Text> | InstanceType<typeof Container> {
  const details = result.details;

  if (!details || details.results.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  if (details.mode === "single") {
    return renderSingle(details.results[0], theme, options.expanded);
  }

  const label = "parallel";
  const successCount = details.results.filter(
    (r) => !isFailedResult(r) && r.exitCode !== -1,
  ).length;
  const running = details.results.filter((r) => r.exitCode === -1).length;
  const status =
    running > 0
      ? `${successCount}/${details.results.length} done, ${running} running`
      : `${successCount}/${details.results.length} succeeded`;

  if (!options.expanded) {
    let text = `${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("accent", status)}`;
    for (const r of details.results) {
      text += `\n${statusIcon(theme, r)} ${theme.fg("accent", r.agent)}`;
    }
    text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    return new Text(text, 0, 0);
  }

  const container = new Container();
  container.addChild(
    new Text(
      `${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("accent", status)}`,
      0,
      0,
    ),
  );
  for (const r of details.results) {
    container.addChild(new Spacer(1));
    container.addChild(renderSingle(r, theme, true));
  }
  return container;
}
