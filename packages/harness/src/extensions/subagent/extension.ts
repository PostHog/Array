import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PosthogProviderOptions } from "../posthog-provider/provider";
import type { AgentConfig } from "./agents";
import { runChain } from "./chain";
import {
  type AgentScope,
  discoverAgents,
  gateProjectAgents,
} from "./discovery";
import {
  formatParallelSummary,
  getFinalOutput,
  getResultOutput,
} from "./format";
import { runPool } from "./process/pool";
import { renderSubagentCall, renderSubagentResult } from "./render";
import { isFailedResult, runAgent, type SingleRunResult } from "./run-agent";

export type SubagentOptions = PosthogProviderOptions;

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const MAX_CHAIN_STEPS = 8;

const CONTEXT_FIELD_DESCRIPTION =
  "Context the agent needs beyond the task itself: file paths already found, decisions already made, constraints. Falls back to a short auto-digest of recent parent turns when omitted, but explicit context is more reliable — prefer passing it.";

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  context: Type.Optional(
    Type.String({ description: CONTEXT_FIELD_DESCRIPTION }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process" }),
  ),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({
    description:
      "Task with an optional {previous} placeholder for the prior step's output",
  }),
  context: Type.Optional(
    Type.String({ description: CONTEXT_FIELD_DESCRIPTION }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process" }),
  ),
});

const AgentScopeSchema = StringEnum(["bundled", "project", "both"] as const, {
  description:
    'Which agent definitions to use. Default: "bundled" (scout, planner, reviewer, worker, oracle). Use "both" to also include project-local .pi/agents/*.md (gated by trust + confirmation).',
  default: "bundled",
});

const SubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({ description: "Name of the agent to invoke (single mode)" }),
  ),
  task: Type.Optional(
    Type.String({ description: "Task to delegate (single mode)" }),
  ),
  context: Type.Optional(
    Type.String({ description: `${CONTEXT_FIELD_DESCRIPTION} (single mode)` }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description: "Tasks to run concurrently (parallel mode)",
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description: "Steps to run in order (chain mode)",
    }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description:
        "Whether to prompt before running project-local agents. Default: true. Set false only for trusted, already-confirmed automation.",
      default: true,
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent process (single mode)",
    }),
  ),
});

interface SubagentToolDetails {
  mode: "single" | "parallel" | "chain";
  results: SingleRunResult[];
}

type SubagentToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentToolDetails;
  isError?: boolean;
};

function errorResult(
  text: string,
  mode: SubagentToolDetails["mode"],
): SubagentToolResult {
  return {
    content: [{ type: "text" as const, text }],
    details: { mode, results: [] },
    isError: true,
  };
}

