import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Adapter, E2E } from "./config";
import {
  type Capture,
  cleanupRepo,
  INIT_PARAMS,
  killCodexStragglers,
  type NewSessionResponse,
  ORIGINAL_TARGET,
  openConnection,
  openSession,
  readTarget,
  setupRepo,
  waitFor,
} from "./driver";

/**
 * Live session-lifecycle e2e: drives a representative session per adapter end to
 * end against the real gateway + binary on a cheap model. One shared golden turn
 * (in `beforeAll`) backs the turn / config / reattach assertions; the other
 * scenarios use their own short sessions. Codex-specific capabilities (the
 * `{decision}` approval round-trip, steering, mode synthesis, list/fork) run only
 * on the codex arm. Assertions are structural lifecycle invariants + the on-disk
 * side effect — never model prose (except the deterministic file edit) — so the
 * suite holds across adapters and cheap models. Opt-in: each arm self-skips
 * unless `E2E_GATEWAY_TOKEN` is set (and, for codex, the native binary exists).
 * Run via `pnpm test:e2e`; filter one adapter with `-t "(codex)"`.
 */
const ADAPTERS: Adapter[] = ["claude", "codex"];

const EDIT_PROMPT =
  "Do exactly these steps and nothing else: 1) Read the file target.txt. " +
  "2) Edit it so the second line reads FOO instead of line2. " +
  "3) Run the shell command `cat target.txt`. " +
  "4) In one sentence confirm what you changed, then stop.";

