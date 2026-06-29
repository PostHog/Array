import { existsSync } from "node:fs";
import { join } from "node:path";

export type Adapter = "claude" | "codex";

/**
 * Live e2e configuration, resolved entirely from the environment so no secret is
 * ever committed. A run needs a local llm-gateway (`./bin/start` in the posthog
 * repo) and an OAuth token it accepts in `E2E_GATEWAY_TOKEN` — see `run-e2e.sh`,
 * which mints one. Without the token every arm self-skips, so `pnpm test` and CI
 * spend nothing.
 */
// `||` not `??`: CI sets unset `vars.*` to an empty string, which should fall
// back to the default rather than override it with "".
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL || "http://localhost:3308/posthog_code";
const TOKEN = process.env.E2E_GATEWAY_TOKEN ?? "";

// apps/code/resources/codex-acp/codex (the native app-server binary), relative
// to packages/agent/e2e.
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

  /**
   * Cheap model per adapter (overridable). Defaults to a small/cheap model so a
   * full run is a couple of short turns. If the gateway doesn't serve the
   * default, override via `E2E_CLAUDE_MODEL` / `E2E_CODEX_MODEL` — the turn will
   * fail loudly (never a false green) rather than silently skip.
   */
  model(adapter: Adapter): string {
    // `||` so an empty CI variable falls back to the default.
    if (adapter === "claude") {
      return process.env.E2E_CLAUDE_MODEL || "claude-haiku-4-5";
    }
    // gpt-5-mini is the cheapest codex model the gateway serves. It's on the
    // product block list, but that gate is only enforced in Agent.run — the
    // e2e drives createAcpConnection directly, so the model is accepted.
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

  /**
   * Point the adapter at the gateway exactly as the host's `configureEnvironment`
   * does: Claude reads `ANTHROPIC_*` from env; codex takes the gateway via
   * `codexOptions` but we set `OPENAI_*` too for parity, and force the native
   * app-server sub-adapter.
   */
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
  codexOptions(cwd: string): {
    cwd: string;
    binaryPath: string;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
  } {
    return {
      cwd,
      binaryPath: NATIVE_CODEX_BIN,
      apiBaseUrl: openAiBase(),
      apiKey: TOKEN,
      model: this.model("codex"),
    };
  },
};
