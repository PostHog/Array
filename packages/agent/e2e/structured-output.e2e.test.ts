import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Adapter, E2E } from "./config";
import {
  cleanupRepo,
  killCodexStragglers,
  openSession,
  setupRepo,
} from "./driver";

/**
 * Live structured-output e2e: both adapters constrain the final assistant message
 * to a JSON schema (`_meta.jsonSchema`) and deliver the parsed object via the
 * `onStructuredOutput` callback — the contract the signals pipeline relies on
 * (codex: native `outputSchema`; claude: SDK `outputFormat: json_schema`). The
 * answer is deterministic (capital of France) so a cheap model passes reliably.
 * Opt-in (same gating as the lifecycle suite); run via `pnpm test:e2e`.
 */
const ADAPTERS: Adapter[] = ["claude", "codex"];

const SCHEMA = {
  type: "object",
  properties: { capital: { type: "string" } },
  required: ["capital"],
  additionalProperties: false,
};

for (const adapter of ADAPTERS) {
  const skip = E2E.skipReason(adapter);
  const title = `structured output (${adapter})${skip ? ` — SKIPPED (${skip})` : ""}`;

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

    it("delivers schema-constrained structured output", async () => {
      let captured: Record<string, unknown> | undefined;
      const s = await openSession({
        adapter,
        cwd: repo,
        codexOptions: adapter === "codex" ? E2E.codexOptions(repo) : undefined,
        onStructuredOutput: async (o) => {
          captured = o;
        },
        meta: {
          systemPrompt: "You answer strictly with JSON matching the schema.",
          model: E2E.model(adapter),
          permissionMode: "bypassPermissions",
          jsonSchema: SCHEMA,
          // Prod always sets taskRunId — exercise structured output and the
          // session ext-notification together, the way the host actually drives it.
          taskRunId: "e2e-structured",
        },
      });
      try {
        const res = await s.conn.prompt({
          sessionId: s.sessionId,
          prompt: [
            {
              type: "text",
              text: "What is the capital of France? Answer using the required JSON schema.",
            },
          ],
        });
        expect(res.stopReason).toBe("end_turn");
        expect(captured, "onStructuredOutput should fire").toBeTruthy();
        expect(typeof captured?.capital).toBe("string");
        expect((captured?.capital as string).toLowerCase()).toContain("paris");
        // With taskRunId set, the session is mapped for the host too.
        expect(s.capture.extMethods()).toContain("_posthog/sdk_session");
      } finally {
        await s.cleanup();
      }
    }, 120_000);
  });
}
