import type { TaskCreationInput } from "@posthog/shared";

/** Minimal shape of a preview-config option we scan for the default model. */
export interface PreviewConfigOption {
  id?: string;
  category?: string;
  type?: string;
  currentValue?: string | boolean | null;
}

/** Pick the default model id out of the agent's preview-config options, if present. */
export function selectModelFromOptions(
  options: PreviewConfigOption[],
): string | undefined {
  const modelOption = options.find(
    (o) => o.id === "model" || o.category === "model",
  );
  if (
    modelOption?.type === "select" &&
    typeof modelOption.currentValue === "string" &&
    modelOption.currentValue
  ) {
    return modelOption.currentValue;
  }
  return undefined;
}

export interface BuildSignalReportTaskInput {
  prompt: string;
  reportId: string;
  cloudRepository: string;
  githubUserIntegrationId: string;
  adapter: "claude" | "codex";
  model: string;
  reasoningLevel?: string;
  baseBranch?: string | null;
}

/** Build the `TaskCreationInput` for an inbox direct-create (Discuss / Create-PR) flow. */
export function buildSignalReportTaskInput(
  args: BuildSignalReportTaskInput,
): TaskCreationInput {
  const {
    prompt,
    reportId,
    cloudRepository,
    githubUserIntegrationId,
    adapter,
    model,
    reasoningLevel,
    baseBranch,
  } = args;
  return {
    content: prompt,
    taskDescription: prompt,
    repository: cloudRepository,
    githubUserIntegrationId,
    workspaceMode: "cloud",
    executionMode: "auto",
    adapter,
    model,
    branch: baseBranch ?? null,
    reasoningLevel: reasoningLevel ?? undefined,
    cloudPrAuthorshipMode: "user",
    cloudRunSource: "signal_report",
    signalReportId: reportId,
  };
}
