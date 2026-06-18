import type { ReportModelResolver } from "@posthog/core/inbox/identifiers";
import { logger } from "@posthog/ui/shell/logger";
import type { QueryClient } from "@tanstack/react-query";

const log = logger.scope("resolve-default-model");

/**
 * Resolve the default model for the given adapter via the preview-config
 * tRPC query. Returns the server's `currentValue` for the `model` option, or
 * undefined if the call fails or the option is missing.
 *
 * Used by inbox flows that create cloud tasks directly (Discuss, Create PR)
 * without going through TaskInput – they need a model to pass to the saga
 * and the user hasn't necessarily picked one yet.
 */
export async function resolveDefaultModel(
  queryClient: QueryClient,
  apiHost: string,
  adapter: "claude" | "codex",
  modelResolver: ReportModelResolver,
): Promise<string | undefined> {
  void queryClient;
  try {
    return await modelResolver.resolveDefaultModel(apiHost, adapter);
  } catch (error) {
    log.warn("Failed to resolve default model", { error, adapter });
  }
  return undefined;
}
