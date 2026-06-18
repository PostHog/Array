import { xmlToPlainText } from "@posthog/core/message-editor/content";
import type { Task } from "@posthog/shared/domain-types";

export const REGENERATE_INTERVAL = 7;

export function getFallbackTaskTitle(description: string): string {
  const plainText = xmlToPlainText(description).trim();
  return (plainText || "Untitled").slice(0, 255);
}

export function isPlaceholderTaskTitle(
  task: Pick<Task, "title" | "description">,
): boolean {
  if (task.title.trim().length === 0) {
    return true;
  }

  const fallbackTitle = getFallbackTaskTitle(task.description);
  return task.title === fallbackTitle;
}

export function isAutoTitleLocked(task: Task | undefined): boolean {
  if (!task?.title_manually_set) {
    return false;
  }

  return !isPlaceholderTaskTitle(task);
}

export interface TitleGenerationDecision {
  shouldGenerateFromPrompts: boolean;
  shouldGenerateFromTaskDescription: boolean;
}

export function decideTitleGeneration(input: {
  promptCount: number;
  lastGeneratedAtCount: number;
  initialDescriptionHandled: boolean;
  task: Pick<Task, "title" | "description">;
}): TitleGenerationDecision {
  const { promptCount, lastGeneratedAtCount, initialDescriptionHandled, task } =
    input;

  const shouldGenerateFromPrompts =
    (promptCount === 1 && lastGeneratedAtCount === 0) ||
    (promptCount > 1 &&
      promptCount - lastGeneratedAtCount >= REGENERATE_INTERVAL);

  const shouldGenerateFromTaskDescription =
    promptCount === 0 &&
    !initialDescriptionHandled &&
    task.description.trim().length > 0 &&
    isPlaceholderTaskTitle(task);

  return { shouldGenerateFromPrompts, shouldGenerateFromTaskDescription };
}

export function selectPromptsForTitle(
  prompts: string[],
  promptCount: number,
): string[] {
  const promptsForTitle =
    promptCount === 1 ? prompts : prompts.slice(-REGENERATE_INTERVAL);
  return promptsForTitle;
}

export function formatPromptsForTitleInput(prompts: string[]): string {
  return prompts.map((p, i) => `${i + 1}. ${p}`).join("\n");
}
