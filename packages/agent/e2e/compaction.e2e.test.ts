import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Adapter, E2E } from "./config";
import {
  cleanupRepo,
  killCodexStragglers,
  openSession,
  setupRepo,
} from "./driver";

/**
 * Live compaction e2e — codex only (for now).
 *
 * codex auto-compacts when the context crosses its `model_auto_compact_token_limit`.
 * We spawn with a low limit and make turn 1 a big cheap INPUT blob (tiny output),
 * so the SECOND turn trips compaction; the adapter must surface it to the host via
 * `_posthog/compact_boundary` (which clears `isCompacting` + drains the queue).
 * Opt-in — self-skips without `E2E_GATEWAY_TOKEN` / the native binary.
 *
 * Claude is excluded: its manual `/compact` hangs the adapter's `prompt()` — the
 * SDK signals /compact completion with a `status`/`compact_result` message, not
 * the `result` message `prompt()` resolves on, so the turn never returns (a
 * separate claude-adapter issue), and filling its ~200k window to force AUTO
 * compaction is too costly for an e2e. Re-enable by adding "claude" to ADAPTERS
 * once /compact resolves cleanly.
 *
 * NOTE: the codex limit/turn count may need tuning on a new model — if it never
 * compacts, codex may clamp the limit or the baseline exceeds it; raise the limit
 * and FILLER together. The failure message prints the methods seen.
 */
const ADAPTERS: Adapter[] = ["codex"];

// codex: a limit above codex's resident baseline (so turn 1 leaves real content
// to compact) with FILLER > limit so the crossing is baseline-independent.
const AUTO_COMPACT_TOKEN_LIMIT = 16000;
// ~20k tokens (~45 chars ≈ 11 tokens × 1800) — larger than the limit above.
const FILLER = "The quick brown fox jumps over the lazy dog. ".repeat(1800);
const MAX_CODEX_TURNS = 3;

for (const adapter of ADAPTERS) {
  const skip = E2E.skipReason(adapter);
  const title = `compaction (${adapter})${skip ? ` — SKIPPED (${skip})` : ""}`;

  describe.skipIf(!!skip)(title, () => {
    let repo: string;

    beforeAll(() => {
      if (adapter === "codex") killCodexStragglers();
      E2E.configureEnv(adapter);
      repo = setupRepo();
    });

    afterAll(() => {
      cleanupRepo(repo);
    });

    it("surfaces a compaction to the host via compact_boundary", async () => {
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions:
          adapter === "codex"
            ? E2E.codexOptions(repo, {
                // The model-scoped key is the effective one; set both to be safe.
                model_auto_compact_token_limit: AUTO_COMPACT_TOKEN_LIMIT,
                auto_compact_token_limit: AUTO_COMPACT_TOKEN_LIMIT,
              })
            : undefined,
        meta: {
          systemPrompt: "You are a coding assistant in a tiny test repo.",
          model: E2E.model(adapter),
          permissionMode: "bypassPermissions",
          taskRunId: "e2e-compaction",
        },
      });
      try {
        const compacted = () =>
          s.capture.extMethods().includes("_posthog/compact_boundary");

        if (adapter === "claude") {
          // A little conversation so there's content to compact, then the
          // cheap deterministic trigger: manual /compact.
          await s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: "Reply with only: hello." }],
          });
          await s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: "/compact" }],
          });
        } else {
          // codex: turn 1 is a big cheap input blob that fills the context past
          // the low limit (tiny output); turn 2+ trips the auto-compaction on
          // the way in. Stop as soon as the boundary is surfaced.
          for (let i = 0; i < MAX_CODEX_TURNS && !compacted(); i++) {
            const text =
              i === 0
                ? `Reference text — do not summarize, reply with only: OK.\n\n${FILLER}`
                : "Reply with only: DONE.";
            await s.conn.prompt({
              sessionId: s.sessionId,
              prompt: [{ type: "text", text }],
            });
          }
        }

        expect(
          compacted(),
          `expected a _posthog/compact_boundary; saw methods: ${s.capture
            .extMethods()
            .join(", ")}`,
        ).toBe(true);
      } finally {
        await s.cleanup();
      }
    }, 300_000);
  });
}