for (const adapter of ADAPTERS) {
  const skip = E2E.skipReason(adapter);
  const title = `session lifecycle (${adapter})${skip ? ` — SKIPPED (${skip})` : ""}`;
  // Codex-only capabilities; registered as skipped on the claude arm so the gap
  // is visible rather than silent.
  const itCodex = adapter === "codex" ? it : it.skip;

  describe.skipIf(!!skip)(title, () => {
    let repo: string;
    const codexOptions = () =>
      adapter === "codex" ? E2E.codexOptions(repo) : undefined;
    const meta = (extra: Record<string, unknown> = {}) => ({
      systemPrompt: "You are a coding assistant in a tiny test repo.",
      model: E2E.model(adapter),
      permissionMode: "bypassPermissions",
      // Drives the cloud ext-notifications (_posthog/sdk_session + turn_complete).
      taskRunId: "e2e-run",
      ...extra,
    });

    let sessionId: string;
    let newSessionResponse: NewSessionResponse;
    let turn: { stopReason?: string; capture: Capture; target: string };

    beforeAll(async () => {
      if (adapter === "codex") killCodexStragglers();
      E2E.configureEnv(adapter);
      repo = setupRepo();
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      sessionId = s.sessionId;
      newSessionResponse = s.newSession;
      try {
        const res = await s.conn.prompt({
          sessionId,
          prompt: [{ type: "text", text: EDIT_PROMPT }],
        });
        turn = {
          stopReason: res.stopReason,
          capture: s.capture,
          target: readTarget(repo),
        };
      } finally {
        await s.cleanup();
      }
    }, 180_000);

    afterAll(() => {
      cleanupRepo(repo);
    });

    it("newSession exposes selectable config options (model / effort)", () => {
      const opts = newSessionResponse.configOptions ?? [];
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.some((o) => (o.options?.length ?? 0) > 1)).toBe(true);
    });

    it("streams a working turn: assistant text, tool calls, usage, file edit", () => {
      expect(turn.stopReason).toBe("end_turn");
      expect(
        turn.capture.updates("agent_message_chunk").length,
      ).toBeGreaterThan(0);
      expect(turn.capture.updates("tool_call").length).toBeGreaterThan(0);
      const anyToolCompleted = [
        ...turn.capture.updates("tool_call"),
        ...turn.capture.updates("tool_call_update"),
      ].some((e) => e.data?.status === "completed");
      expect(anyToolCompleted).toBe(true);

      // A concrete usage signal — the exact method, not a loose substring.
      const hasUsage =
        turn.capture.updates("usage_update").length > 0 ||
        turn.capture.extMethods().includes("_posthog/usage_update");
      expect(hasUsage).toBe(true);

      // Both adapters map the session to the host's taskRunId via sdk_session
      // (the golden meta sets taskRunId, the cloud host always does).
      expect(turn.capture.extMethods()).toContain("_posthog/sdk_session");

      // The real on-disk side effect.
      expect(turn.target).not.toBe(ORIGINAL_TARGET);
      expect(turn.target).toContain("FOO");

      // codex additionally emits _posthog/turn_complete (claude signals turn
      // completion via the prompt response, not this ext-notification).
      if (adapter === "codex") {
        expect(turn.capture.extMethods()).toContain("_posthog/turn_complete");
        // turn_complete carries real, well-formed usage (totalTokens = sum).
        const tc = turn.capture.events.find(
          (e) =>
            e.kind === "extNotification" &&
            e.method === "_posthog/turn_complete",
        );
        const usage = (tc?.data as { usage?: Record<string, number> })?.usage;
        expect(usage).toBeTruthy();
        expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
        expect(usage?.totalTokens).toBe(
          (usage?.inputTokens ?? 0) +
            (usage?.outputTokens ?? 0) +
            (usage?.cachedReadTokens ?? 0) +
            (usage?.cachedWriteTokens ?? 0),
        );
      }
    });

    it("switches a config option via setSessionConfigOption", async () => {
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      try {
        const opt = (s.newSession.configOptions ?? []).find(
          (o) => (o.options?.length ?? 0) > 1,
        );
        expect(
          opt,
          "expected a config option with multiple values",
        ).toBeTruthy();
        const alt =
          opt?.options?.find((v) => v.value !== opt.currentValue) ??
          opt?.options?.[0];
        const res = await s.conn.setSessionConfigOption({
          sessionId: s.sessionId,
          configId: opt?.id,
          value: alt?.value,
        });
        expect(res).toBeTruthy();
        if (adapter === "codex") {
          // codex re-emits config_option_update as the side effect of a switch.
          expect(
            s.capture.updates("config_option_update").length,
          ).toBeGreaterThan(0);
        } else {
          // claude acks via the returned configOptions and/or a re-emit.
          const acknowledged =
            s.capture.updates("config_option_update").length +
              s.capture.updates("current_mode_update").length >
              0 || Array.isArray(res?.configOptions);
          expect(acknowledged).toBe(true);
        }
      } finally {
        await s.cleanup();
      }
    }, 90_000);

    // The cloud host switches mode ONLY via setSessionConfigOption(configId:"mode")
    // (never ACP setSessionMode) on BOTH adapters, so exercise both arms.
    it("emits current_mode_update when the mode is switched via setSessionConfigOption", async () => {
      if (adapter === "codex") killCodexStragglers();
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      try {
        // codex synthesizes modes (read-only); claude exposes a "mode"
        // configOption — pick an alternate value from it.
        let value = "read-only";
        if (adapter === "claude") {
          const modeOpt = (s.newSession.configOptions ?? []).find(
            (o) => o.id === "mode",
          );
          value =
            (modeOpt?.options?.find((v) => v.value !== modeOpt.currentValue)
              ?.value as string) ?? "plan";
        }
        await s.conn.setSessionConfigOption({
          sessionId: s.sessionId,
          configId: "mode",
          value,
        });
        expect(s.capture.updates("current_mode_update").length).toBeGreaterThan(
          0,
        );
      } finally {
        await s.cleanup();
      }
    }, 60_000);

    it("handles the host's refresh_session extMethod per adapter", async () => {
      if (adapter === "codex") killCodexStragglers();
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      try {
        const call = s.conn.extMethod("_posthog/refresh_session", {
          mcpServers: [],
        });
        if (adapter === "claude") {
          // claude IMPLEMENTS refresh_session; the cheap model (haiku) is on
          // the MCP-injection exclude list, so it RECOGNIZES the method and
          // rejects on the model gate — not method-not-found — proving the
          // host's call reaches the handler.
          await expect(call).rejects.toThrow(/MCP injection/i);
        } else {
          // codex doesn't implement extMethod — the host's refresh_session
          // call rejects cleanly (the known adapter divergence).
          await expect(call).rejects.toThrow();
        }
      } finally {
        await s.cleanup();
      }
    }, 60_000);

    // NOTE: the command/file approval `{decision}` round-trip is NOT exercised
    // here. codex spawns under a danger-full-access sandbox (spawn.ts), so it
    // auto-approves and never sends item/*requestApproval — even in read-only
    // mode — so an e2e approval assertion can't fire without changing production
    // sandbox behavior. That envelope is covered by unit tests instead
    // (codex-app-server-agent.test.ts: "maps allow to a decision envelope" et al).
    // Likewise the server->client requestPermission policy (publish-blocking,
    // Slack relay, plan approval, deny-on-shutdown) can't be triggered from a
    // cheap model in this harness — it's covered by approvals.test.ts.

    it("incorporates a prompt's _meta.prContext without error", async () => {
      if (adapter === "codex") killCodexStragglers();
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      try {
        // The host attaches prContext on PR-follow-up runs; both adapters
        // prepend it to the forwarded prompt.
        const res = await s.conn.prompt({
          sessionId: s.sessionId,
          prompt: [
            {
              type: "text",
              text: "Acknowledge the linked pull request in one short sentence, then stop.",
            },
          ],
          _meta: {
            prContext:
              "Context: PR #4242 'Fix the thing' is open and under review.",
          },
        });
        expect(res.stopReason).toBe("end_turn");
        expect(s.capture.updates("agent_message_chunk").length).toBeGreaterThan(
          0,
        );
      } finally {
        await s.cleanup();
      }
    }, 120_000);

    itCodex(
      "folds a mid-turn prompt into the running turn via steering",
      async () => {
        killCodexStragglers();
        const s = await openSession({
          adapter,
          cwd: repo,
          codexOptions: codexOptions(),
          meta: meta(),
        });
        try {
          const p1 = s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [
              {
                type: "text",
                text: "Count up from 1, one number per line, and keep going.",
              },
            ],
          });
          await waitFor(
            () =>
              s.capture.updates("agent_message_chunk").length > 0
                ? true
                : undefined,
            20_000,
          );
          // A second prompt while the turn is in flight folds in via turn/steer.
          const p2 = s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: "Now stop and say DONE." }],
          });
          const [r1] = await Promise.all([p1, p2]);
          expect(r1.stopReason).toBe("end_turn");
          // Both the original and the steered message echoed as user turns.
          expect(
            s.capture.updates("user_message_chunk").length,
          ).toBeGreaterThanOrEqual(2);
        } finally {
          await s.cleanup();
        }
      },
      120_000,
    );

    itCodex(
      "lists the session and forks it",
      async () => {
        killCodexStragglers();
        const b = openConnection({
          adapter,
          cwd: repo,
          codexOptions: codexOptions(),
        });
        try {
          await b.conn.initialize(INIT_PARAMS);
          const listed = await b.conn.listSessions({ cwd: repo });
          const ids = (listed.sessions ?? []).map((x) => x.sessionId);
          expect(ids).toContain(sessionId);
          const forked = await b.conn.unstable_forkSession({
            sessionId,
            cwd: repo,
            mcpServers: [],
            _meta: { model: E2E.model(adapter) },
          });
          expect(forked.sessionId).toBeTruthy();
          expect(forked.sessionId).not.toBe(sessionId);
        } finally {
          await b.cleanup();
        }
      },
      60_000,
    );

    // NOTE: the permission DENY path isn't exercised here. Neither arm reliably
    // surfaces a deny-able approval to a cheap model: codex auto-approves under
    // its danger-full-access sandbox, and claude routes file edits through ACP
    // writeTextFile rather than a requestPermission round-trip. The deny/cancel
    // paths are unit-covered instead (approvals.test.ts safe-default-on-reject;
    // codex-app-server-agent.test.ts command-approval cancel/decline envelope).

    it("interrupts an in-flight turn", async () => {
      if (adapter === "codex") killCodexStragglers();
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
        meta: meta(),
      });
      try {
        const p = s.conn.prompt({
          sessionId: s.sessionId,
          prompt: [
            {
              type: "text",
              text: "Count up from 1, one number per line, and never stop until told to.",
            },
          ],
        });
        // Cancel as soon as the turn is in flight (unbounded work, so no race
        // with a fast finish).
        await waitFor(
          () =>
            s.capture.updates("agent_message_chunk").length > 0 ||
            s.capture.updates("tool_call").length > 0
              ? true
              : undefined,
          20_000,
        );
        await s.conn.cancel({ sessionId: s.sessionId });
        const res = await p;
        expect(res.stopReason).toBe("cancelled");
      } finally {
        await s.cleanup();
      }
    }, 90_000);

    it("resumeSession reconnects and returns config options", async () => {
      if (adapter === "codex") killCodexStragglers();
      const b = openConnection({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
      });
      try {
        await b.conn.initialize(INIT_PARAMS);
        const resumed = await b.conn.resumeSession({
          sessionId,
          cwd: repo,
          mcpServers: [],
          _meta: { model: E2E.model(adapter) },
        });
        expect(resumed).toBeTruthy();
        expect(Array.isArray(resumed.configOptions)).toBe(true);
      } finally {
        await b.cleanup();
      }
    }, 60_000);

    it("reattach (loadSession) restores the session and replays the transcript", async () => {
      if (adapter === "codex") killCodexStragglers();
      const b = openConnection({
        adapter,
        cwd: repo,
        codexOptions: codexOptions(),
      });
      try {
        await b.conn.initialize(INIT_PARAMS);
        const loaded = await b.conn.loadSession({
          sessionId,
          cwd: repo,
          mcpServers: [],
          _meta: { model: E2E.model(adapter) },
        });
        expect(loaded).toBeTruthy();
        // loadSession runs no turn, so any transcript update here is replayed
        // history. The replayed shape differs by adapter, so assert each arm's
        // real replay path: codex replays user/agent message chunks (from
        // thread.turns via mapHistoryItem); claude replays tool calls (from its
        // SDK transcript via replaySessionHistory).
        const replayed = await waitFor(() => {
          const n =
            adapter === "codex"
              ? b.capture.updates("user_message_chunk").length +
                b.capture.updates("agent_message_chunk").length
              : b.capture.updates("tool_call").length +
                b.capture.updates("tool_call_update").length;
          return n > 0 ? n : undefined;
        }, 8000);
        expect(replayed ?? 0).toBeGreaterThan(0);
      } finally {
        await b.cleanup();
      }
    }, 60_000);
  });
}