export function createSubagentExtension(
  options: SubagentOptions = {},
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    void options;

    // Saved orchestration shortcuts (/parallel-review, /scout-and-plan,
    // /implement-and-review) that just call the `subagent` tool in the
    // appropriate mode — pure data, no new runtime behavior.
    pi.on("resources_discover", () => ({
      promptPaths: [fileURLToPath(new URL("./prompts", import.meta.url))],
      skillPaths: [fileURLToPath(new URL("./skills", import.meta.url))],
    }));

    pi.registerTool(
      defineTool({
        name: "subagent",
        label: "Subagent",
        description: [
          "Delegate a task to a focused subagent running in its own isolated pi process/context window.",
          "Modes: single ({agent, task}), parallel ({tasks:[...]}, max 8 tasks / 4 concurrent), chain ({chain:[...]}, sequential with a {previous} placeholder for the prior step's output, max 8 steps).",
          "Bundled agents: scout (fast read-only recon), planner (implementation plan, no edits), reviewer (reviews a diff/change, can apply small fixes), worker (general-purpose implementation), oracle (second opinion, no edits).",
          'Set agentScope: "both" to also allow project-local .pi/agents/*.md (gated by trust + confirmation).',
        ].join(" "),
        promptSnippet:
          "Delegate a task to a focused subagent (scout, planner, reviewer, worker, oracle)",
        promptGuidelines: [
          "Use subagent to delegate scoped work (recon, planning, review, a second opinion) to an isolated context instead of doing it inline.",
          "Use subagent's parallel mode to run several independent scouts/reviewers concurrently rather than sequentially.",
          "Use subagent's chain mode for a fixed pipeline (e.g. scout -> planner -> worker) where each step needs the previous step's output.",
          "Always pass subagent's context field with file paths already found, decisions already made, and constraints — a subagent otherwise only sees its bare task text plus a small auto-generated digest of recent turns.",
          "Subagents cannot themselves call subagent; keep orchestration in the parent session.",
        ],
        parameters: SubagentParams,
        renderCall: renderSubagentCall,
        renderResult: renderSubagentResult,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
          const agentScope: AgentScope =
            (params.agentScope as AgentScope | undefined) ?? "bundled";
          const discovery = discoverAgents(ctx.cwd, agentScope);
          const findAgent = (name: string): AgentConfig | undefined =>
            discovery.agents.find((a) => a.name === name);
          const listAvailable = () =>
            discovery.agents.map((a) => `${a.name} (${a.source})`).join(", ") ||
            "none";

          const hasChain = (params.chain?.length ?? 0) > 0;
          const hasTasks = (params.tasks?.length ?? 0) > 0;
          const hasSingle = Boolean(params.agent && params.task);
          const modeCount =
            Number(hasChain) + Number(hasTasks) + Number(hasSingle);
          const mode: SubagentToolDetails["mode"] = hasChain
            ? "chain"
            : hasTasks
              ? "parallel"
              : "single";

          if (modeCount !== 1) {
            return errorResult(
              `Provide exactly one of agent+task, tasks, or chain. Available agents: ${listAvailable()}`,
              "single",
            );
          }

          const requestedNames = new Set<string>();
          for (const step of params.chain ?? []) requestedNames.add(step.agent);
          for (const t of params.tasks ?? []) requestedNames.add(t.agent);
          if (params.agent) requestedNames.add(params.agent);

          const requestedAgents = Array.from(requestedNames)
            .map(findAgent)
            .filter((a): a is AgentConfig => Boolean(a));

          const gate = await gateProjectAgents({
            ctx,
            requestedAgents,
            projectAgentsDir: discovery.projectAgentsDir,
            confirmProjectAgents: params.confirmProjectAgents,
          });
          if (!gate.allowed) {
            return errorResult(
              gate.reason ?? "Refused to run project-local agents.",
              mode,
            );
          }

          if (
            hasChain &&
            params.chain &&
            params.chain.length > MAX_CHAIN_STEPS
          ) {
            return errorResult(
              `Too many chain steps (${params.chain.length}). Max is ${MAX_CHAIN_STEPS}.`,
              "chain",
            );
          }
          if (
            hasTasks &&
            params.tasks &&
            params.tasks.length > MAX_PARALLEL_TASKS
          ) {
            return errorResult(
              `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              "parallel",
            );
          }
          if (hasTasks && params.tasks) {
            const unknown = params.tasks.filter((t) => !findAgent(t.agent));
            if (unknown.length > 0) {
              return errorResult(
                `Unknown agent(s): ${unknown.map((t) => t.agent).join(", ")}. Available agents: ${listAvailable()}`,
                "parallel",
              );
            }
          }
          if (hasSingle) {
            if (!findAgent(params.agent as string)) {
              return errorResult(
                `Unknown agent "${params.agent}". Available agents: ${listAvailable()}`,
                "single",
              );
            }
          }

          type UpdateFn = typeof onUpdate;

          const runDispatch = async (
            dispatchSignal: AbortSignal | undefined,
            dispatchOnUpdate: UpdateFn,
          ): Promise<SubagentToolResult> => {
            if (hasChain && params.chain) {
              const outcome = await runChain({
                ctx,
                steps: params.chain,
                findAgent,
                signal: dispatchSignal,
                onUpdate: (results) =>
                  dispatchOnUpdate?.({
                    content: [
                      {
                        type: "text",
                        text:
                          getFinalOutput(
                            results[results.length - 1]?.messages ?? [],
                          ) || "(running...)",
                      },
                    ],
                    details: { mode: "chain", results },
                  }),
              });

              if (outcome.unknownAgent) {
                return errorResult(
                  `Chain stopped at step ${outcome.unknownAgent.step}: unknown agent "${outcome.unknownAgent.name}". Available agents: ${listAvailable()}`,
                  "chain",
                );
              }
              if (outcome.failedAtStep) {
                const failedResult = outcome.results[outcome.failedAtStep - 1];
                return {
                  content: [
                    {
                      type: "text",
                      text: `Chain stopped at step ${outcome.failedAtStep} (${failedResult.agent}): ${getResultOutput(failedResult)}`,
                    },
                  ],
                  details: { mode: "chain", results: outcome.results },
                  isError: true,
                };
              }

              const last = outcome.results[outcome.results.length - 1];
              return {
                content: [
                  {
                    type: "text",
                    text:
                      (last && getFinalOutput(last.messages)) || "(no output)",
                  },
                ],
                details: { mode: "chain", results: outcome.results },
              };
            }

            if (hasTasks && params.tasks) {
              const results = await runPool(
                params.tasks,
                { concurrency: MAX_CONCURRENCY, signal: dispatchSignal },
                (t, _index, taskSignal) => {
                  const agent = findAgent(t.agent) as AgentConfig;
                  return runAgent({
                    ctx,
                    agent,
                    task: t.task,
                    cwd: t.cwd,
                    context: t.context,
                    signal: taskSignal,
                  });
                },
              );

              return {
                content: [
                  { type: "text", text: formatParallelSummary(results) },
                ],
                details: { mode: "parallel", results },
              };
            }

            const agent = findAgent(params.agent as string) as AgentConfig;
            const result = await runAgent({
              ctx,
              agent,
              task: params.task as string,
              cwd: params.cwd,
              context: params.context,
              signal: dispatchSignal,
              onUpdate: (partial) =>
                dispatchOnUpdate?.({
                  content: [
                    {
                      type: "text",
                      text: getFinalOutput(partial.messages) || "(running...)",
                    },
                  ],
                  details: { mode: "single", results: [partial] },
                }),
            });

            if (isFailedResult(result)) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}`,
                  },
                ],
                details: { mode: "single", results: [result] },
                isError: true,
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: getFinalOutput(result.messages) || "(no output)",
                },
              ],
              details: { mode: "single", results: [result] },
            };
          };

          return runDispatch(signal, onUpdate);
        },
      }),
    );
  };
}

export default function subagent(pi: ExtensionAPI): void | Promise<void> {
  return createSubagentExtension()(pi);
}
