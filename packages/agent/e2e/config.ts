import { existsSync } from "node:fs";
import { join } from "node:path";

export type Adapter = "claude" | "codex";

/**
 * Live e2e configuration, resolved entirely from the environment so no secret is
 * committed. Needs a local llm-gateway and a token in `E2E_GATEWAY_TOKEN`; targets
 * the `llm_gateway` product, which accepts a personal API key (no OAuth mint,
 * unlike prod's `posthog_code`). Without the token every arm self-skips.
 */
// `||` not `??`: CI sets unset vars to "" which should fall back to the default.
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL || "http://localhost:3308/llm_gateway";
const TOKEN = process.env.E2E_GATEWAY_TOKEN ?? "";

// The native app-server binary, relative to packages/agent/e2e.
const NATIVE_CODEX_BIN = join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "code",
  "resources",
  "codex-acp",
  "codex",
);

/** The gateway base with a trailing `/v1` (codex / OpenAI-format endpoint). */
function openAiBase(): string {
  return GATEWAY_URL.endsWith("/v1") ? GATEWAY_URL : `${GATEWAY_URL}/v1`;
}

export const E2E = {
  token: TOKEN,
  hasToken: !!TOKEN,
  gatewayUrl: GATEWAY_URL,
  codexBin: NATIVE_CODEX_BIN,
  /** Deployment environment. `E2E_ENVIRONMENT=cloud` exercises the cloud code path; undefined = local. */
  environment:
    (process.env.E2E_ENVIRONMENT as "local" | "cloud" | undefined) || undefined,

  /** Cheap model per adapter, overridable via `E2E_CLAUDE_MODEL` / `E2E_CODEX_MODEL`. */
  model(adapter: Adapter): string {
    // `||` so an empty CI variable falls back to the default.
    if (adapter === "claude") {
      return process.env.E2E_CLAUDE_MODEL || "claude-haiku-4-5";
    }
    // gpt-5-mini is on the product block list, but that gate is only enforced in
    // Agent.run — the e2e drives createAcpConnection directly, so it's accepted.
    return process.env.E2E_CODEX_MODEL || "gpt-5-mini";
  },

  /** Null => runnable; a string => skip this arm with that reason (never silent). */
  skipReason(adapter: Adapter): string | null {
    if (!TOKEN) return "E2E_GATEWAY_TOKEN not set";
    if (adapter === "codex" && !existsSync(NATIVE_CODEX_BIN)) {
      return `native codex binary missing at ${NATIVE_CODEX_BIN}`;
    }
    return null;
  },

  /** Point the adapter at the gateway as the host's `configureEnvironment` does. */
  configureEnv(adapter: Adapter): void {
    if (adapter === "claude") {
      process.env.ANTHROPIC_BASE_URL = GATEWAY_URL;
      process.env.ANTHROPIC_AUTH_TOKEN = TOKEN;
      return;
    }
    process.env.OPENAI_BASE_URL = openAiBase();
    process.env.OPENAI_API_KEY = TOKEN;
    process.env.POSTHOG_CODEX_USE_APP_SERVER = "1";
  },

  /** The codexOptions the codex arm passes through `createAcpConnection`. */
  codexOptions(
    cwd: string,
    configOverrides?: Record<string, string | number>,
    modelOverride?: string,
  ): {
    cwd: string;
    binaryPath: string;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    configOverrides?: Record<string, string | number>;
  } {
    return {
      cwd,
      binaryPath: NATIVE_CODEX_BIN,
      apiBaseUrl: openAiBase(),
      apiKey: TOKEN,
      model: modelOverride || this.model("codex"),
      ...(configOverrides ? { configOverrides } : {}),
    };
  },

  /** A stronger model for tests the cheapest models can't handle (e.g. structured-output decodes). */
  strongModel(adapter: Adapter): string {
    if (adapter === "claude") {
      return process.env.E2E_CLAUDE_MODEL || "claude-sonnet-4-5";
    }
    return process.env.E2E_CODEX_MODEL || "gpt-5.5";
  },
};
