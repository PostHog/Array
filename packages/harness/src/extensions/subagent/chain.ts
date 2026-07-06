/**
 * Sequential subagent execution with `{previous}` substitution. Thin — reuses
 * `run-agent.ts` per step; no process/concurrency logic of its own. Stops at
 * the first failing step.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents";
import { getFinalOutput } from "./format";
import {
  isFailedResult,
  type OnSupervisorRequest,
  runAgent,
  type SingleRunResult,
} from "./run-agent";

export interface ChainStep {
  agent: string;
  task: string;
  cwd?: string;
  context?: string;
}

export interface RunChainOptions {
  ctx: ExtensionContext;
  steps: ChainStep[];
  findAgent: (name: string) => AgentConfig | undefined;
  signal?: AbortSignal;
  onUpdate?: (results: SingleRunResult[]) => void;
  onSupervisorRequest?: OnSupervisorRequest;
}

export interface ChainRunOutcome {
  results: SingleRunResult[];
  /** 1-based step number the chain stopped at, if it failed before completing all steps. */
  failedAtStep?: number;
  /** Set when a step referenced an agent name that doesn't exist. */
  unknownAgent?: { step: number; name: string };
}

export async function runChain(
  options: RunChainOptions,
): Promise<ChainRunOutcome> {
  const { ctx, steps, findAgent, signal, onUpdate, onSupervisorRequest } =
    options;
  const results: SingleRunResult[] = [];
  let previousOutput = "";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agent = findAgent(step.agent);
    if (!agent) {
      return { results, unknownAgent: { step: i + 1, name: step.agent } };
    }

    // Use a replacer *function*, not a plain string: `String.replace` treats a
    // string replacement's `$&`, `` $` ``, `$'`, `$$`, `$1`-`$99` as special
    // patterns, and `previousOutput` is arbitrary LLM-generated text that can
    // easily contain a literal "$$" or "$&" and get silently mangled.
    const taskWithContext = step.task.replace(
      /\{previous\}/g,
      () => previousOutput,
    );
    const result = await runAgent({
      ctx,
      agent,
      task: taskWithContext,
      cwd: step.cwd,
      context: step.context,
      step: i + 1,
      signal,
      onUpdate: (partial) => onUpdate?.([...results, partial]),
      onSupervisorRequest,
    });
    results.push(result);

    if (isFailedResult(result)) {
      return { results, failedAtStep: i + 1 };
    }
    previousOutput = getFinalOutput(result.messages);
  }

  return { results };
}
