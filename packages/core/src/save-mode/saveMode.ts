// Save Mode resolver — pure, host-neutral decision logic (alpha).
//
// Gated at the call site by the `llm-gateway-cost-controls` alpha flag; this
// module just computes the effective config. Pure-function module by design
// (same shape as billing/usageDisplay.ts and scouts/scoutPresentation.ts), so
// it is trivially testable and shared unchanged by the desktop and web hosts.
//
// Given the user's save-mode setting + the model/effort they asked for, returns
// the EFFECTIVE model + effort to run, an optional terseness system-reminder
// (the output-token lever), and the telemetry props to stamp on the
// $ai_generation event so savings can be computed in PostHog.

export type SaveMode = "off" | "balanced" | "max_save";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORT_ORDER: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function clampEffort(requested: EffortLevel, cap: EffortLevel): EffortLevel {
  const reqIdx = EFFORT_ORDER.indexOf(requested);
  const capIdx = EFFORT_ORDER.indexOf(cap);
  return reqIdx <= capIdx ? requested : cap;
}

// One-step downshift: the Opus family is the expensive default; Sonnet is the
// cheaper, still-capable tier. Helpers already run on Haiku elsewhere, so we do
// not downshift Sonnet/Haiku further. The gateway model allowlist already
// permits Sonnet, so this needs no backend change.
function downshiftModel(modelId: string): string {
  if (modelId.startsWith("claude-fable")) return "claude-sonnet-4-6";
  if (modelId.startsWith("claude-opus")) return "claude-sonnet-4-6";
  return modelId;
}

// Folds in the prompt-level cost levers PostHog benchmarked in
// posthog.com/blog/optimizing-agent-cost: terse output, trust prior
// results/compacted summaries (don't re-verify), and avoid subagents (no cache
// sharing → expensive cache rewrites + timeout/expiry loops).
const TERSE_REMINDER =
  "Save mode is on. Default to silence between tool calls and keep the final " +
  "summary to one or two sentences. Do not narrate routine actions, restate " +
  "the plan, or add features, refactors, or error handling beyond what was " +
  "asked — prefer the smallest change that fully answers the request. Trust " +
  "prior tool results and compacted summaries: do not re-read files or repeat " +
  "tool calls to double-check work already done. Avoid spawning subagents " +
  "unless the task genuinely fans out across independent items — a single " +
  "agent loop reuses the prompt cache and is usually cheaper.";

export interface SaveModeInput {
  mode: SaveMode;
  requestedModel: string;
  requestedEffort: EffortLevel;
  // Per-task escape hatch: run this one task at full power even in save mode.
  perTaskFullPower?: boolean;
}

export interface SaveModeResult {
  model: string;
  effort: EffortLevel;
  // Appended to the agent's system prompt when set (meta.systemPrompt seam).
  systemReminder: string | null;
  // Stamped onto the $ai_generation event via x-posthog-property-* headers.
  // baselineModel/baselineEffort = what WOULD have run at full power — the
  // repricing reference for the savings estimate.
  telemetry: {
    saveMode: boolean;
    baselineModel: string;
    baselineEffort: EffortLevel;
    effectiveEffort: EffortLevel;
  };
}

export function resolveSaveMode(input: SaveModeInput): SaveModeResult {
  const { mode, requestedModel, requestedEffort, perTaskFullPower } = input;

  const base = {
    baselineModel: requestedModel,
    baselineEffort: requestedEffort,
  };

  if (perTaskFullPower || mode === "off") {
    return {
      model: requestedModel,
      effort: requestedEffort,
      systemReminder: null,
      telemetry: { saveMode: false, ...base, effectiveEffort: requestedEffort },
    };
  }

  if (mode === "balanced") {
    // Gentle: cap effort at high (kills xhigh/max overthinking), keep the model.
    const effort = clampEffort(requestedEffort, "high");
    return {
      model: requestedModel,
      effort,
      systemReminder: TERSE_REMINDER,
      telemetry: { saveMode: true, ...base, effectiveEffort: effort },
    };
  }

  // max_save: downshift the model + cap effort at medium + terseness.
  const effort = clampEffort(requestedEffort, "medium");
  return {
    model: downshiftModel(requestedModel),
    effort,
    systemReminder: TERSE_REMINDER,
    telemetry: { saveMode: true, ...base, effectiveEffort: effort },
  };
}
