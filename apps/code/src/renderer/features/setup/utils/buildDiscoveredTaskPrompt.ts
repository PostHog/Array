import type { DiscoveredTask } from "@features/setup/types";

export function buildDiscoveredTaskPrompt(task: DiscoveredTask): string {
  if (task.prompt) return task.prompt;

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
