import { afterEach, describe, expect, it } from "vitest";
import { resolveUseCodexAppServer } from "./acp-connection";

describe("resolveUseCodexAppServer", () => {
  const saved = {
    app: process.env.POSTHOG_CODEX_USE_APP_SERVER,
    acp: process.env.POSTHOG_CODEX_USE_ACP,
  };
  afterEach(() => {
    if (saved.app === undefined)
      delete process.env.POSTHOG_CODEX_USE_APP_SERVER;
    else process.env.POSTHOG_CODEX_USE_APP_SERVER = saved.app;
    if (saved.acp === undefined) delete process.env.POSTHOG_CODEX_USE_ACP;
    else process.env.POSTHOG_CODEX_USE_ACP = saved.acp;
  });

  it("host flag wins over env and default", () => {
    process.env.POSTHOG_CODEX_USE_ACP = "1";
    process.env.POSTHOG_CODEX_USE_APP_SERVER = "1";
    expect(resolveUseCodexAppServer({ useCodexAppServer: false })).toBe(false);
    expect(resolveUseCodexAppServer({ useCodexAppServer: true })).toBe(true);
  });

  it("POSTHOG_CODEX_USE_APP_SERVER=1 forces app-server", () => {
    delete process.env.POSTHOG_CODEX_USE_ACP;
    process.env.POSTHOG_CODEX_USE_APP_SERVER = "1";
    expect(resolveUseCodexAppServer({})).toBe(true);
  });

  it("POSTHOG_CODEX_USE_ACP=1 forces codex-acp", () => {
    delete process.env.POSTHOG_CODEX_USE_APP_SERVER;
    process.env.POSTHOG_CODEX_USE_ACP = "1";
    expect(resolveUseCodexAppServer({})).toBe(false);
  });

  it("defaults to codex-acp when nothing is set (app-server is opt-in)", () => {
    delete process.env.POSTHOG_CODEX_USE_APP_SERVER;
    delete process.env.POSTHOG_CODEX_USE_ACP;
    expect(resolveUseCodexAppServer({})).toBe(false);
  });

  it("host flag false beats POSTHOG_CODEX_USE_APP_SERVER=1", () => {
    process.env.POSTHOG_CODEX_USE_APP_SERVER = "1";
    delete process.env.POSTHOG_CODEX_USE_ACP;
    expect(resolveUseCodexAppServer({ useCodexAppServer: false })).toBe(false);
  });
});
