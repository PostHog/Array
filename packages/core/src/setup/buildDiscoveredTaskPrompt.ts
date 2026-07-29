import type { DiscoveredTask } from "@posthog/core/setup/types";

const EXPERIMENT_TASK_PROMPT =
  "Set up a PostHog experiment for the feature in this task. Use the PostHog MCP to create the feature flag with control and test variants, then create the experiment in draft with a clear hypothesis and primary metric tied to the feature's success. Wire the variant into the code via posthog.getFeatureFlag. Only launch the experiment if the feature is already live in production — otherwise leave it in draft and tell me to launch it after this is merged and deployed.";

function buildExperimentTaskPrompt(task: DiscoveredTask): string {
  const sections: string[] = [
    EXPERIMENT_TASK_PROMPT,
    "",
    "Use the analysis below as the starting point.",
    "",
    `Hypothesis: ${task.title}`,
    "",
    task.description,
  ];

  if (task.impact) {
    sections.push("", "Primary metric:", task.impact);
  }

  if (task.recommendation) {
    sections.push("", "Proposed variants:", task.recommendation);
  }

  if (task.file) {
    const location = task.lineHint
      ? `${task.file}:${task.lineHint}`
      : task.file;
    sections.push("", `Surface: ${location}`);
  }

  return sections.join("\n");
}

export function buildDiscoveredTaskPrompt(task: DiscoveredTask): string {
  if (task.prompt) return task.prompt;
  if (task.category === "experiment") {
    return buildExperimentTaskPrompt(task);
  }

  const sections: string[] = [
    "Investigate this issue and implement the fix. Open a PR if appropriate.",
    "",
    task.title,
    "",
    task.description,
  ];

  if (task.impact) {
    sections.push("", "Why it matters:", task.impact);
  }

  if (task.recommendation) {
    sections.push("", "Suggested approach:", task.recommendation);
  }

  if (task.file) {
    const location = task.lineHint
      ? `${task.file}:${task.lineHint}`
      : task.file;
    sections.push("", `File: ${location}`);
  }

  return sections.join("\n");
}
