import { describe, expect, it } from "vitest";
import { E2E } from "./config";

/**
 * Fail-loud precondition for the live e2e suite. Without E2E_GATEWAY_TOKEN every
 * arm self-skips and `vitest run` exits 0 — a green run that tested nothing. This
 * one non-skipped test turns a missing token into a RED run.
 */
describe("live e2e preconditions", () => {
  it("requires E2E_GATEWAY_TOKEN (else the suite would skip-to-green)", () => {
    expect(
      E2E.hasToken,
      "E2E_GATEWAY_TOKEN is not set — every adapter arm would skip and the run " +
        "would pass without testing anything. Mint one via e2e/run-e2e.sh or " +
        "set E2E_GATEWAY_TOKEN against a reachable E2E_GATEWAY_URL.",
    ).toBe(true);
  });

  // When a token is present, the codex arm must not skip silently — a missing
  // binary would let the run pass with zero codex coverage.
  it("requires the native codex binary when a token is set (else codex skips-to-green)", () => {
    if (!E2E.hasToken) return; // no token → whole suite skips; nothing to guard
    expect(
      E2E.skipReason("codex"),
      "E2E_GATEWAY_TOKEN is set but the native codex binary is missing — the " +
        "codex arm would silently skip and the run would pass without exercising " +
        "the codex adapter. Ensure apps/code/scripts/download-binaries.mjs ran.",
    ).toBeNull();
  });
});
