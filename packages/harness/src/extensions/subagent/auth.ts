/**
 * Resolves which model/credentials a child subagent process should use, and
 * generates the tiny static-provider extension that hands those credentials
 * to the child without it ever re-running OAuth/gateway resolution itself.
 *
 * No dependency on any specific provider extension (e.g. `posthog-provider`):
 * this reads whatever the parent session already has configured, for
 * whichever provider that happens to be.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export interface ResolvedModelAuth {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
}

export class SubagentAuthError extends Error {}

export interface ModelRequest {
  /** Name used only for error messages (e.g. the requesting agent's name). */
  requestedBy: string;
  /** "provider/id", a bare model id, or `undefined` to use the parent's current model. */
  model?: string;
}

/**
 * Picks the model the child should use — `request.model` ("provider/id")
 * when set, otherwise the parent's current model — and resolves its
 * credentials via `ctx.modelRegistry`. Never performs a login/refresh
 * network call itself; `ctx.modelRegistry` already owns that for the parent
 * session.
 */
export async function resolveModelAuth(
  ctx: ExtensionContext,
  request: ModelRequest,
): Promise<ResolvedModelAuth> {
  let model: Model<Api> | undefined = ctx.model;

  if (request.model) {
    const slash = request.model.indexOf("/");
    model =
      slash > 0
        ? ctx.modelRegistry.find(
            request.model.slice(0, slash),
            request.model.slice(slash + 1),
          )
        : ctx.modelRegistry
            .getAll()
            .find(
              (candidate) =>
                candidate.id === request.model &&
                (!ctx.model || candidate.provider === ctx.model.provider),
            );

    if (!model) {
      throw new SubagentAuthError(
        `Unknown model "${request.model}" requested by "${request.requestedBy}".`,
      );
    }
  }

  if (!model) {
    throw new SubagentAuthError(
      "No active model to delegate to. Select a model first (/model).",
    );
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new SubagentAuthError(
      `No credentials available for model "${model.provider}/${model.id}".`,
    );
  }

  return { model, apiKey: auth.apiKey, headers: auth.headers };
}

/**
 * Tries `primary`, then each of `fallbacks` in order, resolving to the first
 * model with usable credentials. Throws the last error if none work.
 */
export async function resolveModelAuthWithFallback(
  ctx: ExtensionContext,
  requestedBy: string,
  primary: string | undefined,
  fallbacks: string[] = [],
): Promise<ResolvedModelAuth> {
  const candidates = [primary, ...fallbacks];
  let lastError: unknown;
  for (const model of candidates) {
    try {
      return await resolveModelAuth(ctx, { requestedBy, model });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SubagentAuthError("No model could be resolved.");
}

/**
 * Writes a generated extension file that statically registers the resolved
 * provider/model/API key, so the child process never has to resolve auth on
 * its own. Caller owns cleanup of the returned directory.
 */
export async function writeAuthBridgeExtension(
  auth: ResolvedModelAuth,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "posthog-subagent-auth-"),
  );
  const filePath = path.join(tmpDir, "auth-bridge.mjs");
  const { model, apiKey, headers } = auth;

  const providerConfig = {
    baseUrl: model.baseUrl,
    apiKey,
    api: model.api,
    headers,
    models: [
      {
        id: model.id,
        name: model.name,
        api: model.api,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        headers: model.headers,
        compat: model.compat,
      },
    ],
  };

  const source = `export default function (pi) {\n  pi.registerProvider(${JSON.stringify(model.provider)}, ${JSON.stringify(providerConfig, null, 2)});\n}\n`;

  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, source, {
      encoding: "utf-8",
      mode: 0o600,
    });
  });
  return { dir: tmpDir, filePath };
}
