/**
 * Differential parity harness for the two Codex adapters.
 *
 * Drives a scripted scenario (a stateful sequence of ACP client operations)
 * through one codex adapter — selected by the POSTHOG_CODEX_USE_ACP env toggle —
 * over the same in-process ACP transport the real host uses, and captures the
 * full ACP stream (every sessionUpdate, every server→client requestPermission,
 * and each call's response). Run the same scenario through both adapters and
 * diff the captured streams to find parity gaps. No HTTP/JWT/Temporal.
 */
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - resolved by tsx at runtime
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { createAcpConnection } from "../src/adapters/acp-connection";
import type { Logger } from "../src/utils/logger";

export type AdapterMode = "acp" | "app-server";

export interface CapturedEvent {
  t: number;
  kind:
    | "step"
    | "sessionUpdate"
    | "requestPermission"
    | "extNotification"
    | "extMethod";
  op?: string;
  sessionUpdate?: string;
  data?: any;
}

export interface CapturedRun {
  adapter: AdapterMode;
  scenario: string;
  events: CapturedEvent[];
  stepResults: Array<{ op: string; ok: boolean; result?: any; error?: string }>;
  fatalError?: string;
}

export interface ScenarioCtx {
  cwd: string;
  model?: string;
  /** Run one ACP operation, record it as a step boundary + its (redacted) result. */
  step<T>(op: string, fn: () => Promise<T>): Promise<T>;
}

export interface Scenario {
  name: string;
  run: (conn: any, ctx: ScenarioCtx) => Promise<void>;
}

export interface HarnessConfig {
  cwd: string;
  codexOptions: {
    cwd: string;
    binaryPath?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    reasoningEffort?: string;
  };
  timeoutMs?: number;
  logger?: Logger;
}

/** Keep result shapes comparable: drop big/nondeterministic blobs, keep structure. */
function redact(value: any): any {
  if (!value || typeof value !== "object") return value;
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "sessionId") out[k] = "<id>";
    else if (k === "configOptions" && Array.isArray(v)) {
      out[k] = v.map((o: any) => ({
        id: o?.id,
        category: o?.category,
        value: o?.value,
        options: (o?.options ?? []).map((x: any) => x?.id ?? x?.optionId),
      }));
    } else if (k === "modes") {
      out[k] = {
        currentModeId: (v as any)?.currentModeId,
        availableModes: ((v as any)?.availableModes ?? []).map(
          (m: any) => m?.id,
        ),
      };
    } else if (k === "usage" && v && typeof v === "object") {
      out[k] = Object.fromEntries(
        Object.entries(v).map(([uk, uv]) => [
          uk,
          typeof uv === "number" ? (uv > 0 ? ">0" : 0) : uv,
        ]),
      );
    } else if (typeof v === "string" && v.length > 120)
      out[k] = `<str:${v.length}>`;
    else out[k] = v;
  }
  return out;
}

export async function runScenario(
  mode: AdapterMode,
  scenario: Scenario,
  cfg: HarnessConfig,
): Promise<CapturedRun> {
  // Select the adapter. Until the migration adds a passed-in option, the env
  // toggle is the only lever: set => codex-acp, unset => native app-server.
  if (mode === "acp") process.env.POSTHOG_CODEX_USE_ACP = "1";
  else delete process.env.POSTHOG_CODEX_USE_ACP;

  const captured: CapturedRun = {
    adapter: mode,
    scenario: scenario.name,
    events: [],
    stepResults: [],
  };
  let ord = 0;

  const client = {
    async sessionUpdate(p: any): Promise<void> {
      captured.events.push({
        t: ord++,
        kind: "sessionUpdate",
        sessionUpdate: p?.update?.sessionUpdate,
        data: p?.update,
      });
    },
    async requestPermission(p: any): Promise<any> {
      captured.events.push({
        t: ord++,
        kind: "requestPermission",
        data: {
          title: p?.toolCall?.title,
          kind: p?.toolCall?.kind,
          options: (p?.options ?? []).map((o: any) => ({
            id: o?.optionId,
            kind: o?.kind,
          })),
        },
      });
      const allow =
        (p?.options ?? []).find(
          (o: any) => o?.kind === "allow_once" || o?.kind === "allow_always",
        ) ?? p?.options?.[0];
      return {
        outcome: { outcome: "selected", optionId: allow?.optionId ?? "allow" },
      };
    },
    async readTextFile(p: any): Promise<any> {
      return { content: await fs.readFile(resolve(cfg.cwd, p.path), "utf8") };
    },
    async writeTextFile(p: any): Promise<any> {
      await fs.writeFile(resolve(cfg.cwd, p.path), p.content);
      return {};
    },
    // PostHog ext-notifications (_posthog/usage_update, _posthog/turn_complete,
    // _posthog/sdk_session, ...) are part of the parity surface and are sent
    // outside sessionUpdate — capture them so the report covers them.
    async extNotification(method: string, params: any): Promise<void> {
      captured.events.push({
        t: ord++,
        kind: "extNotification",
        op: method,
        data: redact(params),
      });
    },
    async extMethod(method: string, params: any): Promise<any> {
      captured.events.push({
        t: ord++,
        kind: "extMethod",
        op: method,
        data: redact(params),
      });
      return {};
    },
  };

  const acp = createAcpConnection({
    adapter: "codex",
    codexOptions: cfg.codexOptions as any,
    logger: cfg.logger,
  });
  const stream = ndJsonStream(
    acp.clientStreams.writable,
    acp.clientStreams.readable,
  );
  const conn = new ClientSideConnection(() => client, stream);

  const ctx: ScenarioCtx = {
    cwd: cfg.cwd,
    model: cfg.codexOptions.model,
    async step(op, fn) {
      captured.events.push({ t: ord++, kind: "step", op });
      const started = Date.now();
      console.error(`  [step] ${op} ...`);
      try {
        const result = await fn();
        console.error(`  [step] ${op} ✓ (${Date.now() - started}ms)`);
        captured.stepResults.push({ op, ok: true, result: redact(result) });
        return result;
      } catch (e: any) {
        console.error(
          `  [step] ${op} ✗ (${Date.now() - started}ms): ${String(e?.message ?? e)}`,
        );
        captured.stepResults.push({
          op,
          ok: false,
          error: String(e?.message ?? e),
        });
        throw e;
      }
    },
  };

  const timeout = new Promise((_, rej) =>
    setTimeout(
      () =>
        rej(new Error(`scenario timeout after ${cfg.timeoutMs ?? 180000}ms`)),
      cfg.timeoutMs ?? 180000,
    ),
  );
  try {
    await ctx.step("initialize", () =>
      conn.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      }),
    );
    await Promise.race([scenario.run(conn, ctx), timeout]);
  } catch (e: any) {
    captured.fatalError = String(e?.message ?? e);
  } finally {
    // Bounded: a wedged adapter cleanup must never hang the loop.
    await Promise.race([
      acp.cleanup().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  return captured;
}
