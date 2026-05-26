import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";

const log = logger.scope("resolve-default-model");

/**
 * Resolve the default model for the given adapter via the preview-config
 * tRPC query. Returns the server's `currentValue` for the `model` option, or
 * undefined if the call fails or the option is missing.
 *
 * Used by inbox flows that create cloud tasks directly (Discuss, Create PR)
 * without going through TaskInput — they need a model to pass to the saga
 * and the user hasn't necessarily picked one yet.
 */
export async function resolveDefaultModel(
  apiHost: string,
  adapter: "claude" | "codex",
): Promise<string | undefined> {
  try {
    const options = await trpcClient.agent.getPreviewConfigOptions.query({
      apiHost,
      adapter,
    });
    const modelOption = options.find(
      (o) => o.id === "model" || o.category === "model",
    );
    if (modelOption?.type === "select" && modelOption.currentValue) {
      return modelOption.currentValue;
    }
  } catch (error) {
    log.warn("Failed to resolve default model", { error, adapter });
  }
  return undefined;
}
