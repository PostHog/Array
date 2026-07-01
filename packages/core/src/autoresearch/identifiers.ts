export const AUTORESEARCH_SERVICE = Symbol.for(
  "posthog.core.autoresearch.service",
);

/**
 * Narrow host seam for delivering autoresearch prompts to a task's agent
 * session. Bound by hosts to forward into their session service.
 */
export interface AutoresearchPromptClient {
  sendPrompt(taskId: string, prompt: string): Promise<void>;
}

export const AUTORESEARCH_PROMPT_CLIENT = Symbol.for(
  "posthog.core.autoresearch.promptClient",
);
